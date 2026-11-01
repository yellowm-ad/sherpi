"""② 릴 인출길이 L — AS5600 회전각 → 겹감김 반경 모델(닫힌 해) → 길이.

r(L)² = r0² + c(Ltot − L),  c = t²/(πw)
φ − φ0 = (2/c)[r(L0) − r(L)]   ⇔   L = Ltot − (r² − r0²)/c,  r = r(L0) − (c/2)(φ − φ0)
"""
import math
from dataclasses import dataclass


@dataclass
class ReelGeom:
    r0: float
    t: float
    w: float
    Ltot: float


def reel_c(g):
    return g.t * g.t / (math.pi * g.w)


def reel_radius(g, L):
    return math.sqrt(g.r0 * g.r0 + reel_c(g) * max(0.0, g.Ltot - L))


def reel_phi(g, L0, L):
    return (2 / reel_c(g)) * (reel_radius(g, L0) - reel_radius(g, L))


def reel_length(g, L0, phi):
    c = reel_c(g)
    r = max(g.r0, reel_radius(g, L0) - (c / 2) * phi)
    return g.Ltot - (r * r - g.r0 * g.r0) / c


class ReelOdometer:
    """AS5600 12bit 누적. 언랩 Δ = ((raw − prev + 2048) mod 4096) − 2048.
    고착: 동일 원시값 연속 횟수(sameCount) — 정상 센서는 ±1 LSB 떨림이 있다 (HYST=0 설정 필수)."""

    def __init__(self, geom, L0):
        self.geom = geom
        self.L0 = L0
        self.prev = None
        self.phi = 0.0
        self.same_count = 0

    def update(self, raw):
        if raw is not None:
            if self.prev is not None:
                d = ((raw - self.prev + 2048) % 4096) - 2048
                self.phi += d * 2 * math.pi / 4096
                self.same_count = self.same_count + 1 if raw == self.prev else 0
            self.prev = raw
        return self.length

    @property
    def length(self):
        return reel_length(self.geom, self.L0, self.phi)
