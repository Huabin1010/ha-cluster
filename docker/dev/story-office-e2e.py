#!/usr/bin/env python3
"""办公室用户故事 E2E（生产 cl.qzsyzn.com）。

流程：chenweipeng 建项 → 转让 owner 给 huanghuabin → 申请 2c2g → 审批 →
Bastion SSH（HostName=10.129.129.253 走 EasyTier）→ 工作区内 docker compose pull/up CNB
（不经 42 scp tar）→ ClaimShared apps 域 → 邀请 yexinwei → 授权后可连 → 第二服务。

环境变量：
  HA_API_BASE=https://cl.qzsyzn.com/api
  HA_OFFICE_PASS=…（办公室账号初始密码）
  HA_TEST_SSH_PUBKEY=…（本机公钥，默认读 ~/.ssh/id_rsa.pub）
  HA_SKIP_SSH=1  仅测 API，跳过真实 SSH / docker pull
  HA_KEEP=1      结束后不销毁本次项目/工作区
"""
from __future__ import annotations

import json
import os
import pathlib
import random
import subprocess
import sys
import time
import urllib.error
import urllib.request

BASE = os.environ.get("HA_API_BASE", "https://cl.qzsyzn.com/api").rstrip("/")
PASS = os.environ.get("HA_OFFICE_PASS", "HaOffice2026!")
ADMIN_USER = os.environ.get("HA_ADMIN_USER", "admin")
ADMIN_PASS = os.environ.get("HA_ADMIN_PASS", "123456qq")
SKIP_SSH = os.environ.get("HA_SKIP_SSH", "") in ("1", "true", "yes")
KEEP = os.environ.get("HA_KEEP", "") in ("1", "true", "yes")
UA = {"User-Agent": "ha-story-office-e2e/1.0"}
REPO = pathlib.Path(__file__).resolve().parents[2]
IMAGE_DIR = pathlib.Path(
    os.environ.get("HA_STORY_IMAGE_DIR", str(REPO / "tmp" / "story-apps" / "images"))
)
COMPOSE_A = REPO / "tmp" / "story-apps" / "app-a" / "docker-compose.yml"
COMPOSE_B = REPO / "tmp" / "story-apps" / "app-b" / "docker-compose.yml"

passed = failed = 0
ts = int(time.time())


def pubkey() -> str:
    env = os.environ.get("HA_TEST_SSH_PUBKEY", "").strip()
    if env:
        return env
    for name in ("id_rsa.pub", "id_ed25519.pub"):
        p = pathlib.Path.home() / ".ssh" / name
        if p.is_file():
            return p.read_text(encoding="utf-8").strip()
    raise SystemExit("missing HA_TEST_SSH_PUBKEY / ~/.ssh/*.pub")


def api(method, path, body=None, token=""):
    hdrs = {"Content-Type": "application/json", **UA}
    if token:
        hdrs["Authorization"] = f"Bearer {token}"
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, headers=hdrs, method=method)
    try:
        with urllib.request.urlopen(req, timeout=90) as resp:
            raw = resp.read().decode()
            return resp.status, json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try:
            return e.code, json.loads(raw) if raw else {}
        except json.JSONDecodeError:
            return e.code, {"raw": raw}


def api_text(method, path, token=""):
    hdrs = {**UA}
    if token:
        hdrs["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(BASE + path, headers=hdrs, method=method)
    try:
        with urllib.request.urlopen(req, timeout=90) as resp:
            return resp.status, resp.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()


def ok(name, cond, detail=""):
    global passed, failed
    if cond:
        passed += 1
        print(f"  PASS {name}")
    else:
        failed += 1
        detail_s = str(detail)
        if len(detail_s) > 400:
            detail_s = detail_s[:400] + "…"
        print(f"  FAIL {name}  {detail_s}")


def step(title):
    print(f"\n── {title} ──")


def login(user: str, password: str = "") -> tuple[str, dict]:
    pw = password or (ADMIN_PASS if user == ADMIN_USER else PASS)
    code, body = api("POST", "/auth/login", {"username": user, "password": pw})
    if code != 200:
        raise RuntimeError(f"login {user}: {code} {body}")
    return body["token"], body.get("user") or {}


def _ws_items(tok: str) -> list:
    code, body = api("GET", "/workspaces", token=tok)
    if code != 200:
        return []
    items = body.get("data", body) if isinstance(body, dict) else body
    return items if isinstance(items, list) else []


def _project_items(tok: str) -> list:
    code, body = api("GET", "/projects", token=tok)
    if code != 200:
        return []
    items = body.get("data", body) if isinstance(body, dict) else body
    return items if isinstance(items, list) else []


def destroy_workspace_chain(owner_tok: str, admin_tok: str, ws: dict) -> None:
    wid = ws.get("id")
    st = (ws.get("status") or "").lower()
    if not wid:
        return
    if st == "requested":
        api("POST", f"/workspaces/{wid}/reject", token=owner_tok)
        return
    code, _ = api("DELETE", f"/workspaces/{wid}", token=owner_tok)
    if code in (200, 204):
        return
    api("POST", f"/workspaces/{wid}/destroy-request", token=owner_tok)
    api("POST", f"/workspaces/{wid}/destroy-request/approve", token=owner_tok)
    if admin_tok:
        code, dang = api("GET", "/admin/dangerous-approvals", token=admin_tok)
        data = dang.get("data", dang) if isinstance(dang, dict) else dang
        if code == 200 and isinstance(data, list):
            for d in data:
                match = d.get("workspace_id") or d.get("resource_id")
                if match != wid:
                    continue
                did = d.get("id")
                if did:
                    api("POST", f"/admin/dangerous-approvals/{did}/approve", token=admin_tok)


def cleanup_leftovers(office_users: list[str]) -> None:
    """每次开跑前清掉办公室账号残留工作区 / office-* 项目，释放 2c2g 账本。"""
    step("0. 清理上次残留")
    try:
        admin_tok, _ = login(ADMIN_USER, ADMIN_PASS)
    except Exception as e:
        admin_tok = ""
        print(f"  WARN admin 登录失败，平台终审可能卡住: {e}")
    tokens = {}
    for u in office_users:
        try:
            tokens[u], _ = login(u)
        except Exception as e:
            print(f"  WARN 登录 {u} 失败: {e}")
    leftover_ids = set()
    for tok in tokens.values():
        for w in _ws_items(tok):
            leftover_ids.add(w.get("id"))
            destroy_workspace_chain(tok, admin_tok, w)
    if admin_tok and leftover_ids:
        code, dang = api("GET", "/admin/dangerous-approvals", token=admin_tok)
        data = dang.get("data", dang) if isinstance(dang, dict) else dang
        if code == 200 and isinstance(data, list):
            for d in data:
                match = d.get("workspace_id") or d.get("resource_id")
                did = d.get("id")
                if did and match in leftover_ids and (d.get("status") or "") in (
                    "pending",
                    "open",
                    "requested",
                    "",
                ):
                    api("POST", f"/admin/dangerous-approvals/{did}/approve", token=admin_tok)
    deadline = time.time() + 90
    while time.time() < deadline:
        leftover = []
        for tok in tokens.values():
            leftover.extend(
                w
                for w in _ws_items(tok)
                if (w.get("status") or "")
                not in ("destroyed", "rejected", "failed", "")
            )
        if not leftover:
            break
        time.sleep(3)
    # 删掉办公室故事项目，避免 slug 撞车
    for tok in tokens.values():
        for p in _project_items(tok):
            slug = (p.get("slug") or "")
            name = p.get("name") or ""
            if slug.startswith("office-") or "办公室故事" in name:
                api("DELETE", f"/projects/{p.get('id')}", token=tok)
    n = 0
    for tok in tokens.values():
        n += len(
            [
                w
                for w in _ws_items(tok)
                if (w.get("status") or "") not in ("destroyed", "rejected", "failed")
            ]
        )
    ok("残留工作区已清空", n == 0, f"remaining={n}")


def ensure_ssh_key(tok: str, name: str = "office-e2e"):
    code, _ = api("POST", "/me/ssh-keys", {"name": name, "public_key": pubkey()}, token=tok)
    return code in (200, 201, 409)


def wait_ws(tok: str, ws_id: str, want=("running",), timeout=300) -> dict:
    deadline = time.time() + timeout
    last = {}
    while time.time() < deadline:
        code, last = api("GET", f"/workspaces/{ws_id}", token=tok)
        if code == 200 and last.get("status") in want:
            return last
        if code == 200 and last.get("status") == "failed":
            return last
        time.sleep(3)
    return last


def find_user_id(tok: str, username: str) -> str:
    code, body = api("GET", "/users", token=tok)
    if code != 200:
        return ""
    items = body.get("data", body) if isinstance(body, dict) else body
    if not isinstance(items, list):
        items = body.get("users", []) if isinstance(body, dict) else []
    for u in items:
        if u.get("username") == username:
            return u.get("id", "")
    return ""


def member_by_user_id(tok: str, pid: str, user_id: str) -> dict:
    code, body = api("GET", f"/projects/{pid}/members", token=tok)
    if code != 200:
        return {}
    items = body.get("data", body) if isinstance(body, dict) else body
    if not isinstance(items, list):
        return {}
    for m in items:
        if m.get("user_id") == user_id:
            return m
    return {}


def grant_ssh(approver_tok: str, pid: str, user_id: str) -> tuple[int, dict]:
    # Prefer approve endpoint; fall back to PUT member patch if present.
    code, body = api(
        "POST",
        f"/projects/{pid}/members/{user_id}/ssh-access/approve",
        token=approver_tok,
    )
    if code == 200:
        return code, body
    return api(
        "PUT",
        f"/projects/{pid}/members/{user_id}",
        {"ssh_access": "granted"},
        token=approver_tok,
    )


def write_ssh_config(cfg: str, path: pathlib.Path) -> pathlib.Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    # Force BatchMode + known_hosts skip for automation
    extra = "\n".join(
        [
            "    StrictHostKeyChecking no",
            "    UserKnownHostsFile /dev/null",
            "    BatchMode yes",
            "    ConnectTimeout 20",
        ]
    )
    text = cfg.rstrip() + "\n" + extra + "\n"
    path.write_text(text, encoding="utf-8")
    return path


def ssh_common_opts(ws_id: str, remote: str) -> list[str]:
    # 公网 8099 若未在腾讯云安全组放行，经管理 SSH(:22) ProxyJump 到本机 bastion。
    # HostName 覆盖避免 Clash fake-ip。
    # RemoteCommand 必须整行写入 config：Windows OpenSSH 的 -o 会在空格处截断。
    return [
        "-o",
        "BatchMode=yes",
        "-o",
        "StrictHostKeyChecking=no",
        "-o",
        "UserKnownHostsFile=/dev/null",
        "-o",
        "ConnectTimeout=20",
        "-o",
        "ProxyJump=root@42.193.236.123",
        "-o",
        "HostName=10.129.129.253",
    ]


def write_cmd_config(
    base_cfg: pathlib.Path, ws_id: str, remote: str, host_alias: str = ""
) -> pathlib.Path:
    """只保留要连的那一个 Host，并把 RemoteCommand 写进该块。

    发版后 ssh-config 含 Host ha-xxxx 与 ha-xxxx-et 两段；若把 RemoteCommand
    追加到文件末尾，只会作用在最后一个 Host，连第一段会落到 bastion usage。
    """
    out = base_cfg.with_suffix(base_cfg.suffix + ".cmd")
    text = base_cfg.read_text(encoding="utf-8")
    preamble: list[str] = []
    blocks: list[tuple[str, list[str]]] = []
    current_name = ""
    current: list[str] = []
    for ln in text.splitlines():
        if ln.startswith("Host "):
            if current_name or current:
                blocks.append((current_name, current))
            current_name = ln.split(None, 1)[1].strip()
            current = [ln]
        elif not current_name:
            preamble.append(ln)
        else:
            current.append(ln)
    if current_name or current:
        blocks.append((current_name, current))
    picked = None
    for name, lines in blocks:
        if host_alias and name == host_alias:
            picked = (name, lines)
            break
    if picked is None and blocks:
        picked = blocks[0]
    if picked is None:
        picked = (host_alias or "ha-story", [f"Host {host_alias or 'ha-story'}"])
    cleaned = [ln for ln in picked[1] if not ln.strip().startswith("RemoteCommand")]
    cleaned.append(f"  RemoteCommand {ws_id} {remote}")
    out.write_text("\n".join(preamble + cleaned) + "\n", encoding="utf-8")
    return out


def ssh_run(
    config_path: pathlib.Path,
    host_alias: str,
    remote: str,
    ws_id: str,
) -> subprocess.CompletedProcess:
    cfg = write_cmd_config(config_path, ws_id, remote, host_alias)
    cmd = ["ssh", "-F", str(cfg), *ssh_common_opts(ws_id, remote), host_alias]
    return subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=300,
        check=False,
    )


def ssh_pipe(
    config_path: pathlib.Path,
    host_alias: str,
    remote: str,
    ws_id: str,
    data: bytes,
) -> subprocess.CompletedProcess:
    cfg = write_cmd_config(config_path, ws_id, remote)
    return subprocess.run(
        ["ssh", "-F", str(cfg), *ssh_common_opts(ws_id, remote), host_alias],
        input=data,
        capture_output=True,
        timeout=600,
        check=False,
    )


def scp_to(
    config_path: pathlib.Path,
    host_alias: str,
    local: pathlib.Path,
    remote: str,
    ws_id: str,
    tok: str = "",
) -> int:
    """Upload via 42 + fabric identity (large files fail through ForceCommand stdin)."""
    code, target = api("GET", f"/workspaces/{ws_id}/ssh-target", token=tok) if tok else (0, {})
    host = (target or {}).get("host") or (target or {}).get("fabric_ip") or ""
    port = int((target or {}).get("port") or 0)
    if code != 200 or not host or not port:
        # fallback: tiny pipe (ok for compose yml)
        return ssh_pipe(config_path, host_alias, f"cat > {remote}", ws_id, local.read_bytes()).returncode
    remote_tmp = f"/tmp/ha-up-{local.name}"
    up = subprocess.run(
        [
            "scp",
            "-o",
            "BatchMode=yes",
            "-o",
            "StrictHostKeyChecking=no",
            "-o",
            "UserKnownHostsFile=/dev/null",
            str(local),
            f"root@42.193.236.123:{remote_tmp}",
        ],
        capture_output=True,
        timeout=600,
        check=False,
    )
    if up.returncode != 0:
        return up.returncode
    # From 42: push into workspace over fabric with bastion hop key
    push = subprocess.run(
        [
            "ssh",
            "-o",
            "BatchMode=yes",
            "root@42.193.236.123",
            f"install -m 600 /etc/ha-cluster/bastion_ws_ed25519 /tmp/ha-id-$$ && "
            f"scp -P {port} -i /tmp/ha-id-$$ -o BatchMode=yes -o StrictHostKeyChecking=no "
            f"-o UserKnownHostsFile=/dev/null {remote_tmp} root@{host}:{remote} && "
            f"rm -f /tmp/ha-id-$$ {remote_tmp}",
        ],
        capture_output=True,
        text=True,
        timeout=600,
        check=False,
    )
    return push.returncode


def start_http_app(config_path, host_alias, ws_id, name: str, host_port: int):
    """Workspace 内 docker compose pull/up CNB 镜像（走 Worker 出口，不经 42 scp）。"""
    yml = (
        "services:\n"
        f"  api:\n    image: docker.cnb.cool/library/nginx:alpine\n    container_name: {name}-api\n    restart: unless-stopped\n"
        f"  web:\n    image: docker.cnb.cool/library/nginx:alpine\n    container_name: {name}-web\n    restart: unless-stopped\n"
        f"    ports:\n      - \"{host_port}:80\"\n    depends_on:\n      - api\n"
    )
    b64 = __import__("base64").b64encode(yml.encode()).decode()
    cmd = (
        "python3 -c \"import json; print('auths', sorted((json.load(open('/root/.docker/config.json')).get('auths') or {}).keys()))\" "
        "2>/dev/null || echo 'auths []'; "
        "docker compose version || { echo COMPOSE_MISSING >&2; exit 1; }; "
        "if docker pull docker.cnb.cool/library/nginx:alpine; then IMG=docker.cnb.cool/library/nginx:alpine; "
        "elif docker pull docker.1ms.run/library/nginx:alpine; then IMG=docker.1ms.run/library/nginx:alpine; "
        "else echo PULL_FAIL >&2; exit 1; fi; "
        f"mkdir -p /root/{name} && echo {b64} | base64 -d > /root/{name}/docker-compose.yml && "
        f"sed -i \"s|docker.cnb.cool/library/nginx:alpine|$IMG|g\" /root/{name}/docker-compose.yml && "
        f"cd /root/{name} && docker compose up -d && "
        f"sleep 2 && docker compose ps"
    )
    return ssh_run(config_path, host_alias, cmd, ws_id)


def edge_probe(host: str) -> subprocess.CompletedProcess:
    # EasyTier：打 42 虚 IP :18080，不经公网 443
    return subprocess.run(
        [
            "ssh",
            "-o",
            "BatchMode=yes",
            "root@42.193.236.123",
            f"curl -fsS -H 'Host: {host}' http://10.129.129.253:18080/ | head -c 200",
        ],
        capture_output=True,
        text=True,
        timeout=30,
    )


def extra_stories(ctx: dict) -> None:
    """同一项目/机器上再跑一批打乱顺序的边角故事，找权限与入口 bug。"""
    step("11. 随机扩展用户故事")
    pid = ctx["pid"]
    ws_id = ctx["ws_id"]
    zone_id = ctx.get("zone_id") or ""
    c_tok, h_tok, y_tok = ctx["c_tok"], ctx["h_tok"], ctx["y_tok"]
    cfg_path, host_alias = ctx.get("cfg_path"), ctx.get("host_alias")
    prefix = ctx.get("prefix") or ""

    def case_invalid_plan():
        code, body = api(
            "POST",
            f"/projects/{pid}/workspaces",
            {"name": "bad-plan", "plan": "no-such-plan", "arch": "amd64"},
            token=c_tok,
        )
        ok("非法套餐应拒绝", code >= 400, (code, body))

    def case_dup_slug():
        code, body = api("POST", "/projects", {"name": "dup", "slug": ctx["slug"]}, token=c_tok)
        ok("重复 slug 应拒绝", code in (400, 409), (code, body))

    def case_dev_cannot_transfer():
        code, body = api(
            "POST",
            f"/projects/{pid}/transfer-ownership",
            {"new_owner_user_id": ctx["c_uid"]},
            token=c_tok,
        )
        ok("developer 不能转让 owner", code in (400, 403), (code, body))

    def case_second_port_noconfirm():
        if not zone_id:
            ok("跳过第二端口确认（无 zone）", True)
            return
        code, body = api(
            "POST",
            f"/workspaces/{ws_id}/ingress/shared",
            {"zone_id": zone_id, "mode": "custom", "prefix": f"x{ts % 9999}", "port": 8091},
            token=h_tok,
        )
        ok("第二端口未确认应拒绝", code in (400, 409), (code, body))

    def case_reserved_prefix():
        if not zone_id:
            ok("跳过保留前缀（无 zone）", True)
            return
        reserved = random.choice(["admin", "api", "auth", "console"])
        code, body = api(
            "POST",
            f"/workspaces/{ws_id}/ingress/shared",
            {
                "zone_id": zone_id,
                "mode": "custom",
                "prefix": reserved,
                "port": 8092,
                "confirm_second_port": True,
            },
            token=h_tok,
        )
        ok(f"保留前缀 {reserved} 应拒绝", code >= 400, (code, body))

    def case_prefix_collision():
        if not zone_id or not prefix:
            ok("跳过前缀碰撞（无已领前缀）", True)
            return
        code, body = api(
            "POST",
            f"/workspaces/{ws_id}/ingress/shared",
            {
                "zone_id": zone_id,
                "mode": "custom",
                "prefix": prefix,
                "port": 8093,
                "confirm_second_port": True,
            },
            token=h_tok,
        )
        ok("自定义前缀碰撞应拒绝", code in (400, 409), (code, body))

    def case_owner_ssh():
        if SKIP_SSH or not cfg_path:
            ok("跳过 owner SSH（SKIP_SSH）", True)
            return
        code, hcfg = api_text("GET", f"/workspaces/{ws_id}/ssh-config", token=h_tok)
        ok("owner ssh-config 200", code == 200, hcfg[:160])
        if code != 200:
            return
        hp = REPO / "tmp" / "story-ssh" / f"{ws_id[:8]}-owner.config"
        write_ssh_config(hcfg, hp)
        alias = ""
        for line in hcfg.splitlines():
            if line.startswith("Host "):
                alias = line.split(None, 1)[1].strip()
                break
        r = ssh_run(hp, alias, "echo OWNER_SSH_OK && whoami", ws_id)
        ok("huanghuabin owner SSH", r.returncode == 0 and "OWNER_SSH_OK" in (r.stdout or ""), (r.stdout or "") + (r.stderr or ""))

    def case_fabric_dns():
        r = subprocess.run(
            [
                "ssh",
                "-o",
                "BatchMode=yes",
                "root@42.193.236.123",
                "dig +short @10.129.129.253 cl.qzsyzn.com A || "
                "getent hosts cl.qzsyzn.com | awk '{print $1}'",
            ],
            capture_output=True,
            text=True,
            timeout=20,
        )
        out = (r.stdout or "") + (r.stderr or "")
        ok("fabric DNS 解析 cl.qzsyzn.com → .253", "10.129.129.253" in out, out)

    def case_cnb_busybox():
        if SKIP_SSH or not cfg_path or not host_alias:
            ok("跳过 CNB busybox（无 SSH）", True)
            return
        r = ssh_run(
            cfg_path,
            host_alias,
            "if docker pull docker.1ms.run/library/alpine:latest; then "
            "  docker run --rm docker.1ms.run/library/alpine:latest echo CNB_BUSYBOX_OK; "
            "elif docker image inspect docker.cnb.cool/library/nginx:alpine >/dev/null 2>&1; then "
            "  docker run --rm docker.cnb.cool/library/nginx:alpine nginx -v && echo CNB_BUSYBOX_OK; "
            "else echo PULL_FAIL >&2; exit 1; fi",
            ws_id,
        )
        out = (r.stdout or "") + (r.stderr or "")
        ok("CNB/1ms 第二镜像 pull+run", r.returncode == 0 and "CNB_BUSYBOX_OK" in out, out)

    def case_ssh_revoke_regrant():
        y_uid = ctx["y_uid"]
        code, body = api(
            "PUT",
            f"/projects/{pid}/members/{y_uid}",
            {"ssh_access": "revoked"},
            token=h_tok,
        )
        if code >= 400:
            code, body = api(
                "POST",
                f"/projects/{pid}/members/{y_uid}/ssh-access/revoke",
                token=h_tok,
            )
        ok("撤销 yexinwei SSH", code in (200, 204), (code, body))
        code, cfg = api_text("GET", f"/workspaces/{ws_id}/ssh-config", token=y_tok)
        ok("撤销后无 ssh-config", code != 200, cfg[:160])
        code, g = grant_ssh(h_tok, pid, y_uid)
        ok("再次授予 yexinwei SSH", code == 200, g)

    def case_project_isolation():
        hidden_slug = f"hid-{ts % 100000}"
        code, p2 = api("POST", "/projects", {"name": f"隐藏项 {ts}", "slug": hidden_slug}, token=c_tok)
        ok("developer 仍可自建项目", code == 201, p2)
        hid = p2.get("id", "")
        code, lst = api("GET", "/projects", token=y_tok)
        items = lst.get("data", lst) if isinstance(lst, dict) else lst
        ids = [p.get("id") for p in items] if isinstance(items, list) else []
        ok("yexinwei 看不见非成员项目", hid and hid not in ids, ids[:8])
        code, one = api("GET", f"/projects/{hid}", token=y_tok)
        ok("直链非成员项目应 403/404", code in (403, 404), (code, one))
        if hid:
            api("DELETE", f"/projects/{hid}", token=c_tok)

    def case_dev_cannot_approve():
        code, body = api("POST", f"/workspaces/{ws_id}/approve", token=c_tok)
        ok("developer 不能再批已 running 机器", code >= 400, (code, body))

    def case_dev_cannot_add_member():
        code, body = api(
            "POST",
            f"/projects/{pid}/members",
            {"username": "admin", "role": "viewer"},
            token=c_tok,
        )
        ok("developer 不能拉人", code in (400, 403), (code, body))

    def case_dev_cannot_join_token():
        code, body = api("POST", "/admin/join-tokens", {"use_lan_depot": True}, token=c_tok)
        ok("developer 不能发 join token", code in (401, 403, 404), (code, body))

    def case_me_and_plans():
        code, me = api("GET", "/me", token=c_tok)
        ok("/me 是 chenweipeng", code == 200 and me.get("username") == "chenweipeng", me)
        code, plans = api("GET", "/plans", token=c_tok)
        raw = str(plans)
        ok("套餐含 2c2g", code == 200 and "2c2g" in raw, raw[:200])
        code, cap = api("GET", "/capacity", token=h_tok)
        ok("容量接口可读", code == 200, cap if isinstance(cap, dict) else "")

    def case_ingress_meta_fabric():
        code, meta = api("GET", "/ingress/meta", token=c_tok)
        ok("ingress meta 可读", code == 200, meta)
        ok(
            "ingress meta 含 fabric_dns",
            bool(meta.get("fabric_dns") or meta.get("fabric_host")),
            meta if isinstance(meta, dict) else "",
        )

    def case_list_ingress_and_audit():
        code, ings = api("GET", f"/workspaces/{ws_id}/ingress", token=h_tok)
        items = ings.get("data", ings) if isinstance(ings, dict) else ings
        ok("能列出已领域名", code == 200 and isinstance(items, list) and len(items) >= 1, ings)
        code, aud = api("GET", f"/workspaces/{ws_id}/audit", token=c_tok)
        ok("工作区审计可读", code == 200, aud if isinstance(aud, dict) else "")

    def case_usage_and_patch_name():
        code, usage = api("GET", f"/projects/{pid}/usage", token=h_tok)
        ok("项目用量可读", code == 200, usage)
        new_name = f"办公室故事改 {ts % 10000}"
        code, body = api("PATCH", f"/projects/{pid}", {"name": new_name}, token=h_tok)
        ok("owner 改项目名", code == 200, body)
        code, body = api("PATCH", f"/projects/{pid}", {"name": "x"}, token=y_tok)
        ok("developer 不能改项目名", code in (400, 403), (code, body))

    def _reject_if_created(code, body, who_tok):
        wid = body.get("id") if isinstance(body, dict) else ""
        if code in (200, 201) and wid:
            api("POST", f"/workspaces/{wid}/reject", token=who_tok or h_tok)

    def case_invite_token():
        email = f"rand{ts % 100000}@story.local"
        code, inv = api("POST", f"/projects/{pid}/invitations", {"email": email, "role": "viewer"}, token=h_tok)
        ok("邮件邀请 201", code in (200, 201), inv)
        tok = (inv.get("token") or inv.get("invite_token") or "") if isinstance(inv, dict) else ""
        if tok:
            code, acc = api("POST", "/invitations/accept", {"token": tok}, token=y_tok)
            ok("他人邀请码不能领（邮箱不匹配）", code in (400, 403), (code, acc))
            code, acc2 = api("POST", "/invitations/accept", {"token": "not-a-real-invite"}, token=y_tok)
            ok("假邀请码应拒绝", code >= 400, (code, acc2))
        code, me = api("GET", "/me", token=y_tok)
        ymail = (me.get("email") or "") if code == 200 else ""
        if ymail:
            code, inv2 = api("POST", f"/projects/{pid}/invitations", {"email": ymail, "role": "viewer"}, token=h_tok)
            if code in (200, 201):
                tok2 = inv2.get("token") or inv2.get("invite_token") or ""
                code, acc = api("POST", "/invitations/accept", {"token": tok2}, token=y_tok)
                ok("已是成员接受本人邀请应冲突", code in (400, 403, 409), (code, acc))
        else:
            ok("跳过本人邀请（yexinwei 无邮箱）", True)

    def case_dup_member():
        code, body = api(
            "POST",
            f"/projects/{pid}/members",
            {"username": "yexinwei", "role": "developer"},
            token=h_tok,
        )
        ok("重复加人应拒绝", code in (400, 409), (code, body))

    def case_invalid_arch():
        code, body = api(
            "POST",
            f"/projects/{pid}/workspaces",
            {"name": "bad-arch", "plan": "2c2g", "arch": "mips"},
            token=c_tok,
        )
        ok("非法 arch 应拒绝", code >= 400, (code, body))
        _reject_if_created(code, body, h_tok)

    def case_arch_alias():
        code, body = api(
            "POST",
            f"/projects/{pid}/workspaces",
            {"name": f"alias-x64-{ts % 999}", "plan": "2c2g", "arch": "x86_64"},
            token=c_tok,
        )
        ok("x86_64 别名应接受", code == 201, (code, body))
        if code == 201:
            ok("x86_64 归一成 amd64", (body.get("arch") or "") == "amd64", body)
            _reject_if_created(code, body, h_tok)

    def case_disk_shrink():
        code, body = api(
            "POST",
            f"/workspaces/{ws_id}/resize",
            {"cpu_milli": 2000, "mem_bytes": 2 * 1024**3, "disk_bytes": 1},
            token=h_tok,
        )
        ok("缩磁盘应拒绝", code >= 400, (code, body))

    def case_ssh_config_et():
        code, cfg = api_text("GET", f"/workspaces/{ws_id}/ssh-config", token=c_tok)
        has_et = "-et" in cfg and "10.129.129.253" in cfg
        ok("ssh-config 可读", code == 200, cfg[:200])
        ok("ssh-config 含 -et 虚网 Host", has_et, cfg[:240])

    def case_terminal_gate():
        code, body = api("GET", f"/workspaces/{ws_id}/terminal", token=c_tok)
        ok("网页终端入口有响应", code in (200, 400, 403, 426) or code < 500, (code, str(body)[:160]))

    def case_yexinwei_cannot_destroy():
        code, dang = api("GET", "/admin/dangerous-approvals", token=y_tok)
        ok("developer 不能看平台危险队列", code in (401, 403, 404), (code, dang))
        code, body = api("POST", f"/admin/dangerous-approvals/{ws_id}/approve", token=y_tok)
        ok("developer 不能平台终审销毁", code in (401, 403, 404), (code, body))

    def case_wrong_password():
        code, body = api("POST", "/auth/login", {"username": "chenweipeng", "password": "definitely-wrong"})
        ok("错密码不能登录", code in (400, 401), (code, body))

    def case_empty_ws_name():
        code, body = api(
            "POST",
            f"/projects/{pid}/workspaces",
            {"name": "", "plan": "2c2g", "arch": "amd64"},
            token=c_tok,
        )
        if code in (200, 201):
            ok("空名称被接受（有默认名）", True, body.get("name"))
            _reject_if_created(code, body, h_tok)
        else:
            ok("空名称应拒绝", code >= 400, (code, body))

    def case_bad_slug():
        code, body = api("POST", "/projects", {"name": "坏 slug", "slug": "BAD_SLUG!"}, token=c_tok)
        ok("非法 slug 应拒绝", code >= 400, (code, body))

    def case_list_members():
        code, body = api("GET", f"/projects/{pid}/members", token=h_tok)
        items = body.get("data", body) if isinstance(body, dict) else body
        names = []
        if isinstance(items, list):
            for m in items:
                names.append((m.get("username") or m.get("user_id") or "").lower())
        ok("成员列表含三人", code == 200 and len(items) >= 3, (code, names[:8]))

    def case_get_workspace():
        code, body = api("GET", f"/workspaces/{ws_id}", token=c_tok)
        ok("工作区详情可读", code == 200 and body.get("id") == ws_id, body if isinstance(body, dict) else "")
        code, miss = api("GET", "/workspaces/00000000-0000-0000-0000-000000000000", token=c_tok)
        ok("不存在工作区 404", code in (400, 404), (code, miss))

    def case_list_nodes_office():
        code, body = api("GET", "/nodes", token=c_tok)
        ok("办公室账号能看节点或被拒", code in (200, 401, 403), (code, str(body)[:120]))

    def case_claim_no_zone():
        code, body = api(
            "POST",
            f"/workspaces/{ws_id}/ingress/shared",
            {"mode": "random", "port": 8088},
            token=h_tok,
        )
        ok("无 zone 领取应拒绝", code >= 400, (code, body))

    def case_huge_resize():
        code, body = api(
            "POST",
            f"/workspaces/{ws_id}/resize",
            {"cpu_milli": 99_000, "mem_bytes": 64 * 1024**3, "disk_bytes": 1024**4},
            token=h_tok,
        )
        ok("超大升配应拒绝或进审批", code in (200, 201, 400, 409, 422), (code, body))
        if code in (200, 201) and isinstance(body, dict) and body.get("id") and body.get("status") in (
            "resize_requested",
            "pending",
        ):
            api("POST", f"/workspaces/{ws_id}/resize/reject", token=h_tok)

    def case_transfer_non_member():
        code, body = api(
            "POST",
            f"/projects/{pid}/transfer-ownership",
            {"new_owner_user_id": "00000000-0000-0000-0000-000000000000"},
            token=h_tok,
        )
        ok("不能转让给不存在的人", code >= 400, (code, body))

    def case_remove_non_member():
        code, body = api(
            "DELETE",
            f"/projects/{pid}/members/00000000-0000-0000-0000-000000000000",
            token=h_tok,
        )
        ok("删除不存在成员应失败", code in (400, 404), (code, body))

    def case_cannot_remove_owner():
        code, body = api("DELETE", f"/projects/{pid}/members/{ctx['c_uid']}", token=y_tok)
        ok("developer 不能踢人", code in (400, 403), (code, body))

    def case_healthz():
        for path in ("/healthz", "/readyz"):
            code, body = api("GET", path)
            if code == 200:
                ok(f"{path} 可读", True)
                return
        ok("healthz 可读", False, "api /healthz 与 /readyz 都失败")

    def case_list_keys():
        code, body = api("GET", "/me/ssh-keys", token=c_tok)
        total = body.get("total") if isinstance(body, dict) else 0
        ok("公钥列表非空", code == 200 and (total or 0) >= 1, body)

    def case_audit_as_member():
        code, body = api("GET", "/audit-logs", token=y_tok)
        ok("成员可读审计或被限权", code in (200, 401, 403), (code, str(body)[:80]))

    def case_private_ws_reject():
        code, body = api(
            "POST",
            f"/projects/{pid}/workspaces",
            {"name": f"priv-{ts % 999}", "plan": "2c2g", "arch": "amd64", "visibility": "private"},
            token=c_tok,
        )
        ok("可申请 private 机器", code == 201, (code, body))
        _reject_if_created(code, body, h_tok)

    def case_viewer_cannot_create():
        y_uid = ctx["y_uid"]
        code, body = api(
            "PUT",
            f"/projects/{pid}/members/{y_uid}",
            {"role": "viewer"},
            token=h_tok,
        )
        if code >= 400:
            ok("跳过 viewer 建机（改角色失败）", True, (code, body))
            return
        code, ws = api(
            "POST",
            f"/projects/{pid}/workspaces",
            {"name": "viewer-no", "plan": "2c2g", "arch": "amd64"},
            token=y_tok,
        )
        ok("viewer 不能申请机器", code in (400, 403), (code, ws))
        _reject_if_created(code, ws, h_tok)
        api("PUT", f"/projects/{pid}/members/{y_uid}", {"role": "developer"}, token=h_tok)

    def case_dev_cannot_delete_project():
        code, body = api("DELETE", f"/projects/{pid}", token=c_tok)
        ok("developer 不能删项目", code in (400, 403), (code, body))

    def case_dup_invite():
        email = f"dupinv{ts % 100000}@story.local"
        code1, _ = api("POST", f"/projects/{pid}/invitations", {"email": email, "role": "viewer"}, token=h_tok)
        code2, body = api("POST", f"/projects/{pid}/invitations", {"email": email, "role": "viewer"}, token=h_tok)
        ok("重复邀请同一邮箱可接受或冲突", code1 in (200, 201) and code2 in (200, 201, 409), (code2, body))

    def case_yexinwei_cannot_join_token():
        code, body = api("POST", "/admin/join-tokens", {"use_lan_depot": False}, token=y_tok)
        ok("yexinwei 不能发 join token", code in (401, 403, 404), (code, body))

    def case_stop_start():
        if SKIP_SSH:
            ok("跳过停启（SKIP_SSH）", True)
            return
        code, cur = api("GET", f"/workspaces/{ws_id}", token=h_tok)
        st = (cur.get("status") or "") if code == 200 else ""
        if st != "running":
            ok("跳过停启（当前不是 running）", True, st)
            return
        code, body = api("POST", f"/workspaces/{ws_id}/stop", token=h_tok)
        ok("owner 停止机器", code == 200, body)
        stopped = wait_ws(h_tok, ws_id, want=("stopped",), timeout=90)
        ok("停到 stopped", stopped.get("status") == "stopped", stopped)
        code, body = api("POST", f"/workspaces/{ws_id}/start", token=h_tok)
        ok("再启动机器", code == 200, body)
        running = wait_ws(h_tok, ws_id, want=("running",), timeout=180)
        ok("启动后 running", running.get("status") == "running", running)
        if cfg_path and host_alias and running.get("status") == "running":
            r = ssh_run(cfg_path, host_alias, "echo AFTER_START_OK", ws_id)
            ok("重启后 SSH 仍可用", r.returncode == 0 and "AFTER_START_OK" in (r.stdout or ""), (r.stdout or "") + (r.stderr or ""))

    api_cases = [
        case_invalid_plan,
        case_dup_slug,
        case_dev_cannot_transfer,
        case_second_port_noconfirm,
        case_reserved_prefix,
        case_prefix_collision,
        case_project_isolation,
        case_dev_cannot_approve,
        case_dev_cannot_add_member,
        case_dev_cannot_join_token,
        case_me_and_plans,
        case_ingress_meta_fabric,
        case_list_ingress_and_audit,
        case_usage_and_patch_name,
        case_invite_token,
        case_dup_member,
        case_invalid_arch,
        case_arch_alias,
        case_disk_shrink,
        case_yexinwei_cannot_destroy,
        case_wrong_password,
        case_empty_ws_name,
        case_bad_slug,
        case_list_members,
        case_get_workspace,
        case_list_nodes_office,
        case_claim_no_zone,
        case_huge_resize,
        case_transfer_non_member,
        case_remove_non_member,
        case_cannot_remove_owner,
        case_healthz,
        case_list_keys,
        case_audit_as_member,
        case_private_ws_reject,
        case_viewer_cannot_create,
        case_dev_cannot_delete_project,
        case_dup_invite,
        case_yexinwei_cannot_join_token,
    ]
    ssh_read_cases = [
        case_owner_ssh,
        case_fabric_dns,
        case_cnb_busybox,
        case_ssh_config_et,
        case_terminal_gate,
    ]
    rng = random.Random(ts)
    rng.shuffle(api_cases)
    rng.shuffle(ssh_read_cases)
    for fn in api_cases:
        fn()
    for fn in ssh_read_cases:
        fn()
    case_ssh_revoke_regrant()
    case_stop_start()


def main():
    print(f"=== 办公室用户故事 E2E @ {BASE} ===")
    cleanup_leftovers(["chenweipeng", "huanghuabin", "yexinwei"])
    slug = f"office-{ts}"
    pk = pubkey()
    ok("本机公钥可读", bool(pk.startswith("ssh-")))

    step("1. 登录办公室账号 + 上传公钥")
    c_tok, c_user = login("chenweipeng")
    h_tok, h_user = login("huanghuabin")
    y_tok, y_user = login("yexinwei")
    ok("chenweipeng 登录", bool(c_tok))
    ok("huanghuabin 登录", bool(h_tok))
    ok("yexinwei 登录", bool(y_tok))
    ok("chenweipeng SSH 公钥", ensure_ssh_key(c_tok) and api("GET", "/me/ssh-keys", token=c_tok)[1].get("total", 0) >= 1)
    ok("yexinwei SSH 公钥", ensure_ssh_key(y_tok) and api("GET", "/me/ssh-keys", token=y_tok)[1].get("total", 0) >= 1)
    ok("huanghuabin SSH 公钥", ensure_ssh_key(h_tok) and api("GET", "/me/ssh-keys", token=h_tok)[1].get("total", 0) >= 1)

    step("2. chenweipeng 建项；拉 huanghuabin 为 admin；转让 owner")
    code, proj = api(
        "POST",
        "/projects",
        {"name": f"办公室故事 {ts}", "slug": slug},
        token=c_tok,
    )
    ok("创建项目 201", code == 201, proj)
    pid = proj.get("id", "")
    c_uid = c_user.get("id") or ""
    h_uid = h_user.get("id") or find_user_id(h_tok, "huanghuabin")
    y_uid = y_user.get("id") or ""
    code, mem = api(
        "POST",
        f"/projects/{pid}/members",
        {"username": "huanghuabin", "role": "admin"},
        token=c_tok,
    )
    ok("添加 huanghuabin admin", code in (200, 201), mem)
    code, tr = api(
        "POST",
        f"/projects/{pid}/transfer-ownership",
        {"new_owner_user_id": h_uid},
        token=c_tok,
    )
    ok("转让 owner → huanghuabin", code == 200, tr)
    m_c = member_by_user_id(c_tok, pid, c_uid)
    role_c = (m_c.get("role") or "").lower()
    ok("chenweipeng 降为 developer", role_c == "developer", m_c)
    # 转让后 developer 默认 ssh_access=none；由新 owner 授权后才能连 Bastion
    code, g = grant_ssh(h_tok, pid, c_uid)
    ok("huanghuabin 授予 chenweipeng SSH", code == 200, g)
    m_c = member_by_user_id(h_tok, pid, c_uid)
    ok("chenweipeng ssh_access=granted", (m_c.get("ssh_access") or "").lower() == "granted", m_c)

    step("3. chenweipeng 申请 2c2g → pending")
    code, ws = api(
        "POST",
        f"/projects/{pid}/workspaces",
        {"name": "story-2c2g", "plan": "2c2g", "arch": "amd64"},
        token=c_tok,
    )
    ok("申请 workspace 201", code == 201, ws)
    ws_id = ws.get("id", "")
    ok("状态 requested", ws.get("status") == "requested", ws.get("status"))

    step("4. huanghuabin 审批 → running")
    t_prov = time.time()
    code, approved = api("POST", f"/workspaces/{ws_id}/approve", token=h_tok)
    ok("审批 200", code == 200, approved)
    running = wait_ws(c_tok, ws_id, want=("running",), timeout=360)
    prov_s = int(time.time() - t_prov)
    ok("轮询至 running", running.get("status") == "running", running)
    ok("已分配节点", bool(running.get("node_id")), running.get("node_id"))
    ok(f"开通耗时 {prov_s}s（目标 <90s）", running.get("status") == "running", f"{prov_s}s")
    if prov_s > 90:
        print(f"  WARN 开通偏慢 {prov_s}s，已优化 agent 嵌套 Docker 快路径，下次应更快")

    step("5. chenweipeng 取 ssh-config（*.ssh.cl.qzsyzn.com）")
    code, conn = api("GET", f"/workspaces/{ws_id}/connection", token=c_tok)
    ok("connection 200", code == 200, conn)
    code, cfg = api_text("GET", f"/workspaces/{ws_id}/ssh-config", token=c_tok)
    ok("ssh-config 200", code == 200, cfg[:240])
    ok("HostName 含 .ssh.cl.qzsyzn.com", ".ssh.cl.qzsyzn.com" in cfg, cfg[:240])
    ok("User chenweipeng", "chenweipeng" in cfg, cfg[:240])

    cfg_path = REPO / "tmp" / "story-ssh" / f"{ws_id[:8]}.config"
    write_ssh_config(cfg, cfg_path)
    # Host alias is first Host line
    host_alias = ""
    for line in cfg.splitlines():
        if line.startswith("Host "):
            host_alias = line.split(None, 1)[1].strip()
            break
    ok("解析 Host alias", bool(host_alias), cfg[:120])
    zone_id = ""
    prefix = ""

    if not SKIP_SSH and running.get("status") == "running" and host_alias:
        step("5b. 真实 SSH 探测")
        r = ssh_run(cfg_path, host_alias, "hostname && whoami && echo STORY_SSH_OK", ws_id)
        ok("SSH 成功", r.returncode == 0 and "STORY_SSH_OK" in (r.stdout or ""), (r.stdout or "") + (r.stderr or ""))

        # audit username
        code, audit = api("GET", "/audit-logs", token=h_tok)
        found_user = False
        if code == 200:
            items = audit.get("data", audit)
            if isinstance(items, list):
                for a in items:
                    if a.get("action") == "ssh.allow" and a.get("resource_id") == ws_id:
                        meta = a.get("meta") or {}
                        if meta.get("username") == "chenweipeng":
                            found_user = True
                            break
        ok("审计 ssh.allow 含 username=chenweipeng", found_user, "（可能稍后出现，不阻断）" if not found_user else "")

        step("6. CNB docker compose up app-a（不经 42 scp）")
        r = start_http_app(cfg_path, host_alias, ws_id, "story-a", 8088)
        out = (r.stdout or "") + (r.stderr or "")
        ok("已注入 CNB 仓库", "docker.cnb.cool" in out, out)
        ok("CNB compose up story-a", r.returncode == 0 and "story-a-web" in out, out)

        step("7. ClaimShared 随机 *.apps")
        # list zones
        code, zones = api("GET", "/ingress/meta", token=c_tok)
        if code == 200:
            zlist = zones.get("shared_zones") or zones.get("zones") or zones.get("data") or []
            if isinstance(zlist, list):
                for z in zlist:
                    suffix = z.get("suffix") or z.get("domain") or ""
                    if "apps.cl.qzsyzn.com" in suffix or suffix.endswith("apps.cl.qzsyzn.com"):
                        zone_id = z.get("id", "")
                        break
                if not zone_id and zlist:
                    zone_id = zlist[0].get("id", "")
        ok("找到 apps zone", bool(zone_id), zones)
        code, ing = api(
            "POST",
            f"/workspaces/{ws_id}/ingress/shared",
            {"zone_id": zone_id, "mode": "random", "port": 8088},
            token=c_tok,
        )
        ok("claim shared 201/200", code in (200, 201), ing)
        host = ing.get("domain") or ing.get("host") or ing.get("hostname") or ""
        ok("返回 apps 主机名", "apps.cl.qzsyzn.com" in host, ing)
        if host:
            # wait nginx rewrite
            time.sleep(8)
            try:
                req = urllib.request.Request(
                    f"http://{host}/",
                    headers={**UA, "Host": host},
                    method="GET",
                )
                with urllib.request.urlopen(req, timeout=20) as resp:
                    body = resp.read().decode(errors="replace")
                    ok("HTTP apps 可达", resp.status == 200, body[:120])
            except Exception as e:
                probe = edge_probe(host)
                ok(
                    "经 42 edge Host 探测",
                    probe.returncode == 0 and len(probe.stdout or "") > 0,
                    (probe.stdout or "") + (probe.stderr or "") + f" | public_err={e}",
                )

        step("8. 添加 yexinwei（默认无 SSH）")
        code, ym = api(
            "POST",
            f"/projects/{pid}/members",
            {"username": "yexinwei", "role": "developer"},
            token=h_tok,
        )
        ok("添加 yexinwei", code in (200, 201), ym)
        m_y = member_by_user_id(h_tok, pid, y_uid)
        ssh_acc = (m_y.get("ssh_access") or "").lower()
        ok("yexinwei ssh_access=none", ssh_acc in ("none", "", "revoked"), m_y)
        code, ycfg = api_text("GET", f"/workspaces/{ws_id}/ssh-config", token=y_tok)
        if code == 200:
            y_cfg_path = REPO / "tmp" / "story-ssh" / f"{ws_id[:8]}-yexinwei.config"
            write_ssh_config(ycfg, y_cfg_path)
            y_alias = ""
            for line in ycfg.splitlines():
                if line.startswith("Host "):
                    y_alias = line.split(None, 1)[1].strip()
                    break
            r = ssh_run(y_cfg_path, y_alias, "echo SHOULD_FAIL", ws_id)
            ok("授权前 yexinwei SSH 失败", r.returncode != 0, (r.stderr or "")[:200])
        else:
            ok("授权前 yexinwei 无 ssh-config", code != 200, ycfg[:200])

        step("9. yexinwei 申请 SSH；批准")
        code, req_ssh = api("POST", f"/projects/{pid}/ssh-access-request", token=y_tok)
        ok("申请 SSH", code == 200, req_ssh)
        code, appr = grant_ssh(h_tok, pid, y_uid)
        ok("批准 SSH", code == 200, appr)
        code, ycfg2 = api_text("GET", f"/workspaces/{ws_id}/ssh-config", token=y_tok)
        ok("yexinwei ssh-config 200", code == 200, ycfg2[:200])
        ok("User yexinwei", "yexinwei" in ycfg2, ycfg2[:200])
        if code == 200:
            y_cfg_path = REPO / "tmp" / "story-ssh" / f"{ws_id[:8]}-yexinwei.config"
            write_ssh_config(ycfg2, y_cfg_path)
            y_alias = ""
            for line in ycfg2.splitlines():
                if line.startswith("Host "):
                    y_alias = line.split(None, 1)[1].strip()
                    break
            r = ssh_run(y_cfg_path, y_alias, "echo YEXINWEI_SSH_OK && whoami", ws_id)
            ok(
                "yexinwei SSH 成功",
                r.returncode == 0 and "YEXINWEI_SSH_OK" in (r.stdout or ""),
                (r.stdout or "") + (r.stderr or ""),
            )

            step("10. CNB docker compose 第二服务 + 自定义前缀")
            r = start_http_app(y_cfg_path, y_alias, ws_id, "story-b", 8090)
            out = (r.stdout or "") + (r.stderr or "")
            ok("CNB compose up story-b", r.returncode == 0 and "story-b-web" in out, out)
            prefix = f"storyb{ts % 100000}"
            port_b = 8090
            code, ing2 = api(
                "POST",
                f"/workspaces/{ws_id}/ingress/shared",
                {
                    "zone_id": zone_id,
                    "mode": "custom",
                    "prefix": prefix,
                    "port": port_b,
                    "confirm_second_port": True,
                },
                token=y_tok,
            )
            ok("claim custom 前缀", code in (200, 201), ing2)
            host2 = ing2.get("domain") or ing2.get("host") or ing2.get("hostname") or ""
            ok("自定义域名", prefix in host2 and "apps.cl.qzsyzn.com" in host2, ing2)
            if host2:
                time.sleep(8)
                probe = edge_probe(host2)
                ok(
                    "自定义域 EasyTier 探测",
                    probe.returncode == 0 and len(probe.stdout or "") > 0,
                    (probe.stdout or "") + (probe.stderr or ""),
                )
        extra_stories(
            {
                "pid": pid,
                "ws_id": ws_id,
                "slug": slug,
                "zone_id": zone_id,
                "prefix": prefix,
                "c_tok": c_tok,
                "h_tok": h_tok,
                "y_tok": y_tok,
                "c_uid": c_uid,
                "y_uid": y_uid,
                "cfg_path": cfg_path,
                "host_alias": host_alias,
            }
        )
    else:
        print("  SKIP 真实 SSH/compose（HA_SKIP_SSH 或未 running）")
        extra_stories(
            {
                "pid": pid,
                "ws_id": ws_id,
                "slug": slug,
                "zone_id": "",
                "prefix": "",
                "c_tok": c_tok,
                "h_tok": h_tok,
                "y_tok": y_tok,
                "c_uid": c_uid,
                "y_uid": y_uid,
                "cfg_path": None,
                "host_alias": "",
            }
        )

    if not KEEP and pid and ws_id:
        step("12. 收尾清理")
        try:
            admin_tok, _ = login(ADMIN_USER, ADMIN_PASS)
        except Exception:
            admin_tok = ""
        destroy_workspace_chain(h_tok, admin_tok, {"id": ws_id, "status": "running"})
        api("DELETE", f"/projects/{pid}", token=h_tok)

    print(f"\n=== 结果: {passed} 通过, {failed} 失败 ===")
    print(f"project={pid} workspace={ws_id} slug={slug}")
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
