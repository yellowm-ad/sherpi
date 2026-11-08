"""
실시간 영상 송출 (터미널용) — 평소에는 웹의 [카메라 켜기] 버튼을 쓰면 된다 (agent.py).

    cd ~/sherpy/robot && source .venv/bin/activate
    python3 stream.py

카메라 → MediaMTX(WebRTC) → Cloudflare 임시 터널 → 셰르피 웹.
켤 때마다 새 시청 비밀번호를 만들어 서버에 함께 올린다 (주소만 알아서는 못 봄).
Ctrl+C 로 끄면 서버에서 주소를 지우고 종료한다.

⚠️ agent.py 가 이미 돌고 있으면(웹 버튼 사용 중) 이 스크립트는 쓰지 말 것 — 카메라가 겹친다.
⚠️ 영상 데이터 자체는 브라우저↔파이로 직접 흐른다(WebRTC).
   보는 기기가 파이와 같은 와이파이/핫스팟에 있을 때 확실히 된다. 다른 망은 TURN 서버 필요(로드맵 7단계).
"""
import signal
import sys
import threading
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from connect_test import load_env  # noqa: E402  (robot/.env 읽기 재사용)

load_env(HERE / ".env")
from bridge.streamer import Streamer  # noqa: E402


def main() -> None:
    s = Streamer()
    print("🎥 송출 준비 중… (5~15초)")
    if not s.start():
        sys.exit(f"❌ {s.error}")
    print(f"✅ 영상 주소 등록: {s.url}")
    print("📱 앱 로봇 화면을 열면 15초 안에 영상이 떠요. (끄려면 Ctrl+C)")

    stop = threading.Event()
    signal.signal(signal.SIGTERM, lambda *_: stop.set())
    try:
        while not stop.wait(1):
            if not s.running:
                print("⚠️ MediaMTX 또는 터널이 꺼졌어요")
                break
    except KeyboardInterrupt:
        pass
    finally:
        print("\n종료 중…")
        s.stop()


if __name__ == "__main__":
    main()
