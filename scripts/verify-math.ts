/**
 * 셰르피 수학 모델 통합 검증 — npm run verify:math
 *
 *  A. 단위 검증: 최소제곱 보정, 릴 닫힌 해(수치적분 대조), 언랩, 왜곡 역변환, EKF 일관성(NEES), 좌표 변환
 *  B. 7.3 이식 검증은 scripts/verify-73.ts (원본 번들과 비트 단위 대조)
 *  C. 실전 모드 시나리오 표 + 몬테카를로 오경보율
 *  D. 골든 로그 생성 → 파이썬 파이프라인 대조 (robot/sherpy_core/verify_golden.py)
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { fitLinear } from "../src/lib/sherpy/core/calib";
import { reelLength, reelPhi, reelRadius, reelConstRadiusError, ReelOdometer, reelRawCount, type ReelGeom } from "../src/lib/sherpy/core/reel";
import { bearingFromPixel, project, horizontalFov, type CamModel } from "../src/lib/sherpy/core/camera";
import { DogTracker } from "../src/lib/sherpy/core/tracker";
import { toLatLng, toLocal, dogLatLng } from "../src/lib/sherpy/geo";
import { runFusion, makeRng, DEFAULT_FUSION, type FusionOpts } from "../src/lib/sherpy/simulate";
import { DEFAULT_HW, DEFAULT_PARAMS, K, type EnvKey, type ScenarioKey } from "../src/lib/sherpy/params";

let fails = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) fails++;
  console.log(`${ok ? "  ✓" : "  ✗"} ${name}${detail ? "  — " + detail : ""}`);
};

console.log("A. 단위 검증");
{
  // 최소제곱: 잡음 없는 직선은 정확히 복원
  const X = [1000, 5000, 9000, 20000, 41000];
  const F = X.map((x) => 1.2e-3 * x - 0.35);
  const f = fitLinear(X, F);
  check("최소제곱 a,b 복원", Math.abs(f.a - 1.2e-3) < 1e-15 && Math.abs(f.b + 0.35) < 1e-12 && f.r2 > 0.999999999, `a=${f.a} b=${f.b}`);
  // 큰 오프셋(HX711 원시값 ~8백만)에서도 중심화 덕에 정밀
  const X2 = X.map((x) => x + 8_000_000);
  const f2 = fitLinear(X2, F);
  check("최소제곱 수치안정(큰 오프셋)", Math.abs(f2.a - 1.2e-3) < 1e-12, `a=${f2.a}`);
}
{
  const g: ReelGeom = { r0: DEFAULT_HW.reelCore, t: DEFAULT_HW.ropeThick, w: DEFAULT_HW.drumWidth, Ltot: DEFAULT_HW.ropeTotal };
  // 닫힌 해 φ(L) 를 dφ = dL / r(L) 수치적분(심프슨)과 대조
  const L0 = 1.2, L1 = 3.0, n = 2000;
  let s = 0;
  for (let i = 0; i <= n; i++) {
    const L = L0 + ((L1 - L0) * i) / n;
    const w = i === 0 || i === n ? 1 : i % 2 ? 4 : 2;
    s += w / reelRadius(g, L);
  }
  s *= (L1 - L0) / n / 3;
  const phi = reelPhi(g, L0, L1);
  check("릴 닫힌 해 = 수치적분", Math.abs(phi - s) < 1e-9, `φ=${phi.toFixed(9)} rad (${(phi / 2 / Math.PI).toFixed(2)}바퀴), 적분=${s.toFixed(9)}`);
  check("릴 역함수 L(φ(L)) = L", Math.abs(reelLength(g, L0, phi) - L1) < 1e-12);
  const err = reelConstRadiusError(g, L0, L1);
  check("반경 일정 가정의 오차 정량화", Math.abs(err) > 0.01, `1.2→3.0 m 에서 ${(err * 100).toFixed(1)} cm 틀림 (r: ${(reelRadius(g, L0) * 1000).toFixed(1)}→${(reelRadius(g, L1) * 1000).toFixed(1)} mm)`);
  // 언랩: 랩어라운드(4095→0)를 여러 번 지나도 누적 정확
  const odo = new ReelOdometer(g, L0);
  let maxE = 0;
  for (let i = 0; i <= 400; i++) {
    const L = L0 + (L1 - L0) * (0.5 - 0.5 * Math.cos((i / 400) * Math.PI));
    const est = odo.update(reelRawCount(g, L0, L, 4000));
    maxE = Math.max(maxE, Math.abs(est - L));
  }
  check("AS5600 언랩·양자화 누적오차", maxE < 1e-3, `최대 ${(maxE * 1000).toFixed(3)} mm (12bit 양자화 한계 ≈ ${((reelRadius(g, L0) * 2 * Math.PI) / 4096 * 1000).toFixed(3)} mm)`);
}
{
  const cam: CamModel = { fx: DEFAULT_HW.camFx, fy: DEFAULT_HW.camFy, cx: 320, k1: DEFAULT_HW.camK1, yaw: 0.02, W: 640 };
  let maxE = 0;
  for (let deg = -45; deg <= 45; deg += 0.5) {
    const th = (deg * Math.PI) / 180;
    const pr = project(cam, th, 2, 0.45);
    if (pr) maxE = Math.max(maxE, Math.abs(bearingFromPixel(cam, pr.u) - th));
  }
  check("왜곡 보정 역변환 (−45°~45°)", maxE < 1e-10, `최대 ${maxE.toExponential(1)} rad, 화각 ${((horizontalFov(cam) * 180) / Math.PI).toFixed(1)}°`);
  // 단순식 atan((u−cx)/fx) 를 쓰면 얼마나 틀리나
  const th = (30 * Math.PI) / 180, pr = project({ ...cam, yaw: 0 }, th, 2, 0.45)!;
  const naive = Math.atan((pr.u - cam.cx) / cam.fx);
  check("왜곡 무시 시 오차 정량화", true, `30° 에서 단순식은 ${(((th - naive) * 180) / Math.PI).toFixed(2)}° 틀림`);
}
{
  // EKF 일관성: 정지한 강아지를 거리·방향으로 관측 → NEES 평균 ≈ 상태 차원(2)
  const rng = makeRng(42);
  let nees = 0, N = 0;
  for (let trial = 0; trial < 200; trial++) {
    const tr = new DogTracker();
    const truth = { x: 0.4, y: 1.7 };
    const pose = { x: 0, y: 0, psi: 0 };
    tr.init(pose, 0, 1.6, 0.3, 0.2);
    for (let k = 0; k < 50; k++) {
      tr.predict(0.04);
      const th = Math.atan2(truth.x, truth.y) + rng.gauss() * 0.01;
      const d = Math.hypot(truth.x, truth.y) + rng.gauss() * 0.02;
      tr.updateBearing(pose, th, 0.01);
      tr.updateRange(pose, d, 0.02);
    }
    const ex = tr.s[0] - truth.x, ey = tr.s[1] - truth.y;
    const [a, b, c] = [tr.P[0][0], tr.P[0][1], tr.P[1][1]];
    const det = a * c - b * b;
    nees += (c * ex * ex - 2 * b * ex * ey + a * ey * ey) / det; N++;
  }
  const m = nees / N;
  // 200회 평균 NEES 의 95% 구간 ≈ 2 ± 1.96·√(2·2/200) = [1.72, 2.28]
  check("EKF 일관성 (평균 NEES ≈ 2)", m > 1.5 && m < 2.4, `평균 NEES ${m.toFixed(2)} (기대 2 · 1.72 미만이면 공분산이 약간 보수적 = 안전 쪽)`);
}
{
  const o = { lat: 35.8466, lng: 127.1213 };
  const p = toLatLng(o, 12.3, -45.6);
  const back = toLocal(o, p.lat, p.lng);
  check("ENU ↔ 위경도 왕복", Math.abs(back.east - 12.3) < 1e-6 && Math.abs(back.north + 45.6) < 1e-6, `${back.east.toFixed(9)}, ${back.north.toFixed(9)}`);
  const d = dogLatLng(o, 90, { xr: 0, yr: 2 }); // 동쪽을 보는 로봇의 전방 2 m = 동쪽 2 m
  const l = toLocal(o, d.lat, d.lng);
  check("로봇 기준 → 지도 좌표 (방위 90°)", Math.abs(l.east - 2) < 1e-6 && Math.abs(l.north) < 1e-6);
}

console.log("\nC. 실전 모드 시나리오");
const ENVS: EnvKey[] = ["park", "walk", "narrow", "dense"];
const SCN: ScenarioKey[] = ["normal", "pull", "opposite", "load", "encoder", "camera"];
const expectL3: Record<ScenarioKey, boolean> = { normal: false, pull: true, opposite: true, load: true, encoder: true, camera: true };
for (const env of ENVS) for (const scn of SCN) {
  const r = runFusion(DEFAULT_PARAMS, env, scn);
  const l3 = r.events.find((e) => e.level === 3);
  const m = r.metrics!;
  check(`${env}/${scn}`, !!l3 === expectL3[scn] && m.posRms < 0.06,
    `${l3 ? `L3 ${l3.t.toFixed(2)}s ${l3.reason}` : "L3 없음"} · 위치 RMS ${(m.posRms * 100).toFixed(1)} cm · θ RMS ${m.thetaRmsDeg.toFixed(2)}°`);
}
{
  let fa = 0, n = 0;
  for (const env of ENVS) for (let seed = 1; seed <= 25; seed++) {
    const r = runFusion(DEFAULT_PARAMS, env, "normal", { ...DEFAULT_FUSION, seed });
    n++; if (r.stopTime !== null) fa++;
  }
  check("몬테카를로 정상 산책 오경보", fa === 0, `${n}회 중 L3 ${fa}회`);
}

console.log("\nC2. 7.4 추가 — 엔코더 교차 확인 · EKF 앞먹임");
{
  const full: FusionOpts = { ...DEFAULT_FUSION, reelMode: "flexi", predict: true, l2Mode: "directional", encCross: true, ffMode: "ekf" };
  // 축 미끄러짐: 값은 ±LSB 떨려서 동일값 연속으로는 못 잡는다 (Flexi 는 지령 잔차도 없음).
  // 거리가 그대로면(정상 추종) 원리상 구분할 수 없고 위험도 없다 → 급당김(12~22초) 중 12초에 주입해 거리가 변할 때 잡는지 본다.
  const SLIP_T = 12;
  for (const env of ENVS) {
    const off = runFusion(DEFAULT_PARAMS, env, "pull", { ...full, encCross: false, encFault: "slip", encFaultAt: SLIP_T });
    const on = runFusion(DEFAULT_PARAMS, env, "pull", { ...full, encFault: "slip", encFaultAt: SLIP_T });
    const l3off = off.events.find((e) => e.level === 3), l3on = on.events.find((e) => e.level === 3);
    check(`${env}/급당김 중 엔코더 미끄러짐 (Flexi)`, !!l3on && l3on.reason === "엔코더 고착",
      `교차 확인 끔: ${l3off ? `${l3off.t.toFixed(2)}s ${l3off.reason}` : "못 잡음"} → 켬: ${l3on ? `${l3on.t.toFixed(2)}s (주입 ${(l3on.t - SLIP_T).toFixed(2)}s 뒤) ${l3on.reason}` : "못 잡음"}`);
  }
  {
    // 정상 추종 중 미끄러짐은 잡히지 않아도 정상 (오경보·위험 없음) — 결과만 기록
    const r = runFusion(DEFAULT_PARAMS, "park", "encoder", { ...full, encFault: "slip" });
    const l3 = r.events.find((e) => e.level === 3);
    console.log(`  · 참고 park/encoder(정상 추종 중 미끄러짐): ${l3 ? `${l3.t.toFixed(2)}s ${l3.reason}` : "L3 없음 — 거리가 안 변해 구분 불가(위험도 없음)"}`);
  }
  let fa = 0, n = 0;
  for (const env of ENVS) for (let seed = 1; seed <= 25; seed++) {
    const r = runFusion(DEFAULT_PARAMS, env, "normal", { ...full, seed });
    n++; if (r.stopTime !== null) fa++;
  }
  check("몬테카를로 오경보 (Flexi+예측+방향+교차+EKF 앞먹임)", fa === 0, `${n}회 중 L3 ${fa}회`);
  // 강아지가 설정(0.48)과 다른 속도로 걸을 때: 정상상태 거리 오차 e_ss = (v_dog − v_ff)/K_p
  for (const vd of [0.35, 0.7]) {
    const p = { ...DEFAULT_PARAMS, dogSpeed: vd };
    const err = (o: FusionOpts) => {
      const fr = runFusion(p, "park", "normal", { ...o, ffDogSpeed: DEFAULT_PARAMS.dogSpeed }).frames.filter((f) => f.t >= 10);
      return fr.reduce((a, f) => a + f.dist - p.followDist, 0) / fr.length;
    };
    const eFix = err(DEFAULT_FUSION), eEkf = err({ ...DEFAULT_FUSION, ffMode: "ekf" });
    const theory = (vd - DEFAULT_PARAMS.dogSpeed) / K.FOLLOW_GAIN;
    check(`앞먹임 정상상태 오차 (강아지 ${vd} m/s)`, Math.abs(eEkf) < Math.abs(eFix) / 2,
      `설정값 ${(eFix * 100).toFixed(1)} cm (이론 ${(theory * 100).toFixed(1)}) → EKF ${(eEkf * 100).toFixed(1)} cm`);
  }
}

console.log("\nD. 골든 로그 (파이썬 대조용)");
mkdirSync("scripts/fixtures", { recursive: true });
type G = [EnvKey, ScenarioKey, FusionOpts, string];
const goldens: G[] = [
  ["park", "normal", { ...DEFAULT_FUSION, reelMode: "tension" }, "tension"],
  ["dense", "pull", { ...DEFAULT_FUSION, reelMode: "tension" }, "tension"],
  ["walk", "encoder", { ...DEFAULT_FUSION, reelMode: "position" }, "position"],
  ["park", "camera", { ...DEFAULT_FUSION, reelMode: "tension" }, "tension"],
  ["park", "pull", { ...DEFAULT_FUSION, reelMode: "flexi", predict: true }, "flexi-pred"],
  ["walk", "normal", { ...DEFAULT_FUSION, reelMode: "flexi", predict: true }, "flexi-pred"],
  // 7.4 전체 구성: 방향 L2 · 교차 확인 · EKF 앞먹임 (+ 축 미끄러짐 고장, 설정과 다른 강아지 속도)
  ["park", "pull", { ...DEFAULT_FUSION, reelMode: "flexi", predict: true, l2Mode: "directional", encCross: true, ffMode: "ekf" }, "flexi-74"],
  ["walk", "encoder", { ...DEFAULT_FUSION, reelMode: "flexi", predict: true, l2Mode: "directional", encCross: true, ffMode: "ekf", encFault: "slip" }, "flexi-74-slip"],
  ["dense", "normal", { ...DEFAULT_FUSION, reelMode: "tension", l2Mode: "directional", ffMode: "ekf", ffDogSpeed: 0.6 }, "tension-74-ff"],
];
for (const [env, scn, o, tag] of goldens) {
  const r = runFusion(DEFAULT_PARAMS, env, scn, { ...o, record: true });
  const pCore = o.ffDogSpeed === undefined ? DEFAULT_PARAMS : { ...DEFAULT_PARAMS, dogSpeed: o.ffDogSpeed };
  const g = {
    env, scenario: scn, reelMode: o.reelMode, predict: !!o.predict, l2Mode: o.l2Mode ?? "slow", encCross: !!o.encCross, ffMode: o.ffMode ?? "fixed",
    p: pCore, hw: DEFAULT_HW, fit: { a: r.calib!.a, b: r.calib!.b }, L0: r.log!.L0,
    packets: r.log!.packets, outputs: r.log!.outputs.map((o) => ({ ...o, est: { ...o.est, ellipse: undefined } })),
  };
  const file = `scripts/fixtures/golden-${env}-${scn}-${tag}.json`;
  writeFileSync(file, JSON.stringify(g));
  console.log(`  · ${file} (${g.packets.length} 프레임)`);
}

console.log(fails ? `\n실패 ${fails}건` : "\n모두 통과");
if (fails) process.exit(1);
