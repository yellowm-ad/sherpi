/**
 * 7.3 이식 검증 — 원본 번들 엔진과 src/lib/sherpy/world.ts 를 프레임 단위로 대조한다.
 * 실행: npx tsx scripts/verify-73.ts
 * 환경 4 × 시나리오 6 = 24 조합 × 1,001 프레임 × 15 필드, 그리고 무작위 변수 200 조합.
 */
import { simulate, DEFAULTS } from "./fixtures/sherpy73-reference.mjs";
import { run73 } from "../src/lib/sherpy/world";
import { DEFAULT_PARAMS, PARAM_SPECS, type EnvKey, type ScenarioKey, type SimParams } from "../src/lib/sherpy/params";

const ENVS: EnvKey[] = ["park", "walk", "narrow", "dense"];
const SCN: ScenarioKey[] = ["normal", "pull", "opposite", "load", "encoder", "camera"];
const FIELDS = ["t", "psi", "rv", "dogV", "dist", "reel", "tension", "filtered", "rope", "body", "encoder"] as const;

for (const k of Object.keys(DEFAULTS)) {
  if ((DEFAULTS as Record<string, number>)[k] !== DEFAULT_PARAMS[k as keyof SimParams]) throw new Error(`기본값 불일치 ${k}`);
}

let worst = 0, cases = 0, fails = 0;
function compare(p: SimParams, env: EnvKey, scn: ScenarioKey, label: string) {
  const a = simulate(p, env, scn);
  const b = run73(p, env, scn);
  let maxErr = 0, where = "";
  for (let i = 0; i < a.frames.length; i++) {
    const fa = a.frames[i], fb = b.frames[i];
    for (const f of FIELDS) {
      const e = Math.abs(fa[f] - fb[f]);
      if (e > maxErr) { maxErr = e; where = `${f}@${i}`; }
    }
    for (const j of [0, 1]) {
      maxErr = Math.max(maxErr, Math.abs(fa.robot[j] - fb.robot[j]), Math.abs(fa.dog[j] - fb.dog[j]));
    }
    if (fa.mode !== fb.mode) { maxErr = Infinity; where = `mode@${i}`; }
    if ((fa.camera === null) !== (fb.camera === null) || (fa.camera !== null && Math.abs(fa.camera - fb.camera!) > 1e-12)) { maxErr = Infinity; where = `camera@${i}`; }
  }
  const ev = JSON.stringify(a.events) === JSON.stringify(b.events.map(({ t, reason }) => ({ t, reason })));
  const sum = a.peak === b.peak && a.minRope === b.minRope && a.stopTime === b.stopTime;
  cases++;
  worst = Math.max(worst, maxErr);
  const ok = maxErr < 1e-9 && ev && sum;
  if (!ok) { fails++; console.log(`✗ ${label} maxErr=${maxErr} (${where}) events=${ev} summary=${sum}`); }
  return { maxErr, events: a.events };
}

for (const env of ENVS) for (const scn of SCN) {
  const r = compare(DEFAULT_PARAMS, env, scn, `${env}/${scn}`);
  console.log(`  ${env.padEnd(6)} ${scn.padEnd(8)} 오차 ${r.maxErr.toExponential(1)}  이벤트: ${r.events.map((e: { t: number; reason: string }) => `${e.t.toFixed(2)}s ${e.reason}`).join(", ") || "없음"}`);
}

// 무작위 변수 조합 — 슬라이더 범위 안에서
let seed = 7;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
for (let n = 0; n < 200; n++) {
  const p = { ...DEFAULT_PARAMS };
  for (const [k, , lo, hi, step] of PARAM_SPECS) p[k] = Math.round((lo + rnd() * (hi - lo)) / step) * step;
  if (p.warn >= p.stop) p.stop = p.warn + 1;
  compare(p, ENVS[n % 4], SCN[n % 6], `random#${n}`);
}

console.log(`\n${cases}개 조합 · 최대 오차 ${worst.toExponential(2)} · 실패 ${fails}`);
if (fails) process.exit(1);
