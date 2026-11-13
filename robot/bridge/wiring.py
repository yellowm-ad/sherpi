"""
배선 점검 — 조립 가이드(docs/assembly-guide.html) 단계마다 웹 [배선 점검] 버튼 한 번으로
부품이 '정말' 연결됐는지, 웹에서 보낸 값이 부품까지 그대로 가는지 확인한다.

    웹 [배선 점검] → 서버 명령 큐(WIRING_CHECK, 시험값 us·code) → agent.py → 여기 → health.wiring 으로 보고

부품별로 '응답'을 직접 받아 판단한다 (핀이 있다/없다가 아니라 칩이 대답하는지):
  2단계 허브     /dev/i2c-1 · /dev/ttyAMA0 존재
  3단계 AS5600   0x36 응답 + 자석 상태(STATUS) + 각도(RAW ANGLE)
  4단계 PCA9685  0x40 응답 + ★ 신호 왕복: 웹이 정한 시험값(us)을 '비어 있는 CH15' 레지스터에 쓰고
                 다시 읽어 같은지 비교 → 웹 → 서버 → 파이 → 구동부 드라이버 경로 확인.
                 CH0(조향)·CH1(ESC)는 건드리지 않고 지금 값만 읽는다 (바퀴가 움직일 일이 없다).
  5단계 TM1637   칩의 ACK 비트(대답)로 연결 확인 + 웹이 정한 4자리 숫자를 표시 → 눈으로도 확인
  6단계 E-stop   점검하는 동안(약 6초) 눌렀다 떼는 것을 감지 (안 누르면 '못 봄' — 연결 안 됨과 구분 못 하므로)
  7단계 HX711    DOUT 이 '준비(LOW)'로 내려오는지 + 24비트 값 5개 → 포화·흔들림으로 로드셀 선 상태 추정
  8단계 GPS      UART 로 들어오는 NMEA 문장 수(체크섬 통과) · 위성 수 · 측위 여부

모든 항목은 짧은 시간 제한이 있고, 하나가 실패해도 나머지는 계속한다. 라이브러리가 없으면 None(모름).
값을 '쓰는' 곳은 PCA9685 CH15 레지스터와 TM1637 표시뿐이고, 둘 다 끝나면 원래대로 돌린다.
"""
from __future__ import annotations

import os
import time
from collections.abc import Callable

from . import config as C

TEST_CH = 15             # PCA9685 에서 쓰지 않는 채널 — 시험값 왕복용
ESTOP_WATCH_SEC = 6.0    # 이 시간 동안 E-stop 눌림/뗌을 지켜본다


# ── 공통: lgpio 칩 열기 (Pi 5 = RP1, 커널에 따라 gpiochip0 또는 4) ──
def _gpio_open():
    try:
        import lgpio  # type: ignore
    except ImportError:
        return None, None
    for chip in (0, 4, 1, 2, 3, 5):
        try:
            h = lgpio.gpiochip_open(chip)
        except Exception:  # noqa: BLE001
            continue
        try:
            _, lines, _name, label = lgpio.gpio_get_chip_info(h)
            if lines >= 54 or "rp1" in str(label).lower():
                return lgpio, h
        except Exception:  # noqa: BLE001
            pass
        lgpio.gpiochip_close(h)
    return lgpio, None


# ── 2단계: 허브 ─────────────────────────────────
def hub() -> dict:
    return {"i2c": os.path.exists("/dev/i2c-1"), "uart": os.path.exists(C.GPS_PORT)}


# ── 3단계: AS5600 ───────────────────────────────
def as5600(bus) -> dict:
    try:
        st = bus.read_byte_data(0x36, 0x0B)
        hi, lo = bus.read_i2c_block_data(0x36, 0x0C, 2)
    except OSError:
        return {"ok": False}
    magnet = "ok" if st & 0x20 else "none"
    if st & 0x20 and st & 0x10:
        magnet = "weak"
    elif st & 0x20 and st & 0x08:
        magnet = "strong"
    return {"ok": True, "magnet": magnet, "angle": ((hi & 0x0F) << 8) | lo}


# ── 4단계: PCA9685 신호 왕복 ─────────────────────
def _led_base(ch: int) -> int:
    return 0x06 + 4 * ch


# ⚠️ 블록 읽기/쓰기는 MODE1 의 자동 증가(AI) 비트가 켜져 있을 때만 다음 레지스터로 넘어간다.
#    전원 직후(모터 시험 모드)에는 AI 가 꺼져 있어 블록으로 읽으면 같은 칸만 4번 읽힌다.
#    → 한 바이트씩 읽고 쓴다 (MODE1 은 건드리지 않는다).
def _rd4(bus, reg: int) -> list[int]:
    return [bus.read_byte_data(C.I2C_ADDRESS, reg + i) for i in range(4)]


def _wr4(bus, reg: int, data: list[int]) -> None:
    for i, v in enumerate(data):
        bus.write_byte_data(C.I2C_ADDRESS, reg + i, v)


def _read_us(bus, ch: int, prescale: int) -> int | None:
    """채널 레지스터 → 펄스 폭(us). 출력 꺼짐이면 None"""
    on_l, on_h, off_l, off_h = _rd4(bus, _led_base(ch))
    if off_h & 0x10:                          # FULL OFF
        return None
    ticks = ((off_h & 0x0F) << 8 | off_l) - ((on_h & 0x0F) << 8 | on_l)
    ticks %= 4096
    freq = 25_000_000 / (4096 * (prescale + 1))
    return round(ticks / 4096 * 1_000_000 / freq)


def pca9685(bus, test_us: int) -> dict:
    try:
        mode1 = bus.read_byte_data(C.I2C_ADDRESS, 0x00)
        prescale = bus.read_byte_data(C.I2C_ADDRESS, 0xFE)
    except OSError:
        return {"ok": False}
    out: dict = {"ok": True, "awake": not (mode1 & 0x10)}
    freq = 25_000_000 / (4096 * (prescale + 1))
    out["freqHz"] = round(freq, 1)
    # 시험값 → CH15 → 다시 읽기. 레지스터는 잠든(sleep) 상태에서도 쓰고 읽힌다.
    base = _led_base(TEST_CH)
    try:
        saved = _rd4(bus, base)
        ticks = round(test_us * freq * 4096 / 1_000_000)
        ticks = max(0, min(4095, ticks))
        _wr4(bus, base, [0, 0, ticks & 0xFF, ticks >> 8])
        back = _read_us(bus, TEST_CH, prescale)
        _wr4(bus, base, saved)                                 # 원래대로
        step = 1_000_000 / freq / 4096                         # 한 칸 (50Hz 면 4.9us)
        out["loop"] = {"sent": test_us, "back": back, "match": back is not None and abs(back - test_us) <= step + 0.5}
    except OSError:
        out["loop"] = {"sent": test_us, "back": None, "match": False}
    # 조향·ESC 채널: 읽기만
    try:
        out["steerUs"] = _read_us(bus, C.CH_STEER, prescale)
        out["throttleUs"] = _read_us(bus, C.CH_THROTTLE, prescale)
    except OSError:
        pass
    return out


# ── 5단계: TM1637 (ACK + 숫자 표시) ──────────────
_SEG = [0x3F, 0x06, 0x5B, 0x4F, 0x66, 0x6D, 0x7D, 0x07, 0x7F, 0x6F]


class _TM:
    def __init__(self, lg, h, clk: int, dio: int) -> None:
        self.lg, self.h, self.clk, self.dio = lg, h, clk, dio
        lg.gpio_claim_output(h, clk, 1)
        lg.gpio_claim_output(h, dio, 1)

    def _d(self) -> None:
        time.sleep(0.00005)

    def _dio_out(self, v: int) -> None:
        self.lg.gpio_free(self.h, self.dio)
        self.lg.gpio_claim_output(self.h, self.dio, v)

    def _start(self) -> None:
        self.lg.gpio_write(self.h, self.clk, 1); self.lg.gpio_write(self.h, self.dio, 1); self._d()
        self.lg.gpio_write(self.h, self.dio, 0); self._d()

    def _stop(self) -> None:
        self.lg.gpio_write(self.h, self.clk, 0); self._d()
        self.lg.gpio_write(self.h, self.dio, 0); self._d()
        self.lg.gpio_write(self.h, self.clk, 1); self._d()
        self.lg.gpio_write(self.h, self.dio, 1); self._d()

    def _byte(self, b: int) -> bool:
        lg, h = self.lg, self.h
        for i in range(8):
            lg.gpio_write(h, self.clk, 0); self._d()
            lg.gpio_write(h, self.dio, (b >> i) & 1); self._d()
            lg.gpio_write(h, self.clk, 1); self._d()
        # 9번째 클럭: 칩이 DIO 를 LOW 로 당기면 ACK
        lg.gpio_write(h, self.clk, 0)
        lg.gpio_free(h, self.dio)
        lg.gpio_claim_input(h, self.dio, lg.SET_PULL_UP)
        self._d()
        lg.gpio_write(h, self.clk, 1); self._d()
        ack = lg.gpio_read(h, self.dio) == 0
        lg.gpio_write(h, self.clk, 0); self._d()
        self._dio_out(0)
        return ack

    def show(self, code: int) -> bool:
        digits = [_SEG[int(c)] for c in f"{code:04d}"[-4:]]
        self._start(); a1 = self._byte(0x40); self._stop()           # 자동 주소 증가
        self._start(); a2 = self._byte(0xC0)
        for d in digits:
            self._byte(d)
        self._stop()
        self._start(); a3 = self._byte(0x88 | 5); self._stop()       # 켜기 · 밝기 5
        return a1 and a2 and a3

    def close(self) -> None:
        for p in (self.clk, self.dio):
            try:
                self.lg.gpio_free(self.h, p)
            except Exception:  # noqa: BLE001
                pass


def tm1637(lg, h, clk: int, dio: int, code: int) -> dict:
    try:
        tm = _TM(lg, h, clk, dio)
    except Exception as e:  # noqa: BLE001 — 다른 프로그램이 핀을 쓰는 중
        return {"ok": None, "error": f"핀 사용 중: {e}"[:80]}
    try:
        return {"ok": tm.show(code), "code": code}
    finally:
        tm.close()


# ── 7단계: HX711 ────────────────────────────────
def hx711(lg, h) -> dict:
    dt, sck = C.HX711_DT, C.HX711_SCK
    try:
        lg.gpio_claim_input(h, dt, lg.SET_PULL_UP)     # HX711 이 없으면 풀업 때문에 계속 HIGH
        lg.gpio_claim_output(h, sck, 0)
    except Exception as e:  # noqa: BLE001
        return {"ok": None, "error": f"핀 사용 중: {e}"[:80]}
    vals: list[int] = []
    try:
        for _ in range(5):
            t0 = time.monotonic()
            while lg.gpio_read(h, dt) == 1:            # 10회/초 보드면 최대 0.1초 대기
                if time.monotonic() - t0 > 0.4:
                    return {"ok": False} if not vals else {"ok": True, "raw": vals, "partial": True}
                time.sleep(0.002)
            v = 0
            for _ in range(24):                        # SCK HIGH 가 60us 넘으면 칩이 잠드니 빠르게
                lg.gpio_write(h, sck, 1)
                v = (v << 1) | lg.gpio_read(h, dt)
                lg.gpio_write(h, sck, 0)
            lg.gpio_write(h, sck, 1); lg.gpio_write(h, sck, 0)   # 25번째 = 채널 A · 이득 128
            if v & 0x800000:
                v -= 1 << 24
            vals.append(v)
    finally:
        lg.gpio_write(h, sck, 0)
        for p in (dt, sck):
            try:
                lg.gpio_free(h, p)
            except Exception:  # noqa: BLE001
                pass
    sat = sum(1 for v in vals if v >= 0x7FFFFF or v <= -0x800000)
    spread = max(vals) - min(vals) if vals else 0
    # 로드셀이 안 물렸거나 선이 빠지면 값이 끝(포화)에 붙거나 크게 출렁인다
    cell = "bad" if sat >= 2 or spread > 200_000 else "ok"
    return {"ok": True, "raw": vals, "spread": spread, "cell": cell}


# ── 8단계: GPS ─────────────────────────────────
def _nmea_ok(line: str) -> bool:
    if not line.startswith("$") or "*" not in line:
        return False
    body, _, cs = line[1:].partition("*")
    x = 0
    for ch in body:
        x ^= ord(ch)
    return cs[:2].upper() == f"{x:02X}"


def gps(seconds: float = 2.5) -> dict:
    if not os.path.exists(C.GPS_PORT):
        return {"ok": None, "port": False}
    try:
        import termios
        fd = os.open(C.GPS_PORT, os.O_RDONLY | os.O_NOCTTY | os.O_NONBLOCK)
    except (ImportError, OSError) as e:
        return {"ok": None, "port": True, "error": str(e)[:80]}
    try:
        attrs = termios.tcgetattr(fd)
        baud = getattr(termios, f"B{C.GPS_BAUD}", termios.B9600)
        attrs[0] = 0; attrs[1] = 0                                 # iflag · oflag: 원시
        attrs[2] = termios.CS8 | termios.CREAD | termios.CLOCAL    # cflag
        attrs[3] = 0                                               # lflag
        attrs[4] = baud; attrs[5] = baud
        termios.tcsetattr(fd, termios.TCSANOW, attrs)
        termios.tcflush(fd, termios.TCIFLUSH)
        buf = b""
        t_end = time.monotonic() + seconds
        while time.monotonic() < t_end:
            try:
                chunk = os.read(fd, 1024)
                if chunk:
                    buf += chunk
            except BlockingIOError:
                pass
            time.sleep(0.05)
    finally:
        os.close(fd)
    lines = buf.decode("ascii", "ignore").splitlines()
    good = [ln.strip() for ln in lines if _nmea_ok(ln.strip())]
    sats, fix = None, False
    for ln in good:
        f = ln.split(",")
        if ln[3:6] == "GGA" and len(f) > 7:
            fix = f[6] not in ("", "0")
            sats = int(f[7]) if f[7].isdigit() else sats
    # 바이트는 오는데 문장이 하나도 안 맞으면 → 속도(baud) 불일치 또는 TX/RX 엇갈림 잡음
    return {"ok": len(good) > 0, "port": True, "bytes": len(buf), "sentences": len(good), "sats": sats, "fix": fix}


# ── 전체 ───────────────────────────────────────
def check_all(test_us: int, code: int, estop_presses: Callable[[], tuple[int, int] | None]) -> dict:
    """test_us: PCA9685 왕복 시험값(1000~2000), code: 표시기에 띄울 4자리.
    estop_presses: (눌림 횟수, 뗌 횟수) 를 돌려주는 함수 — 에이전트의 E-stop 버튼 객체가 센다. 없으면 None."""
    t0 = time.monotonic()
    e0 = estop_presses()
    r: dict = {"hub": hub()}

    # I2C 장치
    try:
        from smbus2 import SMBus  # type: ignore
        with SMBus(1) as bus:
            r["as5600"] = as5600(bus)
            r["pca9685"] = pca9685(bus, test_us)
    except ImportError:
        r["as5600"] = r["pca9685"] = {"ok": None, "error": "smbus2 없음"}
    except (OSError, FileNotFoundError):
        r["as5600"] = r["pca9685"] = {"ok": None, "error": "I2C 꺼짐"}

    # GPIO 장치 (TM1637 · HX711)
    lg, h = _gpio_open()
    if h is None:
        msg = "lgpio 없음" if lg is None else "GPIO 칩 못 찾음"
        r["tmRed"] = r["tmBlue"] = r["hx711"] = {"ok": None, "error": msg}
    else:
        try:
            r["tmRed"] = tm1637(lg, h, C.TM1637_1_CLK, C.TM1637_1_DIO, code)
            r["tmBlue"] = tm1637(lg, h, C.TM1637_2_CLK, C.TM1637_2_DIO, code)
            r["hx711"] = hx711(lg, h)
        finally:
            lg.gpiochip_close(h)

    r["gps"] = gps()

    # E-stop: 나머지 점검이 끝나도 ESTOP_WATCH_SEC 까지는 지켜본다
    if e0 is None:
        r["estop"] = {"ok": None, "error": "버튼 감시 꺼짐"}
    else:
        while time.monotonic() - t0 < ESTOP_WATCH_SEC:
            time.sleep(0.1)
        e1 = estop_presses() or e0
        pressed, released = e1[0] - e0[0], e1[1] - e0[1]
        r["estop"] = {"ok": True if pressed > 0 and released > 0 else None, "pressed": pressed, "released": released}

    r["testUs"] = test_us
    r["code"] = code
    r["at"] = int(time.time())
    r["tookMs"] = round((time.monotonic() - t0) * 1000)
    return r


if __name__ == "__main__":     # 파이에서 직접:  cd ~/sherpy/robot && .venv/bin/python -m bridge.wiring
    import json
    print(json.dumps(check_all(1500, 1234, lambda: None), ensure_ascii=False, indent=2))
