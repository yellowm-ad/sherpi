/**
 * 셰르피 물리 세계 — SHERPY 7.3 기준 엔진의 1:1 이식.
 *
 * 원본(sherpy-simulator.vercel.app)과 식·계산 순서·상수가 완전히 같다.
 * scripts/verify-math.ts 가 원본 번들의 함수와 24개 조합(환경 4 × 시나리오 6)을 프레임 단위로 대조한다.
 *
 * 좌표계: 지역 Cartesian (x: 오른쪽, y: 전방) [m]. 로봇 방위 ψ 는 +y 에서 +x 쪽으로 잰다.
 *   → 로봇 이동 ẋ = v·sinψ, ẏ = v·cosψ
 * 로봇 기준 강아지 방향각 θ = atan2(Δx_r, Δy_r) — 「셰르피 공식.png」 ③과 같은 정의 (+θ = 오른쪽).
 */
import { K, ENVS, type Env, type EnvKey, type Obstacle, type ScenarioKey, type SimParams } from "./params";

export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
/** S(q) = q²(3 − 2q), q ∈ [0,1] — 경로 진폭을 부드럽게 켜고 끄는 smoothstep */
export const smooth = (q: number) => { const t = clamp(q, 0, 1); return t * t * (3 - 2 * t); };
export const wrapPi = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** 선분 AB 와 원(장애물) 중심 사이 최소거리 − 반경. 음수 = 줄이 장애물을 관통(간섭) */
export function segClearance(a: [number, number], b: [number, number], o: Obstacle) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const s = len2 ? clamp(((o.x - a[0]) * dx + (o.y - a[1]) * dy) / len2, 0, 1) : 0;
  return Math.hypot(a[0] + s * dx - o.x, a[1] + s * dy - o.y) - o.r;
}

/**
 * 원(장애물)을 감아 도는 최단 줄 경로.  A(로봇) → 접선 → 호 → 접선 → B(강아지)
 *   ℓ = √(|AO|² − R²) + √(|BO|² − R²) + R·(∠AOB − acos(R/|AO|) − acos(R/|BO|))
 * 강아지가 받는 줄 방향은 B 쪽 접점 → B. 직선이 원을 지나지 않으면 null.
 */
export function wrappedPath(A: [number, number], B: [number, number], obs: Obstacle[]) {
  let best: { length: number; ux: number; uy: number } | null = null;
  for (const o of obs) {
    if (segClearance(A, B, o) >= 0) continue;
    const ax = A[0] - o.x, ay = A[1] - o.y, bx = B[0] - o.x, by = B[1] - o.y;
    const da = Math.hypot(ax, ay), db = Math.hypot(bx, by), R = o.r;
    if (da <= R || db <= R) continue;
    const aob = Math.acos(clamp((ax * bx + ay * by) / (da * db), -1, 1));
    const arc = Math.max(0, aob - Math.acos(R / da) - Math.acos(R / db));
    const length = Math.sqrt(da * da - R * R) + Math.sqrt(db * db - R * R) + R * arc;
    // B 쪽 접점: B 방향에서 ±acos(R/|BO|) 회전 — A 와 같은 쪽을 고른다
    const beta = Math.acos(R / db), base = Math.atan2(by, bx);
    const side = Math.sign(bx * ay - by * ax) || 1;
    const tAng = base + side * beta;
    const tx = o.x + R * Math.cos(tAng), ty = o.y + R * Math.sin(tAng);
    const L = Math.hypot(B[0] - tx, B[1] - ty) || 1e-3;
    if (!best || length > best.length) best = { length, ux: (B[0] - tx) / L, uy: (B[1] - ty) / L };
  }
  return best;
}

export type Mode = "FOLLOW" | "HOLD";

/** 한 프레임의 참값(물리) */
export interface TruthFrame {
  t: number;
  robot: [number, number];
  dog: [number, number];
  psi: number;       // rad 로봇 방위
  rv: number;        // m/s 로봇 속도
  dogV: number;      // m/s 강아지 속력
  dist: number;      // m 로봇–강아지 직선거리 d
  reel: number;      // m 릴 인출길이 L
  tension: number;   // N 원시(참) 장력
  filtered: number;  // N 필터 장력 F̂ (기준 모드) / 추정 장력 (실전 모드)
  rope: number;      // m 줄–장애물 최소 이격 (음수 = 간섭)
  body: number;      // m 차체–장애물 최소 이격
  mode: Mode;
  encoder: number;   // m 엔코더가 보고하는 L
  camera: number | null; // m 카메라가 보고하는 d (null = 추적 실패)
  theta: number;     // rad 참 방향각 θ (로봇 기준)
  steer: number;     // rad 조향 명령 δ
  vCmd: number;      // m/s 명령속도
}

export interface SafetyEvent { t: number; reason: string; level?: 1 | 2 | 3 }

/** 강아지 경로 진폭(목표 횡위치) — 경로 진폭 x(y) */
export function dogPathX(env: Env, scenario: ScenarioKey, y: number) {
  return scenario === "opposite"
    ? 1.15 * (smooth((y - 4.2) / 1.7) - smooth((y - 10.5) / 2.5))
    : env.curve * (smooth((y - 3.1) / 2) - smooth((y - 10) / 3));
}

export function scenarioObstacles(env: Env, scenario: ScenarioKey): Obstacle[] {
  return scenario === "opposite" ? [{ x: 0, y: 7, r: 0.52 }, ...env.obs.filter((o) => o.y > 10)] : env.obs;
}

/**
 * 물리 상태. 기준 모드(step73)와 실전 모드(외부 명령을 받는 stepWith)가 같은 물리를 공유한다.
 */
export class World {
  readonly env: Env;
  readonly obstacles: Obstacle[];
  // 상태 — 원본 변수명: W,_ → rx,ry / T → psi / A → rv / G,rl → dx,dy / dl,el → dvx,dvy / _l → reel / jl → filtered
  rx = 0; ry = 0; psi = 0; rv = 0;
  dx = 0; dy: number; dvx = 0; dvy: number;
  reel: number;
  filtered = 0;
  mode: Mode = "FOLLOW";
  stopTime: number | null = null;
  encHeld: number;     // 엔코더 고착 시 붙잡힌 값 (원본 P)
  encStuck = 0;        // 원본 sl
  peak = 0;
  minRope = Infinity;
  frame = 0;
  events: SafetyEvent[] = [];

  /** 실시간 시연용 — 강아지 경로를 바꾸거나(pathFn), 급당김을 넣거나(extraPull), 멈추게(dogWant) 한다 */
  pathFn: ((y: number) => number) | null = null;
  extraPull = 0;      // N 추가 추진력 (0 이면 시나리오 규칙만)
  dogWant = 1;        // 강아지 목표속도 배율 (0 = 멈춰 섬)

  constructor(public p: SimParams, public envKey: EnvKey | Env, public scenario: ScenarioKey) {
    this.env = typeof envKey === "string" ? ENVS[envKey] : envKey;
    this.obstacles = scenarioObstacles(this.env, scenario);
    this.dy = p.followDist;
    this.dvy = p.dogSpeed;
    this.reel = Math.min(p.reelMax, p.followDist + 0.1);
    this.encHeld = this.reel;
  }

  get t() { return this.frame * K.DT; }

  /** 강아지가 자기 의지로 내는 힘 (추진·횡이동) — 원본 ol, ht */
  private dogDrive(t: number) {
    const { p } = this;
    const pathX = this.pathFn ? this.pathFn(this.dy) : dogPathX(this.env, this.scenario, this.dy);
    const latV = clamp((pathX - this.dx) * K.DOG_LAT_GAIN, -K.DOG_LAT_V, K.DOG_LAT_V);
    const pulling = (this.scenario === "pull" && t >= K.PULL_T0 && t < K.PULL_T1) || this.extraPull > 0;
    const want = (p.dogSpeed + (pulling ? K.PULL_DV : 0)) * this.dogWant;
    const fwd = clamp((want - this.dvy) * p.dogMass * K.DOG_GAIN, -K.DOG_FWD_MAX, K.DOG_FWD_MAX) + (pulling ? (this.extraPull || p.pullForce) : 0);
    const lat = clamp((latV - this.dvx) * p.dogMass * K.DOG_GAIN, -K.DOG_LAT_MAX, K.DOG_LAT_MAX);
    return { fwd, lat };
  }

  /** 실전 모드에서만 켠다 — 줄이 장애물을 감으면 줄 경로가 직선보다 길어진다 (7.3 은 직선만) */
  wrapRope = false;

  /** 줄 장력 F_t = k(ℓ − L) + 12·max(0, v_r)  (ℓ > L), 0 (ℓ ≤ L) — 원본 o.  ℓ = 줄 경로 길이 (감김 없으면 d) */
  ropeTension() {
    const d = Math.hypot(this.dx - this.rx, this.dy - this.ry);
    let ux = (this.dx - this.rx) / Math.max(0.001, d), uy = (this.dy - this.ry) / Math.max(0.001, d);
    let path = d;
    if (this.wrapRope) {
      const w = wrappedPath([this.rx, this.ry], [this.dx, this.dy], this.obstacles);
      if (w) { path = w.length; ux = w.ux; uy = w.uy; }
    }
    const stretch = Math.max(0, path - this.reel);
    const vr = (this.dvx - this.rv * Math.sin(this.psi)) * ux + (this.dvy - this.rv * Math.cos(this.psi)) * uy;
    const T = stretch > 0 ? this.p.stiffness * stretch + K.ROPE_DAMP * Math.max(0, vr) : 0;
    return { d, ux, uy, T, vr, path };
  }

  /** 기하 이격: 차체·줄·경계 */
  geometry() {
    const r: [number, number] = [this.rx, this.ry], g: [number, number] = [this.dx, this.dy];
    const body = Math.min(...this.obstacles.map((o) => Math.hypot(this.rx - o.x, this.ry - o.y) - o.r - K.ROBOT_HALF_W));
    const rope = Math.min(...this.obstacles.map((o) => segClearance(r, g, o)));
    const robotEdge = this.env.half - Math.abs(this.rx) - K.ROBOT_HALF_W;
    const dogEdge = this.env.half - Math.abs(this.dx) - K.DOG_HALF_W;
    return { body, rope, robotEdge, dogEdge };
  }

  /** 참 방향각 θ — 로봇 좌표계에서 본 강아지 방향 */
  trueTheta() {
    const ex = this.dx - this.rx, ey = this.dy - this.ry;
    const xr = ex * Math.cos(this.psi) - ey * Math.sin(this.psi);
    const yr = ex * Math.sin(this.psi) + ey * Math.cos(this.psi);
    return Math.atan2(xr, yr);
  }

  /** 7.3 원본의 방향 목표 Pu (월드 좌표) */
  headingTarget(t: number) {
    let pu = Math.atan2(this.dx - this.rx, Math.max(0.2, this.dy - this.ry));
    if (this.scenario === "opposite" && t > 0 && t < 28 && this.ry > 3 && this.ry < 10) {
      const sx = -1.13 * (smooth((this.ry - 3.1) / 1.4) - smooth((this.ry - 10) / 2.2));
      pu = Math.atan2(sx - this.rx, 1);
    }
    return pu;
  }

  /**
   * 물리 한 스텝 적분 — 로봇(자전거 모델) + 강아지(F = ma) + 릴.
   * reelTarget 이 null 이면 7.3 규칙(적분 뒤의 참 거리 + 0.04)을 쓴다.
   * smoothAccel = false 면 원본의 뱅뱅 가감속(목표 근처에서 ±떨림)을 그대로 재현한다.
   */
  integrate(vCmd: number, steer: number, T: number, ux: number, uy: number, t: number, reelTarget: number | null, smoothAccel = false) {
    const { p } = this;
    const dt = K.DT;
    const { fwd, lat } = this.dogDrive(t);
    if (smoothAccel) this.rv = clamp(this.rv + clamp(vCmd - this.rv, -K.DECEL * dt, K.ACCEL * dt), 0, p.robotMax);
    else this.rv = clamp(this.rv + dt * (vCmd > this.rv ? K.ACCEL : -K.DECEL), 0, p.robotMax);
    if (vCmd === 0 && this.rv < 0.02) this.rv = 0;
    this.psi += (this.rv / K.WHEELBASE) * Math.tan(steer) * dt;
    this.rx += this.rv * Math.sin(this.psi) * dt;
    this.ry += this.rv * Math.cos(this.psi) * dt;

    // 강아지: m·a = F추진 − F_t·û − 2.2·v
    const ax = (lat - T * ux - K.DOG_DAMP * this.dvx) / p.dogMass;
    const ay = (fwd - T * uy - K.DOG_DAMP * this.dvy) / p.dogMass;
    this.dvx = clamp(this.dvx + ax * dt, -K.DOG_V_MAX, K.DOG_V_MAX);
    this.dvy = clamp(this.dvy + ay * dt, -K.DOG_V_MAX, K.DOG_V_MAX);
    this.dx += this.dvx * dt;
    this.dy += this.dvy * dt;
    const lim = this.env.half - 0.16;
    this.dx = clamp(this.dx, -lim, lim);
    if (Math.abs(this.dx) >= lim && this.dvx * this.dx > 0) this.dvx = 0;

    // 릴: L목표 = clamp(d새 + 0.04, 1.2, reelMax). FOLLOW: 회수 ≤ 0.5 · 인출 ≤ 0.65 m/s, HOLD: 인출 금지
    const dNew = Math.hypot(this.dx - this.rx, this.dy - this.ry);
    const target = clamp((reelTarget ?? dNew + K.REEL_SLACK), K.REEL_MIN, p.reelMax);
    this.reel += this.mode === "FOLLOW"
      ? clamp(target - this.reel, -K.REEL_IN * dt, K.REEL_OUT * dt)
      : clamp(target - this.reel, -K.REEL_IN * dt, 0);
    this.reel = clamp(this.reel, K.REEL_MIN, p.reelMax);
    return dNew;
  }

  /** 7.3 기준 모드 한 프레임 — 원본 Oy 루프 본문과 같은 순서 */
  step73(): TruthFrame {
    const { p, scenario } = this;
    const t = this.frame * K.DT;
    const { d, ux, uy, T } = this.ropeTension();

    // 센서 (원본: 시나리오별 고장 주입)
    const loadOut = scenario === "load" && t >= K.FAULT_T;
    const raw = loadOut ? null : T + p.noise * (0.65 * Math.sin(17 * t) + 0.35 * Math.sin(31 * t));
    const encoder = scenario === "encoder" && t >= K.FAULT_T ? this.encHeld : this.reel;
    const camera = scenario === "camera" && t >= K.FAULT_T ? null : d + 0.015 * Math.sin(11 * t);
    // 1차 저역통과: α = 1 − exp(−dt / max(0.025, τ)),  F̂ ← F̂ + α(z − F̂)
    if (raw !== null) this.filtered += (1 - Math.exp(-K.DT / Math.max(0.025, p.tau))) * (raw - this.filtered);

    const g = this.geometry();
    if (scenario === "encoder" && t >= K.FAULT_T) this.encStuck++;
    else { this.encStuck = 0; this.encHeld = encoder; }

    // 안전 판단 L3
    const sensorFail = raw === null || camera === null || this.encStuck >= K.ENCODER_STUCK_FRAMES;
    const geomFail = g.body < p.clearance || g.rope < 0 || g.robotEdge < 0 || g.dogEdge < 0 || this.filtered >= p.stop;
    if (this.mode !== "HOLD" && (sensorFail || geomFail)) {
      this.mode = "HOLD";
      this.stopTime = t;
      const reason = raw === null ? "로드셀 신호 단절"
        : camera === null ? "카메라 추적 실패"
        : this.encStuck >= K.ENCODER_STUCK_FRAMES ? "엔코더 고착"
        : g.body < p.clearance ? "차체 장애물 안전거리 부족"
        : g.rope < 0 ? "리드줄이 장애물에 걸림"
        : g.robotEdge < 0 || g.dogEdge < 0 ? "환경 경계 이탈"
        : "장력 정지 임계값 초과";
      this.events.push({ t, reason, level: 3 });
    }

    // 명령: 조향 δ = clamp(1.4·wrap(Pu − ψ), ±steerMax), 속도 v = clamp(dogSpeed + 1.2(d − followDist), 0, robotMax)
    const theta = this.trueTheta();
    const err = wrapPi(this.headingTarget(t) - this.psi);
    const steerLim = (p.steerMax * Math.PI) / 180;
    const steer = clamp(K.STEER_GAIN * err, -steerLim, steerLim);
    let vCmd = clamp(p.dogSpeed + K.FOLLOW_GAIN * (d - p.followDist), 0, p.robotMax);
    if (this.filtered >= p.warn) vCmd = Math.min(vCmd, K.WARN_SPEED);
    if (this.mode === "HOLD") vCmd = 0;

    const dNew = this.integrate(vCmd, steer, T, ux, uy, t, null, false);
    this.peak = Math.max(this.peak, T);
    this.minRope = Math.min(this.minRope, g.rope);
    this.frame++;

    return {
      t, robot: [this.rx, this.ry], dog: [this.dx, this.dy], psi: this.psi, rv: this.rv,
      dogV: Math.hypot(this.dvx, this.dvy), dist: dNew, reel: this.reel, tension: T, filtered: this.filtered,
      rope: g.rope, body: g.body, mode: this.mode, encoder, camera, theta, steer, vCmd,
    };
  }
}

export interface RunResult {
  frames: TruthFrame[];
  events: SafetyEvent[];
  peak: number;
  minRope: number;
  stopTime: number | null;
  obstacles: Obstacle[];
}

/** 7.3 기준 모드 40초 전체 계산 (원본 Oy 와 동일 결과) */
export function run73(p: SimParams, env: EnvKey, scenario: ScenarioKey): RunResult {
  const w = new World(p, env, scenario);
  const frames: TruthFrame[] = [];
  for (let i = 0; i <= K.FRAMES; i++) frames.push(w.step73());
  return { frames, events: w.events, peak: w.peak, minRope: w.minRope, stopTime: w.stopTime, obstacles: w.obstacles };
}
