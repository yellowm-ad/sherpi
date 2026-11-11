"""
수동 조종(joystick.py) 시험 — 노트북에서:  python robot/tests/test_joystick.py
모터·터널 없이 (1) 판단 로직  (2) 실제 웹소켓 왕복(127.0.0.1)을 확인한다. 모터는 시험 모드(신호 안 보냄).
"""
import asyncio
import json
import sys
import threading
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from bridge import config as C  # noqa: E402
from bridge.motor import Motor, to_us  # noqa: E402
from bridge.joystick import JoyCore, Joystick  # noqa: E402

FAILS = []


def check(name, got, want):
    ok = want(got) if callable(want) else got == want
    print(f"{'✅' if ok else '❌'} {name}: {got}")
    if not ok:
        FAILS.append(name)


class Clock:
    def __init__(self): self.t = 100.0
    def __call__(self): return self.t


# ── 1) 판단 로직 ─────────────────────────────
C.MOTOR_LIVE = False
m = Motor()
check("기본은 시험 모드", m.live, False)
check("중립 us", to_us(0, 0), (1500, 1500))

clk = Clock()
blocked = {"why": None}
inputs = []
core = JoyCore(m, lambda: blocked["why"], lambda s, v: inputs.append((s, v)), clock=clk)

a = core.handle(0, 1, 0)
check("앞으로 끝까지 → 상한만큼만", a["speed"], C.JOY_MAX_THROTTLE)
check("스로틀 us", a["throttleUs"], to_us(0, C.JOY_MAX_THROTTLE)[1])
clk.t += 0.05
a = core.handle(1, 0.5, 1)
check("오른쪽 끝 조향 us", a["steerUs"], 2000)
clk.t += 0.05
a = core.handle(0, -1, 2)
check("뒤로 당기면 정지 (후진 없음)", (a["speed"], a["throttleUs"]), (0.0, 1500))
check("후진 안내", a["note"], lambda n: bool(n))
clk.t += 0.05
check("늦게 온 옛 번호 무시", core.handle(0, 1, 1), None)
check("가운데 흔들림 무시", core.handle(0.03, 0.05, 3)["speed"], 0.0)

clk.t += 0.05
core.handle(0, 1, 4)
clk.t += 0.01
check("너무 잦은 신호 건너뜀", core.handle(0, 1, 5), None)
check("멈춤 신호는 잦아도 처리", core.handle(0, 0, 6)["throttleUs"], 1500)

clk.t += 0.1
core.handle(0, 1, 7)
clk.t += C.JOY_DEADMAN_SEC + 0.05
check("신호 끊기면 데드맨 정지", core.tick(), lambda r: bool(r))
check("정지 후 모터 중립", m.last, (1500, 1500))
check("정지도 기록에 남음", inputs[-1], (0.0, 0.0))

clk.t += 0.1
core.handle(0, 1, 8)
blocked["why"] = "긴급 정지"
check("움직이는 중 긴급 정지 → 다음 확인에서 멈춤", core.tick(), "긴급 정지")
clk.t += 0.1
a = core.handle(0, 1, 9)
check("긴급 정지 중 조종 거부", (a["ok"], a["throttleUs"]), (False, 1500))
blocked["why"] = None
check("이상한 값은 0 으로", core.handle("abc", float("nan"), 10)["throttleUs"], 1500)


# ── 2) 실제 웹소켓 왕복 (터널 없이 127.0.0.1) ────────
async def live() -> None:
    from websockets.asyncio.client import connect
    url = f"ws://127.0.0.1:{C.JOY_PORT}"

    async with connect(url) as ws:
        await ws.send(json.dumps({"t": "auth", "token": "틀림"}))
        try:
            await ws.recv()
            check("틀린 비밀번호 끊김", "열림", "끊김")
        except Exception:
            check("틀린 비밀번호 끊김", "끊김", "끊김")

    async with connect(url) as ws:
        await ws.send(json.dumps({"t": "auth", "token": joy.token}))
        hello = json.loads(await ws.recv())
        check("hello 시험 모드", (hello["t"], hello["live"]), ("hello", False))
        await ws.send(json.dumps({"t": "joy", "x": 0, "y": 1, "seq": 0}))
        ack = json.loads(await ws.recv())
        check("조종 ack", (ack["t"], ack["ok"], ack["throttleUs"]), ("ack", True, to_us(0, C.JOY_MAX_THROTTLE)[1]))
        await ws.send(json.dumps({"t": "ping", "id": 7}))
        check("ping→pong", json.loads(await ws.recv()), {"t": "pong", "id": 7})
        # 손을 뗀 것처럼 아무것도 안 보냄 → 데드맨이 halt 를 알려 준다
        halt = json.loads(await asyncio.wait_for(ws.recv(), 2))
        check("데드맨 halt 알림", halt["t"], "halt")

    async with connect(url) as ws:
        await ws.send(json.dumps({"t": "auth", "token": joy.token}))
        await ws.recv()
        await ws.send(json.dumps({"t": "joy", "x": 0, "y": 1, "seq": 0}))
        await ws.recv()
    await asyncio.sleep(0.3)
    check("연결 끊기면 정지", (joy.core.moving, m.last), (False, (1500, 1500)))


joy = Joystick(m, lambda: None)
joy.token = "test-token-1234567890"
ready = threading.Event()
joy._thread = threading.Thread(target=joy._serve, args=(ready,), daemon=True)
joy._thread.start()
ready.wait(5)
try:
    asyncio.run(live())
finally:
    joy.stop()
check("끄면 서버 스레드 종료", joy._thread is None, True)

print()
print("모두 통과 ✅" if not FAILS else f"실패 {len(FAILS)}개: {FAILS}")
sys.exit(1 if FAILS else 0)
