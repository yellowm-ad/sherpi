"""
장애물 판단 — 카메라 한 장 → "계속 / 천천히 / 기다림 / 왼쪽·오른쪽으로 피함 / 멈춤".

울토르(게임)에서 오브젝트마다 충돌 박스를 줘 캐릭터가 못 지나가게 한 것과 같은 생각이다.
  - 게임: 타일 격자에 '막힘' 칸을 칠하고, 캐릭터 이동 전에 다음 칸이 막혔는지 본다.
  - 여기: 화면 아래(=로봇 바로 앞 바닥)에 로봇이 지나갈 '통로'(사다리꼴)를 그리고,
          그 통로에 걸친 물체의 '발끝'이 얼마나 아래(=가까이)에 있는지로 막힘 정도를 잰다.

막힘을 찾는 눈은 두 가지다.
  1) 객체 인식(YOLO) — 사람·강아지·자전거·차·벤치 등 '이름 있는' 물체. 사람·동물·탈것은 움직이니 먼저 기다린다.
  2) 바닥 색 — 로봇 바로 앞 바닥 색을 기준으로, 그 색이 위로 어디까지 이어지는지 열마다 잰다.
     YOLO 가 모르는 물체(기둥·볼라드·화단 턱·벽)도 '바닥이 끊긴 곳'으로 잡는다. 그림자에 속을 수 있어 끌 수 있다.

강아지는 두 종류로 나눈다.
  - 우리 강아지(한 마리): 줄 방향각 θ 로 화면 위치를 예상해 가장 잘 맞는 강아지. 줄 센서가 없으면
    직전 프레임의 우리 강아지와 가장 가까운 것, 처음이면 가장 가까이(화면 아래) 있는 것.
    평소엔 장애물로 안 보지만, 통로 안에서 stop_near 보다 가까우면 '멈춰서 기다림'(옆으로 피하지 않음 —
    줄로 묶여 있어 피해도 소용없고, 강아지 쪽으로 꺾을 수 있다).
  - 남의 강아지: 사람과 같은 '움직이는 장애물' — 기다렸다가 안 비키면 피한다.

[안전] 이 판단은 테스트·보조용이다. 모터를 직접 움직이지 않는다 (agent 가 결과만 웹에 보여 준다).
       1차 안전장치는 리드줄 장력 정지(F̂ ≥ 35 N)와 본체 물리 정지 버튼이다.

numpy 만 쓴다 (노트북에서도 시험 가능: python robot/tests/test_avoid.py).
"""
from __future__ import annotations

import time
from dataclasses import dataclass, field, asdict

import numpy as np

# ── 판단 단계 (뒤로 갈수록 심각) ─────────────────
GO, SLOW, AVOID_LEFT, AVOID_RIGHT, WAIT, STOP = "GO", "SLOW", "AVOID_LEFT", "AVOID_RIGHT", "WAIT", "STOP"
SEVERITY = {GO: 0, SLOW: 1, AVOID_LEFT: 2, AVOID_RIGHT: 2, WAIT: 3, STOP: 4}

# COCO 이름 → 보호자용 이름. 없는 것은 '물체'
KO = {
    "person": "사람", "bicycle": "자전거", "car": "자동차", "motorcycle": "오토바이", "bus": "버스",
    "truck": "트럭", "dog": "강아지", "cat": "고양이", "bird": "새", "horse": "말", "bench": "벤치",
    "chair": "의자", "potted plant": "화분", "fire hydrant": "소화전", "stop sign": "표지판",
    "parking meter": "주차기", "backpack": "가방", "umbrella": "우산", "handbag": "가방",
    "suitcase": "캐리어", "sports ball": "공", "skateboard": "스케이트보드", "bottle": "병",
    "traffic light": "신호등", "dining table": "테이블", "couch": "소파", "bed": "침대",
}
# 움직이는 것 — 막히면 바로 피하지 말고 잠깐 기다린다 (사람이 지나가면 길이 열린다)
MOVING = {"person", "bicycle", "car", "motorcycle", "bus", "truck", "dog", "cat", "horse", "bird", "skateboard"}


@dataclass
class Params:
    """웹 [자율주행 인식 테스트] 화면에서 바꿀 수 있는 값. 범위를 벗어나면 잘라낸다."""
    conf: float = 0.35        # 인식 신뢰도 하한
    stop_near: float = 0.60   # 이만큼 가까우면(0=지평선, 1=화면 맨 아래) 멈춤
    slow_near: float = 0.35   # 이만큼이면 감속
    corridor: float = 0.45    # 화면 맨 아래에서 로봇 통로 폭 (화면 폭 비율)
    horizon: float = 0.42     # 지평선 높이 (화면 위에서부터 비율). 카메라 각도에 맞춘다
    wait_s: float = 3.0       # 움직이는 물체 앞에서 기다리는 시간 → 그래도 막혀 있으면 피한다
    floor_on: bool = True     # 바닥 색 검사 사용
    floor_tol: float = 30.0   # 바닥 색 허용 차이 (클수록 관대 = 덜 멈춤)
    ignore_dog: bool = True   # 우리 강아지(한 마리)는 멀면 장애물로 안 본다. 바로 앞이면 그래도 멈춘다. 남의 강아지는 늘 장애물
    imgsz: int = 320          # 인식 입력 크기 (작을수록 빠름)

    RANGES = {
        "conf": (0.1, 0.9), "stop_near": (0.2, 0.98), "slow_near": (0.1, 0.95), "corridor": (0.15, 0.95),
        "horizon": (0.15, 0.8), "wait_s": (0.0, 15.0), "floor_tol": (5.0, 90.0),
    }
    IMGSZ = (256, 320, 416, 480, 640)

    def update(self, d: dict) -> None:
        """웹에서 온 값 — 아는 이름만, 범위 안으로 잘라서 반영한다."""
        for k, (lo, hi) in self.RANGES.items():
            v = d.get(k)
            if isinstance(v, (int, float)) and not isinstance(v, bool) and np.isfinite(v):
                setattr(self, k, float(min(hi, max(lo, v))))
        for k in ("floor_on", "ignore_dog"):
            if isinstance(d.get(k), bool):
                setattr(self, k, d[k])
        if d.get("imgsz") in self.IMGSZ:
            self.imgsz = int(d["imgsz"])
        if self.slow_near > self.stop_near:
            self.slow_near = self.stop_near

    def to_dict(self) -> dict:
        d = asdict(self)
        d.pop("RANGES", None)
        d.pop("IMGSZ", None)
        return d


@dataclass
class Det:
    """인식 결과 하나 — 좌표는 화면 비율(0~1)"""
    cls: str
    conf: float
    x1: float
    y1: float
    x2: float
    y2: float


# 카메라 — sherpy_core/params.py 의 camW·camFx·camCx 와 같게 (줄 방향각 θ → 화면 가로 위치)
CAM_FX_N = 300 / 640
CAM_CX_N = 324 / 640
CAM_YAW = 0.026
OURS_MATCH = 0.22   # θ 로 예상한 위치와 이 이상(화면 폭 비율) 어긋나면 우리 강아지가 아니다
OURS_TRACK = 0.18   # 줄 센서 없을 때 직전 위치에서 이 이상 튀면 다른 강아지로 본다


def x_from_theta(theta: float) -> float:
    """줄 방향각 θ(rad, 오른쪽 +, 로봇 정면 0) → 화면 가로 위치 0~1 (왜곡은 무시)"""
    import math
    return CAM_CX_N + CAM_FX_N * math.tan(max(-1.4, min(1.4, theta - CAM_YAW)))


def nearness(y: float, horizon: float) -> float:
    """화면 높이 y(0 위 ~ 1 아래) → 가까움 0(지평선)~1(바로 앞)"""
    return float(min(1.0, max(0.0, (y - horizon) / max(1e-6, 1.0 - horizon))))


def corridor_half(n: float, corridor: float) -> float:
    """가까움 n 인 줄에서 통로 반폭 (원근: 지평선에선 바닥 폭의 25%)"""
    return corridor / 2 * (0.25 + 0.75 * n)


# ── 바닥 색 검사 ───────────────────────────────
COLS = 12  # 화면을 세로 띠 12개로 나눠 띠마다 '바닥이 어디까지 이어지나'를 잰다


class FloorModel:
    """로봇 바로 앞 바닥 색을 기억해 두고(막혀 있을 땐 갱신 안 함), 띠마다 막힘 가까움을 낸다."""

    def __init__(self) -> None:
        self.ref: np.ndarray | None = None

    @staticmethod
    def _feat(bgr: np.ndarray) -> np.ndarray:
        """밝기는 덜(그림자에 덜 속게), 색은 더 본다 — YCrCb 근사"""
        b, g, r = (bgr[..., i].astype(np.float32) for i in range(3))
        y = 0.299 * r + 0.587 * g + 0.114 * b
        cr = (r - y) * 0.713
        cb = (b - y) * 0.564
        return np.stack([y * 0.35, cr, cb], axis=-1)

    def blocks(self, bgr_small: np.ndarray, p: Params, may_learn: bool, skip: Det | None = None) -> list[float]:
        """bgr_small: 작게 줄인 화면 (예: 160x90). 반환: 띠마다 막힘 가까움 0~1 (0 = 끝까지 바닥)
        skip: 바닥으로 칠 상자 (우리 강아지 — 몸통 색이 '바닥 끊김'으로 잡히지 않게)"""
        h, w = bgr_small.shape[:2]
        f = self._feat(bgr_small)
        # 기준 = 맨 아래 12% · 가운데 30% 의 중앙값
        y0, x0, x1 = int(h * 0.88), int(w * 0.35), int(w * 0.65)
        patch = f[y0:, x0:x1].reshape(-1, 3)
        cur = np.median(patch, axis=0)
        if self.ref is None or may_learn:
            self.ref = cur if self.ref is None else self.ref * 0.8 + cur * 0.2
        dist = np.linalg.norm(f - self.ref, axis=-1)
        floor = dist < p.floor_tol
        if skip is not None:
            floor[max(0, int(skip.y1 * h)):int(np.ceil(skip.y2 * h)) + 1,
                  max(0, int(skip.x1 * w)):int(np.ceil(skip.x2 * w))] = True
        top = int(h * p.horizon)
        out: list[float] = []
        for i in range(COLS):
            a, b = int(w * i / COLS), int(w * (i + 1) / COLS)
            band = floor[top:, a:b].mean(axis=1)  # 줄마다 바닥 비율 (위→아래)
            blocked_rows = np.where(band < 0.5)[0]
            if blocked_rows.size == 0:
                out.append(0.0)
                continue
            # 아래에서 위로 올라가며 처음 바닥이 끊기는 줄
            last = blocked_rows[-1]
            y = (top + last + 1) / h
            out.append(nearness(y, p.horizon))
        return out


# ── 판단 ───────────────────────────────────────
@dataclass
class Avoider:
    p: Params = field(default_factory=Params)
    floor: FloorModel = field(default_factory=FloorModel)
    decision: str = GO
    reason: str = "앞이 비어 있어요"
    _pending: str = GO
    _pending_n: int = 0
    _blocked_since: float | None = None
    _ours_x: float | None = None     # 직전 프레임 우리 강아지 가로 위치 (줄 센서 없을 때 따라가기용)
    CONFIRM = 3  # 덜 심각한 쪽으로 내려갈 땐 3번 연속 같아야 바꾼다 (깜빡임 방지). 심각한 쪽은 즉시.

    def pick_ours(self, dogs: list[Det], leash: dict | None) -> Det | None:
        """강아지 여러 마리 중 '우리 강아지' 한 마리. 못 고르면 None (= 보이는 강아지 전부 남의 강아지)."""
        if not dogs:
            self._ours_x = None
            return None
        cx = lambda d: (d.x1 + d.x2) / 2  # noqa: E731
        theta = (leash or {}).get("theta")
        if isinstance(theta, (int, float)) and np.isfinite(theta):
            want = x_from_theta(float(theta))
            best = min(dogs, key=lambda d: abs(cx(d) - want))
            ok = abs(cx(best) - want) <= OURS_MATCH
        elif self._ours_x is not None:
            best = min(dogs, key=lambda d: abs(cx(d) - self._ours_x))
            ok = abs(cx(best) - self._ours_x) <= OURS_TRACK
            if not ok and len(dogs) == 1:
                best, ok = dogs[0], True   # 한 마리뿐이면 놓쳤다 다시 잡은 것으로 본다
        else:
            best, ok = max(dogs, key=lambda d: d.y2), True  # 처음: 가장 가까운 강아지
        self._ours_x = cx(best) if ok else None
        return best if ok else None

    def step(self, dets: list[Det], bgr_small: np.ndarray | None, now: float | None = None,
             leash: dict | None = None) -> dict:
        """leash: 줄 센서 값 {"theta": rad, "L": m} — 없으면 None (화면만으로 우리 강아지를 고른다)"""
        p = self.p
        now = time.monotonic() if now is None else now
        objs = []
        zone_block = {"left": 0.0, "center": 0.0, "right": 0.0}
        moving_center = False
        ours_close = False
        names_center: list[str] = []

        dets = [d for d in dets if d.conf >= p.conf and d.y2 > p.horizon]
        ours = self.pick_ours([d for d in dets if d.cls == "dog"], leash) if p.ignore_dog else None

        for d in dets:
            n = nearness(d.y2, p.horizon)
            hw = corridor_half(n, p.corridor)
            lo, hi = 0.5 - hw, 0.5 + hw
            if d is ours:
                in_center = d.x2 > lo and d.x1 < hi
                if in_center and n >= p.stop_near:
                    ours_close = True
                    zone_block["center"] = max(zone_block["center"], n)
                zone = "center" if in_center else ("left" if d.x2 <= lo else "right")
                objs.append(self._obj(d, zone, n, ours=True))
                continue
            # 통로와 겹치면 center, 아니면 왼쪽/오른쪽 옆길 (통로 폭만큼 옆)
            if d.x2 > lo and d.x1 < hi:
                if n > zone_block["center"]:
                    zone_block["center"] = n
                if n >= p.slow_near:
                    names_center.append(KO.get(d.cls, "물체"))
                    moving_center |= d.cls in MOVING
            if d.x1 < lo and d.x2 > lo - 2 * hw:
                zone_block["left"] = max(zone_block["left"], n)
            if d.x2 > hi and d.x1 < hi + 2 * hw:
                zone_block["right"] = max(zone_block["right"], n)
            zone = "center" if (d.x2 > lo and d.x1 < hi) else ("left" if d.x2 <= lo else "right")
            objs.append(self._obj(d, zone, n))

        free: list[float] = []
        if p.floor_on and bgr_small is not None:
            free = self.floor.blocks(bgr_small, p, may_learn=zone_block["center"] < p.slow_near and not ours_close,
                                     skip=ours)
            hw0 = corridor_half(p.slow_near, p.corridor)
            for i, b in enumerate(free):
                cx = (i + 0.5) / COLS
                z = "center" if abs(cx - 0.5) < hw0 else ("left" if cx < 0.5 else "right")
                if b > zone_block[z]:
                    zone_block[z] = b
                    if z == "center" and b >= p.slow_near and "바닥이 끊김" not in names_center:
                        names_center.append("바닥이 끊김")

        if ours_close:
            # 우리 강아지가 바로 앞 — 옆으로 피하지 않고 멈춰서 기다린다 (기다림 시간이 지나도 피하지 않음)
            self._blocked_since = None
            raw, reason = WAIT, "우리 강아지가 바로 앞 — 멈춰서 기다려요"
        else:
            raw, reason = self._raw(zone_block, moving_center, names_center, now)
        self._settle(raw, reason)
        return {
            "decision": self.decision,
            "reason": self.reason,
            "zones": {k: round(v, 3) for k, v in zone_block.items()},
            "heading": round(self._heading(free), 3) if free else 0.0,
            "free": [round(1 - b, 3) for b in free],
            "objects": objs[:30],
            "waitLeft": round(max(0.0, p.wait_s - (now - self._blocked_since)), 1) if self._blocked_since and self.decision == WAIT else None,
        }

    def _raw(self, z: dict, moving: bool, names: list[str], now: float) -> tuple[str, str]:
        p = self.p
        c = z["center"]
        what = "·".join(dict.fromkeys(names)) or "물체"
        if c >= p.stop_near:
            if self._blocked_since is None:
                self._blocked_since = now
            waited = now - self._blocked_since
            side_l, side_r = z["left"], z["right"]
            best = AVOID_LEFT if side_l <= side_r else AVOID_RIGHT
            best_ok = min(side_l, side_r) < p.slow_near
            if moving and waited < p.wait_s:
                return WAIT, f"앞에 {what} — 지나갈 때까지 기다려요"
            if best_ok:
                side = "왼쪽" if best == AVOID_LEFT else "오른쪽"
                return best, f"앞에 {what} — {side}으로 비켜 가요" + (" (기다려도 안 비켜서)" if moving else "")
            return STOP, f"앞에 {what} — 양옆도 막혀 멈췄어요"
        self._blocked_since = None
        if c >= p.slow_near:
            return SLOW, f"앞에 {what} — 천천히 가요"
        return GO, "앞이 비어 있어요"

    def _settle(self, raw: str, reason: str) -> None:
        """심각해지는 쪽은 바로, 풀리는 쪽은 CONFIRM 번 연속일 때만."""
        if SEVERITY[raw] >= SEVERITY[self.decision]:
            self.decision, self.reason = raw, reason
            self._pending, self._pending_n = raw, 0
            return
        if raw == self._pending:
            self._pending_n += 1
        else:
            self._pending, self._pending_n = raw, 1
        if self._pending_n >= self.CONFIRM:
            self.decision, self.reason = raw, reason
            self._pending_n = 0

    @staticmethod
    def _heading(free_blocks: list[float]) -> float:
        """길 방향 (-1 왼쪽 ~ +1 오른쪽) — 바닥이 가장 멀리 이어지는 띠, 가운데를 조금 더 선호"""
        best, best_i = -1.0, COLS // 2
        for i, b in enumerate(free_blocks):
            cx = (i + 0.5) / COLS
            score = (1 - b) - 0.15 * abs(cx - 0.5)
            if score > best:
                best, best_i = score, i
        return ((best_i + 0.5) / COLS - 0.5) * 2

    @staticmethod
    def _obj(d: Det, zone: str | None, n: float, ours: bool = False) -> dict:
        return {
            "label": "우리 강아지" if ours else KO.get(d.cls, "물체"), "cls": d.cls[:24], "conf": round(d.conf, 2),
            "box": [round(d.x1, 3), round(d.y1, 3), round(d.x2, 3), round(d.y2, 3)],
            "near": round(n, 2), "zone": zone, "ours": ours,
        }
