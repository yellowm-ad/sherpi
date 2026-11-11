"""
셰르피 에이전트 — 파이가 켜지면 저절로 실행돼(systemd) 웹 버튼으로 로봇을 다룰 수 있게 한다.

    (설치)  bash ~/sherpy/robot/install_agent.sh
    (직접)  cd ~/sherpy/robot && source .venv/bin/activate && python3 agent.py

웹 [로봇 관리] 화면의 버튼 → 서버 명령 큐 → 여기서 1초마다 가져와 실행:
    CAMERA_ON / CAMERA_OFF   영상 송출 켜기·끄기 (bridge/streamer.py)
    VISION_ON / VISION_OFF   자율주행 인식 테스트 켜기·끄기 (bridge/vision.py — 카메라를 송출과 나눠 쓸 수 없어 송출은 끈다)
    VISION_SET / VISION_MARK 인식 판단 값 바꾸기 / '놓침·괜히 멈춤·잘함' 표본 저장 (모터는 움직이지 않음)
    SYS_CHECK                연결·전원·부품 전체 점검 후 보고
    REBOOT / POWER_OFF       다시 시작 / 안전하게 끄기 (주행 중이면 거부)
    JOY_ON / JOY_OFF         수동 조종(조이스틱) 연결 켜기·끄기 (bridge/joystick.py — 폰과 터널로 직접 연결)
    ESTOP                    바퀴 즉시 정지 + 조종 거부 (정지 해제 = RESUME)
    START_TEACH / STOP_TEACH 티칭 = 수동 조종으로 몰면서 조작 기록 (robot/teach_log/*.jsonl)
자동주행(START_FOLLOW 등)은 상태만 바꾼다 (경로 추종 프로그램은 아직 없음 — 붙으면 여기로 합친다).
모터 출력은 bridge/motor.py 한 곳 — 기본은 시험 모드(신호 안 보냄), robot/.env 에 SHERPY_MOTOR=on 일 때만 실제 출력.

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
from bridge.motor import Motor  # noqa: E402
from bridge.joystick import Joystick  # noqa: E402
try:  # numpy 가 없어도 에이전트(연결·끄기 버튼)는 살아 있어야 한다
    from bridge.vision import Vision  # noqa: E402
except Exception as _e:  # noqa: BLE001
    class Vision:  # type: ignore[no-redef]
        running = False
        error = f"인식 모듈을 못 불러왔어요 (bash robot/install_vision.sh): {str(_e)[:80]}"
        params = None
        def start(self): return False
        def stop(self): pass
        def set_params(self, d): pass
        def mark(self, kind): return None

HEADERS = {"Authorization": f"Bearer {C.API_KEY}"}
HEALTH_URL = f"{C.SERVER_URL}/api/robots/{C.ROBOT_ID}/health"
HEALTH_EVERY = 10.0  # 초

state = {"mode": "idle", "watchdog": False, "busy": None, "last_full": {}, "shutting": None}
streamer = Streamer()
vision = Vision()
motor = Motor()
TEACH_DIR = HERE / "teach_log"
teach = {"f": None}


def joy_allow() -> str | None:
    """수동 조종을 받아도 되나 — 안 되면 이유 (앱에 그대로 보임)"""
    if state["mode"] == "estop":
        return "긴급 정지 상태예요 — [정지 해제] 후 조종할 수 있어요"
    if state["mode"] == "follow":
        return "자동주행 중이에요 — 일시정지하면 수동 조종할 수 있어요"
    if state["shutting"]:
        return "로봇이 꺼지는 중이에요"
    return None


def joy_input(steer: float, speed: float) -> None:
    """티칭 중이면 조작을 기록 (나중에 GPS·엔코더 기록과 합쳐 경로로 쓴다)"""
    f = teach["f"]
    if f and state["mode"] == "teach":
        f.write(f'{{"t":{time.time():.3f},"steer":{steer:.3f},"speed":{speed:.3f}}}' + "\n")


def teach_open() -> None:
    teach_close()
    TEACH_DIR.mkdir(exist_ok=True)
    path = TEACH_DIR / f"{time.strftime('%Y%m%d-%H%M%S')}.jsonl"
    teach["f"] = open(path, "a", encoding="utf-8", buffering=1)
    log(f"   티칭 기록 → {path.name}")


def teach_close() -> None:
    if teach["f"]:
        teach["f"].close()
        teach["f"] = None


joystick = Joystick(motor, joy_allow, joy_input)
down = CommandDownlink()
up = TelemetryUplink()
stop_evt = threading.Event()


def log(msg: str) -> None:
    print(time.strftime("%H:%M:%S"), msg, flush=True)


# ── 상태 보고 ──────────────────────────────────
def push_health(full: bool = False, extra: dict | None = None) -> None:
    h = system.collect(streamer.running, full, down.last_rtt_ms, camera_busy=vision.running)
    if full:
        state["last_full"] = {"devices": h["devices"], "checkedAt": h["checkedAt"]}
    else:
        h.update(state["last_full"])          # 마지막 전체 점검 결과는 계속 보여준다
    h["mode"] = state["mode"]
    h["busy"] = state["busy"]                 # "camera_on" 처럼 진행 중인 작업
    h["streamError"] = streamer.error
    h["vision"] = vision.running
    h["visionError"] = vision.error
    h["visionLive"] = vision.live.info() if vision.running else None   # 주소·비밀번호 — 서버는 주인에게만
    h["visionLiveError"] = vision.live.error
    h["joy"] = joystick.info()              # 주소·비밀번호 — 서버는 주인에게만 보여 준다
    h["joyConnected"] = joystick.connected
    h["joyError"] = joystick.error
    h["motorLive"] = motor.live
    h["motorError"] = motor.error
    if state["shutting"]:
        h["shuttingDown"] = state["shutting"]   # 꺼질 때까지 계속 '꺼지는 중'으로 보이게
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
    if vision.running:
        log("👁 인식 테스트 끄는 중 (카메라를 송출에 넘김)")
        vision.stop()
    log("🎥 카메라 송출 켜는 중…")
    ok = streamer.start()
    log(f"✅ 송출 시작 {streamer.url}" if ok else f"❌ 송출 실패: {streamer.error}")


def camera_off() -> None:
    streamer.stop()
    log("⏹ 송출 종료")


def vision_on() -> None:
    if streamer.running:
        log("🎥 송출 끄는 중 (카메라를 인식 테스트에 넘김)")
        streamer.stop()
    log("👁 인식 테스트 켜는 중…")
    ok = vision.start()
    if ok:
        time.sleep(3)  # 카메라가 정말 열렸는지 잠깐 본다
    ok = ok and vision.running
    log("✅ 인식 테스트 시작" if ok else f"❌ 인식 테스트 실패: {vision.error}")
    if ok:
        # 직접 보기 터널은 따로 (5~15초) — 그동안 웹은 서버 경유 사진을 보여 준다
        def live_on() -> None:
            ok2 = vision.live.start()
            log("📡 화면 직접 보기 준비" if ok2 else f"⚠ 화면 직접 보기 실패 — 서버 경유로 보여 줘요: {vision.live.error}")
            push_health()
        threading.Thread(target=live_on, daemon=True).start()


def vision_off() -> None:
    vision.stop()
    log("⏹ 인식 테스트 종료")


def joy_on() -> None:
    log("🕹 수동 조종 연결 켜는 중…")
    ok = joystick.start()
    log(f"✅ 조종 연결 준비 ({'실제 출력' if motor.live else '시험 모드 — 모터 신호 안 보냄'})" if ok else f"❌ 조종 연결 실패: {joystick.error}")


def joy_off() -> None:
    joystick.stop()
    log("⏹ 수동 조종 연결 종료")


def power_action(kind: str) -> None:
    """kind: reboot | poweroff — 확인 보고를 먼저 보내고 3초 뒤 실행.

    에이전트는 여기서 스스로 끝내지 않는다. OS 가 꺼지면서 systemd 가 SIGTERM 으로 정리한다.
    (예전 버그: 명령 처리 스레드(daemon)에서 만든 Timer 는 daemon 을 물려받아,
     에이전트가 먼저 끝나면 3초가 되기 전에 같이 사라져 poweroff 가 실행되지 않았다.)
    """
    if subprocess.run(["sudo", "-n", "-l", "/usr/bin/systemctl", kind], capture_output=True).returncode != 0:
        log(f"⛔ {kind} 권한 없음 — install_agent.sh 를 다시 실행하세요")
        return
    log(f"🔌 {kind} 준비 — 송출·인식·조종 종료")
    streamer.stop()
    vision.stop()
    joystick.stop()
    state["shutting"] = kind
    push_health()

    def go():
        r = subprocess.run(["sudo", "-n", "/usr/bin/systemctl", kind], capture_output=True, text=True)
        if r.returncode != 0:
            state["shutting"] = None
            log(f"❌ {kind} 실패: {(r.stderr or r.stdout).strip()[:200]}")
            push_health()
    t = threading.Timer(3.0, go)
    t.daemon = False
    t.start()


def on_command(ctype: str, payload: dict) -> None:
    log(f"📩 {ctype}")
    if ctype == "CAMERA_ON":
        in_background("camera_on", camera_on)
    elif ctype == "CAMERA_OFF":
        in_background("camera_off", camera_off)
    elif ctype == "VISION_ON":
        in_background("vision_on", vision_on)
    elif ctype == "VISION_OFF":
        in_background("vision_off", vision_off)
    elif ctype == "VISION_SET":
        vision.set_params(payload)          # 이름·범위는 Params.update 가 거른다
        log(f"   인식 값 → {vision.params.to_dict() if vision.params else '-'}")
    elif ctype == "VISION_MARK":
        name = vision.mark(str(payload.get("kind", "")))
        log(f"   표본 저장: {name}" if name else "   표본 저장 안 됨 (인식이 꺼져 있거나 종류가 틀림)")
    elif ctype == "JOY_ON":
        in_background("joy_on", joy_on)
    elif ctype == "JOY_OFF":
        in_background("joy_off", joy_off)
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
        state["mode"] = "estop"         # 먼저 상태를 바꿔 새 조종 신호를 막고
        joystick.halt()                 # 바퀴 즉시 정지
        motor.stop()
        teach_close()
    elif ctype in ("PAUSE", "STOP_TEACH"):
        if state["mode"] != "estop":    # 긴급 정지는 [정지 해제]로만 풀린다
            state["mode"] = "idle"
        joystick.halt()
        motor.stop()
        teach_close()
    elif ctype == "START_TEACH":
        if state["mode"] in ("estop", "follow"):
            log("⛔ 정지·자동주행 중에는 티칭을 시작할 수 없어요")
        else:
            state["mode"] = "teach"
            teach_open()
    elif ctype == "RESUME":
        # 긴급 정지 해제 → 대기 / 일시정지였으면 자동주행 재개
        state["mode"] = "idle" if state["mode"] == "estop" else "follow"
    elif ctype == "START_FOLLOW":
        if state["mode"] == "estop":
            log("⛔ 긴급 정지 상태 — 먼저 정지 해제")
        else:
            joystick.halt()
            teach_close()
            state["mode"] = "follow"
    else:
        log(f"   (처리하지 않는 명령)")


def on_watchdog() -> None:
    # 서버와 3초 넘게 끊김 → 스스로 정지. 모터 제어가 붙으면 여기서 ESC 중립.
    if not state["watchdog"]:
        state["watchdog"] = True
        if state["mode"] == "follow":   # 자동주행은 멈춘다. 수동 조종(티칭)은 폰과 직접 연결이라 계속 —
            state["mode"] = "idle"      # 그쪽이 끊기면 데드맨이 0.3초 안에 멈춘다
            motor.stop()
        log(f"⚠️ 서버 응답 {C.WATCHDOG_SEC:.0f}초 넘게 없음 — 자동주행 정지")


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
        joystick.stop()
        motor.close()
        teach_close()
        streamer.stop()
        vision.stop()
        up.stop()
        down.stop()


if __name__ == "__main__":
    main()
