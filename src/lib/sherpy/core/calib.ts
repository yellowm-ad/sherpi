/**
 * ① 장력 T — 로드셀 + HX711 선형 보정
 *
 *   기준 힘 F_i = m_i·g,  장력 T = aX + b
 *   최소제곱:  min Σ [F_i − (aX_i + b)]²
 *   정규방정식 해:  a = (nΣXF − ΣXΣF) / (nΣX² − (ΣX)²),  b = (ΣF − aΣX) / n
 *
 * 수치 안정성: HX711 원시값은 수만~수십만 count 라 ΣX² 가 커서 소거 오차가 난다.
 * 평균을 빼고(중심화) 계산한다 — 결과는 같고 오차만 줄어든다.
 */
export const G = 9.80665;

export interface LinearFit {
  a: number;     // N/count
  b: number;     // N
  r2: number;    // 결정계수
  rmse: number;  // N — 잔차 제곱평균제곱근
  n: number;
  /** 기울기 a 의 표준오차 — 하중 점이 적거나 퍼져 있지 않으면 커진다 */
  seA: number;
}

export function fitLinear(X: number[], F: number[]): LinearFit {
  const n = X.length;
  if (n < 2 || F.length !== n) throw new Error("보정 점이 2개 이상 필요");
  const mx = X.reduce((s, v) => s + v, 0) / n;
  const mf = F.reduce((s, v) => s + v, 0) / n;
  let sxx = 0, sxf = 0, sff = 0;
  for (let i = 0; i < n; i++) {
    const dx = X[i] - mx, df = F[i] - mf;
    sxx += dx * dx; sxf += dx * df; sff += df * df;
  }
  if (sxx === 0) throw new Error("원시값이 모두 같음 — 하중을 바꿔 측정할 것");
  const a = sxf / sxx;
  const b = mf - a * mx;
  let sse = 0;
  for (let i = 0; i < n; i++) { const e = F[i] - (a * X[i] + b); sse += e * e; }
  const r2 = sff ? 1 - sse / sff : 1;
  const rmse = Math.sqrt(sse / n);
  const seA = n > 2 ? Math.sqrt(sse / (n - 2) / sxx) : 0;
  return { a, b, r2, rmse, n, seA };
}

/** 보정 결과로 원시값 → 장력 [N] */
export const countsToNewton = (fit: Pick<LinearFit, "a" | "b">, X: number) => fit.a * X + fit.b;

/**
 * 1차 저역통과(지수평활) — 7.3: α = 1 − exp(−dt / max(0.025, τ)),  F̂ ← F̂ + α(z − F̂)
 * 연속시간 dF̂/dt = (z − F̂)/τ 를 정확히 이산화한 식이다 (오일러 근사 α = dt/τ 가 아님).
 * 계단 입력에 대한 63% 도달 시간 = τ, 95% = 3τ → 잡음 억제 ↔ 위험 감지 지연의 교환.
 */
export function lowpassAlpha(dt: number, tau: number) {
  return 1 - Math.exp(-dt / Math.max(0.025, tau));
}
