import { z } from "zod";

/** 로봇 → 서버 텔레메트리 (1Hz) */
export const TelemetrySchema = z.object({
  ts: z.string().datetime(),
  mode: z.enum(["idle", "teach", "follow", "estop"]),
  safety_level: z.number().int().min(0).max(3),
  faults: z.array(z.string()).default([]),

  tension_n: z.number().nullable().optional(),
  leash_len_m: z.number().nullable().optional(),
  speed_cmd: z.number().nullable().optional(),
  steer_cmd: z.number().min(-1).max(1).nullable().optional(),

  lat: z.number().nullable().optional(),
  lng: z.number().nullable().optional(),
  gps_src: z.enum(["phone", "robot"]).nullable().optional(),
  // 로봇 GPS (robot/bridge/gps.py) — 실측 지면속도·방위·위성 수
  speed_mps: z.number().min(0).nullable().optional(),
  heading_deg: z.number().min(0).max(360).nullable().optional(),
  gps_sats: z.number().int().min(0).nullable().optional(),

  route_id: z.number().int().nullable().optional(),
  kf_index: z.number().int().nullable().optional(),
  kf_total: z.number().int().nullable().optional(),
  match_quality: z.number().min(0).max(1).nullable().optional(),

  battery_v: z.number().nullable().optional(),

  // 강아지 위치 추정 (robot/sherpy_core — 2026-11-01) : θ·d 는 로봇 기준, 지도 위치는 앱이 GPS+방위로 계산
  dog_bearing_deg: z.number().min(-180).max(180).nullable().optional(), // θ (+ = 오른쪽)
  dog_dist_m: z.number().min(0).max(20).nullable().optional(),          // d̂
  dog_sigma_m: z.number().min(0).max(50).nullable().optional(),         // 위치 1σ
  dog_track: z.enum(["ok", "coast", "lost"]).nullable().optional(),
  tension_filt_n: z.number().nullable().optional(),                     // F̂ (안전 판단에 쓴 필터 장력)
});
export type Telemetry = z.infer<typeof TelemetrySchema>;

/** 앱 → 로봇 명령 */
export const COMMAND_TYPES = [
  "ESTOP",
  "START_TEACH",
  "STOP_TEACH",
  "START_FOLLOW",
  "PAUSE",
  "RESUME",
  "SET_ROUTE",
  "SET_SPEED_LIMIT",
] as const;

export const CommandSchema = z.object({
  type: z.enum(COMMAND_TYPES),
  payload: z.record(z.unknown()).default({}),
});
export type CommandType = (typeof COMMAND_TYPES)[number];

/**
 * 안전 임계값 — SHERPY 7.3 기준 엔진 (2026-11-01 갱신, 이전 8/30/40 N·5 m 폐기)
 * robot/bridge/config.py · robot/sherpy_core/params.py 와 반드시 동일하게 유지할 것.
 * 단계: L1 주의(표시만) F̂ ≥ F_CAUTION · L2 경고(≤0.2 m/s) F̂ ≥ F_WARN · L3 HOLD F̂ ≥ F_STOP
 */
export const THRESHOLDS = {
  F_CAUTION: 8.0, // N — L1 주의 표시 (= warn/2, 제어 영향 없음)
  F_WARN: 16.0,   // N — L2 경고: 명령속도 ≤ 0.2 m/s, pull_count 집계 기준
  F_STOP: 35.0,   // N — L3 정지: HOLD 래치 (자동 복귀 없음)
  L_MIN: 1.2,     // m — 릴 최소 인출길이
  L_SOFT: 2.76,   // m — 릴 인출 한계 근접 (0.92 × L_MAX)
  L_MAX: 3.0,     // m — 릴 최대 인출길이 (reelMax)
  KF_MIN_QUALITY: 0.5, // 매칭 신뢰도 하한
} as const;

export const SAFETY_LABEL = ["정상", "주의", "경고", "정지"] as const;
export const SAFETY_COLOR = [
  "var(--color-level-0)",
  "var(--color-level-1)",
  "var(--color-level-2)",
  "var(--color-level-3)",
] as const;

/** 고장 코드 — walkbot/safety.py 와 동일 */
export const FAULT_LABEL: Record<string, string> = {
  F1: "로드셀/HX711 응답 없음",
  F2: "AS5600 자석 이탈 또는 I2C 오류",
  F3: "카메라 프레임 끊김",
  F4: "경로 매칭 실패 (신뢰도 저하)",
  F5: "전원 이상",
  F6: "구동부 걸림 (장력 유지·줄 변화 없음·속도 0)",
  F7: "리드줄 걸림 의심 (줄 길이 ≠ 실제 거리)",
  F8: "강아지 추적 실패 (카메라 0.5초 이상 미검출)",
  TEST_MODE: "테스트 모드 — 센서 없이 가짜 값 전송 중",
};
