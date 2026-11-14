"""
인식 화면 직접 보기 — 폰 ──wss──▶ Cloudflare 임시 터널 ──▶ 파이 127.0.0.1:8891 (이 파일)

- 예전: 파이 → Vercel → DB → 웹이 0.7초마다 가져감 → 1~3초 늦은 슬라이드쇼.
- 지금: 폰이 파이에 직접 붙어 최신 사진·판단을 초당 5장 받는다 (보통 0.2~0.5초 늦음).
  직접 연결이 안 되면 웹은 예전 방식(서버 경유)으로 저절로 돌아간다.
- 보기만 한다 — 폰에서 받는 것은 비밀번호·ping 뿐, 로봇을 움직이는 명령은 없다.

[보안] 켤 때마다 새 비밀번호(token), 첫 메시지 3초 안에 확인. 주소·비밀번호는 health 로 올리고
       서버는 로봇 주인에게만 보여 준다. 동시에 보는 기기는 LIVE_MAX_VIEWERS 대까지.
"""
from __future__ import annotations

import asyncio
import json
import secrets
import subprocess
import threading

from . import config as C
from . import tunnel


class LiveView:
    def __init__(self, port: int = C.LIVE_PORT) -> None:
        self.port = port
        self.url: str | None = None
        self.token: str | None = None
        self.error: str | None = None
        self.cf: subprocess.Popen | None = None
        self._viewers: set = set()
        self._latest: str | None = None   # 보낼 최신 메시지 (JSON 문자열). 느린 기기는 중간 사진을 건너뛴다
        self._seq = 0
        self._loop: asyncio.AbstractEventLoop | None = None
        self._stop_fut: asyncio.Future | None = None
        self._new: asyncio.Event | None = None
        self._thread: threading.Thread | None = None
        self._lock = threading.Lock()

    # ── 상태 ──
    @property
    def running(self) -> bool:
        return bool(self.url and self.cf and self.cf.poll() is None and self._thread and self._thread.is_alive())

    @property
    def viewers(self) -> int:
        return len(self._viewers)

    def info(self) -> dict | None:
        return {"url": self.url, "token": self.token} if self.running else None

    # ── 켜기 / 끄기 ──
    def start(self, use_tunnel: bool = True) -> bool:
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
            if use_tunnel and not tunnel.available():
                self.error = "cloudflared 가 설치돼 있지 않아요"
                return False
            self.token = secrets.token_urlsafe(24)
            ready = threading.Event()
            self._thread = threading.Thread(target=self._serve, args=(ready,), daemon=True)
            self._thread.start()
            ready.wait(5)
            if not self._thread.is_alive():
                self.error = self.error or "화면 서버를 못 열었어요"
                return False
            if not use_tunnel:  # 시험용 (127.0.0.1 만)
                return True
            self.cf, url = tunnel.open_tunnel(self.port)
            if not url:
                self.error = "터널 주소를 못 받았어요 — 서버 경유로 보여 줘요"
                self._kill()
                return False
            self.url = url
            return True

    def stop(self) -> None:
        with self._lock:
            self._kill()

    def _kill(self) -> None:
        tunnel.close(self.cf)
        self.cf = None
        self.url = None
        self.token = None
        if self._loop and self._stop_fut:
            loop, fut = self._loop, self._stop_fut
            loop.call_soon_threadsafe(lambda: fut.done() or fut.set_result(None))
        if self._thread:
            self._thread.join(timeout=3)
        self._thread = None
        self._loop = self._stop_fut = self._new = None
        self._viewers = set()
        self._latest = None

    # ── 보내기 (인식 스레드에서 부른다) ──
    def publish(self, result: dict | None, jpeg_b64: str) -> None:
        loop, new = self._loop, self._new
        if not loop or not new or not self._viewers:
            return
        self._seq += 1
        self._latest = json.dumps({"t": "frame", "seq": self._seq, "result": result, "frame": jpeg_b64},
                                  ensure_ascii=False)
        loop.call_soon_threadsafe(new.set)

    # ── 서버 (별도 스레드의 asyncio) ──
    def _serve(self, ready: threading.Event) -> None:
        try:
            from websockets.asyncio.server import serve  # websockets ≥ 13
        except ImportError:
            from websockets.server import serve  # type: ignore[no-redef]
        loop = asyncio.new_event_loop()
        self._loop = loop

        async def main() -> None:
            self._stop_fut = loop.create_future()
            self._new = asyncio.Event()
            async with serve(self._handler, "127.0.0.1", self.port, max_size=1024,
                             ping_interval=10, ping_timeout=10):
                ready.set()
                await self._stop_fut

        try:
            loop.run_until_complete(main())
        except Exception as e:  # noqa: BLE001 — 포트 사용 중 등
            self.error = f"화면 서버 오류: {e}"[:200]
        finally:
            loop.close()
            ready.set()

    async def _handler(self, ws, *_) -> None:
        try:
            m = json.loads(await asyncio.wait_for(ws.recv(), 3))
            ok = isinstance(m, dict) and m.get("t") == "auth" and self.token is not None \
                and secrets.compare_digest(str(m.get("token", "")), self.token)
        except Exception:  # noqa: BLE001
            ok = False
        if not ok:
            await ws.close(4001, "auth")
            return
        if len(self._viewers) >= C.LIVE_MAX_VIEWERS:
            await ws.close(4003, "full")
            return
        self._viewers.add(ws)
        await ws.send(json.dumps({"t": "hello"}))
        sender = asyncio.create_task(self._send_loop(ws))
        try:
            async for raw in ws:  # 보기 전용 — ping 만 받는다
                if isinstance(raw, str) and len(raw) < 128:
                    try:
                        m = json.loads(raw)
                    except ValueError:
                        continue
                    if isinstance(m, dict) and m.get("t") == "ping":
                        await ws.send(json.dumps({"t": "pong", "id": m.get("id")}))
        except Exception:  # noqa: BLE001 — 끊김
            pass
        finally:
            sender.cancel()
            self._viewers.discard(ws)

    async def _send_loop(self, ws) -> None:
        sent = 0
        try:
            while True:
                new = self._new
                if new is None:
                    return
                if self._seq == sent:
                    # set() 은 기다리던 기기를 모두 깨운다 — 그 뒤 clear 해도 깨어난 기기는 그대로 진행
                    await new.wait()
                    new.clear()
                msg, seq = self._latest, self._seq
                if msg and seq != sent:
                    sent = seq
                    await ws.send(msg)   # 느린 기기면 여기서 기다리는 동안 새 사진이 덮어쓴다(중간 건너뜀)
        except Exception:  # noqa: BLE001
            pass
