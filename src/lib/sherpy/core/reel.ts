/**
 * ② 릴 인출길이 L — AS5600 회전각 → 겹감김 반경 모델 → 길이
 *
 * 공식 1 의 근사식  L ≈ L0 + Σ r_eff,i Δφ_i  는 반경이 바뀔 때마다 오차가 쌓인다.
 * 줄이 드럼에 층층이 감기면 단면적이 보존된다는 사실로 닫힌 해를 얻는다.
 *
 *   드럼에 감긴 줄 길이 Lw = Ltot − L,  줄 두께 t, 드럼 폭 w, 심 반경 r0
 *   감긴 단면적:  π(r² − r0²)·w = Lw·t²       →  r(L)² = r0² + c·(Ltot − L),   c = t²/(πw)
 *   줄이 풀리는 속도:  dL = r(L)·dφ
 *   변수분리 적분:  ∫ dL / √(r0² + c(Ltot − L)) = ∫ dφ
 *              ⇒  φ − φ0 = (2/c)·[r(L0) − r(L)]
 *   역함수:      r(L) = r(L0) − (c/2)(φ − φ0),   L = Ltot − (r(L)² − r0²)/c
 *
 * 즉 누적 회전각 하나만 알면 L 이 정확히 나온다 (Σ 근사 불필요, 적분 오차 0).
 * 반경이 일정하다고 보면(L = L0 + r·Δφ) 다 풀었을 때 수십 cm 가 틀린다 — reelConstRadiusError 참고.
 */
export interface ReelGeom { r0: number; t: number; w: number; Ltot: number }

export const reelC = (g: ReelGeom) => (g.t * g.t) / (Math.PI * g.w);
export const reelRadius = (g: ReelGeom, L: number) => Math.sqrt(g.r0 * g.r0 + reelC(g) * Math.max(0, g.Ltot - L));

/** 인출 L0 → L 까지 드럼 회전각 [rad] (인출 방향 +) */
export const reelPhi = (g: ReelGeom, L0: number, L: number) => (2 / reelC(g)) * (reelRadius(g, L0) - reelRadius(g, L));

/** 누적 회전각 φ [rad] 로부터 L */
export function reelLength(g: ReelGeom, L0: number, phi: number) {
  const c = reelC(g);
  const r = Math.max(g.r0, reelRadius(g, L0) - (c / 2) * phi);
  return g.Ltot - (r * r - g.r0 * g.r0) / c;
}

/** 반경 일정 가정(공식 1 의 L = L0 + r(φ−φ0))의 오차 [m] — 반경을 L0 위치 값으로 고정했을 때 */
export function reelConstRadiusError(g: ReelGeom, L0: number, L: number) {
  const phi = reelPhi(g, L0, L);
  return L0 + reelRadius(g, L0) * phi - L;
}

/**
 * AS5600 (12bit, 0~4095) 누적 오도메트리.
 * 언랩: Δ = ((raw − prev + 2048) mod 4096) − 2048  → (−2048, 2048] count
 * 조건(표본화 정리와 같은 꼴): 한 주기 동안 드럼이 반 바퀴 미만 돌아야 방향을 헷갈리지 않는다.
 *   f_s > 2·ω_max/(2π) = 2·v_max/(2π·r_min)
 *   v 0.65 m/s, r0 25 mm → 4.1 rev/s → f_s > 8.3 Hz (25 Hz 로 3배 여유)
 *
 * 고착 판정: 정상 AS5600 은 ±1 LSB 떨림이 있어 값이 25프레임 연속 똑같을 확률이 사실상 0 이다.
 * (I²C 가 멈추면 드라이버가 마지막 값을 계속 돌려준다) → 동일값 연속 횟수로 고착을 잡는다.
 * 다만 AS5600 HYST 레지스터를 켜면 정지 시 값이 고정되므로 HYST=0 으로 설정할 것.
 */
export class ReelOdometer {
  private prev: number | null = null;
  phi = 0;           // 누적 회전각 rad
  sameCount = 0;     // 동일 원시값 연속 횟수
  constructor(public geom: ReelGeom, public L0: number) {}

  /** raw: 0~4095 또는 null(읽기 실패). 반환: L [m] */
  update(raw: number | null): number {
    if (raw !== null) {
      if (this.prev !== null) {
        const d = ((((raw - this.prev + 2048) % 4096) + 4096) % 4096) - 2048;
        this.phi += (d * 2 * Math.PI) / 4096;
        this.sameCount = raw === this.prev ? this.sameCount + 1 : 0;
      }
      this.prev = raw;
    }
    return this.length;
  }
  get length() { return reelLength(this.geom, this.L0, this.phi); }
}

/** 시뮬레이터용: L → AS5600 원시값 (참 회전각을 12bit 로 양자화) */
export function reelRawCount(g: ReelGeom, L0: number, L: number, phi0Count = 1234) {
  const phi = reelPhi(g, L0, L);
  return (((Math.round(phi0Count + (phi * 4096) / (2 * Math.PI))) % 4096) + 4096) % 4096;
}
