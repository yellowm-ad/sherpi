"""③ 방향각 θ — 픽셀 u → 왜곡 보정(뉴턴법) → 장착각 보정.  θ = atan(x_n) + ψ_cam"""
import math
from dataclasses import dataclass


@dataclass
class CamModel:
    fx: float
    fy: float
    cx: float
    k1: float
    yaw: float
    W: float


def undistort_x(xd, k1):
    x = xd
    for _ in range(6):
        g = x + k1 * x * x * x - xd
        dg = 1 + 3 * k1 * x * x
        x -= g / dg
    return x


def bearing_from_pixel(cam, u):
    xd = (u - cam.cx) / cam.fx
    return math.atan(undistort_x(xd, cam.k1)) + cam.yaw


def range_from_box(cam, h, dog_height, theta):
    thc = theta - cam.yaw
    return (cam.fy * dog_height) / max(1.0, h) / max(0.2, math.cos(thc))
