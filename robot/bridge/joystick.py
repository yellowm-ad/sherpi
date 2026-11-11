"""
수동 조종(조이스틱) — 티칭(주행 학습) 때 사람이 폰으로 로봇을 몬다.

    폰 앱 ──wss──▶ Cloudflare 임시 터널 ──▶ 파이 127.0.0.1:8890 (이 파일) ──▶ motor.py

- 서버(Vercel) 명령 큐는 1초씩 늦어 조종에 못 쓴다 → 폰과 파이가 터널로 직접 주고받는다 (보통 0.05~0.15초).
- 파이는 여전히 '밖으로 나가는' 연결만 쓴다 (터널). 공유기 포트 개방 없음.

[안전]
- 손을 떼면 앱이 0 을 보내고, 0.3초 동안 신호가 없으면 파이가 스스로 정지한다 (데드맨).
- 연결이 끊기면 정지. 조종기는 한 번에 한 대 (새로 붙으면 이전 기기는 끊고 정지부터).
- 전진만 한다 (후진은 ESC 후진 절차·안전 확인 뒤). 스로틀 상한 JOY_MAX_THROTTLE.
- 긴급 정지·자동주행 중에는 조종을 거부한다 (allow 콜백).
[보안]
- 켤 때마다 새 비밀번호(token). 첫 메시지로 맞는 token 이 3초 안에 와야 조종할 수 있다.
- 주소·비밀번호는 health 로 서버에 올리고, 서버는 로봇 주인에게만 보여 준다.
- 받은 값 중 숫자 두 개(x, y)만 쓴다. 문자열을 실행하지 않는다.
"""
import asyncio
import json
import math
import re
import secrets
import subprocess
import threading
import time
from collections.abc import Callable

from . import config as C
from .motor import Motor

URL_RE = re.compile(r"https://[a-z0-9-]+\.trycloudflare\.com")


def _num(v) -> float:
    try:
        v = float(v)
    except (TypeError, ValueError):
        return 0.0
    return max(-1.0, min(1.0, v)) if math.isfinite(v) else 0.0


class JoyCore:
    """네트워크 없이 시험할 수 있는 조종 판단 (스틱 값 → 모터, 데드맨, 거부)."""

    def __init__(self, motor: Motor, allow: Callable[[], str | None],
                 on_input: Callable[[float, float], None] | None = None,
                 clock: Callable[[], float] = time.monotonic) -> None:
        self.motor = motor
        self.allow = allow
        self.on_input = on_input or (lambda s, v: None)
        self.clock = clock
        self.lock = threading.Lock()
        self.seq = -1
        self.last_at = 0.0
        self.moving = False

    def handle(self, x, y, seq) -> dict | None:
        """앱의 스틱 값 하나 처리 → 앱에 돌려줄 ack (건너뛰면 None)"""
        try:
            seq = int(seq)
        except (TypeError, ValueError):
            return None
        x, y = _num(x), _num(y)
        zero = abs(x) < C.JOY_DEAD_ZONE and abs(y) < C.JOY_DEAD_ZONE
        with self.lock:
            now = self.clock()
            if seq <= self.seq:
                return None                     # 늦게 도착한 옛 신호
            if not zero and now - self.last_at < 1.0 / C.JOY_MAX_HZ:
                return None                     # 너무 잦음 (0 = 멈춤 신호는 항상 처리)
            self.seq = seq
            self.last_at = now
            reason = self.allow()
            if reason:
                self._halt()
                return self._ack(seq, 0.0, 0.0, reason=reason)
            steer = 0.0 if abs(x) < C.JOY_DEAD_ZONE else x * C.JOY_STEER_MAX
            fwd = 0.0 if y < C.JOY_DEAD_ZONE else y
            speed = fwd * C.JOY_MAX_THROTTLE
            self.motor.drive(steer, speed)
            was = self.moving
            self.moving = steer != 0.0 or speed != 0.0
            if self.moving or was:
                self.on_input(steer, speed)
            note = "후진은 아직 지원하지 않아요" if y <= -0.3 else None
            return self._ack(seq, steer, speed, note=note)

    def tick(self) -> str | None:
        """주기적으로 불러 데드맨·거부 확인. 멈췄으면 이유를 돌려준다."""
        with self.lock:
            if not self.moving:
                return None
            if self.clock() - self.last_at > C.JOY_DEADMAN_SEC:
                self._halt()
                return "신호가 끊겨 멈췄어요"
            reason = self.allow()
            if reason:
                self._halt()
                return reason
        return None

    def halt(self) -> None:
        with self.lock:
            self._halt()

    def reset(self) -> None:
        """새 조종기가 붙을 때 — 번호를 처음부터 받고 정지 상태로 시작"""
        with self.lock:
            self.seq = -1
            self._halt()

    def _halt(self) -> None:
        self.motor.stop()
        if self.moving:
            self.on_input(0.0, 0.0)
        self.moving = False

    def _ack(self, seq: int, steer: float, speed: float, reason: str | None = None, note: str | None = None) -> dict:
        su, tu = self.motor.last
        return {"t": "ack", "seq": seq, "ok": reason is None, "reason": reason, "note": note,
                "steer": round(steer, 3), "speed": round(speed, 3), "steerUs": su, "throttleUs": tu}


class Joystick:
    """조종 서버(127.0.0.1) + Cloudflare 임시 터널 켜기/끄기"""

    def __init__(self, motor: Motor, allow: Callable[[], str | None],
                 on_input: Callable[[float, float], None] | None = None) -> None:
        self.motor = motor
        self.core = JoyCore(motor, allow, on_input)
        self.url: str | None = None
        self.token: str | None = None
        self.error: str | None = None
        self.cf: subprocess.Popen | None = None
        self._loop: asyncio.AbstractEventLoop | None = None
        self._stop_fut: asyncio.Future | None = None
        self._thread: threading.Thread | None = None
        self._client = None
        self._lock = threading.Lock()

    # ── 상태 ──
    @property
    def running(self) -> bool:
        return bool(self.url and self.cf and self.cf.poll() is None and self._thread and self._thread.is_alive())

    @property
    def connected(self) -> bool:
        return self._client is not None

    def info(self) -> dict | None:
        return {"url": self.url, "token": self.token} if self.running else None

    # ── 켜기 / 끄기 ──
    def start(self) -> bool:
        with self._lock:
            if self.running:
                return True
            self._kill()
            self.error = None
            try:
                import websockets  # noqa: F401
            except ImportError:
                self.error = "websockets 가 없어요 (bash robot/install_agent.sh 다시 실행)"
                return False
            if subprocess.run(["which", "cloudflared"], capture_output=True).returncode != 0:
                self.error = "cloudflared 가 설치돼 있지 않아요"
                return False

            self.token = secrets.token_urlsafe(24)
            ready = threading.Event()
            self._thread = threading.Thread(target=self._serve, args=(ready,), daemon=True)
            self._thread.start()
            ready.wait(5)
            if not self._thread.is_alive():
                self.error = self.error or "조종 서버를 못 열었어요"
                return False

            self.cf = subprocess.Popen(
                ["cloudflared", "tunnel", "--no-autoupdate", "--url", f"http://localhost:{C.JOY_PORT}"],
                stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
            )
            killer = threading.Timer(40, lambda: self.cf and self.cf.poll() is None and not self.url and self.cf.kill())
            killer.daemon = True
            killer.start()
            url = None
            for line in self.cf.stdout:  # 보통 5~15초
                m = URL_RE.search(line)
                if m:
                    url = m.group(0)
                    break
            killer.cancel()
            if not url:
                self.error = "터널 주소를 못 받았어요 (인터넷 연결 확인)"
                self._kill()
                return False
            threading.Thread(target=lambda: [None for _ in self.cf.stdout], daemon=True).start()
            self.url = url
            return True

    def stop(self) -> None:
        with self._lock:
            self._kill()

    def halt(self) -> None:
        """긴급 정지 등 — 연결은 두고 바퀴만 즉시 정지"""
        self.core.halt()

    def _kill(self) -> None:
        self.core.reset()
        if self.cf and self.cf.poll() is None:
            self.cf.terminate()
            try:
                self.cf.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.cf.kill()
        self.cf = None
        self.url = None
        self.token = None
        if self._loop and self._stop_fut:
            loop, fut = self._loop, self._stop_fut
            loop.call_soon_threadsafe(lambda: fut.done() or fut.set_result(None))
        if self._thread:
            self._thread.join(timeout=3)
        self._thread = None
        self._loop = self._stop_fut = None
        self._client = None

    # ── 서버 (별도 스레드의 asyncio) ──
    def _serve(self, ready: threading.Event) -> None:
        try:
            from websockets.asyncio.server import serve  # websockets ≥ 13
        except ImportError:
            from websockets.server import serve  # type: ignore[no-redef]  # 예전 버전
        loop = asyncio.new_event_loop()
        self._loop = loop

        async def main() -> None:
            self._stop_fut = loop.create_future()
            async with serve(self._handler, "127.0.0.1", C.JOY_PORT, max_size=1024, ping_interval=5, ping_timeout=5):
                ready.set()
                ticker = asyncio.create_task(self._ticker())
                await self._stop_fut
                ticker.cancel()

        try:
            loop.run_until_complete(main())
        except Exception as e:  # noqa: BLE001 — 포트 사용 중 등
            self.error = f"조종 서버 오류: {e}"[:200]
        finally:
            self.core.halt()
            loop.close()
            ready.set()

    async def _ticker(self) -> None:
        while True:
            await asyncio.sleep(0.05)
            why = self.core.tick()
            if why and self._client is not None:
                try:
                    await self._client.send(json.dumps({"t": "halt", "reason": why}))
                except Exception:  # noqa: BLE001
                    pass

    async def _handler(self, ws, *_) -> None:
        # 1) 비밀번호 확인
        try:
            m = json.loads(await asyncio.wait_for(ws.recv(), 3))
            ok = isinstance(m, dict) and m.get("t") == "auth" and self.token is not None \
                and secrets.compare_digest(str(m.get("token", "")), self.token)
        except Exception:  # noqa: BLE001
            ok = False
        if not ok:
            await ws.close(4001, "auth")
            return
        # 2) 한 대만 — 새 기기가 붙으면 이전 기기는 끊고 정지부터
        old = self._client
        self._client = ws
        self.core.reset()
        if old is not None:
            try:
                await old.close(4002, "replaced")
            except Exception:  # noqa: BLE001
                pass
        await ws.send(json.dumps({"t": "hello", "live": self.motor.live, "max": C.JOY_MAX_THROTTLE,
                                  "deadman": C.JOY_DEADMAN_SEC, "motorError": self.motor.error}))
        # 3) 조종
        try:
            async for raw in ws:
                if not isinstance(raw, str) or len(raw) > 256:
                    continue
                try:
                    m = json.loads(raw)
                except ValueError:
                    continue
                if not isinstance(m, dict):
                    continue
                if m.get("t") == "joy":
                    ack = self.core.handle(m.get("x"), m.get("y"), m.get("seq"))
                    if ack:
                        await ws.send(json.dumps(ack))
                elif m.get("t") == "ping":
                    await ws.send(json.dumps({"t": "pong", "id": m.get("id")}))
        except Exception:  # noqa: BLE001 — 끊김
            pass
        finally:
            if self._client is ws:
                self._client = None
                self.core.halt()
