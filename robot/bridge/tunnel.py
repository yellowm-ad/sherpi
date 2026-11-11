"""
Cloudflare 임시 터널(trycloudflare) — 파이 안의 127.0.0.1:port 를 https 주소 하나로 밖에 연다.
파이는 '밖으로 나가는' 연결만 쓴다 (공유기 포트 개방 없음). 조종(joystick.py)·인식 화면(live_view.py)이 같이 쓴다.
"""
from __future__ import annotations

import re
import subprocess
import threading

URL_RE = re.compile(r"https://[a-z0-9-]+\.trycloudflare\.com")


def available() -> bool:
    return subprocess.run(["which", "cloudflared"], capture_output=True).returncode == 0


def open_tunnel(port: int, timeout: float = 40) -> tuple[subprocess.Popen | None, str | None]:
    """터널을 열고 (프로세스, 주소). 실패하면 (None, None). 보통 5~15초."""
    cf = subprocess.Popen(
        ["cloudflared", "tunnel", "--no-autoupdate", "--url", f"http://localhost:{int(port)}"],
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
    )
    found: list[str] = []
    killer = threading.Timer(timeout, lambda: cf.poll() is None and not found and cf.kill())
    killer.daemon = True
    killer.start()
    for line in cf.stdout:
        m = URL_RE.search(line)
        if m:
            found.append(m.group(0))
            break
    killer.cancel()
    if not found:
        close(cf)
        return None, None
    # 남은 출력을 계속 읽어 줘야 파이프가 막히지 않는다
    threading.Thread(target=lambda: [None for _ in cf.stdout], daemon=True).start()
    return cf, found[0]


def close(cf: subprocess.Popen | None) -> None:
    if cf and cf.poll() is None:
        cf.terminate()
        try:
            cf.wait(timeout=5)
        except subprocess.TimeoutExpired:
            cf.kill()
