/**
 * 모드 비교 실험 — 7.3 기준 vs 실전(장력 제어 릴) vs 실전(Flexi 태엽 릴) × 예측 경고 켬/끔
 *   npx tsx scripts/compare-modes.ts
 * 지표: 첫 L2 시각 · 첫 L3 시각 · 경고 여유(L3 − L2) · 최대 장력 · 위치 RMS
 */
import { DEFAULT_PARAMS, type EnvKey, type ScenarioKey, type SimParams } from "../src/lib/sherpy/params";
import { runReference, runFusion, DEFAULT_FUSION, type FusionOpts, type SimResult } from "../src/lib/sherpy/simulate";

function summary(r: SimResult) {
  const l2 = r.frames.find((f) => f.level >= 2);
  const l3 = r.frames.find((f) => f.level === 3);
  const margin = l2 && l3 ? l3.t - l2.t : null;
  return {
    L2: l2 ? l2.t.toFixed(2) : "-",
    L3: l3 ? `${l3.t.toFixed(2)}` : "-",
    "경고여유s": margin === null ? "-" : margin.toFixed(2),
    "L3전최대N": Math.max(0, ...r.frames.filter((f) => !l3 || f.t < l3.t).map((f) => f.tension)).toFixed(1),
    "최대장력N": r.peak.toFixed(1),
    "위치RMScm": r.metrics ? (r.metrics.posRms * 100).toFixed(1) : "-",
    "L2사유": (l2 as { reason?: string } | undefined)?.reason ?? (l2 ? "장력 경고" : "-"),
    "L3사유": r.events.find((e) => e.level === 3)?.reason ?? "-",
  };
}

const cases: [string, (p: SimParams, e: EnvKey, s: ScenarioKey) => SimResult][] = [
  ["7.3 기준", (p, e, s) => runReference(p, e, s)],
  ["장력릴", (p, e, s) => runFusion(p, e, s, DEFAULT_FUSION)],
  ["장력릴+예측", (p, e, s) => runFusion(p, e, s, { ...DEFAULT_FUSION, predict: true })],
  ["장력릴+예측+방향L2", (p, e, s) => runFusion(p, e, s, { ...DEFAULT_FUSION, predict: true, l2Mode: "directional" })],
  ["Flexi", (p, e, s) => runFusion(p, e, s, { ...DEFAULT_FUSION, reelMode: "flexi" } as FusionOpts)],
  ["Flexi+예측", (p, e, s) => runFusion(p, e, s, { ...DEFAULT_FUSION, reelMode: "flexi", predict: true } as FusionOpts)],
  ["Flexi+예측+방향L2", (p, e, s) => runFusion(p, e, s, { ...DEFAULT_FUSION, reelMode: "flexi", predict: true, l2Mode: "directional" } as FusionOpts)],
  ["Flexi 7.4 전체", (p, e, s) => runFusion(p, e, s, { ...DEFAULT_FUSION, reelMode: "flexi", predict: true, l2Mode: "directional", encCross: true, ffMode: "ekf" } as FusionOpts)],
];

for (const [env, scn] of [["park", "normal"], ["park", "pull"], ["walk", "pull"], ["park", "opposite"]] as [EnvKey, ScenarioKey][]) {
  for (const k of [550, 150]) {
    console.log(`\n■ ${env}/${scn}  k=${k} N/m`);
    const p = { ...DEFAULT_PARAMS, stiffness: k };
    const rows: Record<string, unknown> = {};
    for (const [name, fn] of cases) rows[name] = summary(fn(p, env, scn));
    console.table(rows);
  }
}

console.log("\n■ 오경보 몬테카를로 (정상 산책 · 환경 4 × 시드 25)");
for (const [name, o] of [["장력릴+예측", { ...DEFAULT_FUSION, predict: true }], ["Flexi+예측+방향L2", { ...DEFAULT_FUSION, reelMode: "flexi", predict: true, l2Mode: "directional" }]] as [string, FusionOpts][]) {
  let l2 = 0, l3 = 0, n = 0;
  for (const env of ["park", "walk", "narrow", "dense"] as EnvKey[]) for (let seed = 1; seed <= 25; seed++) {
    const r = runFusion(DEFAULT_PARAMS, env, "normal", { ...o, seed });
    n++; if (r.frames.some((f) => f.level >= 2)) l2++; if (r.stopTime !== null) l3++;
  }
  console.log(`  ${name}: ${n}회 중 L2 ${l2}회 · L3 ${l3}회`);
}
