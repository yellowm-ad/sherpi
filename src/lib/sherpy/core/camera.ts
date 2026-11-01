/**
 * ③ 방향각 θ — 카메라 검출 픽셀 → 왜곡 보정 → 장착각 보정 → 로봇 기준 각도
 *
 * 핀홀 + 1차 방사 왜곡(가로 한 축):
 *   정규 좌표 x_n = tan(θ_c),  왜곡 x_d = x_n(1 + k1·x_n²),  픽셀 u = c_x + f_x·x_d
 * 역변환(왜곡 보정): x_n 은 3차 방정식의 해라서 뉴턴법으로 푼다
 *   g(x) = x + k1x³ − x_d = 0,   x ← x − g(x)/(1 + 3k1x²)   (3~4회면 1e-12 수렴)
 * 로봇 기준 방향각:  θ = atan(x_n) + ψ_cam   (ψ_cam = 카메라 장착 요 — 정렬 오차)
 *   공식 1 의 θ ≈ atan((u − c_x)/f_x) 는 k1 = 0, ψ_cam = 0 인 특수해다.
 *
 * 거리(보조):  강아지 어깨높이 H 를 알면 박스 높이 h 로  Z = f_y·H/h,  d = Z / cos θ_c
 *   단안 거리 오차는 거리의 제곱에 비례해 커진다:  σ_d ≈ d·(σ_h/h) → 5~6% — 줄 측정보다 10배 나쁨.
 *   그래서 거리는 줄(L + T/k)이 주 센서, 카메라 거리는 줄 걸림을 잡는 교차검증용이다.
 */
export interface CamModel { fx: number; fy: number; cx: number; k1: number; yaw: number; W: number }

export function undistortX(xd: number, k1: number) {
  let x = xd;
  for (let i = 0; i < 6; i++) {
    const g = x + k1 * x * x * x - xd;
    const dg = 1 + 3 * k1 * x * x;
    x -= g / dg;
  }
  return x;
}

/** 픽셀 u → 로봇 기준 θ [rad] (+ = 오른쪽) */
export function bearingFromPixel(cam: CamModel, u: number) {
  const xd = (u - cam.cx) / cam.fx;
  return Math.atan(undistortX(xd, cam.k1)) + cam.yaw;
}

/** 박스 높이 h [px] → 거리 d [m] */
export function rangeFromBox(cam: CamModel, h: number, dogHeight: number, theta: number) {
  const thc = theta - cam.yaw;
  return (cam.fy * dogHeight) / Math.max(1, h) / Math.max(0.2, Math.cos(thc));
}

/** 시뮬레이터용 정방향 투영. 화면 밖이면 null */
export function project(cam: CamModel, theta: number, d: number, dogHeight: number): { u: number; h: number } | null {
  const thc = theta - cam.yaw;
  if (Math.abs(thc) > Math.PI / 2 - 0.05) return null;
  const xn = Math.tan(thc);
  // 왜곡 다항식이 단조인 구간(|x_n| < 1/√(3|k1|))만 유효 — 그 밖은 렌즈 화각 밖
  if (cam.k1 < 0 && Math.abs(xn) >= 1 / Math.sqrt(-3 * cam.k1)) return null;
  const u = cam.cx + cam.fx * xn * (1 + cam.k1 * xn * xn);
  if (u < 0 || u > cam.W) return null;
  const Z = d * Math.cos(thc);
  return { u, h: (cam.fy * dogHeight) / Math.max(0.05, Z) };
}

/** 화각(가로) [rad] — 왜곡 포함, 화면 끝 픽셀의 각도로 계산 */
export function horizontalFov(cam: CamModel) {
  return bearingFromPixel({ ...cam, yaw: 0 }, cam.W) - bearingFromPixel({ ...cam, yaw: 0 }, 0);
}
