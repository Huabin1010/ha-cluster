#!/usr/bin/env python3
from __future__ import annotations

import http.server
import subprocess
import sys
import threading
from pathlib import Path

ROOT = Path(__file__).resolve().parent


class Ok(http.server.BaseHTTPRequestHandler):
    def do_GET(self) -> None:
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b'{"status":"ok"}')

    def log_message(self, *_args: object) -> None:
        return


def test_probe_ok() -> None:
    srv = http.server.HTTPServer(("127.0.0.1", 0), Ok)
    port = srv.server_address[1]
    t = threading.Thread(target=srv.serve_forever, daemon=True)
    t.start()
    try:
        r = subprocess.run(
            [
                sys.executable,
                str(ROOT / "rolling_probe.py"),
                "--url",
                f"http://127.0.0.1:{port}/healthz",
                "--seconds",
                "1.2",
                "--interval-ms",
                "150",
                "--max-fail-window-s",
                "3",
            ],
            check=False,
            capture_output=True,
            text=True,
        )
        if r.returncode != 0:
            raise SystemExit(f"probe should pass: {r.stdout} {r.stderr}")
    finally:
        srv.shutdown()


if __name__ == "__main__":
    test_probe_ok()
    print("OK: rolling_probe")
