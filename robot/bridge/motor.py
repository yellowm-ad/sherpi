"""
모터 출력 한 곳 — 수동 조종(조이스틱)과 나중의 자동주행이 모두 여기로만 바퀴를 움직인다.

기본은 '시험 모드': PCA9685 로 신호를 보내지 않고, 보낼 값(마이크로초)만 계산해 돌려준다.
  → 배선 전에도 앱 조이스틱 ↔ 파이 연결·안전 동작(손 떼면 정지 등)을 확인할 수 있다.
실제로 바퀴를 돌리려면 (배선 끝 + 바퀴를 바닥에서 띄운 상태에서) robot/.env 에
  SHERPY_MOTOR=on
을 넣고 에이전트를 다시 시작한다 (sudo systemctl restart sherpy-agent).
"""
import math
import threading

from . import config as C


def to_us(steer: float, speed: float) -> tuple[int, int]:
    """hal_pca9685.PCA9685HAL.drive 와 같은 계산 — (조향 us, 스로틀 us)"""
    half = (C.PWM_MAX_US - C.PWM_MIN_US) / 2.0
    return round(C.PWM_NEUTRAL_US + steer * half), round(C.PWM_NEUTRAL_US + speed * half)


def _clamp(v, lo: float, hi: float) -> float:
    try:
        v = float(v)
    except (TypeError, ValueError):
        return 0.0
    if not math.isfinite(v):
        return 0.0
    return max(lo, min(hi, v))


class Motor:
    def __init__(self) -> None:
        self.live = False
        self.error: str | None = None
        self.hal = None
        self._lock = threading.Lock()
        self.last = to_us(0.0, 0.0)
        if C.MOTOR_LIVE:
            try:
                from hal_pca9685 import PCA9685HAL  # robot/ 폴더 (agent.py 가 경로에 넣어 둠)
                self.hal = PCA9685HAL()            # 켜자마자 중립(정지)
                self.hal.set_gear(low=True)        # 산책 속도는 저속단
                self.live = True
            except Exception as e:  # noqa: BLE001 — 드라이버가 없으면 시험 모드로라도 살아 있어야 한다
                self.error = f"모터 드라이버 연결 실패 → 시험 모드: {e}"[:200]

    def drive(self, steer: float, speed: float) -> tuple[int, int]:
        """steer -1(좌)~+1(우), speed 0~1(전진). 실제로 나간(또는 시험 모드에서 나갔을) us 값을 돌려준다."""
        steer = _clamp(steer, -1.0, 1.0)
        speed = _clamp(speed, 0.0, 1.0)
        us = to_us(steer, speed)
        with self._lock:
            if self.live and self.hal:
                self.hal.drive(steer, speed)
            self.last = us
        return us

    def stop(self) -> tuple[int, int]:
        with self._lock:
            if self.live and self.hal:
                self.hal.neutral()
            self.last = to_us(0.0, 0.0)
        return self.last

    def close(self) -> None:
        self.stop()
        if self.hal:
            try:
                self.hal.close()
            except Exception:  # noqa: BLE001
                pass
