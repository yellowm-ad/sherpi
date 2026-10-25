import {
  pgSchema, serial, bigserial, integer, text, varchar, timestamp,
  doublePrecision, boolean, jsonb, index, uniqueIndex, primaryKey,
} from "drizzle-orm/pg-core";

/**
 * 모든 테이블은 Postgres 스키마 "sherpy" 안에 만든다.
 * 같은 Neon DB를 먹메이트(public 스키마)와 같이 써도 테이블 이름이 겹치지 않는다.
 * drizzle.config.ts 의 schemaFilter 로 public 은 절대 건드리지 않는다.
 */
export const sherpy = pgSchema("sherpy");

/* ── 계정 ─────────────────────────────────────
   먹메이트와 동일 정책: 아이디 10자 / 비밀번호 16자, 외부 본인인증 없음 */
export const users = sherpy.table("users", {
  id: serial("id").primaryKey(),
  username: varchar("username", { length: 10 }).notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  nickname: varchar("nickname", { length: 20 }).notNull(),
  avatarUrl: text("avatar_url"),
  role: varchar("role", { length: 10 }).notNull().default("USER"),                 // USER | ADMIN
  accountStatus: varchar("account_status", { length: 10 }).notNull().default("ACTIVE"), // ACTIVE | SUSPENDED
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

/* ── 반려견 ──────────────────────────────────── */
export const dogs = sherpy.table("dogs", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  name: varchar("name", { length: 20 }).notNull(),
  breed: varchar("breed", { length: 40 }),
  weightKg: doublePrecision("weight_kg"),
  birthDate: timestamp("birth_date", { withTimezone: false }),
  photoUrl: text("photo_url"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

/* ── 로봇 ────────────────────────────────────── */
export const robots = sherpy.table("robots", {
  id: serial("id").primaryKey(),
  ownerId: integer("owner_id").notNull().references(() => users.id),
  serial: varchar("serial", { length: 40 }).notNull().unique(),
  name: varchar("name", { length: 20 }).notNull().default("셰르피"),
  apiKeyHash: text("api_key_hash").notNull(),      // 평문 저장 금지
  pairingCode: varchar("pairing_code", { length: 8 }),
  fwVersion: varchar("fw_version", { length: 20 }),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

/* ── 텔레메트리 (시계열, 1Hz) ───────────────────
   7일 경과분은 주기 삭제 — Neon 용량 관리 */
export const robotTelemetry = sherpy.table("robot_telemetry", {
  id: serial("id").primaryKey(),
  robotId: integer("robot_id").notNull().references(() => robots.id),
  ts: timestamp("ts", { withTimezone: true }).notNull(),

  mode: varchar("mode", { length: 10 }).notNull(),           // idle|teach|follow|estop
  safetyLevel: integer("safety_level").notNull().default(0), // 0~3
  faults: jsonb("faults").$type<string[]>().default([]),     // ["F2","F5"]

  tensionN: doublePrecision("tension_n"),      // 로드셀 SBA-50L
  leashLenM: doublePrecision("leash_len_m"),   // AS5600 회전각 환산
  speedCmd: doublePrecision("speed_cmd"),
  steerCmd: doublePrecision("steer_cmd"),      // -1(좌) ~ +1(우)

  lat: doublePrecision("lat"),
  lng: doublePrecision("lng"),
  gpsSrc: varchar("gps_src", { length: 8 }),   // phone|robot
  speedMps: doublePrecision("speed_mps"),      // GPS 실측 지면속도 (speedCmd 는 지령값)
  headingDeg: doublePrecision("heading_deg"),  // GPS 진행 방위 (0=북, 시계방향)
  gpsSats: integer("gps_sats"),                // 잡힌 위성 수 — 0이면 측위 실패

  routeId: integer("route_id"),
  kfIndex: integer("kf_index"),
  kfTotal: integer("kf_total"),
  matchQuality: doublePrecision("match_quality"),

  batteryV: doublePrecision("battery_v"),      // ADC 미장착 시 null
}, (t) => [index("idx_telemetry_robot_ts").on(t.robotId, t.ts)]);

/* ── 명령 큐 ──────────────────────────────────
   pending → sent → acked | expired(10초 무응답) */
export const robotCommands = sherpy.table("robot_commands", {
  id: serial("id").primaryKey(),
  robotId: integer("robot_id").notNull().references(() => robots.id),
  issuedBy: integer("issued_by").references(() => users.id),
  type: varchar("type", { length: 20 }).notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().default({}),
  status: varchar("status", { length: 10 }).notNull().default("pending"),
  issuedAt: timestamp("issued_at", { withTimezone: true }).defaultNow().notNull(),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  ackedAt: timestamp("acked_at", { withTimezone: true }),
}, (t) => [index("idx_cmd_robot_status").on(t.robotId, t.status, t.issuedAt)]);

/* ── 코스 ────────────────────────────────────── */
export const routes = sherpy.table("routes", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  name: varchar("name", { length: 40 }).notNull(),
  description: text("description"),
  distanceM: integer("distance_m"),
  estDurationS: integer("est_duration_s"),
  difficulty: varchar("difficulty", { length: 10 }),  // easy|normal|hard
  isPublic: boolean("is_public").notNull().default(false),
  taught: boolean("taught").notNull().default(false),     // 셰르피 티칭 완료 여부
  keyframes: integer("keyframes").notNull().default(0),
  likeCount: integer("like_count").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export const routePoints = sherpy.table("route_points", {
  id: serial("id").primaryKey(),
  routeId: integer("route_id").notNull().references(() => routes.id),
  seq: integer("seq").notNull(),
  lat: doublePrecision("lat").notNull(),
  lng: doublePrecision("lng").notNull(),
});

export const routePois = sherpy.table("route_pois", {
  id: serial("id").primaryKey(),
  routeId: integer("route_id").notNull().references(() => routes.id),
  type: varchar("type", { length: 20 }).notNull(), // water|poopbag|shade|caution|petfriendly
  lat: doublePrecision("lat").notNull(),
  lng: doublePrecision("lng").notNull(),
  label: varchar("label", { length: 30 }),
});

export const routeLikes = sherpy.table("route_likes", {
  routeId: integer("route_id").notNull().references(() => routes.id),
  userId: integer("user_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [primaryKey({ columns: [t.routeId, t.userId] })]);

/* ── 산책 기록 ───────────────────────────────── */
export const walks = sherpy.table("walks", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  dogId: integer("dog_id").references(() => dogs.id),
  robotId: integer("robot_id").references(() => robots.id),
  routeId: integer("route_id").references(() => routes.id),

  startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
  endedAt: timestamp("ended_at", { withTimezone: true }),

  distanceM: integer("distance_m"),
  durationS: integer("duration_s"),
  avgSpeed: doublePrecision("avg_speed"),
  maxSpeed: doublePrecision("max_speed"),
  avgTensionN: doublePrecision("avg_tension_n"),
  maxTensionN: doublePrecision("max_tension_n"),
  pullCount: integer("pull_count").default(0),     // 장력 > F_HARD(30N) 횟수
  warningCount: integer("warning_count").default(0),

  path: jsonb("path").$type<[number, number][]>(),
  weatherSnapshot: jsonb("weather_snapshot").$type<Record<string, unknown>>(),
});

/* ── 커뮤니티 — 먹메이트 "음식 커뮤니티"와 같은 고정 오픈채팅방 방식 ──
   폴링 2.5초 + messages.id 커서 증분 조회. 삭제는 소프트(deleted_at)로
   "삭제된 메시지예요" 처리, 신고 시 메시지 스냅샷을 남긴다. */
export const chatRooms = sherpy.table("chat_rooms", {
  id: serial("id").primaryKey(),
  title: varchar("title", { length: 40 }).notNull().unique(),
  description: varchar("description", { length: 80 }),
  emoji: varchar("emoji", { length: 8 }),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const messages = sherpy.table("messages", {
  id: bigserial("id", { mode: "number" }).primaryKey(),    // 폴링 커서
  roomId: integer("room_id").notNull().references(() => chatRooms.id, { onDelete: "cascade" }),
  senderId: integer("sender_id").references(() => users.id), // SYSTEM 메시지는 NULL
  type: varchar("type", { length: 10 }).notNull().default("TEXT"), // TEXT | SYSTEM
  content: text("content").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (t) => [index("idx_messages_room").on(t.roomId, t.id)]);

export const reports = sherpy.table("reports", {
  id: serial("id").primaryKey(),
  reporterId: integer("reporter_id").notNull().references(() => users.id),
  reportedUserId: integer("reported_user_id").notNull().references(() => users.id),
  roomId: integer("room_id").references(() => chatRooms.id),
  messageId: integer("message_id"),
  reason: varchar("reason", { length: 20 }).notNull(),
  detail: text("detail"),
  messageContentSnapshot: text("message_content_snapshot"),
  status: varchar("status", { length: 12 }).notNull().default("PENDING"), // PENDING|RESOLVED|DISMISSED
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  handledAt: timestamp("handled_at", { withTimezone: true }),
}, (t) => [uniqueIndex("reports_reporter_message_key").on(t.reporterId, t.messageId)]);

/* ── 기상 캐시 (30분) ────────────────────────── */
export const weatherCache = sherpy.table("weather_cache", {
  nx: integer("nx").notNull(),
  ny: integer("ny").notNull(),
  baseDate: varchar("base_date", { length: 8 }).notNull(),
  baseTime: varchar("base_time", { length: 4 }).notNull(),
  payload: jsonb("payload").notNull(),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [primaryKey({ columns: [t.nx, t.ny, t.baseDate, t.baseTime] })]);

/* ── 명목상 기능 (P3) — UI + 시드 데이터만 ───── */
export const marketItems = sherpy.table("market_items", {
  id: serial("id").primaryKey(),
  title: varchar("title", { length: 60 }).notNull(),
  price: integer("price").notNull(),
  condition: varchar("condition", { length: 10 }),
  images: jsonb("images").$type<string[]>().default([]),
  status: varchar("status", { length: 10 }).notNull().default("onsale"),
});

export const crowdMock = sherpy.table("crowd_mock", {
  areaCode: varchar("area_code", { length: 20 }).primaryKey(),
  name: varchar("name", { length: 40 }).notNull(),
  level: integer("level").notNull(),   // 1 여유 / 2 보통 / 3 혼잡
  polygon: jsonb("polygon").$type<[number, number][]>(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});
