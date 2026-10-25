"""
TM1637 4자리 7세그먼트 LED ×2 — 로봇 본체 상태 표시

[왜 필요한가]
보호자가 항상 폰을 보고 있지는 않다. 로봇만 쳐다봐도 지금 줄이 얼마나 당겨지고
얼마나 풀렸는지 읽을 수 있어야 한다. 네트워크가 끊겨 앱이 멈춰도 이건 계속 동작한다.

  LED_1 (RED)  : 견인 장력, 정수 N   — 임계 초과 시 점멸
  LED_2 (BLUE) : 줄 길이, 정수 cm

[표시 단위를 정수로 잡은 이유]
TM1637 라이브러리마다 소수점(DP) 제어 방식이 달라 이식성이 떨어진다.
장력은 N 단위 정수(0~99), 줄 길이는 cm 단위 정수(0~500)로 띄우면
소수점 없이도 읽는 데 문제가 없고 어느 라이브러리에서나 동작한다.

[⚠️ 라즈베리파이 5 주의]
TM1637 은 CLK/DIO 2선 비트뱅잉이라 GPIO 라이브러리를 탄다.
Pi 5에서는 RPi.GPIO 가 동작하지 않으므로 rpi-lgpio 로 교체되어 있어야 한다.
또한 I2C 를 켜면 GPIO 2/3 이 커널 드라이버에 점유되므로 그 핀을 피해 배선한다.

설치: pip install raspberrypi-tm1637
"""
import threading
import time

try:
    import tm1637
except ImportError:          # 라이브러리가 없어도 로봇은 계속 돌아야 한다
    tm1637 = None

from . import config as C


class StatusDisplay:
    """두 개의 7세그먼트를 0.5초마다 갱신한다. 실패해도 주행을 막지 않는다."""

    def __init__(self) -> None:
        self.ok = False
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self._blink = False
        self._snapshot = lambda: {}

        if tm1637 is None:
            print("[display] tm1637 라이브러리 없음 — 표시 생략")
            return

        try:
            self.tension_led = tm1637.TM1637(clk=C.TM1637_1_CLK, dio=C.TM1637_1_DIO)
            self.leash_led = tm1637.TM1637(clk=C.TM1637_2_CLK, dio=C.TM1637_2_DIO)
            self.tension_led.brightness(5)
            self.leash_led.brightness(5)
            self.ok = True
        except Exception as e:
            print(f"[display] 초기화 실패: {e} — 표시 생략")

    # ── 수명주기 ────────────────────────────────
    def start(self, snapshot_fn) -> None:
        """snapshot_fn: tension_n / leash_len_m 을 담은 dict 를 돌려주는 콜러블"""
        if not self.ok:
            return
        self._snapshot = snapshot_fn
        self._thread = threading.Thread(target=self._loop, daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        if self._thread:
            self._thread.join(timeout=2)
        self._clear()

    def _clear(self) -> None:
        if not self.ok:
            return
        try:
            self.tension_led.write([0, 0, 0, 0])
            self.leash_led.write([0, 0, 0, 0])
        except Exception:
            pass

    # ── 갱신 루프 ───────────────────────────────
    def _loop(self) -> None:
        while not self._stop.is_set():
            try:
                s = self._snapshot()
                self._render(s.get("tension_n"), s.get("leash_len_m"))
            except Exception as e:
                print(f"[display] {e}")
            self._blink = not self._blink
            time.sleep(0.5)      # 0.5초 주기 — 점멸이 1Hz로 보인다

    def _render(self, tension, leash) -> None:
        self._render_tension(tension)
        self._render_leash(leash)

    def _render_tension(self, tension) -> None:
        """장력 N(정수). F_HARD 이상이면 점멸, F_ESTOP 이상이면 전부 점멸."""
        if tension is None:
            self.tension_led.show("----")
            return

        over_estop = tension >= C.F_ESTOP
        over_hard = tension >= C.F_HARD

        if (over_estop or over_hard) and self._blink:
            self.tension_led.write([0, 0, 0, 0])     # 꺼진 프레임
            return

        n = max(0, min(9999, int(round(tension))))
        self.tension_led.show(f"{n:>4}")

    def _render_leash(self, leash) -> None:
        """줄 길이 cm(정수). L_HARD 이상이면 점멸."""
        if leash is None:
            self.leash_led.show("----")
            return

        if leash >= C.L_HARD and self._blink:
            self.leash_led.write([0, 0, 0, 0])
            return

        cm = max(0, min(9999, int(round(leash * 100))))
        self.leash_led.show(f"{cm:>4}")


# ── 단독 테스트 ────────────────────────────────
# robot/ 에서:  python3 -m bridge.display
if __name__ == "__main__":
    import math

    d = StatusDisplay()
    if not d.ok:
        raise SystemExit("디스플레이 초기화 실패 — 배선과 핀 번호를 확인하세요")

    state = {"t": 0.0}
    d.start(lambda: {
        "tension_n": 20 + 18 * math.sin(state["t"]),
        "leash_len_m": 2.5 + 2.0 * math.sin(state["t"] / 3),
    })
    print("장력(N)과 줄 길이(cm)가 번갈아 변합니다. Ctrl+C 로 종료.")
    try:
        while True:
            state["t"] += 0.5
            time.sleep(0.5)
    except KeyboardInterrupt:
        d.stop()
