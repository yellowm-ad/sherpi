"""입력 변수·상수 — src/lib/sherpy/params.ts 와 반드시 같은 값 (verify_golden 이 대조)."""
from dataclasses import dataclass, asdict


class K:
    DT = 0.04
    FRAMES = 1000
    WHEELBASE = 0.35
    ACCEL = 0.85
    DECEL = 1.9
    STEER_GAIN = 1.4
    FOLLOW_GAIN = 1.2
    WARN_SPEED = 0.2
    REEL_MIN = 1.2
    REEL_SLACK = 0.04
    REEL_OUT = 0.65
    REEL_IN = 0.5
    ROPE_DAMP = 12
    ENCODER_STUCK_FRAMES = 25


@dataclass
class SimParams:
    dogSpeed: float = 0.48
    robotMax: float = 0.8
    followDist: float = 1.6
    reelMax: float = 3.0
    dogMass: float = 15
    pullForce: float = 30
    stiffness: float = 550
    steerMax: float = 35
    tau: float = 0.2
    noise: float = 0.8
    warn: float = 16
    stop: float = 35
    clearance: float = 0.2


@dataclass
class HwParams:
    lcGain: float = 1.2e-3
    lcOffset: float = -0.35
    lcCountNoise: float = 180
    lcDrift: float = 0.004
    lcTimeout: float = 0.2
    reelCore: float = 0.025
    ropeThick: float = 0.003
    drumWidth: float = 0.03
    ropeTotal: float = 5
    encNoiseLsb: float = 0.6
    encResidualTol: float = 0.15
    camW: float = 640
    camFx: float = 300
    camFy: float = 300
    camCx: float = 324
    camK1: float = -0.08
    camYaw: float = 0.026
    camYawEst: float = 0.022
    camPxNoise: float = 2.5
    camHNoise: float = 0.05
    camDrop: float = 0.03
    camLostHold: float = 0.5
    dogHeight: float = 0.45
    odoSpeedNoise: float = 0.02
    gyroNoise: float = 0.01
    # Flexi 태엽 릴 — T_s(L) = T0 + k_s·L
    flexiT0: float = 1.5
    flexiKs: float = 0.5
    flexiDamp: float = 2
    flexiRetract: float = 1.5
    flexiLock: bool = True


DEFAULT_PARAMS = SimParams()
DEFAULT_HW = HwParams()


def as_dict(x) -> dict:
    return asdict(x)
