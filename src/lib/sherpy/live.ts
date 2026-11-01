/**
 * 실시간 시뮬레이터 — 시연 모드의 가상 셰르피가 쓰는 "끝없는 산책".
 * 40초짜리 실험(simulate.ts)과 같은 World + 센서 모델 + SherpyCore 를 25 Hz 로 계속 돌린다.
 * 대시보드가 보는 장력·줄 길이·강아지 위치는 모두 이 파이프라인의 출력이다 (실로봇과 같은 의미의 값).
 */
import { K, DEFAULT_HW, DEFAULT_PARAMS, type Env, type SimParams } from "./params";
import { World } from "./world";
import { makeRng, calibrationSession } from "./simulate";
import { reelRawCount, type ReelGeom } from "./core/reel";
import { project, type CamModel } from "./core/camera";
import { SherpyCore, type CoreOutput } from "./core/pipeline";

/** 넓은 산책로, 장애물 없음 (지도 위 코스를 따라 걷는다고 본다) */
const LIVE_ENV: Env = { half: 6, curve: 0, obs: [] };

export interface LiveSnapshot {
  out: CoreOutput;
  truth: { theta: number; d: number; tension: number; reel: number; rv: number };
  t: number;
}

export class LiveSim {
  w: World;
  core: SherpyCore;
  t = 0;
  private rng = makeRng(Date.now() % 100000);
  private geom: ReelGeom;
  private cam: CamModel;
  private L0: number;
  private encHeld: number | null = null;
  private prevPsi = 0;
  /** 이벤트 주입 (남은 초) */
  pullLeft = 0;
  pullForce = 0;
  camDropLeft = 0;
  last: LiveSnapshot | null = null;

  constructor(public p: SimParams = DEFAULT_PARAMS) {
    const hw = DEFAULT_HW;
    this.w = new World(p, LIVE_ENV, "normal");
    this.w.wrapRope = true;
    // 강아지는 좌우로 천천히 갈지자 — 주기 ~25 m
    this.w.pathFn = (y) => 0.55 * Math.sin(y / 4) + 0.25 * Math.sin(y / 1.7 + 1);
    this.w.reel = p.followDist - 2 / p.stiffness;
    this.L0 = this.w.reel;
    this.geom = { r0: hw.reelCore, t: hw.ropeThick, w: hw.drumWidth, Ltot: hw.ropeTotal };
    this.cam = { fx: hw.camFx, fy: hw.camFy, cx: hw.camCx, k1: hw.camK1, yaw: hw.camYaw, W: hw.camW };
    const fit = calibrationSession(hw, this.rng).fit;
    this.core = new SherpyCore({ p, hw, fit, reelMode: "tension", L0: this.L0 });
  }

  /** moving=false 면 로봇에 정지 명령(속도 0)을 주고 강아지도 멈춰 앉는다 */
  step(moving: boolean, speedLimit: number) {
    const { w, p, rng } = this;
    const hw = DEFAULT_HW;
    const dt = K.DT;
    const { d, ux, uy, T } = w.ropeTension();
    const theta = w.trueTheta();

    if (this.pullLeft > 0) { this.pullLeft -= dt; w.extraPull = this.pullForce; } else w.extraPull = 0;
    if (this.camDropLeft > 0) this.camDropLeft -= dt;
    // 로봇이 멈추면(정지·일시정지·HOLD) 강아지도 서서히 멈춘다 — 당기는 중이면 계속 당긴다
    w.dogWant = moving && !this.core.safety.hold ? 1 : w.extraPull > 0 ? 1 : 0;

    const Tm = T + p.noise * (0.65 * Math.sin(17 * this.t) + 0.35 * Math.sin(31 * this.t));
    const loadRaw = (Tm - hw.lcOffset) / hw.lcGain + rng.gauss() * hw.lcCountNoise;
    const encRaw = (reelRawCount(this.geom, this.L0, w.reel) + Math.round(rng.gauss() * hw.encNoiseLsb) + 4096) % 4096;
    let cam: { u: number; h: number } | null = null;
    if (this.camDropLeft <= 0 && rng.u() >= hw.camDrop) {
      const pr = project(this.cam, theta, d, hw.dogHeight);
      if (pr) cam = { u: pr.u + rng.gauss() * hw.camPxNoise, h: pr.h * (1 + rng.gauss() * hw.camHNoise) };
    }
    const yawRate = (w.psi - this.prevPsi) / dt;
    this.prevPsi = w.psi;

    const out = this.core.step({
      t: this.t, loadRaw, encRaw, cam,
      odo: { v: w.rv * (1 + rng.gauss() * hw.odoSpeedNoise), yawRate: yawRate + rng.gauss() * hw.gyroNoise },
      geom: null, avoidX: null,
    });
    w.mode = out.hold ? "HOLD" : "FOLLOW";
    const v = moving ? Math.min(out.cmd.v, speedLimit) : 0;
    w.integrate(v, moving ? out.cmd.steer : 0, T, ux, uy, this.t, w.reel + out.cmd.reelRate * dt, true);
    w.frame++;
    this.t += dt;
    this.encHeld = encRaw;
    this.last = { out: { ...out, cmd: { ...out.cmd, v } }, truth: { theta, d, tension: T, reel: w.reel, rv: w.rv }, t: this.t };
    return this.last;
  }

  /** 재개 — L3 원인(장력 등)이 사라졌을 때만 풀린다 */
  resume() {
    const o = this.last?.out;
    const clear = !o || (o.That < this.p.warn && o.track !== "lost");
    return this.core.resume(clear);
  }

  inject(kind: "pull" | "overload" | "dip") {
    if (kind === "pull") { this.pullLeft = 2.5; this.pullForce = 46; }
    if (kind === "overload") { this.pullLeft = 5; this.pullForce = 70; }
    if (kind === "dip") this.camDropLeft = 0.35; // 0.5초 미만 — 예측으로 버티는 L1 주의
  }
}

/** 파이프라인 L3 사유 → 고장 코드 (FAULT_LABEL) */
export function reasonToFault(reason: string | null): string | null {
  if (!reason) return null;
  if (reason.includes("로드셀")) return "F1";
  if (reason.includes("엔코더")) return "F2";
  if (reason.includes("카메라")) return "F8";
  if (reason.includes("걸림")) return "F7";
  return null;
}
