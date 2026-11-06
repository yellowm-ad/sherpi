"""
웹 연동 점검 — 센서·모터 없이 라즈베리파이와 셰르피 웹(sherpy.vercel.app) 연결만 확인한다.

    cd ~/sherpy/robot && source .venv/bin/activate
    python3 connect_test.py

- 1초마다 '테스트 값'(장력·줄 길이는 천천히 오르내림, 위치는 덕진공원 고정)을 올린다.
- 앱에서 누른 명령(정지·일시정지 등)을 받아 화면에 찍고 ack 한다. 실제로 움직이는 것은 없다.
- 실로봇과 같은 bridge.TelemetryUplink / bridge.CommandDownlink 를 그대로 쓴다.
  센서가 붙으면 snapshot() 의 테스트 값 자리만 실제 값으로 바꾸면 된다.
- 키는 robot/.env (로봇마다 다름, scripts/robot-key.mjs 로 발급). Ctrl+C 로 끝낸다.
"""
import math
import os
import sys
import time
from pathlib import Path


def load_env(path: Path) -> None:
    """robot/.env 를 환경변수로 읽는다 (systemd 의 EnvironmentFile 과 같은 형식)."""
    if not path.exists():
        sys.exit(f"❌ {path} 가 없어요. 노트북에서 받은 키 파일을 여기에 복사하세요.")
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip())


load_env(Path(__file__).resolve().parent / ".env")

import requests  # noqa: E402
from bridge import config as C  # noqa: E402  (.env 를 읽은 뒤에 import 해야 값이 반영된다)
from bridge import TelemetryUplink, CommandDownlink  # noqa: E402

if not C.API_KEY:
    sys.exit("❌ SHERPY_API_KEY 가 비어 있어요. robot/.env 를 확인하세요.")

# 덕진공원 (시연 장소)
LAT, LNG = 35.8475, 127.1215
state = {"mode": "idle", "t0": time.monotonic(), "watchdog": False}


def snapshot() -> dict:
    t = time.monotonic() - state["t0"]
    return {
        "mode": state["mode"],
        "safety_level": 0,
        "faults": ["TEST_MODE"],                      # 앱에서 '테스트 중' 임을 알 수 있게
        "tension_n": round(4 + 3 * math.sin(t / 5), 2),    # 1~7 N 오르내림 (경고 16 N 미만)
        "leash_len_m": round(1.8 + 0.4 * math.sin(t / 7), 2),
        "speed_cmd": 0.0,
        "steer_cmd": 0.0,
        "lat": LAT, "lng": LNG, "gps_src": "robot",
        "speed_mps": 0.0, "heading_deg": 0.0, "gps_sats": None,
    }


def on_command(ctype: str, payload: dict) -> None:
    print(f"📩 명령 받음: {ctype} {payload or ''}  (테스트 모드라 실제 동작 없음)")
    if ctype == "ESTOP":
        state["mode"] = "estop"
    elif ctype in ("PAUSE", "STOP_TEACH"):
        state["mode"] = "idle"
    elif ctype == "START_TEACH":
        state["mode"] = "teach"
    elif ctype in ("START_FOLLOW", "RESUME"):
        state["mode"] = "follow"


def on_watchdog() -> None:
    # 실로봇이라면 여기서 스스로 감속·정지한다. 테스트에선 한 번만 알린다.
    if not state["watchdog"]:
        state["watchdog"] = True
        print(f"⚠️  서버 응답이 {C.WATCHDOG_SEC:.0f}초 넘게 없음 — 실로봇이면 지금 스스로 멈춤")


def preflight() -> None:
    url = f"{C.SERVER_URL}/api/robots/{C.ROBOT_ID}/commands/pending"
    try:
        r = requests.get(url, headers={"Authorization": f"Bearer {C.API_KEY}"}, timeout=5)
    except requests.RequestException as e:
        sys.exit(f"❌ 서버에 못 닿았어요 (인터넷 연결 확인): {e}")
    if r.status_code == 401:
        sys.exit("❌ 키가 맞지 않아요 (401). robot/.env 의 로봇 번호·키를 확인하세요.")
    if not r.ok:
        sys.exit(f"❌ 서버 응답 {r.status_code}: {r.text[:200]}")
    print(f"✅ 서버 인증 성공 — 로봇 #{C.ROBOT_ID} → {C.SERVER_URL}")


if __name__ == "__main__":
    preflight()
    up, down = TelemetryUplink(), CommandDownlink()
    up.start(snapshot)
    down.start(on_command, on_watchdog)
    print("📡 1초마다 테스트 값 전송 중. 앱의 로봇 화면을 열어 보세요. (끝내려면 Ctrl+C)")
    try:
        n = 0
        while True:
            time.sleep(5)
            n += 5
            if time.monotonic() - down.last_ok < C.WATCHDOG_SEC:
                state["watchdog"] = False
            print(f"  … {n}초 경과 · 모드={state['mode']} · 대기 중인 전송 {len(up.buffer)}개")
    except KeyboardInterrupt:
        print("\n종료")
    finally:
        up.stop()
        down.stop()
