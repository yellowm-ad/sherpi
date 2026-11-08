"""셰르피 한 사이클 (0.04초) — pipeline.ts 와 식·순서 동일.

입력 packet(dict):
  t, loadRaw(HX711 count|None), encRaw(AS5600 0~4095|None), cam({"u","h"}|None),
  odo({"v","yawRate"}), geom(dict|None), avoidX(float|None)
"""
import math
from dataclasses import dataclass

from .params import K
from .calib import counts_to_newton, lowpass_alpha
from .reel import ReelGeom, ReelOdometer
from .camera import CamModel, bearing_from_pixel, range_from_box
from .tracker import DogTracker, Pose
from .safety import SafetySupervisor, SafetyCfg


def clamp(v, lo, hi):
    return max(lo, min(hi, v))


def wrap_pi(a):
    return math.atan2(math.sin(a), math.cos(a))


@dataclass
class CoreConfig:
    p: object                  # SimParams
    hw: object                 # HwParams
    fit: dict                  # {"a","b"} — 로드셀 보정 결과
    reelMode: str = "tension"  # tension | position | naive
    L0: float = 1.6
    Tref: float = 2.0
    predict: bool = False
    l2Mode: str = "slow"       # slow | directional
    encCross: bool = False     # 엔코더 교차 확인 (카메라 거리 변화 vs L)
    ffMode: str = "fixed"      # fixed | ekf — 추종 앞먹임


class SherpyCore:
    def __init__(self, cfg: CoreConfig):
        self.cfg = cfg
        p, hw = cfg.p, cfg.hw
        self.pose = Pose()
        self.tracker = DogTracker()
        self.odo = ReelOdometer(ReelGeom(hw.reelCore, hw.ropeThick, hw.drumWidth, hw.ropeTotal), cfg.L0)
        self.prev_L = cfg.L0
        self.cam = CamModel(hw.camFx, hw.camFy, hw.camW / 2, hw.camK1, hw.camYawEst, hw.camW)
        self.safety = SafetySupervisor(SafetyCfg(p.warn, p.stop, p.clearance, p.reelMax,
                                                 hw.lcTimeout, hw.camLostHold, K.ENCODER_STUCK_FRAMES, hw.encResidualTol,
                                                 predict=bool(cfg.predict)))
        self.tracker.init(self.pose, 0.0, p.followDist, 0.3, 0.2)
        self.That = 0.0
        self.Tfast = 0.0
        self.load_age = 0.0
        self.cam_age = 0.0
        self.snagF = 0.0
        self.snag_time = 0.0
        self._last_cmd_rate = 0.0
        self._enc_hist = []
        self.prev_That = 0.0
        self.Tdot = 0.0
        self.Ldot = 0.0
        self.dcam_f = None
        self._cross_hist = []
        self.cross_time = 0.0

    def step(self, s):
        p, hw = self.cfg.p, self.cfg.hw
        dt = K.DT
        odo = s["odo"]
        self.pose.psi += odo["yawRate"] * dt
        self.pose.x += odo["v"] * math.sin(self.pose.psi) * dt
        self.pose.y += odo["v"] * math.cos(self.pose.psi) * dt
        self.tracker.predict(dt)

        # ① 변수 구하기
        T = None
        if s.get("loadRaw") is not None:
            T = counts_to_newton(self.cfg.fit, s["loadRaw"])
            self.That += lowpass_alpha(dt, p.tau) * (T - self.That)
            self.Tfast += lowpass_alpha(dt, 0.05) * (T - self.Tfast)
            self.load_age = 0.0
        else:
            self.load_age += dt
        aD = lowpass_alpha(dt, 0.1)
        self.Tdot += aD * ((self.That - self.prev_That) / dt - self.Tdot)
        self.prev_That = self.That

        L = self.odo.update(s.get("encRaw"))
        self._enc_hist.append((L - self.prev_L, self._last_cmd_rate * dt))
        if len(self._enc_hist) > K.ENCODER_STUCK_FRAMES:
            self._enc_hist.pop(0)
        self.Ldot += aD * ((L - self.prev_L) / dt - self.Ldot)
        self.prev_L = L
        sum_cmd = 0.0
        for _, c in self._enc_hist:
            sum_cmd += c
        sum_meas = 0.0
        for m, _ in self._enc_hist:
            sum_meas += m
        enc_residual = abs(sum_cmd - sum_meas) if (
            self.Tfast < p.warn / 2 and abs(sum_meas) < 0.002 and K.REEL_MIN + 0.02 < L < p.reelMax - 0.02) else 0.0

        theta_meas = d_cam = None
        cam = s.get("cam")
        if cam:
            theta_meas = bearing_from_pixel(self.cam, cam["u"])
            d_cam = range_from_box(self.cam, cam["h"], hw.dogHeight, theta_meas)

        # ② 변수 통합
        rel0 = self.tracker.relative(self.pose)
        robot_radial = odo["v"] * (math.sin(self.pose.psi) * rel0["ex"] + math.cos(self.pose.psi) * rel0["ey"]) / rel0["rho"]
        v_rel = rel0["vr"] - robot_radial

        nis = {"bearing": None, "rope": None, "cam": None}
        cam_used = False
        if theta_meas is not None:
            u = self.tracker.update_bearing(self.pose, theta_meas, math.hypot(hw.camPxNoise / hw.camFx, 0.006))
            nis["bearing"], cam_used = u["nis"], u["used"]
        d_rope = None
        if self.Tfast > 1.0 and self.load_age == 0:
            T_base = (hw.flexiT0 + hw.flexiKs * max(0.0, L)) if self.cfg.reelMode == "flexi" else 0.0
            d_rope = L + max(0.0, self.Tfast - T_base - K.ROPE_DAMP * max(0.0, v_rel)) / p.stiffness

        if d_rope is not None and d_cam is not None:
            self.snagF += lowpass_alpha(dt, 0.3) * (d_rope - d_cam - self.snagF)
        else:
            self.snagF *= 0.98
        snag_thresh = max(0.3, 0.12 * L)
        self.snag_time = self.snag_time + dt if self.snagF > snag_thresh else 0.0
        snag = self.snag_time >= 0.4

        if d_rope is not None and not snag:
            sig = math.hypot(0.01, 0.6 / p.stiffness, 0.004 * L)
            nis["rope"] = self.tracker.update_range(self.pose, d_rope, sig)["nis"]
        else:
            self.tracker.constrain_max_range(self.pose, L + 0.03, 0.03)
        if d_cam is not None:
            nis["cam"] = self.tracker.update_range(self.pose, d_cam, 0.06 * d_cam + 0.04)["nis"]

        self.cam_age = 0.0 if cam_used else self.cam_age + dt
        if self.cam_age > 0.2:
            k = math.exp(-dt / 0.8)
            self.tracker.s[2] *= k
            self.tracker.s[3] *= k
        rel = self.tracker.relative(self.pose)
        sigma = self.tracker.sigma_pos
        track = "ok" if self.cam_age == 0 else ("coast" if self.cam_age <= hw.camLostHold else "lost")

        # 엔코더 교차 확인: 카메라 거리는 변하는데 L 이 그대로
        enc_cam = False
        if self.cfg.encCross:
            if d_cam is not None:
                self.dcam_f = d_cam if self.dcam_f is None else self.dcam_f + lowpass_alpha(dt, 0.3) * (d_cam - self.dcam_f)
            self._cross_hist.append((self.dcam_f if self.cam_age <= 0.2 else None, L))
            if len(self._cross_hist) > K.ENCODER_STUCK_FRAMES + 1:
                self._cross_hist.pop(0)
            a, b = self._cross_hist[0], self._cross_hist[-1]
            moved = (len(self._cross_hist) > K.ENCODER_STUCK_FRAMES and a[0] is not None and b[0] is not None
                     and abs(b[0] - a[0]) > max(0.2, 0.1 * b[0]) and abs(b[1] - a[1]) < 0.002
                     and K.REEL_MIN + 0.02 < L < p.reelMax - 0.02)
            self.cross_time = self.cross_time + dt if moved else 0.0
            enc_cam = self.cross_time >= 0.4

        # ③ 안전 판단
        so = self.safety.step({
            "t": s["t"], "Thead": self.That, "loadAge": self.load_age, "encFrozen": self.odo.same_count,
            "encResidual": enc_residual, "camAge": self.cam_age, "sigmaPos": sigma, "snag": snag,
            "reel": L, "geom": s.get("geom"), "Tdot": self.Tdot, "Ldot": self.Ldot, "encCam": enc_cam,
        })

        # ④ 명령
        ex = self.tracker.s[0] - self.pose.x
        ey = self.tracker.s[1] - self.pose.y
        pu = math.atan2(ex, max(0.2, ey))
        if s.get("avoidX") is not None:
            pu = math.atan2(s["avoidX"] - self.pose.x, 1)
        steer_lim = p.steerMax * math.pi / 180
        steer = clamp(K.STEER_GAIN * wrap_pi(pu - self.pose.psi), -steer_lim, steer_lim)
        if self.cfg.ffMode == "ekf":
            vff = 0.0 if track == "lost" else clamp(rel["vr"], 0, p.robotMax)
        else:
            vff = p.dogSpeed
        v = clamp(vff + K.FOLLOW_GAIN * (rel["rho"] - p.followDist), 0, p.robotMax)
        # 방향 고려 L2: 강아지가 멀어지며 당기는 중(v_r > 0.05)이면 L2 감속을 걸지 않는다 (L3 는 그대로)
        pulling = self.cfg.l2Mode == "directional" and so["level"] == 2 and v_rel > 0.05
        if so["speedCap"] is not None and not (pulling and not so["hold"]):
            v = min(v, so["speedCap"])

        mode = self.cfg.reelMode
        if mode == "tension":
            reel_rate = 0.03 * (self.Tfast - self.cfg.Tref) + max(-0.3, min(0.6, v_rel))
            if self.load_age > 0:
                reel_rate = 0.0
        elif mode == "flexi":
            reel_rate = 0.0
        elif mode == "position":
            reel_rate = (clamp(rel["rho"] + K.REEL_SLACK, K.REEL_MIN, p.reelMax) - L) / dt
        else:
            reel_rate = 0.0 if d_cam is None else (clamp(d_cam + K.REEL_SLACK, K.REEL_MIN, p.reelMax) - L) / dt
        reel_rate = clamp(reel_rate, -K.REEL_IN, 0.0 if so["hold"] else K.REEL_OUT)
        if L >= p.reelMax - 1e-6:
            reel_rate = min(reel_rate, 0.0)
        if L <= K.REEL_MIN + 1e-6:
            reel_rate = max(reel_rate, 0.0)
        self._last_cmd_rate = reel_rate

        return {
            "t": s["t"], "T": T, "Tfast": self.Tfast, "That": self.That, "L": L,
            "thetaMeas": theta_meas, "dCam": d_cam, "dRope": d_rope,
            "est": {"xr": rel["xr"], "yr": rel["yr"], "theta": rel["theta"], "d": rel["rho"], "sigma": sigma, "vr": v_rel},
            "pose": {"x": self.pose.x, "y": self.pose.y, "psi": self.pose.psi},
            "track": track, "snagResidual": self.snagF,
            "level": so["level"], "hold": so["hold"], "reason": so["reason"], "notes": so["notes"],
            "cmd": {"v": 0.0 if so["hold"] else v, "steer": steer, "reelRate": reel_rate},
            "rate": {"Tdot": self.Tdot, "Ldot": self.Ldot}, "vff": vff,
        }

    def resume(self, clear):
        return self.safety.try_reset(clear)
