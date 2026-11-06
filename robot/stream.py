"""
실시간 영상 송출 — 카메라 → MediaMTX(WebRTC) → Cloudflare 임시 터널 → 셰르피 웹

    cd ~/sherpy/robot && source .venv/bin/activate
    python3 stream.py

1. MediaMTX 로 카메라를 WebRTC(WHEP) 로 내보낸다 (포트 8889, 경로 sherpy).
2. cloudflared 임시 터널로 https 주소를 받는다 (켤 때마다 바뀜, 포트포워딩 불필요).
3. 그 주소를 이 로봇의 키로 서버에 알린다 → 앱 로봇 화면이 15초 안에 영상으로 바뀐다.
Ctrl+C 로 끄면 서버에서 주소를 지우고 둘 다 종료한다.

⚠️ 영상 데이터 자체는 터널이 아니라 브라우저↔파이로 직접 흐른다(WebRTC).
   그래서 보는 기기가 파이와 같은 와이파이/핫스팟에 있을 때 확실히 된다.
   다른 망(LTE 등)에서 보려면 TURN 서버가 추가로 필요하다 (로드맵 7단계).
"""
import os
import re
import signal
import subprocess
import sys
import threading
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from connect_test import load_env  # noqa: E402  (robot/.env 읽기 재사용)

load_env(HERE / ".env")
import requests  # noqa: E402
from bridge import config as C  # noqa: E402

MEDIAMTX = Path(os.environ.get("SHERPY_MEDIAMTX", Path.home() / "mediamtx" / "mediamtx"))
URL_RE = re.compile(r"https://[a-z0-9-]+\.trycloudflare\.com")


def report(url: str | None) -> None:
    r = requests.put(
        f"{C.SERVER_URL}/api/robots/{C.ROBOT_ID}/stream-url",
        json={"url": url}, headers={"Authorization": f"Bearer {C.API_KEY}"}, timeout=10,
    )
    if r.status_code == 401:
        sys.exit("❌ 로봇 키가 맞지 않아요 (401). robot/.env 를 확인하세요.")
    r.raise_for_status()


def main() -> None:
    if not MEDIAMTX.exists():
        sys.exit(f"❌ MediaMTX 가 없어요: {MEDIAMTX}\n   설치 방법은 docs/ROBOT_BRIDGE.md 5장")
    if subprocess.run(["which", "cloudflared"], capture_output=True).returncode != 0:
        sys.exit("❌ cloudflared 가 없어요. 설치 방법은 docs/ROBOT_BRIDGE.md 5장")

    mtx = subprocess.Popen([str(MEDIAMTX), str(HERE / "mediamtx.yml")], cwd=MEDIAMTX.parent)
    print("🎥 MediaMTX 시작 — 같은 와이파이에서 http://<파이IP>:8889/sherpy 로도 볼 수 있어요")

    cf = subprocess.Popen(
        ["cloudflared", "tunnel", "--no-autoupdate", "--url", "http://localhost:8889"],
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
    )
    url = None
    for line in cf.stdout:  # 주소가 나올 때까지 읽는다 (보통 5~15초)
        m = URL_RE.search(line)
        if m:
            url = m.group(0)
            break
    if not url:
        mtx.terminate()
        sys.exit("❌ 터널 주소를 못 받았어요. 인터넷 연결을 확인하세요.")
    # 이후 cloudflared 로그는 버린다 (안 읽으면 파이프가 막힘)
    threading.Thread(target=lambda: [None for _ in cf.stdout], daemon=True).start()

    report(url)
    print(f"✅ 영상 주소 등록: {url}")
    print("📱 앱 로봇 화면을 열면 15초 안에 영상이 떠요. (끄려면 Ctrl+C)")

    stop = threading.Event()
    signal.signal(signal.SIGTERM, lambda *_: stop.set())
    try:
        while not stop.wait(1):
            if mtx.poll() is not None or cf.poll() is not None:
                print("⚠️ MediaMTX 또는 터널이 꺼졌어요")
                break
    except KeyboardInterrupt:
        pass
    finally:
        print("\n종료 중…")
        try:
            report(None)
        except Exception as e:  # 주소 삭제 실패해도 종료는 계속
            print(f"[stream] 주소 삭제 실패: {e}")
        for p in (cf, mtx):
            p.terminate()


if __name__ == "__main__":
    main()
