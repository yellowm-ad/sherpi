/**
 * 셰르피 수학 모델 — 입력 변수와 고정 상수 (SHERPY 7.3 기준 엔진)
 *
 * 기준: 「셰르피 공식 2.png」 SHERPY 7.3 | 변수에서 안전 판단까지 + sherpy-simulator.vercel.app
 * ⚠️ 로봇 쪽 robot/sherpy_core/params.py 와 반드시 같은 값이어야 한다 (scripts/verify-math 가 대조).
 */

/** 우리가 정해야 하는 입력 변수 13개 — 기본값 ≠ 실측 확정값 (측정·부품 사양·실험으로 확인 필요) */
export interface SimParams {
  // 속도·거리
  dogSpeed: number;   // 강아지 목표속도 m/s
  robotMax: number;   // 로봇 최대속도 m/s
  followDist: number; // 목표 추종거리 m
  reelMax: number;    // 릴 최대 인출길이 m
  // 힘·관성
  dogMass: number;    // 강아지 질량 kg
  pullForce: number;  // 급당김 추가 힘 N
  stiffness: number;  // 줄 등가 강성 N/m
  // 제어·센서
  steerMax: number;   // 최대 조향각 °
  tau: number;        // 장력 필터 시정수 s
  noise: number;      // 로드셀 잡음 진폭 N
  // 안전 기준
  warn: number;       // L2 경고 장력 N
  stop: number;       // L3 정지 장력 N
  clearance: number;  // 장애물 안전 여유 m
}

export const DEFAULT_PARAMS: SimParams = {
  dogSpeed: 0.48, robotMax: 0.8, followDist: 1.6, reelMax: 3,
  dogMass: 15, pullForce: 30, stiffness: 550,
  steerMax: 35, tau: 0.2, noise: 0.8,
  warn: 16, stop: 35, clearance: 0.2,
};

/** 슬라이더 범위 — [키, 이름, 최소, 최대, 간격, 단위, 묶음] */
export const PARAM_SPECS: [keyof SimParams, string, number, number, number, string, string][] = [
  ["dogSpeed", "강아지 목표속도", 0.2, 0.9, 0.01, "m/s", "속도·거리"],
  ["robotMax", "로봇 최대속도", 0.3, 1.2, 0.01, "m/s", "속도·거리"],
  ["followDist", "목표 추종거리", 1, 2, 0.05, "m", "속도·거리"],
  ["reelMax", "릴 최대 인출길이", 2.1, 5, 0.1, "m", "속도·거리"],
  ["dogMass", "강아지 질량", 5, 30, 1, "kg", "힘·관성"],
  ["pullForce", "급당김 추가 추진력", 0, 100, 1, "N", "힘·관성"],
  ["stiffness", "리드줄 등가 강성", 150, 1200, 10, "N/m", "힘·관성"],
  ["steerMax", "최대 조향각", 10, 45, 1, "°", "제어·센서"],
  ["tau", "장력 필터 시정수", 0.05, 1, 0.05, "s", "제어·센서"],
  ["noise", "로드셀 잡음 진폭", 0, 5, 0.1, "N", "제어·센서"],
  ["warn", "장력 경고값 L2", 5, 60, 1, "N", "안전 기준"],
  ["stop", "장력 정지값 L3", 10, 100, 1, "N", "안전 기준"],
  ["clearance", "장애물 안전 여유", 0, 0.6, 0.01, "m", "안전 기준"],
];

/** 7.3 엔진 고정 상수 — 식 안에 숫자로 박혀 있던 값에 이름을 붙였다 */
export const K = {
  DT: 0.04,            // s — 0.04초마다 반복 (25 Hz)
  FRAMES: 1000,        // 40초 → 1,001 프레임
  WHEELBASE: 0.35,     // m — ψ̇ = (v/0.35)·tanδ
  ACCEL: 0.85,         // m/s² 가속
  DECEL: 1.9,          // m/s² 감속
  STEER_GAIN: 1.4,     // δ = 1.4·θ
  FOLLOW_GAIN: 1.2,    // v = dogSpeed + 1.2(d − followDist)
  WARN_SPEED: 0.2,     // m/s — L2 명령속도 상한
  REEL_MIN: 1.2,       // m — 릴 최소 인출길이
  REEL_SLACK: 0.04,    // m — L목표 = d + 0.04
  REEL_OUT: 0.65,      // m/s — 인출 속도 한계
  REEL_IN: 0.5,        // m/s — 회수 속도 한계
  ROPE_DAMP: 12,       // N·s/m — 12·max(0, v_r)
  DOG_DAMP: 2.2,       // N·s/m — 강아지 감쇠
  DOG_GAIN: 3,         // 강아지 추진 이득 (m·3)
  DOG_FWD_MAX: 85,     // N
  DOG_LAT_MAX: 65,     // N
  DOG_V_MAX: 1.5,      // m/s
  DOG_LAT_GAIN: 1.6,
  DOG_LAT_V: 0.7,
  ROBOT_HALF_W: 0.23,  // m — 차체 반폭(장애물·경계)
  DOG_HALF_W: 0.15,
  ENCODER_STUCK_FRAMES: 25,
  FAULT_T: 14,         // s — 고장 주입 시각
  PULL_T0: 12, PULL_T1: 22, PULL_DV: 0.35,
} as const;

export type EnvKey = "park" | "walk" | "narrow" | "dense";
export type ScenarioKey = "normal" | "pull" | "opposite" | "load" | "encoder" | "camera";
export interface Obstacle { x: number; y: number; r: number }
export interface Env { half: number; curve: number; obs: Obstacle[] }

export const ENVS: Record<EnvKey, Env> = {
  park:   { half: 3.4,  curve: 0.45, obs: [{ x: -1.6, y: 6, r: 0.3 }] },
  walk:   { half: 1.5,  curve: 0.22, obs: [{ x: -1.15, y: 6, r: 0.22 }] },
  narrow: { half: 0.95, curve: 0.1,  obs: [{ x: -0.73, y: 6, r: 0.17 }] },
  dense:  { half: 2.6,  curve: 0.7,  obs: [{ x: -1.5, y: 5, r: 0.32 }, { x: 1.65, y: 10, r: 0.36 }, { x: -1.35, y: 15, r: 0.25 }] },
};

export const ENV_LABEL: Record<EnvKey, string> = {
  park: "개방형 공원", walk: "일반 보행로", narrow: "협소 통로", dense: "장애물 밀집 구역",
};
export const SCENARIO_LABEL: Record<ScenarioKey, string> = {
  normal: "정상 산책", pull: "강아지 급당김", opposite: "장애물 반대 방향 회피",
  load: "로드셀 신호 단절", encoder: "엔코더 고착", camera: "카메라 추적 실패",
};

/* ──────────────────────────────────────────────────────────────
 * 하드웨어 모델 — 실전 모드(센서 융합)에서 쓰는 부품 상수.
 * 실측 전 가정값. 부품이 확정되면 여기만 바꾼다.
 * ────────────────────────────────────────────────────────────── */
export interface HwParams {
  // ① 로드셀 + HX711 — 원시값 X[count] → T = aX + b
  lcGain: number;       // N/count (참값 a)
  lcOffset: number;     // N (참값 b — 영점)
  lcCountNoise: number; // count (1σ 백색잡음)
  lcDrift: number;      // N/s 영점 드리프트
  lcTimeout: number;    // s — 새 샘플 없음 → 신호 단절 판정
  // ② 릴 + AS5600 — 12bit 회전각 → 겹감김 반경 모델 → L
  reelCore: number;     // m 드럼 심 반경 r0
  ropeThick: number;    // m 줄 두께 t
  drumWidth: number;    // m 드럼 폭 w
  ropeTotal: number;    // m 드럼에 감긴 전체 줄
  encNoiseLsb: number;  // LSB (1σ)
  encResidualTol: number; // m — 지령 적분과 측정의 허용 차이
  // ③ 카메라 — 핀홀 + 방사 왜곡
  camW: number;         // px
  camFx: number;        // px 가로 초점거리
  camFy: number;
  camCx: number;        // px 주점 (참값)
  camK1: number;        // 방사 왜곡 계수
  camYaw: number;       // rad 장착 요(참값)
  camYawEst: number;    // rad 보정으로 추정한 장착 요
  camPxNoise: number;   // px 검출 중심 흔들림 1σ
  camHNoise: number;    // 비율 — 박스 높이 흔들림 1σ
  camDrop: number;      // 프레임당 검출 누락 확률
  camLostHold: number;  // s — 이 시간 넘게 못 보면 추적 실패
  dogHeight: number;    // m 강아지 어깨높이 (프로필)
  // 오도메트리
  odoSpeedNoise: number; // 비율
  gyroNoise: number;     // rad/s
}

export const DEFAULT_HW: HwParams = {
  lcGain: 1.2e-3, lcOffset: -0.35, lcCountNoise: 180, lcDrift: 0.004, lcTimeout: 0.2,
  reelCore: 0.025, ropeThick: 0.003, drumWidth: 0.03, ropeTotal: 5, encNoiseLsb: 0.6, encResidualTol: 0.15,
  camW: 640, camFx: 300, camFy: 300, camCx: 324, camK1: -0.08, camYaw: 0.026, camYawEst: 0.022,
  camPxNoise: 2.5, camHNoise: 0.05, camDrop: 0.03, camLostHold: 0.5, dogHeight: 0.45,
  odoSpeedNoise: 0.02, gyroNoise: 0.01,
};
