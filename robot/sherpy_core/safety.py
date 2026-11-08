"""③ 페일세이프 — L0 정상 / L1 주의(표시만) / L2 경고(≤0.2 m/s, 히스테리시스 2 N) / L3 HOLD 래치(자동 복귀 없음)."""
import math
from dataclasses import dataclass


@dataclass
class SafetyCfg:
    warn: float
    stop: float
    clearance: float
    reelMax: float
    lcTimeout: float
    camLostHold: float
    encFrames: int
    encTol: float
    predict: bool = False
    horizon: float = 1.0
    holdFor: float = 0.5


class SafetySupervisor:
    def __init__(self, cfg):
        self.cfg = cfg
        self.hold = False
        self.hold_reason = None
        self.hold_at = None
        self._warn_on = False
        self._pred_until = -1.0
        self._pred_reason = None

    def try_reset(self, clear):
        if not clear:
            return False
        self.hold = False
        self.hold_reason = None
        self.hold_at = None
        return True

    def l3_cause(self, i):
        c = self.cfg
        if i["loadAge"] > c.lcTimeout:
            return "로드셀 신호 단절"
        if i["camAge"] > c.camLostHold:
            return "카메라 추적 실패"
        if i["encFrozen"] >= c.encFrames or i["encResidual"] > c.encTol or i.get("encCam"):
            return "엔코더 고착"
        g = i.get("geom")
        if g:
            if g["body"] < c.clearance:
                return "차체 장애물 안전거리 부족"
            if g["rope"] < 0:
                return "리드줄이 장애물에 걸림"
            if g["robotEdge"] < 0 or g["dogEdge"] < 0:
                return "환경 경계 이탈"
        if i["snag"]:
            return "리드줄 걸림 의심 (줄 길이 ≠ 실제 거리)"
        if i["Thead"] >= c.stop:
            return "장력 정지 임계값 초과"
        return None

    def step(self, i):
        c = self.cfg
        cause = self.l3_cause(i)
        if not self.hold and cause:
            self.hold, self.hold_reason, self.hold_at = True, cause, i["t"]
        if self._warn_on:
            if i["Thead"] < c.warn - 2:
                self._warn_on = False
        elif i["Thead"] >= c.warn:
            self._warn_on = True
        if c.predict:
            H = c.horizon
            Td = i.get("Tdot") or 0.0
            Ld = i.get("Ldot") or 0.0
            tT = (c.stop - i["Thead"]) / Td if (Td > 0.5 and i["Thead"] >= c.warn / 2) else math.inf
            tL = (c.reelMax - i["reel"]) / Ld if (Ld > 0.2 and i["reel"] >= 0.6 * c.reelMax) else math.inf
            if min(tT, tL) < H:
                self._pred_until = i["t"] + c.holdFor
                self._pred_reason = "장력 급상승 (정지값 도달 예상)" if tT <= tL else "리드줄 끝 도달 예상"
        pred_on = i["t"] <= self._pred_until
        notes = []
        if 0.1 < i["camAge"] <= c.camLostHold:
            notes.append("카메라 일시 가림 — 예측으로 추적 중")
        if i["Thead"] >= c.warn / 2 and not self._warn_on:
            notes.append("장력 상승")
        if i["reel"] >= 0.92 * c.reelMax:
            notes.append("릴 인출 한계 근접")
        if i["sigmaPos"] > 0.25:
            notes.append("강아지 위치 불확실")
        if self.hold:
            return {"level": 3, "hold": True, "reason": self.hold_reason, "notes": notes, "speedCap": 0.0}
        if self._warn_on:
            return {"level": 2, "hold": False, "reason": "장력 경고", "notes": notes, "speedCap": 0.2}
        if pred_on:
            return {"level": 2, "hold": False, "reason": self._pred_reason, "notes": notes, "speedCap": 0.2}
        return {"level": 1 if notes else 0, "hold": False, "reason": None, "notes": notes, "speedCap": None}
