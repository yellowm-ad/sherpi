/**
 * 페일세이프 판단 — 추정값 + 센서 건강 상태 → 안전 단계 L0~L3
 *
 *  L0 정상 추종
 *  L1 주의   (표시만, 제어 영향 없음) — 카메라 일시 가림, 장력 경고의 절반, 릴 거의 다 풀림, 위치 불확실
 *  L2 경고   F̂ ≥ warn → 명령속도 ≤ 0.2 m/s.  히스테리시스: F̂ < warn − 2 N 이 돼야 해제 (경계에서 깜빡임 방지)
 *  L3 정지   HOLD 래치 → 속도 0, 릴 인출 금지. **자동 복귀 없음** — 원인이 사라진 뒤 사용자가 재개해야 풀린다.
 *
 * 원칙 (7.3 그대로):  warn < stop,  정지 명령 ≠ 즉시 정지(감속 1.9 m/s² 으로 멈춘다),
 *                     줄 간섭은 기하 판정(감김·마찰 해석 아님).
 * 7.3 대비 추가: 센서 신호는 "한 프레임 끊김"이 아니라 시간 기준으로 판정한다(가림·순간 누락에 L3 남발 방지),
 *                엔코더 고착은 동일값 연속 + 지령 대비 잔차 두 가지로 잡는다(원본은 주입 시점을 알고 셌다),
 *                줄 걸림은 지도 없이도 "줄 거리 − 카메라 거리" 잔차로 잡는다.
 */
export type Level = 0 | 1 | 2 | 3;

export interface SafetyInput {
  t: number;
  Thead: number;            // N 필터 장력
  loadAge: number;          // s 마지막 정상 로드셀 샘플 이후
  encFrozen: number;        // 프레임 — 동일 원시값 연속
  encResidual: number;      // m — 25프레임 창의 |지령 적분 − 측정|
  camAge: number;           // s 마지막 유효 검출 이후
  sigmaPos: number;         // m 강아지 위치 1σ
  snag: boolean;            // 줄 걸림 의심 (잔차)
  reel: number;             // m
  geom: { body: number; rope: number; robotEdge: number; dogEdge: number } | null;
  /** 예측 경고용 변화율 (predict 켤 때만) — 필터 장력의 기울기 dT̂/dt [N/s], 인출 속도 dL/dt [m/s] */
  Tdot?: number;
  Ldot?: number;
  /** 엔코더 교차 확인 — 카메라 거리는 변하는데 L 이 그대로 (encCross 켤 때만) */
  encCam?: boolean;
}

export interface SafetyCfg {
  warn: number; stop: number; clearance: number; reelMax: number;
  lcTimeout: number; camLostHold: number; encFrames: number; encTol: number;
  /**
   * 예측 경고 (팀 보드 WARNING: "장력 급상승 · 리드 길이 급증").  지금 값이 아니라 '언제 넘을지'로 판단한다.
   *   장력 도달 시간   t_T = (stop − T̂) / (dT̂/dt)     (dT̂/dt > 0, T̂ ≥ warn/2)
   *   줄 끝 도달 시간  t_L = (reelMax − L) / (dL/dt)    (dL/dt > 0.2 m/s, L ≥ 0.6·reelMax)
   *   min(t_T, t_L) < horizon  →  L2 를 미리 켜고 holdFor 초 유지
   * horizon ≈ 제동시간 v/a + 지연 = 0.8/1.9 + 0.2 ≈ 0.6 s → 여유 두고 1.0 s
   */
  predict?: boolean;
  horizon?: number;
  holdFor?: number;
}

export interface SafetyOut { level: Level; hold: boolean; reason: string | null; notes: string[]; speedCap: number | null }

export class SafetySupervisor {
  hold = false;
  holdReason: string | null = null;
  holdAt: number | null = null;
  private warnOn = false;
  private predUntil = -1;
  private predReason: string | null = null;

  constructor(public cfg: SafetyCfg) {}

  /** 원인이 모두 사라졌을 때만 해제 가능. 해제 여부를 돌려준다 */
  tryReset(clear: boolean) {
    if (!clear) return false;
    this.hold = false; this.holdReason = null; this.holdAt = null;
    return true;
  }

  /** 지금 L3 원인이 있는가 (순서 = 보고 우선순위: 센서 → 기하 → 장력) */
  l3Cause(i: SafetyInput): string | null {
    const c = this.cfg;
    if (i.loadAge > c.lcTimeout) return "로드셀 신호 단절";
    if (i.camAge > c.camLostHold) return "카메라 추적 실패";
    if (i.encFrozen >= c.encFrames || i.encResidual > c.encTol || i.encCam) return "엔코더 고착";
    if (i.geom) {
      if (i.geom.body < c.clearance) return "차체 장애물 안전거리 부족";
      if (i.geom.rope < 0) return "리드줄이 장애물에 걸림";
      if (i.geom.robotEdge < 0 || i.geom.dogEdge < 0) return "환경 경계 이탈";
    }
    if (i.snag) return "리드줄 걸림 의심 (줄 길이 ≠ 실제 거리)";
    if (i.Thead >= c.stop) return "장력 정지 임계값 초과";
    return null;
  }

  step(i: SafetyInput): SafetyOut {
    const c = this.cfg;
    const cause = this.l3Cause(i);
    if (!this.hold && cause) { this.hold = true; this.holdReason = cause; this.holdAt = i.t; }

    if (this.warnOn) { if (i.Thead < c.warn - 2) this.warnOn = false; }
    else if (i.Thead >= c.warn) this.warnOn = true;

    if (c.predict) {
      const H = c.horizon ?? 1.0;
      const Td = i.Tdot ?? 0, Ld = i.Ldot ?? 0;
      const tT = Td > 0.5 && i.Thead >= c.warn / 2 ? (c.stop - i.Thead) / Td : Infinity;
      const tL = Ld > 0.2 && i.reel >= 0.6 * c.reelMax ? (c.reelMax - i.reel) / Ld : Infinity;
      if (Math.min(tT, tL) < H) {
        this.predUntil = i.t + (c.holdFor ?? 0.5);
        this.predReason = tT <= tL ? "장력 급상승 (정지값 도달 예상)" : "리드줄 끝 도달 예상";
      }
    }
    const predOn = i.t <= this.predUntil;

    const notes: string[] = [];
    if (i.camAge > 0.1 && i.camAge <= c.camLostHold) notes.push("카메라 일시 가림 — 예측으로 추적 중");
    if (i.Thead >= c.warn / 2 && !this.warnOn) notes.push("장력 상승");
    if (i.reel >= 0.92 * c.reelMax) notes.push("릴 인출 한계 근접");
    if (i.sigmaPos > 0.25) notes.push("강아지 위치 불확실");

    if (this.hold) return { level: 3, hold: true, reason: this.holdReason, notes, speedCap: 0 };
    if (this.warnOn) return { level: 2, hold: false, reason: "장력 경고", notes, speedCap: 0.2 };
    if (predOn) return { level: 2, hold: false, reason: this.predReason, notes, speedCap: 0.2 };
    return { level: notes.length ? 1 : 0, hold: false, reason: null, notes, speedCap: null };
  }
}
