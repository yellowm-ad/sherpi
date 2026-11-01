/**
 * 변수 통합 — 강아지 위치 추정 (확장 칼만 필터, EKF)
 *
 * 세 변수는 각각 위치의 일부만 말해 준다.
 *   θ (카메라)      → 방향만. 거리는 모른다.
 *   L + T/k (릴·로드셀) → 줄이 팽팽할 때만 거리. 느슨하면 "d ≤ L" 이라는 상한뿐.
 *   d_cam (박스 크기) → 거리지만 오차 5~6%.
 * 그래서 상태 s = [x, y, vx, vy] (오도메트리 좌표계의 강아지 위치·속도)를 두고
 * 예측(등속 운동) → 갱신(측정마다 베이즈 결합)을 반복한다. 머신러닝 관점에선
 * 가우시안 사전분포 × 가능도 → 사후분포를 매 프레임 닫힌 형태로 계산하는 온라인 베이즈 추론이다.
 *
 * 예측:  s⁻ = F s,  P⁻ = F P Fᵀ + Q      (F: 등속, Q: 강아지 가속 σ_a 의 이산 백색잡음)
 * 갱신(스칼라 측정 z = h(s) + v, v ~ N(0, R)):
 *   ν = z − h(s⁻)            혁신(잔차)
 *   S = H P⁻ Hᵀ + R          혁신 분산
 *   K = P⁻ Hᵀ / S            칼만 이득
 *   s = s⁻ + K ν,  P = (I − KH) P⁻ (I − KH)ᵀ + K R Kᵀ   (조셉 형식 — 수치적으로 대칭·양정치 유지)
 * 이상치 게이트: NIS = ν²/S > χ²₁(0.997) = 9 이면 그 측정을 버린다 (3σ 밖).
 *
 * 측정 모델 (로봇 자세 x_r, y_r, ψ 기준, e = (x − x_r, y − y_r)):
 *   x_r' = e_x cosψ − e_y sinψ,   y_r' = e_x sinψ + e_y cosψ     (로봇 좌표: +x 오른쪽, +y 전방)
 *   θ = atan2(x_r', y_r'),  ∂θ/∂x = (y_r' cosψ − x_r' sinψ)/ρ²,  ∂θ/∂y = −(y_r' sinψ + x_r' cosψ)/ρ²
 *   ρ = |e|,               ∂ρ/∂x = e_x/ρ,  ∂ρ/∂y = e_y/ρ
 */
export type Vec4 = [number, number, number, number];
export type Mat4 = number[][]; // 4×4

const eye = (): Mat4 => [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]];

export interface Pose { x: number; y: number; psi: number }

export interface TrackerOpts {
  sigmaAccel: number;   // m/s² 강아지 가속 불확실성
  gate: number;         // NIS 게이트
}
export const DEFAULT_TRACKER: TrackerOpts = { sigmaAccel: 1.6, gate: 9 };

export interface UpdateResult { used: boolean; nis: number; innov: number }

export class DogTracker {
  s: Vec4 = [0, 0, 0, 0];
  P: Mat4 = eye();
  ready = false;

  constructor(public opts: TrackerOpts = DEFAULT_TRACKER) {}

  /** 첫 위치: 로봇 기준 (θ, d) 로 초기화. 불확실성은 크게 */
  init(pose: Pose, theta: number, d: number, sigD = 0.3, sigTh = 0.15) {
    const a = pose.psi + theta;
    this.s = [pose.x + d * Math.sin(a), pose.y + d * Math.cos(a), 0, 0];
    // 극좌표 불확실성 → 직교좌표 공분산 (야코비안 전파)
    const J = [[Math.sin(a), d * Math.cos(a)], [Math.cos(a), -d * Math.sin(a)]];
    const Sp = [[sigD * sigD, 0], [0, sigTh * sigTh]];
    const C = [[0, 0], [0, 0]];
    for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) for (let k = 0; k < 2; k++) for (let l = 0; l < 2; l++) C[i][j] += J[i][k] * Sp[k][l] * J[j][l];
    this.P = [[C[0][0] + 1e-4, C[0][1], 0, 0], [C[1][0], C[1][1] + 1e-4, 0, 0], [0, 0, 0.5, 0], [0, 0, 0, 0.5]];
    this.ready = true;
  }

  predict(dt: number) {
    const [x, y, vx, vy] = this.s;
    this.s = [x + vx * dt, y + vy * dt, vx, vy];
    const P = this.P;
    // P = F P Fᵀ (F = [[I, dt·I],[0, I]])
    const FP: Mat4 = P.map((r) => r.slice());
    for (let j = 0; j < 4; j++) { FP[0][j] = P[0][j] + dt * P[2][j]; FP[1][j] = P[1][j] + dt * P[3][j]; }
    const N: Mat4 = FP.map((r) => r.slice());
    for (let i = 0; i < 4; i++) { N[i][0] = FP[i][0] + dt * FP[i][2]; N[i][1] = FP[i][1] + dt * FP[i][3]; }
    // Q — 이산 백색 가속 잡음
    const q = this.opts.sigmaAccel ** 2;
    const q11 = (dt ** 4) / 4 * q, q13 = (dt ** 3) / 2 * q, q33 = dt * dt * q;
    N[0][0] += q11; N[1][1] += q11; N[0][2] += q13; N[2][0] += q13; N[1][3] += q13; N[3][1] += q13; N[2][2] += q33; N[3][3] += q33;
    this.P = N;
  }

  /** 로봇 좌표로 본 현재 추정 */
  relative(pose: Pose) {
    const ex = this.s[0] - pose.x, ey = this.s[1] - pose.y;
    const c = Math.cos(pose.psi), sn = Math.sin(pose.psi);
    const xr = ex * c - ey * sn, yr = ex * sn + ey * c;
    const rho = Math.max(1e-3, Math.hypot(ex, ey));
    // 반경 방향 상대속도 (강아지 속도의 시선 성분 − 로봇 속도의 시선 성분은 호출 쪽에서 뺀다)
    const vr = (this.s[2] * ex + this.s[3] * ey) / rho;
    return { xr, yr, ex, ey, rho, theta: Math.atan2(xr, yr), vr };
  }

  /** 스칼라 측정 갱신. H 는 [∂h/∂x, ∂h/∂y, 0, 0] (위치만 관측) */
  private scalarUpdate(innov: number, H: [number, number], R: number, gate = this.opts.gate): UpdateResult {
    const P = this.P;
    const PHt = [0, 1, 2, 3].map((i) => P[i][0] * H[0] + P[i][1] * H[1]);
    const S = H[0] * PHt[0] + H[1] * PHt[1] + R;
    const nis = (innov * innov) / S;
    if (!(S > 0) || nis > gate) return { used: false, nis, innov };
    const Kg = PHt.map((v) => v / S);
    for (let i = 0; i < 4; i++) this.s[i] += Kg[i] * innov;
    // 조셉 형식: P = (I − KH) P (I − KH)ᵀ + K R Kᵀ
    const A = eye();
    for (let i = 0; i < 4; i++) { A[i][0] -= Kg[i] * H[0]; A[i][1] -= Kg[i] * H[1]; }
    const AP = A.map((r) => [0, 1, 2, 3].map((j) => r[0] * P[0][j] + r[1] * P[1][j] + r[2] * P[2][j] + r[3] * P[3][j]));
    const N = AP.map((r) => [0, 1, 2, 3].map((j) => r[0] * A[j][0] + r[1] * A[j][1] + r[2] * A[j][2] + r[3] * A[j][3]));
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) N[i][j] += Kg[i] * R * Kg[j];
    // 대칭화 (반올림 누적 방지)
    for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) { const m = (N[i][j] + N[j][i]) / 2; N[i][j] = m; N[j][i] = m; }
    this.P = N;
    return { used: true, nis, innov };
  }

  /** θ 측정 (카메라) */
  updateBearing(pose: Pose, theta: number, sigma: number): UpdateResult {
    const r = this.relative(pose);
    const rho2 = Math.max(1e-4, r.xr * r.xr + r.yr * r.yr);
    const c = Math.cos(pose.psi), sn = Math.sin(pose.psi);
    const H: [number, number] = [(r.yr * c - r.xr * sn) / rho2, -(r.yr * sn + r.xr * c) / rho2];
    const innov = Math.atan2(Math.sin(theta - r.theta), Math.cos(theta - r.theta));
    return this.scalarUpdate(innov, H, sigma * sigma);
  }

  /** 거리 측정 (줄 L + T/k, 또는 카메라 박스) */
  updateRange(pose: Pose, d: number, sigma: number, gate?: number): UpdateResult {
    const r = this.relative(pose);
    const H: [number, number] = [r.ex / r.rho, r.ey / r.rho];
    return this.scalarUpdate(d - r.rho, H, sigma * sigma, gate);
  }

  /**
   * 부등식 제약 d ≤ L (줄이 느슨해도 강아지가 줄 길이보다 멀 수는 없다).
   * 추정이 제약을 넘으면 경계 d = L 로 투영하는 가상 측정을 넣는다 (제약 칼만 필터의 투영법).
   */
  constrainMaxRange(pose: Pose, Lmax: number, sigma: number) {
    const r = this.relative(pose);
    if (r.rho <= Lmax) return false;
    this.updateRange(pose, Lmax, sigma, Infinity);
    return true;
  }

  /** 위치 1σ 오차 타원 (오도메트리 좌표). 고유값 분해 — 2×2 대칭행렬 닫힌 해 */
  ellipse() {
    const a = this.P[0][0], b = this.P[0][1], d = this.P[1][1];
    const tr = (a + d) / 2, det = Math.sqrt(Math.max(0, ((a - d) / 2) ** 2 + b * b));
    const l1 = tr + det, l2 = Math.max(0, tr - det);
    const ang = Math.atan2(l1 - a, b || 1e-12); // 장축 방향 (x축 기준)
    return { major: Math.sqrt(l1), minor: Math.sqrt(l2), angle: b === 0 && a >= d ? 0 : b === 0 ? Math.PI / 2 : ang };
  }

  /** 위치 불확실성 크기 [m] — √(trace P_pos) */
  get sigmaPos() { return Math.sqrt(Math.max(0, this.P[0][0] + this.P[1][1])); }
}
