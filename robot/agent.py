"""
셰르피 에이전트 — 파이가 켜지면 저절로 실행돼(systemd) 웹 버튼으로 로봇을 다룰 수 있게 한다.

    (설치)  bash ~/sherpy/robot/install_agent.sh
    (직접)  cd ~/sherpy/robot && source .venv/bin/activate && python3 agent.py

웹 [로봇 관리] 화면의 버튼 → 서버 명령 큐 → 여기서 1초마다 가져와 실행:
    CAMERA_ON / CAMERA_OFF   영상 송출 켜기·끄기 (bridge/streamer.py)
    SYS_CHECK                연결·전원·부품 전체 점검 후 보고
    REBOOT / POWER_OFF       다시 시작 / 안전하게 끄기 (주행 중이면 거부)
그 외 ESTOP·PAUSE 등 주행 명령은 상태만 바꾼다 (모터 제어 프로그램은 아직 없음 — 붙으면 여기로 합친다).

[보안]
- 파이는 바깥에서 들어오는 연결을 받지 않는다. 파이가 서버로 먼저 나가서 명령을 가져온다(포트 개방 없음).
- 서버는 로봇 주인 계정의 명령만 큐에 넣고, 로봇은 자기 키(로봇마다 다름)로만 가져간다.
- 웹에서 온 값을 명령어로 실행하지 않는다. 아래 정해진 명령 이름만 처리하고 나머지는 무시한다.
- 끄기·재시작은 sudoers 에 '이 두 명령만' 허용한다 (install_agent.sh).
"""
import signal
import subprocess
import sys
import threading
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from connect_test import load_env  # noqa: E402

load_env(HERE / ".env")
import requests  # noqa: E402
from bridge import config as C  # noqa: E402
from bridge import TelemetryUplink, CommandDownlink  # noqa: E402
from bridge.streamer import Streamer  # noqa: E402
from bridge import system  # noqa: E402

HEADERS = {"Authorization": f"Bearer {C.API_KEY}"}
HEALTH_URL = f"{C.SERVER_URL}/api/robots/{C.ROBOT_ID}/health"
HEALTH_EVERY = 10.0  # 초

state = {"mode": "idle", "watchdog": False, "busy": None, "last_full": {}}
streamer = Streamer()
down = CommandDownlink()
up = TelemetryUplink()
stop_evt = threading.Event()


def log(msg: str) -> None:
    print(time.strftime("%H:%M:%S"), msg, flush=True)


# ── 상태 보고 ──────────────────────────────────
def push_health(full: bool = False, extra: dict | None = None) -> None:
    h = system.collect(streamer.running, full, down.last_rtt_ms)
    if full:
        state["last_full"] = {"devices": h["devices"], "checkedAt": h["checkedAt"]}
    else:
        h.update(state["last_full"])          # 마지막 전체 점검 결과는 계속 보여준다
    h["mode"] = state["mode"]
    h["busy"] = state["busy"]                 # "camera_on" 처럼 진행 중인 작업
    h["streamError"] = streamer.error
    if extra:
        h.update(extra)
    try:
        requests.put(HEALTH_URL, json=h, headers=HEADERS, timeout=C.HTTP_TIMEOUT)
    except requests.RequestException as e:
        log(f"[health] 보고 실패: {e}")


def health_loop() -> None:
    while not stop_evt.wait(HEALTH_EVERY):
        push_health()


def snapshot() -> dict:
    # 센서가 아직 없으므로 측정값은 비워 둔다 (가짜 값을 보내지 않음)
    return {"mode": state["mode"], "safety_level": 0, "faults": ["NO_SENSORS"]}


# ── 명령 처리 ──────────────────────────────────
def in_background(name: str, fn) -> None:
    """오래 걸리는 작업은 따로 돌린다 (명령 폴링·워치독이 멈추지 않게)"""
    if state["busy"]:
        log(f"⏳ {state['busy']} 진행 중 — {name} 무시")
        return

    def run():
        state["busy"] = name
        push_health()
        try:
            fn()
        finally:
            state["busy"] = None
            push_health(full=name == "check")
    threading.Thread(target=run, daemon=True).start()


def camera_on() -> None:
    log("🎥 카메라 송출 켜는 중…")
    ok = streamer.start()
    log(f"✅ 송출 시작 {streamer.url}" if ok else f"❌ 송출 실패: {streamer.error}")


def camera_off() -> None:
    streamer.stop()
    log("⏹ 송출 종료")


def power_action(kind: str) -> None:
    """kind: reboot | poweroff — 확인 보고를 먼저 보내고 3초 뒤 실행"""
    log(f"🔌 {kind} 준비 — 송출 종료")
    streamer.stop()
    push_health(extra={"shuttingDown": kind})
    stop_evt.set()

    def go():
        subprocess.run(["sudo", "-n", "/usr/bin/systemctl", kind], check=False)
    threading.Timer(3.0, go).start()


def on_command(ctype: str, payload: dict) -> None:
    log(f"📩 {ctype}")
    if ctype == "CAMERA_ON":
        in_background("camera_on", camera_on)
    elif ctype == "CAMERA_OFF":
        in_background("camera_off", camera_off)
    elif ctype == "SYS_CHECK":
        in_background("check", lambda: None)
    elif ctype in ("REBOOT", "POWER_OFF"):
        if state["mode"] in ("follow", "teach"):
            log("⛔ 주행 중에는 끄거나 다시 시작할 수 없어요")
            push_health(extra={"rejected": ctype})
        elif payload.get("confirm") is not True:
            log("⛔ 확인 값 없음 — 무시")
        else:
            power_action("reboot" if ctype == "REBOOT" else "poweroff")
    elif ctype == "ESTOP":
        state["mode"] = "estop"
    elif ctype in ("PAUSE", "STOP_TEACH"):
        state["mode"] = "idle"
    elif ctype == "START_TEACH":
        state["mode"] = "teach"
    elif ctype in ("START_FOLLOW", "RESUME"):
        state["mode"] = "follow"
    else:
        log(f"   (처리하지 않는 명령)")


def on_watchdog() -> None:
    # 서버와 3초 넘게 끊김 → 스스로 정지. 모터 제어가 붙으면 여기서 ESC 중립.
    if not state["watchdog"]:
        state["watchdog"] = True
        if state["mode"] in ("follow", "teach"):
            state["mode"] = "idle"
        log(f"⚠️ 서버 응답 {C.WATCHDOG_SEC:.0f}초 넘게 없음 — 정지 상태로 전환")


# ── 시작 ──────────────────────────────────────
def wait_for_server() -> None:
    """부팅 직후엔 와이파이가 늦게 잡히므로 될 때까지 기다린다. 키가 틀리면 바로 종료."""
    url = f"{C.SERVER_URL}/api/robots/{C.ROBOT_ID}/commands/pending"
    delay = 2
    while True:
        try:
            r = requests.get(url, headers=HEADERS, timeout=5)
            if r.status_code == 401:
                sys.exit("❌ 로봇 키가 맞지 않아요 (401). robot/.env 를 확인하세요.")
            if r.ok:
                log(f"✅ 서버 연결 — 로봇 #{C.ROBOT_ID}")
                return
            log(f"서버 응답 {r.status_code} — {delay}초 뒤 다시")
        except requests.RequestException:
            log(f"인터넷 대기 중… {delay}초 뒤 다시")
        time.sleep(delay)
        delay = min(delay * 2, 30)


def main() -> None:
    if not C.API_KEY:
        sys.exit("❌ SHERPY_API_KEY 가 비어 있어요. robot/.env 를 확인하세요.")
    wait_for_server()
    up.start(snapshot)
    down.start(on_command, on_watchdog)
    threading.Thread(target=health_loop, daemon=True).start()
    in_background("check", lambda: None)   # 켜지자마자 한 번 전체 점검

    signal.signal(signal.SIGTERM, lambda *_: stop_evt.set())
    try:
        while not stop_evt.wait(1):
            if time.monotonic() - down.last_ok < C.WATCHDOG_SEC:
                state["watchdog"] = False
    except KeyboardInterrupt:
        pass
    finally:
        log("종료 중…")
        streamer.stop()
        up.stop()
        down.stop()


if __name__ == "__main__":
    main()
