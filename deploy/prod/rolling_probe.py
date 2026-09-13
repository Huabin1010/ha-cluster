#!/usr/bin/env python3
"""Probe control-plane health on an interval; fail if consecutive errors exceed a window."""
from __future__ import annotations

import argparse
import json
import time
import urllib.error
import urllib.request


def one(url: str, timeout: float) -> int:
    req = urllib.request.Request(url, method="GET")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return int(resp.status)
    except urllib.error.HTTPError as e:
        return int(e.code)
    except Exception:
        return 0


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--url", default="https://cl.qzsyzn.com/healthz")
    p.add_argument("--interval-ms", type=int, default=200)
    p.add_argument("--seconds", type=float, default=8)
    p.add_argument("--max-fail-window-s", type=float, default=3)
    args = p.parse_args()

    deadline = time.monotonic() + args.seconds
    fail_start: float | None = None
    worst = 0.0
    ok = 0
    bad = 0
    while time.monotonic() < deadline:
        code = one(args.url, timeout=2.0)
        now = time.monotonic()
        if 200 <= code < 400:
            ok += 1
            fail_start = None
        else:
            bad += 1
            if fail_start is None:
                fail_start = now
            worst = max(worst, now - fail_start)
        time.sleep(max(args.interval_ms, 50) / 1000.0)

    out = {"ok": ok, "bad": bad, "worst_fail_s": round(worst, 3)}
    print(json.dumps(out, ensure_ascii=False))
    if worst > args.max_fail_window_s:
        return 1
    if ok == 0:
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
