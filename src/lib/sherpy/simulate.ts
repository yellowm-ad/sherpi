/**
 * 시뮬레이션 실행기 — 기준 모드(7.3 그대로) / 실전 모드(센서 모델 + 처리 파이프라인)
 *
 * 실전 모드는 "로봇이 참값을 모른다"는 조건에서 돈다:
 *   물리 세계(World) ─센서 모델→ 원시값(count·px) ─SherpyCore→ 추정·안전·명령 ─→ 물리 세계
 * 그래서 추정 오차, 오경보, 감지 지연을 7.3 과 같은 시나리오로 직접 비교할 수 있다.
 */
import { K, DEFAULT_HW, ENVS, type EnvKey, type HwParams, type ScenarioKey, type SimParams } from "./params";
import { World, run73, smooth, type SafetyEvent, type TruthFrame } from "./world";
import { fitLinear, G, type LinearFit } from "./core/calib";
import { reelRawCount, type ReelGeom } from "./core/reel";
import { project, type CamModel } from "./core/camera";
import { SherpyCore, type ReelMode, type SensorPacket, type CoreOutput } from "./core/pipeline";
import type { Level } from "./core/safety";

/** 재현 가능한 난수 (mulberry32) + 정규분포 (Box–Muller) */
export function makeRng(seed: number) {
  let a = seed >>> 0;
  const u = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const gauss = () => Math.sqrt(-2 * Math.log(1 - u())) * Math.cos(2 * Math.PI * u());
  return { u, gauss };
}

export interface EstFrame {
  x: number; y: number;          // 월드 좌표 강아지 추정 (로봇 참 자세 + 추정 상대위치 — 화면 표시용)
  d: number; theta: number; sigma: number;
  ellipse: { major: number; minor: number; angle: number }; // 월드 기준
  track: "ok" | "coast" | "lost";
  T: number | null; Tfast: number; L: number;
  thetaMeas: number | null; dCam: number | null; dRope: number | null;
  snag: number; notes: string[];
  camPx: { u: number; h: number } | null;
  loadRaw: number | null; encRaw: number | null;
}

export interface SimFrame extends TruthFrame {
  level: Level;
  ropePath: number;      // m 실제 줄 경로 길이 (감김 포함)
  est: EstFrame | null;  // 실전 모드만
}

export interface SimResult {
  mode: "ref" | "fusion";
  frames: SimFrame[];
  events: SafetyEvent[];
  peak: number;
  minRope: number;
  stopTime: number | null;
  obstacles: { x: number; y: number; r: number }[];
  half: number;
  calib: LinearFit | null;
  metrics: { posRms: number; thetaRmsDeg: number; dRms: number; maxPosErr: number; l2Frames: number } | null;
  log?: { L0: number; packets: SensorPacket[]; outputs: CoreOutput[] };
}

export interface FusionOpts {
  reelMode: ReelMode;
  smoothAccel: boolean;
  seed: number;
  hw: HwParams;
  /** 센서 로그·출력 기록 (골든 테스트·로그 내보내기용) */
  record?: boolean;
  l2Mode?: "slow" | "directional";
}
export const DEFAULT_FUSION: FusionOpts = { reelMode: "tension", smoothAccel: true, seed: 1, hw: DEFAULT_HW };

/** 7.3 의 화면 단계 (My): HOLD → L3, F̂ ≥ warn → L2, 그 외 L0 */
export const level73 = (f: TruthFrame, p: SimParams): Level => (f.mode === "HOLD" ? 3 : f.filtered >= p.warn ? 2 : 0);

export function runReference(p: SimParams, env: EnvKey, scenario: ScenarioKey): SimResult {
  const r = run73(p, env, scenario);
  return {
    mode: "ref", frames: r.frames.map((f) => ({ ...f, level: level73(f, p), ropePath: f.dist, est: null })),
    events: r.events, peak: r.peak, minRope: r.minRope, stopTime: r.stopTime, obstacles: r.obstacles,
    half: ENVS[env].half, calib: null, metrics: null,
  };
}

/** 로드셀 보정 실험 — 알려진 하중 7점을 각 10회 평균해 최소제곱 */
export function calibrationSession(hw: HwParams, rng: ReturnType<typeof makeRng>) {
  const masses = [0, 0.5, 1, 1.5, 2, 3, 4];
  const X: number[] = [], F: number[] = [];
  for (const m of masses) {
    const f = m * G;
    let sum = 0;
    for (let i = 0; i < 10; i++) sum += (f - hw.lcOffset) / hw.lcGain + rng.gauss() * hw.lcCountNoise;
    // 장착 방향·마찰 오차: 하중마다 ±1% 정도 비선형 흔들림
    X.push(sum / 10 * (1 + rng.gauss() * 0.004));
    F.push(f);
  }
  return { masses, X, F, fit: fitLinear(X, F) };
}

export function runFusion(p: SimParams, env: EnvKey, scenario: ScenarioKey, o: FusionOpts = DEFAULT_FUSION): SimResult {
  const { hw } = o;
  const rng = makeRng(o.seed * 7919 + 17);
  const calib = calibrationSession(hw, rng);
  const w = new World(p, env, scenario);
  w.wrapRope = true;
  // 출발 자세: 장력 제어는 줄을 예압(2 N)만큼 당긴 상태로 시작한다 (느슨하게 출발하면 첫 0.3초에 줄이 '탁' 걸린다)
  if (o.reelMode === "tension") w.reel = p.followDist - 2 / p.stiffness;
  const L0 = w.reel;
  const log = o.record ? { L0, packets: [] as SensorPacket[], outputs: [] as CoreOutput[] } : undefined;
  const geom: ReelGeom = { r0: hw.reelCore, t: hw.ropeThick, w: hw.drumWidth, Ltot: hw.ropeTotal };
  const camTrue: CamModel = { fx: hw.camFx, fy: hw.camFy, cx: hw.camCx, k1: hw.camK1, yaw: hw.camYaw, W: hw.camW };
  const core = new SherpyCore({ p, hw, fit: calib.fit, reelMode: o.reelMode, L0, l2Mode: o.l2Mode ?? "slow" });

  const frames: SimFrame[] = [];
  const events: SafetyEvent[] = [];
  let prevPsi = 0, encHeld: number | null = null, lastLevel: Level = 0;
  let peak = 0, minRope = Infinity, stopTime: number | null = null;
  let se = 0, sth = 0, sd = 0, maxErr = 0, l2 = 0, nTrack = 0;

  for (let i = 0; i <= K.FRAMES; i++) {
    const t = i * K.DT;
    const { d, ux, uy, T, path } = w.ropeTension();
    const g = w.geometry();
    const theta = w.trueTheta();

    // ── 센서 모델 (참값 → 원시값) ──
    const loadOut = scenario === "load" && t >= K.FAULT_T;
    const Tm = T + p.noise * (0.65 * Math.sin(17 * t) + 0.35 * Math.sin(31 * t)) + hw.lcDrift * t;
    const loadRaw = loadOut ? null : (Tm - hw.lcOffset) / hw.lcGain + rng.gauss() * hw.lcCountNoise;

    let encRaw = (reelRawCount(geom, L0, w.reel) + Math.round(rng.gauss() * hw.encNoiseLsb) + 4096) % 4096;
    if (scenario === "encoder" && t >= K.FAULT_T) encRaw = encHeld ?? encRaw;
    else encHeld = encRaw;

    // 가림: 시선(로봇→강아지)이 장애물을 지나면 안 보인다
    const occluded = w.obstacles.some((ob) => {
      const ex = w.dx - w.rx, ey = w.dy - w.ry, L2 = ex * ex + ey * ey;
      const s = Math.max(0, Math.min(1, ((ob.x - w.rx) * ex + (ob.y - w.ry) * ey) / L2));
      return Math.hypot(w.rx + s * ex - ob.x, w.ry + s * ey - ob.y) < ob.r * 0.8;
    });
    let cam: { u: number; h: number } | null = null;
    if (!(scenario === "camera" && t >= K.FAULT_T) && !occluded && rng.u() >= hw.camDrop) {
      const pr = project(camTrue, theta, d, hw.dogHeight);
      if (pr) cam = { u: pr.u + rng.gauss() * hw.camPxNoise, h: pr.h * (1 + rng.gauss() * hw.camHNoise) };
    }
    const yawRate = i === 0 ? 0 : (w.psi - prevPsi) / K.DT;
    prevPsi = w.psi;

    // 회피 경로(7.3 opposite 의 경로 계획) — 로봇은 자기 추정 자세로 따라간다
    let avoidX: number | null = null;
    const py = core.pose.y;
    if (scenario === "opposite" && t > 0 && t < 28 && py > 3 && py < 10) avoidX = -1.13 * (smooth((py - 3.1) / 1.4) - smooth((py - 10) / 2.2));

    const pkt: SensorPacket = {
      t, loadRaw, encRaw, cam,
      odo: { v: w.rv * (1 + rng.gauss() * hw.odoSpeedNoise), yawRate: yawRate + rng.gauss() * hw.gyroNoise },
      geom: g, avoidX,
    };
    const out = core.step(pkt);
    if (log) { log.packets.push(pkt); log.outputs.push(out); }

    if (out.level !== lastLevel && out.level >= 2) events.push({ t, reason: out.reason ?? "", level: out.level as 2 | 3 });
    if (out.hold && stopTime === null) stopTime = t;
    lastLevel = out.level;

    // ── 물리 적분 ──
    w.mode = out.hold ? "HOLD" : "FOLLOW";
    const dNew = w.integrate(out.cmd.v, out.cmd.steer, T, ux, uy, t, w.reel + out.cmd.reelRate * K.DT, o.smoothAccel);
    w.frame++;
    peak = Math.max(peak, T);
    minRope = Math.min(minRope, g.rope);
    if (out.level === 2) l2++;

    // 추정 → 월드 좌표 (로봇 참 자세 기준으로 그려야 화면에서 참값과 비교된다)
    const c = Math.cos(w.psi), s = Math.sin(w.psi);
    const ex = out.est.xr * c + out.est.yr * s, ey = -out.est.xr * s + out.est.yr * c;
    const estX = w.rx + ex, estY = w.ry + ey;
    // 오차는 적분 전 참값(센서가 본 순간)과 비교
    const err = Math.hypot(out.est.d * Math.sin(out.est.theta) - d * Math.sin(theta), out.est.d * Math.cos(out.est.theta) - d * Math.cos(theta));
    const eth = Math.atan2(Math.sin(out.est.theta - theta), Math.cos(out.est.theta - theta));
    // 추적 성능은 추적 중(ok·coast)인 프레임만 — 카메라가 없으면 방향은 원리적으로 알 수 없다
    if (out.track !== "lost") { se += err * err; sth += eth * eth; sd += (out.est.d - d) ** 2; maxErr = Math.max(maxErr, err); nTrack++; }

    frames.push({
      t, robot: [w.rx, w.ry], dog: [w.dx, w.dy], psi: w.psi, rv: w.rv, dogV: Math.hypot(w.dvx, w.dvy),
      dist: dNew, reel: w.reel, tension: T, filtered: out.That, rope: g.rope, body: g.body,
      mode: w.mode, encoder: out.L, camera: out.dCam, theta, steer: out.cmd.steer, vCmd: out.cmd.v,
      level: out.level, ropePath: path,
      est: {
        x: estX, y: estY, d: out.est.d, theta: out.est.theta, sigma: out.est.sigma,
        ellipse: { ...out.est.ellipse, angle: out.est.ellipse.angle - w.psi },
        track: out.track, T: out.T, Tfast: out.Tfast, L: out.L, thetaMeas: out.thetaMeas, dCam: out.dCam, dRope: out.dRope,
        snag: out.snagResidual, notes: out.notes, camPx: cam, loadRaw, encRaw,
      },
    });
  }
  const n = Math.max(1, nTrack);
  return {
    mode: "fusion", frames, events, peak, minRope, stopTime, obstacles: w.obstacles, half: ENVS[env].half,
    calib: calib.fit, log,
    metrics: { posRms: Math.sqrt(se / n), thetaRmsDeg: (Math.sqrt(sth / n) * 180) / Math.PI, dRms: Math.sqrt(sd / n), maxPosErr: maxErr, l2Frames: l2 },
  };
}

export function runSim(p: SimParams, env: EnvKey, scenario: ScenarioKey, mode: "ref" | "fusion", o?: FusionOpts) {
  return mode === "ref" ? runReference(p, env, scenario) : runFusion(p, env, scenario, o);
}
