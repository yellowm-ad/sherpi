"""
장애물 판단(avoid.py) 시험 — 노트북에서:  python robot/tests/test_avoid.py
카메라·YOLO 없이 '가짜 인식 결과 + 그린 바닥 사진'으로 상황을 만들어 판단을 확인한다.
"""
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from bridge.avoid import Avoider, Det, Params, GO, SLOW, WAIT, STOP, AVOID_LEFT, AVOID_RIGHT  # noqa: E402

FAILS = []


def check(name, got, want):
    ok = got == want if not callable(want) else want(got)
    print(f"{'✅' if ok else '❌'} {name}: {got}")
    if not ok:
        FAILS.append(name)


def floor_img(color=(120, 120, 120)):
    img = np.zeros((90, 160, 3), np.uint8)
    img[:] = color
    return img


def run(av, dets, img=None, t=0.0, n=1):
    r = None
    for i in range(n):
        r = av.step(dets, img, now=t + i * 0.1)
    return r


# 1) 빈 길
av = Avoider()
check("빈 길 → 계속", run(av, [], floor_img())["decision"], GO)

# 2) 바로 앞 사람 → 기다림 → wait_s 지나도 그대로면 비어 있는 쪽으로
av = Avoider()
person = Det("person", 0.9, 0.42, 0.3, 0.6, 0.95)          # 가운데, 발끝이 화면 아래쪽
check("앞에 사람 → 기다림", run(av, [person], floor_img())["decision"], WAIT)
r = run(av, [person], floor_img(), t=av.p.wait_s + 0.5, n=3)  # 기다림→피함도 3프레임 확인
check("오래 안 비키면 → 옆으로 피함", r["decision"], lambda d: d in (AVOID_LEFT, AVOID_RIGHT))

# 3) 멈춰 있는 벤치 + 왼쪽 막힘 → 바로 오른쪽으로
av = Avoider()
bench = Det("bench", 0.8, 0.35, 0.5, 0.65, 0.9)
left_pole = Det("fire hydrant", 0.7, 0.05, 0.4, 0.22, 0.85)
check("벤치(정지 물체) + 왼쪽 막힘 → 오른쪽", run(av, [bench, left_pole], floor_img())["decision"], AVOID_RIGHT)

# 4) 앞·양옆 모두 막힘 → 멈춤
av = Avoider()
wall = [Det("bench", 0.8, 0.0, 0.4, 0.33, 0.95), bench, Det("bench", 0.8, 0.67, 0.4, 1.0, 0.95)]
check("양옆도 막힘 → 멈춤", run(av, wall, floor_img())["decision"], STOP)

# 5) 우리 강아지는 무시 / 끄면 기다림
av = Avoider()
dog = Det("dog", 0.9, 0.4, 0.6, 0.6, 0.95)
check("우리 강아지 무시 → 계속", run(av, [dog], floor_img())["decision"], GO)
av.p.update({"ignore_dog": False})
check("강아지 무시 끔 → 기다림", run(av, [dog], floor_img(), t=10)["decision"], WAIT)

# 6) 조금 먼 물체 → 감속
av = Avoider()
far = Det("person", 0.9, 0.45, 0.3, 0.55, 0.68)
check("조금 먼 사람 → 천천히", run(av, [far], floor_img())["decision"], SLOW)

# 7) YOLO 가 모르는 물체(바닥 색이 끊김) — 가운데 가까이 검은 기둥
av = Avoider()
run(av, [], floor_img(), n=3)                                  # 바닥 색 먼저 익힘
img = floor_img()
img[45:78, 70:90] = (20, 20, 20)                               # 가운데, 꽤 가까이
r = run(av, [], img, t=1)
check("모르는 물체(바닥 끊김) → 피함/멈춤", r["decision"], lambda d: d in (AVOID_LEFT, AVOID_RIGHT, STOP, WAIT))
check("  이유에 '바닥이 끊김'", "바닥이 끊김" in r["reason"], True)
av.p.update({"floor_on": False})
check("바닥 검사 끔 → 계속(3프레임 뒤)", run(av, [], img, t=2, n=3)["decision"], GO)

# 8) 깜빡임 방지 — 막혔다가 풀리면 3번 연속 비어야 '계속'
av = Avoider()
run(av, [bench], floor_img())
check("풀린 첫 프레임은 아직 피함", run(av, [], floor_img(), t=1)["decision"], lambda d: d != GO)
check("3프레임 뒤 계속", run(av, [], floor_img(), t=2, n=3)["decision"], GO)

# 9) 웹 값 거르기
p = Params()
p.update({"conf": 5, "stop_near": -1, "imgsz": 999, "evil": "rm -rf", "floor_on": "yes", "wait_s": float("nan")})
check("값 범위 자르기", (p.conf, p.stop_near, p.imgsz, p.floor_on, p.wait_s), (0.9, 0.2, 320, True, 3.0))
check("감속 ≤ 멈춤 유지", p.slow_near <= p.stop_near, True)

# 10) 낮은 신뢰도는 무시
av = Avoider()
check("신뢰도 낮은 사람 무시", run(av, [Det("person", 0.2, 0.42, 0.3, 0.6, 0.95)], floor_img())["decision"], GO)

print()
print("모두 통과" if not FAILS else f"실패 {len(FAILS)}개: {FAILS}")
sys.exit(1 if FAILS else 0)
