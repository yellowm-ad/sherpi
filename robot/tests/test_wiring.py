"""
배선 점검(wiring.py) 시험 — 노트북에서:  python robot/tests/test_wiring.py
가짜 I2C 버스(PCA9685·AS5600 레지스터)와 가짜 GPIO(TM1637 ACK·HX711 비트)로
'꽂혀 있음 / 안 꽂힘' 두 경우의 판단이 맞는지 확인한다.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from bridge import wiring  # noqa: E402

FAILS = []


def check(name, got, want):
    ok = want(got) if callable(want) else got == want
    print(("✅" if ok else "❌"), name, "→", got)
    if not ok:
        FAILS.append(name)


# ── 가짜 I2C ──────────────────────────────────
class FakeBus:
    def __init__(self, devices: dict[int, dict[int, int]]):
        self.dev = devices

    def _regs(self, addr):
        if addr not in self.dev:
            raise OSError(121, "Remote I/O error")
        return self.dev[addr]

    def read_byte_data(self, addr, reg):
        return self._regs(addr).get(reg, 0)

    def read_i2c_block_data(self, addr, reg, n):
        r = self._regs(addr)
        return [r.get(reg + i, 0) for i in range(n)]

    def write_i2c_block_data(self, addr, reg, data):
        r = self._regs(addr)
        for i, v in enumerate(data):
            r[reg + i] = v


def pca_regs(prescale=121, sleeping=True):
    regs = {0x00: 0x11 if sleeping else 0x01, 0xFE: prescale}
    for ch in range(16):                      # 전원 직후: 모든 채널 FULL OFF
        regs[0x06 + 4 * ch + 3] = 0x10
    return regs


# AS5600: 자석 감지 + 각도 2048
bus = FakeBus({0x36: {0x0B: 0x20, 0x0C: 0x08, 0x0D: 0x00}, 0x40: pca_regs()})
a = wiring.as5600(bus)
check("AS5600 대답·자석·각도", a, {"ok": True, "magnet": "ok", "angle": 2048})
check("AS5600 자석 약함", wiring.as5600(FakeBus({0x36: {0x0B: 0x30}}))["magnet"], "weak")
check("AS5600 없음", wiring.as5600(FakeBus({})), {"ok": False})

for test_us in (1100, 1437, 1900):
    p = wiring.pca9685(bus, test_us)
    check(f"PCA9685 시험값 {test_us}us 왕복 일치", p["loop"], lambda x: x["match"] and abs(x["back"] - test_us) <= 5)
check("PCA9685 50Hz 근처 (prescale 121)", p["freqHz"], lambda f: 49 < f < 51)
check("CH15 원래대로 (FULL OFF)", bus.dev[0x40][0x06 + 4 * 15 + 3], 0x10)
check("조향·ESC 채널 = 출력 없음(읽기만)", (p["steerUs"], p["throttleUs"]), (None, None))
check("PCA9685 없음", wiring.pca9685(FakeBus({}), 1500), {"ok": False})

# 실제 출력 중이면 CH0/CH1 이 1500us 로 읽혀야 — adafruit 라이브러리처럼 ON=0, OFF=duty>>4
pr = pca_regs(sleeping=False)
ticks = round(1500 / 20000 * 4096 * (25e6 / (4096 * 122)) / 50)   # ≈ 307
for ch in (0, 1):
    b = 0x06 + 4 * ch
    pr[b], pr[b + 1], pr[b + 2], pr[b + 3] = 0, 0, ticks & 0xFF, ticks >> 8
p = wiring.pca9685(FakeBus({0x40: pr}), 1500)
check("실제 출력 중 조향·ESC 1500us 근처", (p["steerUs"], p["throttleUs"]), lambda t: all(abs(x - 1500) <= 10 for x in t))


# ── 가짜 GPIO (lgpio 흉내) ─────────────────────
class FakeLG:
    SET_PULL_UP = 32

    def __init__(self, tm_present=(), hx_values=None):
        self.out, self.mode = {}, {}
        self.tm = set(tm_present)      # (clk, dio) 쌍 — 이 핀에 표시기가 있으면 ACK
        self.hx = list(hx_values) if hx_values is not None else None
        self.bits, self.clk_hi = [], 0

    def gpio_claim_output(self, h, g, level=0, flags=0):
        self.mode[g] = "out"; self.out[g] = level

    def gpio_claim_input(self, h, g, flags=0):
        self.mode[g] = "in"

    def gpio_free(self, h, g):
        self.mode.pop(g, None)

    def gpio_write(self, h, g, v):
        if g == 6 and v == 1 and self.hx is not None and self.bits:   # HX711 SCK 상승 → 다음 비트
            self.clk_hi += 1
        self.out[g] = v

    def gpio_read(self, h, g):
        for clk, dio in self.tm:
            if g == dio and self.mode.get(dio) == "in":
                return 0                     # ACK
        if g == 5:                            # HX711 DOUT
            if self.hx is None:
                return 1                      # 없음 → 풀업으로 HIGH
            if not self.bits or self.clk_hi >= 25:
                if not self.hx:
                    return 1
                v = self.hx.pop(0) & 0xFFFFFF
                self.bits = [(v >> (23 - i)) & 1 for i in range(24)]
                self.clk_hi = 0
                return 0                      # 준비됨
            return self.bits[self.clk_hi - 1] if 0 < self.clk_hi <= 24 else 0
        return 1


lg = FakeLG(tm_present=[(20, 21)])
check("TM1637 RED 있음 → ACK", wiring.tm1637(lg, 0, 20, 21, 1234)["ok"], True)
check("TM1637 BLUE 없음 → 응답 없음", wiring.tm1637(lg, 0, 19, 26, 1234)["ok"], False)

check("HX711 없음", wiring.hx711(FakeLG(), 0), {"ok": False})
r = wiring.hx711(FakeLG(hx_values=[1000, 1010, 995, 1003, 1001]), 0)
check("HX711 값 5개 · 로드셀 정상", (r["ok"], r["raw"], r["cell"]), (True, [1000, 1010, 995, 1003, 1001], "ok"))
r = wiring.hx711(FakeLG(hx_values=[0x7FFFFF] * 5), 0)
check("HX711 포화 → 로드셀 선 의심", r["cell"], "bad")
r = wiring.hx711(FakeLG(hx_values=[-5000 & 0xFFFFFF] * 5), 0)
check("HX711 음수 값", r["raw"][0], -5000)

# ── GPS NMEA 체크섬 ───────────────────────────
check("NMEA 체크섬 맞음", wiring._nmea_ok("$GPGGA,123519,4807.038,N,01131.000,E,1,08,0.9,545.4,M,46.9,M,,*47"), True)
check("NMEA 체크섬 틀림", wiring._nmea_ok("$GPGGA,123519,4807.038,N,01131.000,E,1,08,0.9,545.4,M,46.9,M,,*48"), False)

print()
print("모두 통과 ✅" if not FAILS else f"실패 {len(FAILS)}개 ❌: {FAILS}")
sys.exit(1 if FAILS else 0)
