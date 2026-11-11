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

# 5) 우리 강아지 — 멀면 무시, 바로 앞이면 멈춰 기다림(피하지 않음), 남의 강아지는 장애물
av = Avoider()
dog_far = Det("dog", 0.9, 0.45, 0.5, 0.58, 0.62)            # 통로 안이지만 멀다 (가까움 ≈ 0.34)
check("멀리 있는 우리 강아지 → 계속", run(av, [dog_far], floor_img())["decision"], GO)
r = run(av, [dog_far], floor_img())
check("  우리 강아지로 표시", r["objects"][0]["ours"], True)

av = Avoider()
dog = Det("dog", 0.9, 0.4, 0.6, 0.6, 0.95)                  # 통로 안, 바로 앞
check("바로 앞 우리 강아지 → 멈춰 기다림", run(av, [dog], floor_img())["decision"], WAIT)
r = run(av, [dog], floor_img(), t=av.p.wait_s + 5, n=5)
check("  오래 있어도 옆으로 피하지 않음", r["decision"], WAIT)
check("  이유에 '우리 강아지'", "우리 강아지" in r["reason"], True)

av = Avoider()
side_dog = Det("dog", 0.9, 0.0, 0.5, 0.12, 0.97)            # 바로 옆(통로 밖)에서 걷는 중
check("옆에서 걷는 우리 강아지 → 계속", run(av, [side_dog], floor_img())["decision"], GO)

# 줄 방향각 θ 로 우리 강아지 고르기 — 오른쪽에 우리 강아지, 가운데 바로 앞에 남의 강아지
av = Avoider()
ours_r = Det("dog", 0.9, 0.80, 0.5, 0.95, 0.80)
other = Det("dog", 0.9, 0.42, 0.55, 0.58, 0.95)
r = run(av, [ours_r, other], floor_img(), n=1)
check("줄 정보 없으면 가까운 쪽을 우리 강아지로 (가운데)", [o["ours"] for o in r["objects"]], [False, True])
av = Avoider()
r = av.step([ours_r, other], floor_img(), now=0.0, leash={"theta": 0.65, "L": 1.5})
check("θ=오른쪽 → 오른쪽 강아지가 우리 강아지", [o["ours"] for o in r["objects"]], [True, False])
check("  가운데 남의 강아지 → 기다림(움직이는 장애물)", r["decision"], WAIT)
r = run(av, [ours_r, other], floor_img(), t=av.p.wait_s + 1, n=3)
check("  안 비키면 남의 강아지는 피해 감", r["decision"], lambda d: d in (AVOID_LEFT, AVOID_RIGHT, STOP))

av = Avoider()
r = av.step([other], floor_img(), now=0.0, leash={"theta": -0.7, "L": 2.0})
check("θ 쪽에 강아지 없음 → 보이는 강아지는 남의 강아지", (r["objects"][0]["ours"], r["decision"]), (False, WAIT))

# 따라가기 — 줄 정보 없이 한 마리를 계속 우리 강아지로
av = Avoider()
a = Det("dog", 0.9, 0.10, 0.5, 0.22, 0.70)
b = Det("dog", 0.9, 0.70, 0.5, 0.82, 0.75)
av.step([a], floor_img(), now=0)                             # 처음엔 a 한 마리
r = av.step([Det("dog", 0.9, 0.12, 0.5, 0.24, 0.70), b], floor_img(), now=0.1)
check("다른 강아지가 나타나도 원래 강아지를 계속 우리 강아지로", [o["ours"] for o in r["objects"]], [True, False])

# 바닥 색 검사가 우리 강아지 몸통을 '바닥 끊김'으로 잡지 않음
av = Avoider()
run(av, [], floor_img(), n=3)
img = floor_img()
img[38:56, 65:99] = (30, 80, 160)                            # 강아지 몸통 색 (상자와 같은 자리)
r = run(av, [Det("dog", 0.9, 0.40, 0.42, 0.62, 0.62)], img, t=1)
check("우리 강아지 몸통은 바닥 끊김 아님 → 계속", r["decision"], GO)

# 끄면 강아지도 전부 장애물 (옛 동작)
av = Avoider()
av.p.update({"ignore_dog": False})
check("우리 강아지 구분 끔 → 기다림", run(av, [dog_far.__class__("dog", 0.9, 0.4, 0.6, 0.6, 0.95)], floor_img(), t=10)["decision"], WAIT)

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
