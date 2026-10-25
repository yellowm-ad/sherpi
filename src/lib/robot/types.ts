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

/** walkbot/config.py 의 임계값과 반드시 동일하게 유지할 것 */
export const THRESHOLDS = {
  F_SOFT: 8.0,    // N — 감속 시작
  F_HARD: 30.0,   // N — 강한 견인, pull_count 집계 기준
  F_ESTOP: 40.0,  // N — 비상정지
  L_SOFT: 3.0,    // m — 줄 길이 경고
  L_HARD: 4.5,
  L_MAX: 5.0,
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
};
