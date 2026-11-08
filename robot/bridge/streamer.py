"""
실시간 영상 송출 켜기/끄기 — MediaMTX(WebRTC) + Cloudflare 임시 터널.

agent.py(웹 버튼)와 stream.py(터미널) 가 같이 쓴다.

[보안]
- 켤 때마다 시청 비밀번호(token)를 새로 만든다. MediaMTX 는 이 비밀번호가 맞는 요청에만 영상을 준다.
  터널 주소가 새어 나가도 비밀번호 없이는 못 본다.
- 주소와 비밀번호는 이 로봇의 키로 서버에 올리고, 서버는 로봇 주인에게만 내려준다.
- 실행 명령은 고정된 프로그램·인자만 쓴다 (웹에서 받은 문자열을 실행하지 않음).
"""
import os
import re
import secrets
import subprocess
import tempfile
import threading
from pathlib import Path

import requests

from . import config as C

ROBOT_DIR = Path(__file__).resolve().parent.parent
MEDIAMTX = Path(os.environ.get("SHERPY_MEDIAMTX", Path.home() / "mediamtx" / "mediamtx"))
URL_RE = re.compile(r"https://[a-z0-9-]+\.trycloudflare\.com")
VIEW_USER = "viewer"


def _runtime_config(token: str) -> Path:
    """robot/mediamtx.yml 에 '시청 비밀번호' 블록을 붙인 실행용 설정 (임시 파일, 나만 읽기)."""
    base = (ROBOT_DIR / "mediamtx.yml").read_text(encoding="utf-8")
    auth = (
        "\nauthMethod: internal\n"
        "authInternalUsers:\n"
        f"  - user: {VIEW_USER}\n"
        f"    pass: {token}\n"
        "    ips: []\n"
        "    permissions:\n"
        "      - action: read\n"
        "        path: sherpy\n"
    )
    fd, name = tempfile.mkstemp(prefix="sherpy-mtx-", suffix=".yml")
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        f.write(base + auth)
    os.chmod(name, 0o600)
    return Path(name)


class Streamer:
    def __init__(self) -> None:
        self.mtx: subprocess.Popen | None = None
        self.cf: subprocess.Popen | None = None
        self.url: str | None = None
        self.error: str | None = None
        self._cfg: Path | None = None
        self._lock = threading.Lock()

    # ── 상태 ──
    @property
    def running(self) -> bool:
        return bool(self.url and self.mtx and self.mtx.poll() is None and self.cf and self.cf.poll() is None)

    def ready(self) -> str | None:
        """켤 수 없는 이유 (None 이면 켤 수 있음)"""
        if not MEDIAMTX.exists():
            return f"MediaMTX 가 없어요 ({MEDIAMTX})"
        if subprocess.run(["which", "cloudflared"], capture_output=True).returncode != 0:
            return "cloudflared 가 설치돼 있지 않아요"
        return None

    # ── 서버에 주소 알리기 ──
    @staticmethod
    def report(url: str | None, token: str | None) -> None:
        r = requests.put(
            f"{C.SERVER_URL}/api/robots/{C.ROBOT_ID}/stream-url",
            json={"url": url, "token": token},
            headers={"Authorization": f"Bearer {C.API_KEY}"}, timeout=10,
        )
        r.raise_for_status()

    # ── 켜기 / 끄기 ──
    def start(self) -> bool:
        with self._lock:
            if self.running:
                return True
            self._kill()
            self.error = self.ready()
            if self.error:
                return False
            token = secrets.token_urlsafe(24)
            self._cfg = _runtime_config(token)
            self.mtx = subprocess.Popen([str(MEDIAMTX), str(self._cfg)], cwd=MEDIAMTX.parent,
                                        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            self.cf = subprocess.Popen(
                ["cloudflared", "tunnel", "--no-autoupdate", "--url", "http://localhost:8889"],
                stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
            )
            url = None
            for line in self.cf.stdout:  # 보통 5~15초
                m = URL_RE.search(line)
                if m:
                    url = m.group(0)
                    break
            if not url:
                self.error = "터널 주소를 못 받았어요 (인터넷 연결 확인)"
                self._kill()
                return False
            # 이후 로그는 버린다 (안 읽으면 파이프가 막힘)
            threading.Thread(target=lambda: [None for _ in self.cf.stdout], daemon=True).start()
            try:
                self.report(url, token)
            except Exception as e:
                self.error = f"서버에 주소를 못 올렸어요: {e}"
                self._kill()
                return False
            self.url = url
            return True

    def stop(self) -> None:
        with self._lock:
            had = self.url is not None
            self._kill()
            if had:
                try:
                    self.report(None, None)
                except Exception as e:  # 주소 삭제 실패해도 끄기는 계속
                    print(f"[stream] 주소 삭제 실패: {e}")

    def _kill(self) -> None:
        for p in (self.cf, self.mtx):
            if p and p.poll() is None:
                p.terminate()
                try:
                    p.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    p.kill()
        self.cf = self.mtx = None
        self.url = None
        if self._cfg:
            self._cfg.unlink(missing_ok=True)
            self._cfg = None
