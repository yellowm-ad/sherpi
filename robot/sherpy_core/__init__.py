"""셰르피 처리 파이프라인 (라즈베리파이용) — 웹 src/lib/sherpy/core/*.ts 의 1:1 이식.

    ① 변수 구하기  HX711 count → T,  AS5600 count → L,  카메라 픽셀 → θ
    ② 변수 통합    EKF 로 강아지 위치·거리·불확실성
    ③ 안전 판단    L0~L3 (HOLD 래치, 자동 복귀 없음)
    ④ 명령         속도 v, 조향 δ, 릴 속도 L̇

순수 파이썬(math 만) — numpy 없이 Pi 5 에서 25 Hz 로 충분히 돈다.
TS 와 같은 입력에 같은 출력을 내는지 scripts/verify-math.ts + robot/sherpy_core/verify_golden.py 가 대조한다.
"""
from .params import K, SimParams, HwParams, DEFAULT_PARAMS, DEFAULT_HW
from .calib import fit_linear, lowpass_alpha, G
from .reel import ReelGeom, ReelOdometer, reel_length, reel_phi, reel_radius
from .camera import CamModel, bearing_from_pixel, range_from_box, undistort_x
from .tracker import DogTracker, Pose
from .safety import SafetySupervisor, SafetyCfg
from .pipeline import SherpyCore, CoreConfig
