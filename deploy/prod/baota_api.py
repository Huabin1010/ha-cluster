#!/usr/bin/env python3
"""宝塔 Linux 面板 API 客户端：建站 / 反代 / SSL。

凭据（勿提交）：
  HA_BT_PANEL   面板根 URL，如 http://42.193.236.123:8888
  HA_BT_KEY     API 接口密钥（面板「API 接口」里的密钥，非安全入口）
  或从 docs/credentials.local.md 的「宝塔 · 42」段解析（可选）

签名：request_token = md5(request_time + md5(api_key))

用法：
  python deploy/prod/baota_api.py ping
  python deploy/prod/baota_api.py ensure-site --domain cl.qzsyzn.com --path /www/wwwroot/cl.qzsyzn.com
  python deploy/prod/baota_api.py ensure-proxy --domain cl.qzsyzn.com --target http://127.0.0.1:18082
  python deploy/prod/baota_api.py ensure-ssl --domain cl.qzsyzn.com
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]


def _md5(s: str) -> str:
    return hashlib.md5(s.encode("utf-8")).hexdigest()


def load_creds() -> tuple[str, str]:
    panel = os.environ.get("HA_BT_PANEL", "").rstrip("/")
    key = os.environ.get("HA_BT_KEY", "").strip()
    if panel and key:
        return panel, key
    cred = ROOT / "docs" / "credentials.local.md"
    if cred.is_file():
        text = cred.read_text(encoding="utf-8")
        m_panel = re.search(r"HA_BT_PANEL\s*[:=]\s*`?(\S+?)`?\s*$", text, re.M)
        m_key = re.search(r"HA_BT_KEY\s*[:=]\s*`?(\S+?)`?\s*$", text, re.M)
        if not panel and m_panel:
            panel = m_panel.group(1).rstrip("/")
        if not key and m_key:
            key = m_key.group(1).strip()
    if not panel or not key:
        raise SystemExit("需要 HA_BT_PANEL + HA_BT_KEY（环境变量或 credentials.local.md）")
    return panel, key


class BaotaClient:
    def __init__(self, panel: str, key: str) -> None:
        self.panel = panel.rstrip("/")
        self.key = key

    def _auth(self) -> dict[str, str]:
        now = str(int(time.time()))
        return {
            "request_time": now,
            "request_token": _md5(now + _md5(self.key)),
        }

    def post(self, path: str, data: dict[str, Any] | None = None) -> Any:
        body = self._auth()
        if data:
            body.update({k: str(v) if not isinstance(v, str) else v for k, v in data.items()})
        encoded = urllib.parse.urlencode(body).encode("utf-8")
        url = self.panel + path
        req = urllib.request.Request(
            url,
            data=encoded,
            method="POST",
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                raw = resp.read().decode("utf-8", errors="replace")
        except urllib.error.HTTPError as e:
            raw = e.read().decode("utf-8", errors="replace")
            raise SystemExit(f"HTTP {e.code} {url}: {raw[:500]}") from e
        except urllib.error.URLError as e:
            raise SystemExit(f"连接失败 {url}: {e}") from e
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            return {"raw": raw}

    def ping(self) -> Any:
        # 常见探测接口
        for path in ("/system?action=GetSystemTotal", "/system?action=GetNetWork"):
            out = self.post(path)
            if isinstance(out, dict) and (out.get("status") is not False or "memTotal" in out or "cpuNum" in out):
                return out
        return self.post("/system?action=GetSystemTotal")

    def list_sites(self) -> Any:
        return self.post("/data?action=getData", {"table": "sites", "limit": "1000", "p": "1", "search": ""})

    def find_site(self, domain: str) -> dict[str, Any] | None:
        data = self.list_sites()
        rows = data.get("data") if isinstance(data, dict) else None
        if not isinstance(rows, list):
            return None
        for row in rows:
            if row.get("name") == domain:
                return row
        return None

    def add_site(self, domain: str, path: str) -> Any:
        # type_id=-1 默认分类；version=00 纯静态
        payload = {
            "webname": json.dumps({"domain": domain, "domainlist": [], "count": 0}),
            "path": path,
            "type_id": "-1",
            "type": "PHP",
            "version": "00",
            "port": "80",
            "ps": "ha-cluster",
            "ftp": "false",
            "sql": "false",
        }
        return self.post("/site?action=AddSite", payload)

    def ensure_site(self, domain: str, path: str) -> dict[str, Any]:
        existing = self.find_site(domain)
        if existing:
            return {"ok": True, "created": False, "site": existing}
        out = self.add_site(domain, path)
        return {"ok": True, "created": True, "result": out, "site": self.find_site(domain)}

    def set_proxy(self, site_name: str, target: str, proxy_name: str = "ha-api") -> Any:
        """开启全站反向代理到 target（需 websocket）。"""
        # 先尝试新版 proxy 接口
        proxyname = proxy_name
        proxydir = "/"
        advanced = {
            "proxyname": proxyname,
            "sitename": site_name,
            "proxydir": proxydir,
            "proxysite": target,
            "todomain": "$host",
            "type": "1",
            "cache": "0",
            "subfilter": json.dumps([{"sub1": "", "sub2": ""}]),
            "advanced": "0",
            "cachetime": "1",
        }
        # CreateProxy / ModifyProxy / GetProxyList
        listed = self.post("/site?action=GetProxyList", {"sitename": site_name})
        exists = False
        if isinstance(listed, list):
            exists = any(p.get("proxyname") == proxyname for p in listed if isinstance(p, dict))
        elif isinstance(listed, dict) and isinstance(listed.get("data"), list):
            exists = any(p.get("proxyname") == proxyname for p in listed["data"] if isinstance(p, dict))

        if exists:
            return self.post("/site?action=ModifyProxy", advanced)
        return self.post("/site?action=CreateProxy", advanced)

    def ensure_proxy(self, domain: str, target: str) -> Any:
        site = self.find_site(domain)
        if not site:
            raise SystemExit(f"站点不存在: {domain}，先 ensure-site")
        return self.set_proxy(domain, target)

    def ensure_dns(self, domains: list[str], value: str | None = None) -> Any:
        """经宝塔 DNSPod 插件创建 A 记录（需面板已绑定腾讯云密钥）。

        domains: 完整 FQDN 列表，如 cl.qzsyzn.com、*.cl.qzsyzn.com
        value: 空则用面板本机公网 IP（create_record_bysite）
        """
        if value:
            # 精确 create_record：按根域拆分
            results = []
            for fqdn in domains:
                fqdn = fqdn.strip()
                if not fqdn:
                    continue
                # 粗分：*.a.b.com / a.b.com → Domain=b.com 由插件 get_root_domain 更准，这里走 bysite
                results.append(fqdn)
            return self.post(
                "/plugin?action=a&name=dnspod&s=create_record_bysite",
                {"domains": json.dumps(results)},
            )
        return self.post(
            "/plugin?action=a&name=dnspod&s=create_record_bysite",
            {"domains": json.dumps(domains)},
        )

    def apply_ssl(self, domain: str) -> Any:
        """申请 Let's Encrypt（HTTP 验证）。域名 DNS 必须已指向本机，否则 ACME 失败。"""
        site = self.find_site(domain)
        if not site:
            raise SystemExit(f"站点不存在: {domain}")
        path = site.get("path") or f"/www/wwwroot/{domain}"
        payload = {
            "domains": json.dumps([domain]),
            "auth_type": "http",
            "auth_to": path,
            "auto_wildcard": "0",
            "id": str(site.get("id", "")),
        }
        out = self.post("/acme?action=apply_cert_api", payload)
        if isinstance(out, dict) and out.get("status") is False:
            # 常见原因：DNS 未解析到本机
            out2 = self.post(
                "/site?action=ApplyCertByDnsOrHttp",
                {
                    "siteName": domain,
                    "domains": json.dumps([domain]),
                    "force": "true",
                    "email": os.environ.get("HA_BT_SSL_EMAIL", "admin@" + domain),
                    "apply_type": "http",
                },
            )
            if isinstance(out2, dict):
                out = {"primary": out, "fallback": out2}
        # 申请成功后把证书写入站点（部分面板版本不会自动挂载）
        deployed = None
        if isinstance(out, dict) and out.get("status") is True and out.get("private_key") and out.get("cert"):
            deployed = self.post(
                "/site?action=SetSSL",
                {
                    "type": "1",
                    "siteName": domain,
                    "key": out["private_key"],
                    "csr": out["cert"] + (out.get("root") or ""),
                },
            )
        https = self.post("/site?action=HttpToHttps", {"siteName": domain})
        return {"ssl": out, "deploy": deployed, "http_to_https": https}


def main() -> int:
    ap = argparse.ArgumentParser(description="宝塔 API：建站/反代/SSL")
    sub = ap.add_subparsers(dest="cmd", required=True)

    sub.add_parser("ping", help="探测面板 API")
    p_site = sub.add_parser("ensure-site", help="确保站点存在")
    p_site.add_argument("--domain", required=True)
    p_site.add_argument("--path", required=True)
    p_proxy = sub.add_parser("ensure-proxy", help="确保反向代理")
    p_proxy.add_argument("--domain", required=True)
    p_proxy.add_argument("--target", default="http://127.0.0.1:18082")
    p_ssl = sub.add_parser("ensure-ssl", help="申请并强制 HTTPS")
    p_ssl.add_argument("--domain", required=True)
    p_dns = sub.add_parser("ensure-dns", help="经宝塔 DNSPod 插件添加 A 记录")
    p_dns.add_argument(
        "--domains",
        default="cl.qzsyzn.com,*.cl.qzsyzn.com",
        help="逗号分隔 FQDN，默认主域+泛域",
    )
    p_all = sub.add_parser("setup-cl", help="一键：DNS+建站+反代+SSL（cl.qzsyzn.com）")
    p_all.add_argument("--domain", default="cl.qzsyzn.com")
    p_all.add_argument("--path", default="/www/wwwroot/cl.qzsyzn.com")
    p_all.add_argument("--target", default="http://127.0.0.1:18082")
    p_all.add_argument("--skip-ssl", action="store_true")
    p_all.add_argument("--skip-dns", action="store_true")

    args = ap.parse_args()
    panel, key = load_creds()
    client = BaotaClient(panel, key)

    if args.cmd == "ping":
        print(json.dumps(client.ping(), ensure_ascii=False, indent=2))
        return 0
    if args.cmd == "ensure-site":
        print(json.dumps(client.ensure_site(args.domain, args.path), ensure_ascii=False, indent=2))
        return 0
    if args.cmd == "ensure-proxy":
        print(json.dumps(client.ensure_proxy(args.domain, args.target), ensure_ascii=False, indent=2))
        return 0
    if args.cmd == "ensure-ssl":
        print(json.dumps(client.apply_ssl(args.domain), ensure_ascii=False, indent=2))
        return 0
    if args.cmd == "ensure-dns":
        domains = [d.strip() for d in args.domains.split(",") if d.strip()]
        print(json.dumps(client.ensure_dns(domains), ensure_ascii=False, indent=2))
        return 0
    if args.cmd == "setup-cl":
        if not args.skip_dns:
            dns_domains = [args.domain, "*." + args.domain]
            dns = client.ensure_dns(dns_domains)
            print("dns:", json.dumps(dns, ensure_ascii=False))
        site = client.ensure_site(args.domain, args.path)
        print("site:", json.dumps(site, ensure_ascii=False))
        proxy = client.ensure_proxy(args.domain, args.target)
        print("proxy:", json.dumps(proxy, ensure_ascii=False))
        if not args.skip_ssl:
            ssl = client.apply_ssl(args.domain)
            print("ssl:", json.dumps(ssl, ensure_ascii=False))
        return 0
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
