"""① 장력 T — 로드셀 + HX711 선형 보정.  T = aX + b,  min Σ[F_i − (aX_i + b)]²  (중심화 정규방정식)"""
import math

G = 9.80665


def fit_linear(X, F):
    n = len(X)
    if n < 2 or len(F) != n:
        raise ValueError("보정 점이 2개 이상 필요")
    mx = sum(X) / n
    mf = sum(F) / n
    sxx = sxf = sff = 0.0
    for x, f in zip(X, F):
        dx, df = x - mx, f - mf
        sxx += dx * dx
        sxf += dx * df
        sff += df * df
    if sxx == 0:
        raise ValueError("원시값이 모두 같음 — 하중을 바꿔 측정할 것")
    a = sxf / sxx
    b = mf - a * mx
    sse = sum((f - (a * x + b)) ** 2 for x, f in zip(X, F))
    return {
        "a": a, "b": b, "r2": 1 - sse / sff if sff else 1.0, "rmse": math.sqrt(sse / n), "n": n,
        "seA": math.sqrt(sse / (n - 2) / sxx) if n > 2 else 0.0,
    }


def counts_to_newton(fit, X):
    return fit["a"] * X + fit["b"]


def lowpass_alpha(dt, tau):
    """α = 1 − exp(−dt / max(0.025, τ)) — 1차 저역통과의 정확한 이산화"""
    return 1 - math.exp(-dt / max(0.025, tau))
