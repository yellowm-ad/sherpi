"""골든 테스트 — 웹(TS)이 기록한 센서 로그를 파이썬 파이프라인에 그대로 넣어 출력이 같은지 본다.

  npx tsx scripts/verify-math.ts          # scripts/fixtures/golden-*.json 생성 (+ TS 단위검증)
  cd robot && python -m sherpy_core.verify_golden
"""
import glob
import json
import os
import sys

from .params import SimParams, HwParams
from .pipeline import SherpyCore, CoreConfig

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
FIELDS = [("Tfast",), ("That",), ("L",), ("est", "d"), ("est", "theta"), ("est", "sigma"),
          ("cmd", "v"), ("cmd", "steer"), ("cmd", "reelRate"), ("rate", "Tdot"), ("rate", "Ldot"), ("vff",)]


def get(o, path):
    for k in path:
        o = o[k]
    return o


def main():
    files = sorted(glob.glob(os.path.join(ROOT, "scripts", "fixtures", "golden-*.json")))
    if not files:
        print("골든 파일 없음 — 먼저 npx tsx scripts/verify-math.ts")
        return 1
    fails = 0
    for f in files:
        with open(f, encoding="utf-8") as fp:
            g = json.load(fp)
        core = SherpyCore(CoreConfig(SimParams(**g["p"]), HwParams(**g["hw"]), g["fit"], g["reelMode"], g["L0"],
                                    predict=bool(g.get("predict", False)), l2Mode=g.get("l2Mode", "slow"),
                                    encCross=bool(g.get("encCross", False)), ffMode=g.get("ffMode", "fixed")))
        worst, where, mismatch = 0.0, "", 0
        for pkt, exp in zip(g["packets"], g["outputs"]):
            out = core.step(pkt)
            for path in FIELDS:
                e = abs(get(out, path) - get(exp, path))
                if e > worst:
                    worst, where = e, ".".join(path) + "@%.2f" % pkt["t"]
            if out["level"] != exp["level"] or out["reason"] != exp["reason"]:
                mismatch += 1
        ok = worst < 1e-9 and mismatch == 0
        fails += 0 if ok else 1
        mark = "OK " if ok else "XX "
        print("%s%-36s 프레임 %d  최대 오차 %.2e (%s)  단계 불일치 %d" % (mark, os.path.basename(f), len(g["packets"]), worst, where, mismatch))
    print("파이썬 = TS 일치" if not fails else "불일치 %d건" % fails)
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
