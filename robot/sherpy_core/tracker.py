"""② 변수 통합 — 강아지 위치 EKF. tracker.ts 와 식·순서 동일 (설명은 TS 주석 참고).

상태 s = [x, y, vx, vy] (오도메트리 좌표), 예측 = 등속 + 이산 백색가속 잡음,
갱신 = 스칼라 측정(θ, 거리) 순차 결합, 조셉 형식 공분산, NIS 게이트 9.
"""
import math
from dataclasses import dataclass


@dataclass
class Pose:
    x: float = 0.0
    y: float = 0.0
    psi: float = 0.0


def _eye():
    return [[1.0 if i == j else 0.0 for j in range(4)] for i in range(4)]


class DogTracker:
    def __init__(self, sigma_accel=1.6, gate=9.0):
        self.sigma_accel = sigma_accel
        self.gate = gate
        self.s = [0.0, 0.0, 0.0, 0.0]
        self.P = _eye()
        self.ready = False

    def init(self, pose, theta, d, sig_d=0.3, sig_th=0.15):
        a = pose.psi + theta
        self.s = [pose.x + d * math.sin(a), pose.y + d * math.cos(a), 0.0, 0.0]
        J = [[math.sin(a), d * math.cos(a)], [math.cos(a), -d * math.sin(a)]]
        Sp = [[sig_d * sig_d, 0.0], [0.0, sig_th * sig_th]]
        C = [[0.0, 0.0], [0.0, 0.0]]
        for i in range(2):
            for j in range(2):
                for k in range(2):
                    for l in range(2):
                        C[i][j] += J[i][k] * Sp[k][l] * J[j][l]
        self.P = [[C[0][0] + 1e-4, C[0][1], 0.0, 0.0], [C[1][0], C[1][1] + 1e-4, 0.0, 0.0],
                  [0.0, 0.0, 0.5, 0.0], [0.0, 0.0, 0.0, 0.5]]
        self.ready = True

    def predict(self, dt):
        x, y, vx, vy = self.s
        self.s = [x + vx * dt, y + vy * dt, vx, vy]
        P = self.P
        FP = [r[:] for r in P]
        for j in range(4):
            FP[0][j] = P[0][j] + dt * P[2][j]
            FP[1][j] = P[1][j] + dt * P[3][j]
        N = [r[:] for r in FP]
        for i in range(4):
            N[i][0] = FP[i][0] + dt * FP[i][2]
            N[i][1] = FP[i][1] + dt * FP[i][3]
        q = self.sigma_accel ** 2
        q11 = (dt ** 4) / 4 * q
        q13 = (dt ** 3) / 2 * q
        q33 = dt * dt * q
        N[0][0] += q11; N[1][1] += q11
        N[0][2] += q13; N[2][0] += q13; N[1][3] += q13; N[3][1] += q13
        N[2][2] += q33; N[3][3] += q33
        self.P = N

    def relative(self, pose):
        ex = self.s[0] - pose.x
        ey = self.s[1] - pose.y
        c, sn = math.cos(pose.psi), math.sin(pose.psi)
        xr = ex * c - ey * sn
        yr = ex * sn + ey * c
        rho = max(1e-3, math.hypot(ex, ey))
        vr = (self.s[2] * ex + self.s[3] * ey) / rho
        return {"xr": xr, "yr": yr, "ex": ex, "ey": ey, "rho": rho, "theta": math.atan2(xr, yr), "vr": vr}

    def _scalar_update(self, innov, H, R, gate=None):
        gate = self.gate if gate is None else gate
        P = self.P
        PHt = [P[i][0] * H[0] + P[i][1] * H[1] for i in range(4)]
        S = H[0] * PHt[0] + H[1] * PHt[1] + R
        nis = innov * innov / S if S > 0 else math.inf
        if not (S > 0) or nis > gate:
            return {"used": False, "nis": nis, "innov": innov}
        Kg = [v / S for v in PHt]
        for i in range(4):
            self.s[i] += Kg[i] * innov
        A = _eye()
        for i in range(4):
            A[i][0] -= Kg[i] * H[0]
            A[i][1] -= Kg[i] * H[1]
        AP = [[r[0] * P[0][j] + r[1] * P[1][j] + r[2] * P[2][j] + r[3] * P[3][j] for j in range(4)] for r in A]
        N = [[r[0] * A[j][0] + r[1] * A[j][1] + r[2] * A[j][2] + r[3] * A[j][3] for j in range(4)] for r in AP]
        for i in range(4):
            for j in range(4):
                N[i][j] += Kg[i] * R * Kg[j]
        for i in range(4):
            for j in range(i + 1, 4):
                m = (N[i][j] + N[j][i]) / 2
                N[i][j] = m
                N[j][i] = m
        self.P = N
        return {"used": True, "nis": nis, "innov": innov}

    def update_bearing(self, pose, theta, sigma):
        r = self.relative(pose)
        rho2 = max(1e-4, r["xr"] ** 2 + r["yr"] ** 2)
        c, sn = math.cos(pose.psi), math.sin(pose.psi)
        H = [(r["yr"] * c - r["xr"] * sn) / rho2, -(r["yr"] * sn + r["xr"] * c) / rho2]
        innov = math.atan2(math.sin(theta - r["theta"]), math.cos(theta - r["theta"]))
        return self._scalar_update(innov, H, sigma * sigma)

    def update_range(self, pose, d, sigma, gate=None):
        r = self.relative(pose)
        H = [r["ex"] / r["rho"], r["ey"] / r["rho"]]
        return self._scalar_update(d - r["rho"], H, sigma * sigma, gate)

    def constrain_max_range(self, pose, Lmax, sigma):
        r = self.relative(pose)
        if r["rho"] <= Lmax:
            return False
        self.update_range(pose, Lmax, sigma, math.inf)
        return True

    @property
    def sigma_pos(self):
        return math.sqrt(max(0.0, self.P[0][0] + self.P[1][1]))
