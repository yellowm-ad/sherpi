"""
명령 다운링크 — 1Hz로 서버를 폴링한다.

로봇이 폴링하는 구조라서 인바운드 포트를 열 필요가 없다.
LTE 테더링·스마트폰 핫스팟 환경에서도 그대로 동작한다.

[안전]
서버 응답을 WATCHDOG_SEC(3초) 이상 못 받으면 on_watchdog 콜백을 호출해
로봇이 스스로 감속·정지하게 한다. 원격 정지는 보조 수단이고,
1차 안전장치는 본체 ESC 전원 스위치(모터 전원 차단)다.
"""
import threading
import time

import requests

from . import config as C


class CommandDownlink:
    def __init__(self) -> None:
        base = f"{C.SERVER_URL}/api/robots/{C.ROBOT_ID}/commands"
        self.pending_url = f"{base}/pending"
        self.ack_url = base + "/{cid}/ack"
        self.headers = {"Authorization": f"Bearer {C.API_KEY}"}
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self.last_ok = time.monotonic()
        self.last_rtt_ms: float | None = None   # 서버 응답 시간 (연결 품질 표시용)

    def start(self, on_command, on_watchdog) -> None:
        self._on_command = on_command
        self._on_watchdog = on_watchdog
        self._thread = threading.Thread(target=self._loop, daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        if self._thread:
            self._thread.join(timeout=2)

    def _loop(self) -> None:
        period = 1.0 / C.COMMAND_HZ
        while not self._stop.is_set():
            t0 = time.monotonic()
            try:
                res = requests.get(self.pending_url, headers=self.headers, timeout=C.HTTP_TIMEOUT)
                if res.ok:
                    self.last_ok = time.monotonic()
                    self.last_rtt_ms = (self.last_ok - t0) * 1000
                    for cmd in res.json().get("commands", []):
                        self._handle(cmd)
            except Exception as e:
                print(f"[commands] {e}")

            if time.monotonic() - self.last_ok > C.WATCHDOG_SEC:
                self._on_watchdog()

            time.sleep(max(0.0, period - (time.monotonic() - t0)))

    def _handle(self, cmd: dict) -> None:
        try:
            self._on_command(cmd["type"], cmd.get("payload") or {})
        finally:
            try:
                requests.post(
                    self.ack_url.format(cid=cmd["id"]),
                    headers=self.headers, timeout=C.HTTP_TIMEOUT,
                )
            except Exception as e:
                print(f"[commands] ack 실패: {e}")
