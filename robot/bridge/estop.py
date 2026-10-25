"""
E-stop 물리버튼 — 안전설계 L3 의 1차 수단

앱의 원격 정지는 네트워크를 타서 약 1초 지연·단절 가능성이 있는 보조 수단이다.
이 버튼은 네트워크와 무관하게 GPIO 인터럽트로 즉시 hal.estop() 을 부른다.

배선: 버튼 한쪽 → GPIO 17, 다른 쪽 → GND (내부 풀업 사용, 눌리면 LOW)
      NC(상시폐로) 접점을 쓰면 선이 끊겨도 '눌림'으로 잡혀 더 안전하다 → active_low=False 로 바꾼다.

[⚠️ 라즈베리파이 5]
gpiozero 2.x 는 Pi 5에서 lgpio 백엔드를 쓴다. RPi.GPIO 는 동작하지 않는다.

    from bridge.estop import EstopButton
    btn = EstopButton(on_press=lambda: (hal.estop(), state.set_mode("estop")))
"""
from collections.abc import Callable

try:
    from gpiozero import Button
except ImportError:  # 개발 PC 등 GPIO 가 없는 환경
    Button = None

from . import config as C


class EstopButton:
    def __init__(self, on_press: Callable[[], None], on_release: Callable[[], None] | None = None) -> None:
        self.ok = False
        if Button is None:
            print("[estop] gpiozero 없음 — ⚠️ 물리 비상정지 비활성")
            return
        try:
            # pull_up=True: 눌리면 LOW. bounce_time 으로 채터링 무시
            self.btn = Button(C.ESTOP_PIN, pull_up=C.ESTOP_ACTIVE_LOW, bounce_time=0.05)
            self.btn.when_pressed = on_press
            if on_release:
                self.btn.when_released = on_release
            self.ok = True
            # 부팅 때 이미 눌려 있으면 곧바로 정지 상태로 시작한다
            if self.btn.is_pressed:
                on_press()
        except Exception as e:
            print(f"[estop] 초기화 실패: {e} — ⚠️ 물리 비상정지 비활성")

    @property
    def pressed(self) -> bool:
        return self.ok and self.btn.is_pressed

    def close(self) -> None:
        if self.ok:
            self.btn.close()
