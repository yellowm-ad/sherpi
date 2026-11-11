"""
인식 화면 직접 보기(live_view.py) 시험 — 노트북에서:  python robot/tests/test_live_view.py
터널 없이 127.0.0.1 로 비밀번호·사진 받기·느린 기기 건너뛰기·인원 제한을 확인한다.
"""
import asyncio
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from bridge import config as C  # noqa: E402
from bridge.live_view import LiveView  # noqa: E402

FAILS = []


def check(name, got, want):
    ok = want(got) if callable(want) else got == want
    print(f"{'✅' if ok else '❌'} {name}: {got}")
    if not ok:
        FAILS.append(name)


lv = LiveView(port=8892)
check("터널 없이 켜기", lv.start(use_tunnel=False), True)
check("터널 없으면 주소 안 알림", lv.info(), None)
check("보는 사람 없으면 publish 무시", (lv.publish({"a": 1}, "AAAA"), lv._latest), (None, None))


async def main() -> None:
    from websockets.asyncio.client import connect
    url = "ws://127.0.0.1:8892"
    async with connect(url) as ws:
        await ws.send(json.dumps({"t": "auth", "token": "wrong"}))
        try:
            await ws.recv()
            check("틀린 비밀번호 끊김", "열림", "끊김")
        except Exception:
            check("틀린 비밀번호 끊김", "끊김", "끊김")

    async with connect(url) as a, connect(url) as b:
        for ws in (a, b):
            await ws.send(json.dumps({"t": "auth", "token": lv.token}))
            check("hello", json.loads(await ws.recv())["t"], "hello")
        await asyncio.sleep(0.05)
        check("보는 기기 2대", lv.viewers, 2)
        lv.publish({"decision": "GO"}, "QUJD")
        for name, ws in (("A", a), ("B", b)):
            m = json.loads(await asyncio.wait_for(ws.recv(), 2))
            check(f"{name} 사진 받음", (m["t"], m["result"]["decision"], m["frame"]), ("frame", "GO", "QUJD"))
        # 빠르게 여러 장 → 마지막 장은 반드시 받는다 (중간은 건너뛰어도 됨)
        for i in range(20):
            lv.publish({"decision": "GO", "i": i}, "QUJD")
        last = None
        try:
            while True:
                m = json.loads(await asyncio.wait_for(a.recv(), 0.5))
                last = m["result"]["i"]
        except asyncio.TimeoutError:
            pass
        check("밀려도 최신 사진까지 받음", last, 19)
        await a.send(json.dumps({"t": "ping", "id": 5}))
        m = json.loads(await asyncio.wait_for(a.recv(), 2))
        while m["t"] != "pong":
            m = json.loads(await asyncio.wait_for(a.recv(), 2))
        check("ping→pong", m, {"t": "pong", "id": 5})

        extra = []
        for _ in range(C.LIVE_MAX_VIEWERS):
            ws = await connect(url)
            await ws.send(json.dumps({"t": "auth", "token": lv.token}))
            extra.append(ws)
        codes = []
        for ws in extra:
            try:
                await asyncio.wait_for(ws.recv(), 1)
                codes.append("ok")
            except Exception:
                codes.append(ws.close_code)
        check(f"최대 {C.LIVE_MAX_VIEWERS}대 — 넘치면 거절", codes.count(4003), 2)
        for ws in extra:
            await ws.close()
    await asyncio.sleep(0.2)
    check("끊기면 인원에서 빠짐", lv.viewers, 0)


try:
    asyncio.run(main())
finally:
    lv.stop()
check("끄면 서버 종료", lv._thread is None, True)
print()
print("모두 통과 ✅" if not FAILS else f"실패 {len(FAILS)}개: {FAILS}")
sys.exit(1 if FAILS else 0)
