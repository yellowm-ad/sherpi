/**
 * 셰르피 처리 파이프라인 — 로봇에서 매 0.04초 도는 한 사이클.
 *
 *   ① 변수 구하기   HX711 count → T,   AS5600 count → L,   카메라 픽셀 → θ
 *   ② 변수 통합     EKF 로 강아지 위치 (x, y) · 거리 d · 불확실성
 *   ③ 안전 판단     SafetySupervisor → L0~L3
 *   ④ 명령          속도 v, 조향 δ, 릴 속도 L̇
 *
 * 시뮬레이터(실전 모드)와 실제 로봇(robot/sherpy_core/pipeline.py)이 같은 코드를 돈다.
 * 순수 함수형 입력(SensorPacket) → 출력(CoreOutput) 이라 기록된 센서 로그를 그대로 재생해 검증할 수 있다.
 */
import { K, flexiSpring, type HwParams, type SimParams } from "../params";
import { countsToNewton, lowpassAlpha, type LinearFit } from "./calib";
import { ReelOdometer, type ReelGeom } from "./reel";
import { bearingFromPixel, rangeFromBox, type CamModel } from "./camera";
import { DogTracker, type Pose } from "./tracker";
import { SafetySupervisor, type Level } from "./safety";

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const wrapPi = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/**
 * tension  — 장력 제어(예압): 줄을 항상 살짝 팽팽하게 → d = L + T/k 로 거리를 mm 단위로 안다 (기본)
 * position — 7.3 위치 제어: L목표 = d̂ + 0.04 (d̂ 는 융합 추정)
 * naive    — 비교용: 융합 없이 카메라 거리만으로 L목표 = d_cam + 0.04  (실패 사례 시연)
 * flexi    — 팀 하드웨어: Flexi 태엽 릴 (모터 없음 → 릴 명령 0). 태엽이 줄을 늘 T_s(L) 로 당겨 L ≈ d
 */
export type ReelMode = "tension" | "position" | "naive" | "flexi";

export interface SensorPacket {
  t: number;
  loadRaw: number | null;                 // HX711 count (null = 새 샘플 없음)
  encRaw: number | null;                  // AS5600 0~4095
  cam: { u: number; h: number } | null;   // 강아지 검출 박스 중심 u, 높이 h [px]
  odo: { v: number; yawRate: number };    // 바퀴 속도 m/s, 자이로 rad/s
  geom?: { body: number; rope: number; robotEdge: number; dogEdge: number } | null; // 주변 인식(라이다·초음파·지도)
  avoidX?: number | null;                 // 경로 계획기의 회피 목표 x (없으면 null)
}

export interface CoreConfig {
  p: SimParams;
  hw: HwParams;
  fit: Pick<LinearFit, "a" | "b">;
  reelMode: ReelMode;
  L0: number;
  /** 줄 예압 장력 [N] — 장력 제어 모드에서 줄을 항상 살짝 팽팽하게 */
  Tref?: number;
  /**
   * L2 감속 규칙. slow = 7.3 그대로(장력 ≥ warn 이면 ≤0.2 m/s).
   * directional = 강아지가 멀어지며 당기는 중(v_r > 0)이면 감속하지 않는다 — 로봇이 느려지면 거리가 벌어져 장력이 더 커지므로.
   *               로봇이 강아지를 끄는 경우(강아지 정지·뒤처짐, v_r ≤ 0)에만 감속.
   */
  l2Mode?: "slow" | "directional";
  /** 예측 경고 — dT̂/dt·dL/dt 로 정지값·줄 끝 도달 시간을 계산해 L2 를 미리 켠다 (safety.ts) */
  predict?: boolean;
}

export interface CoreOutput {
  t: number;
  T: number | null;      // N 이번 샘플 장력 (보정 후)
  Tfast: number;         // N 릴 제어용 빠른 필터
  That: number;          // N 안전 판단용 필터 (τ)
  L: number;             // m 엔코더 인출길이
  thetaMeas: number | null;
  dCam: number | null;
  dRope: number | null;
  est: { xr: number; yr: number; theta: number; d: number; sigma: number; vr: number; ellipse: { major: number; minor: number; angle: number } };
  pose: Pose;
  track: "ok" | "coast" | "lost";
  snagResidual: number;
  level: Level;
  hold: boolean;
  reason: string | null;
  notes: string[];
  cmd: { v: number; steer: number; reelRate: number };
  nis: { bearing: number | null; rope: number | null; cam: number | null };
  /** 변화율 — 장력 기울기 dT̂/dt [N/s], 인출 속도 dL/dt [m/s] (τ 0.1 s 미분 필터) */
  rate: { Tdot: number; Ldot: number };
}

export class SherpyCore {
  pose: Pose = { x: 0, y: 0, psi: 0 };
  tracker = new DogTracker();
  odo: ReelOdometer;
  safety: SafetySupervisor;
  cam: CamModel;
  That = 0;
  Tfast = 0;
  loadAge = 0;
  camAge = 0;
  snagF = 0;
  snagTime = 0;
  private lastCmdRate = 0;
  private encHist: { meas: number; cmd: number }[] = [];
  private prevL: number;
  private prevThat = 0;
  Tdot = 0;
  Ldot = 0;

  constructor(public cfg: CoreConfig) {
    const { hw, p } = cfg;
    const geom: ReelGeom = { r0: hw.reelCore, t: hw.ropeThick, w: hw.drumWidth, Ltot: hw.ropeTotal };
    this.odo = new ReelOdometer(geom, cfg.L0);
    this.prevL = cfg.L0;
    // 카메라 내부 파라미터: 체커보드 보정으로 얻었다고 가정 — 주점 c_x 는 참값보다 몇 px 틀린 추정값을 쓴다
    this.cam = { fx: hw.camFx, fy: hw.camFy, cx: hw.camW / 2, k1: hw.camK1, yaw: hw.camYawEst, W: hw.camW };
    this.safety = new SafetySupervisor({
      warn: p.warn, stop: p.stop, clearance: p.clearance, reelMax: p.reelMax,
      lcTimeout: hw.lcTimeout, camLostHold: hw.camLostHold, encFrames: K.ENCODER_STUCK_FRAMES, encTol: hw.encResidualTol,
      predict: !!cfg.predict,
    });
    this.tracker.init(this.pose, 0, p.followDist, 0.3, 0.2);
  }

  step(s: SensorPacket): CoreOutput {
    const { p, hw } = this.cfg;
    const dt = K.DT;

    // ── 로봇 자세 (오도메트리 추측항법) ──
    this.pose.psi += s.odo.yawRate * dt;
    this.pose.x += s.odo.v * Math.sin(this.pose.psi) * dt;
    this.pose.y += s.odo.v * Math.cos(this.pose.psi) * dt;
    this.tracker.predict(dt);

    // ── ① 변수 구하기 ──
    // T: 선형 보정 → 두 갈래 필터 (안전용 τ, 릴 제어용 빠른 τ)
    let T: number | null = null;
    if (s.loadRaw !== null) {
      T = countsToNewton(this.cfg.fit, s.loadRaw);
      this.That += lowpassAlpha(dt, p.tau) * (T - this.That);
      this.Tfast += lowpassAlpha(dt, 0.05) * (T - this.Tfast);
      this.loadAge = 0;
    } else this.loadAge += dt;
    // 변화율: 후진차분을 τ 0.1 s 로 한 번 더 거른다 (미분은 잡음을 키우므로)
    const aD = lowpassAlpha(dt, 0.1);
    this.Tdot += aD * ((this.That - this.prevThat) / dt - this.Tdot);
    this.prevThat = this.That;

    // L: AS5600 언랩 → 겹감김 닫힌 해
    const L = this.odo.update(s.encRaw);
    this.encHist.push({ meas: L - this.prevL, cmd: this.lastCmdRate * dt });
    if (this.encHist.length > K.ENCODER_STUCK_FRAMES) this.encHist.shift();
    this.Ldot += aD * ((L - this.prevL) / dt - this.Ldot);
    this.prevL = L;
    // 엔코더 잔차: "릴에 움직이라고 했는데 측정이 전혀 안 움직였다" — 단, 장력이 높으면 모터가 하중에 밀려
    // 실제로 못 움직일 수 있으므로(정상) 부하가 낮을 때만 본다. 한계(1.2 m·reelMax)에서 막힌 경우도 제외.
    const sumCmd = this.encHist.reduce((a, h) => a + h.cmd, 0);
    const sumMeas = this.encHist.reduce((a, h) => a + h.meas, 0);
    const encResidual = this.Tfast < p.warn / 2 && Math.abs(sumMeas) < 0.002 && L > K.REEL_MIN + 0.02 && L < p.reelMax - 0.02
      ? Math.abs(sumCmd - sumMeas) : 0;

    // θ, d_cam: 픽셀 → 왜곡 보정 → 장착각 보정
    let thetaMeas: number | null = null, dCam: number | null = null;
    if (s.cam) {
      thetaMeas = bearingFromPixel(this.cam, s.cam.u);
      dCam = rangeFromBox(this.cam, s.cam.h, hw.dogHeight, thetaMeas);
    }

    // ── ② 변수 통합 (EKF) ──
    const rel0 = this.tracker.relative(this.pose);
    const robotRadial = s.odo.v * (Math.sin(this.pose.psi) * rel0.ex + Math.cos(this.pose.psi) * rel0.ey) / rel0.rho;
    const vRel = rel0.vr - robotRadial; // 강아지가 멀어지는 속도 (+)

    const nis: CoreOutput["nis"] = { bearing: null, rope: null, cam: null };
    let camUsed = false;
    if (thetaMeas !== null) {
      // σ_θ: 검출 흔들림 σ_u/f_x + 장착각 보정 잔여오차
      const u = this.tracker.updateBearing(this.pose, thetaMeas, Math.hypot(hw.camPxNoise / hw.camFx, 0.006));
      nis.bearing = u.nis; camUsed = u.used;
    }
    // 줄이 팽팽하면 d = L + (T − 12·max(0, v_r))/k  (7.3 장력식의 역함수)
    let dRope: number | null = null;
    const taut = this.Tfast > 1.0 && this.loadAge === 0;
    // Flexi: 태엽 장력 T_s(L) 은 늘어남이 아니므로 빼고 남는 것만 줄 탄성으로 본다
    const Tbase = this.cfg.reelMode === "flexi" ? flexiSpring(hw, L) : 0;
    if (taut) dRope = L + Math.max(0, this.Tfast - Tbase - K.ROPE_DAMP * Math.max(0, vRel)) / p.stiffness;

    // 줄 걸림 잔차: 줄이 말하는 거리 − 카메라가 말하는 거리 (걸리면 줄 경로가 길어져 +)
    if (dRope !== null && dCam !== null) {
      this.snagF += lowpassAlpha(dt, 0.3) * (dRope - dCam - this.snagF);
    } else this.snagF *= 0.98;
    const snagThresh = Math.max(0.3, 0.12 * L);
    this.snagTime = this.snagF > snagThresh ? this.snagTime + dt : 0;
    const snag = this.snagTime >= 0.4;

    if (dRope !== null && !snag) {
      const sig = Math.hypot(0.01, 0.6 / p.stiffness, 0.004 * L);
      nis.rope = this.tracker.updateRange(this.pose, dRope, sig).nis;
    } else {
      // 느슨한 줄: d ≤ L (+줄 늘어남 여유)
      this.tracker.constrainMaxRange(this.pose, L + 0.03, 0.03);
    }
    if (dCam !== null) {
      // 카메라 거리는 줄 정보가 없을 때 주로 기여 (σ 가 커서 줄이 있으면 영향이 작다)
      nis.cam = this.tracker.updateRange(this.pose, dCam, 0.06 * dCam + 0.04).nis;
    }

    this.camAge = camUsed ? 0 : this.camAge + dt;
    // 방향 정보가 끊기면 속도 추정을 서서히 0 으로 (등속 외삽이 옆으로 떠내려가지 않게 — 1차 마르코프 속도 모델)
    if (this.camAge > 0.2) { const k = Math.exp(-dt / 0.8); this.tracker.s[2] *= k; this.tracker.s[3] *= k; }
    const rel = this.tracker.relative(this.pose);
    const sigma = this.tracker.sigmaPos;
    const track = this.camAge === 0 ? "ok" : this.camAge <= hw.camLostHold ? "coast" : "lost";

    // ── ③ 안전 판단 ──
    const so = this.safety.step({
      t: s.t, Thead: this.That, loadAge: this.loadAge, encFrozen: this.odo.sameCount, encResidual,
      camAge: this.camAge, sigmaPos: sigma, snag, reel: L, geom: s.geom ?? null,
      Tdot: this.Tdot, Ldot: this.Ldot,
    });

    // ── ④ 명령 ──
    // 조향: 7.3 과 같은 구조 — 목표 방위 = 강아지 방향(전방 최소 0.2 m), 회피 경로가 있으면 그쪽
    const ex = this.tracker.s[0] - this.pose.x, ey = this.tracker.s[1] - this.pose.y;
    let pu = Math.atan2(ex, Math.max(0.2, ey));
    if (s.avoidX != null) pu = Math.atan2(s.avoidX - this.pose.x, 1);
    const steerLim = (p.steerMax * Math.PI) / 180;
    const steer = clamp(K.STEER_GAIN * wrapPi(pu - this.pose.psi), -steerLim, steerLim);

    let v = clamp(p.dogSpeed + K.FOLLOW_GAIN * (rel.rho - p.followDist), 0, p.robotMax);
    const pulling = this.cfg.l2Mode === "directional" && so.level === 2 && vRel > 0.05;
    if (so.speedCap !== null && !(pulling && !so.hold)) v = Math.min(v, so.speedCap);

    // 릴: 장력 제어(예압) — L̇ = K_T(T_fast − T_ref) + v_r(앞먹임).  위치 제어(7.3) — L̇ ∝ (d̂ + 0.04 − L)
    let reelRate: number;
    if (this.cfg.reelMode === "tension") {
      const Tref = this.cfg.Tref ?? 2;
      reelRate = 0.03 * (this.Tfast - Tref) + Math.max(-0.3, Math.min(0.6, vRel));
      if (this.loadAge > 0) reelRate = 0; // 장력을 모르면 릴을 움직이지 않는다
    } else if (this.cfg.reelMode === "flexi") {
      reelRate = 0; // 태엽 릴 — 제어 대상 아님 (잠금은 L3 때 작동기가)
    } else if (this.cfg.reelMode === "position") {
      reelRate = (clamp(rel.rho + K.REEL_SLACK, K.REEL_MIN, p.reelMax) - L) / dt;
    } else {
      reelRate = dCam === null ? 0 : (clamp(dCam + K.REEL_SLACK, K.REEL_MIN, p.reelMax) - L) / dt;
    }
    reelRate = clamp(reelRate, -K.REEL_IN, so.hold ? 0 : K.REEL_OUT);
    if (L >= p.reelMax - 1e-6) reelRate = Math.min(reelRate, 0);
    if (L <= K.REEL_MIN + 1e-6) reelRate = Math.max(reelRate, 0);
    this.lastCmdRate = reelRate;

    return {
      t: s.t, T, Tfast: this.Tfast, That: this.That, L, thetaMeas, dCam, dRope,
      est: { xr: rel.xr, yr: rel.yr, theta: rel.theta, d: rel.rho, sigma, vr: vRel, ellipse: this.relEllipse() },
      pose: { ...this.pose }, track, snagResidual: this.snagF,
      level: so.level, hold: so.hold, reason: so.reason, notes: so.notes,
      cmd: { v: so.hold ? 0 : v, steer, reelRate }, nis, rate: { Tdot: this.Tdot, Ldot: this.Ldot },
    };
  }

  /** 오차 타원을 로봇 좌표계로 돌린 것 (화면 표시용) */
  private relEllipse() {
    const e = this.tracker.ellipse();
    // 월드 x축 기준 각 → 로봇 좌표 (로봇 +x 는 월드에서 ψ 만큼 시계방향 회전)
    return { ...e, angle: e.angle + this.pose.psi };
  }

  /** 사용자 재개 명령 — L3 원인이 사라졌을 때만 */
  resume(clear: boolean) { return this.safety.tryReset(clear); }
}
