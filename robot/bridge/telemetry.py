"""
텔레메트리 업링크 — 1Hz로 로봇 상태를 서버에 올린다.

지속 연결(WebSocket)을 쓰지 않고 매번 POST하므로, 네트워크가 끊겼다
다시 붙어도 다음 전송부터 자동으로 복구된다. 끊긴 동안의 데이터는
최대 BUFFER_MAX개까지 로컬에 모았다가 한 번에 올린다.
"""
import threading
import time
from collections import deque
from datetime import datetime, timezone

import requests

from . import config as C


class TelemetryUplink:
    def __init__(self) -> None:
        self.url = f"{C.SERVER_URL}/api/robots/{C.ROBOT_ID}/telemetry"
        self.headers = {"Authorization": f"Bearer {C.API_KEY}"}
        self.buffer: deque = deque(maxlen=C.BUFFER_MAX)
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

    def start(self, snapshot_fn) -> None:
        """snapshot_fn: 현재 상태 dict를 돌려주는 콜러블"""
        self._snapshot = snapshot_fn
        self._thread = threading.Thread(target=self._loop, daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        if self._thread:
            self._thread.join(timeout=2)

    def _loop(self) -> None:
        period = 1.0 / C.TELEMETRY_HZ
        while not self._stop.is_set():
            t0 = time.monotonic()
            try:
                self.buffer.append(self._build(self._snapshot()))
                self._flush()
            except Exception as e:  # 업링크 실패가 주행을 막으면 안 된다
                print(f"[telemetry] {e}")
            time.sleep(max(0.0, period - (time.monotonic() - t0)))

    def _build(self, s: dict) -> dict:
        return {
            "ts": datetime.now(timezone.utc).isoformat(),
            "mode": s.get("mode", "idle"),
            "safety_level": int(s.get("safety_level", 0)),
            "faults": s.get("faults", []),
            "tension_n": s.get("tension_n"),
            "leash_len_m": s.get("leash_len_m"),
            "speed_cmd": s.get("speed_cmd"),
            "steer_cmd": s.get("steer_cmd"),
            "lat": s.get("lat"),
            "lng": s.get("lng"),
            "gps_src": s.get("gps_src", "phone"),
            "speed_mps": s.get("speed_mps"),       # GPS 실측 지면속도 (gps.telemetry_fields)
            "heading_deg": s.get("heading_deg"),
            "gps_sats": s.get("gps_sats"),
            "route_id": s.get("route_id"),
            "kf_index": s.get("kf_index"),
            "kf_total": s.get("kf_total"),
            "match_quality": s.get("match_quality"),
            "battery_v": s.get("battery_v"),   # ADC 미장착이면 None
        }

    def _flush(self) -> None:
        if not self.buffer:
            return
        batch = list(self.buffer)
        res = requests.post(self.url, json=batch, headers=self.headers, timeout=C.HTTP_TIMEOUT)
        if res.ok:
            self.buffer.clear()
        else:
            print(f"[telemetry] HTTP {res.status_code} — 버퍼 {len(self.buffer)}개 유지")
