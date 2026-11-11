// 1회성 DB 초기화 — 코스 id 를 1001부터(앱 내장 코스 12·15·18과 겹치지 않게), 커뮤니티 고정방 시드.
// 실행: node scripts/db-init.mjs   (여러 번 실행해도 안전)
import { config } from "dotenv";
import { neon } from "@neondatabase/serverless";
config({ path: ".env.local" });
const sql = neon(process.env.DATABASE_URL);

const [{ max }] = await sql`select coalesce(max(id), 0)::int as max from sherpy.routes`;
if (max < 1000) await sql`select setval('sherpy.routes_id_seq', 1000, true)`;

// 2026-10-25 로봇 GPS 필드 (robot/bridge/gps.py) — 이미 있으면 그대로
await sql`alter table sherpy.robot_telemetry
            add column if not exists speed_mps double precision,
            add column if not exists heading_deg double precision,
            add column if not exists gps_sats integer`;

// 2026-11-01 강아지 위치 추정 + 필터 장력 (robot/sherpy_core) — 이미 있으면 그대로
await sql`alter table sherpy.robot_telemetry
            add column if not exists dog_bearing_deg double precision,
            add column if not exists dog_dist_m double precision,
            add column if not exists dog_sigma_m double precision,
            add column if not exists dog_track varchar(6),
            add column if not exists tension_filt_n double precision`;

// 2026-11-09 로봇 관리 화면 (robot/agent.py) — 상태 보고 + 영상 시청 비밀번호
await sql`alter table sherpy.robots
            add column if not exists stream_token varchar(64),
            add column if not exists health jsonb,
            add column if not exists health_at timestamptz`;

// 2026-11-11 자율주행 인식 테스트 (robot/bridge/vision.py) — 최신 결과 1건만 덮어쓴다
await sql`alter table sherpy.robots
            add column if not exists vision jsonb,
            add column if not exists vision_frame text,
            add column if not exists vision_at timestamptz`;

const rooms = [
  ["덕진공원 산책 메이트", "오늘 덕진공원 같이 걸을 분, 코스·시간 공유", "🌳", 1],
  ["셰르피 사용팁", "티칭·자동주행·장력 경고 노하우", "🤖", 2],
  ["우리 강아지 자랑", "산책 사진 말고 이야기로 자랑해요", "🐶", 3],
  ["질문 있어요", "로봇·산책·반려 생활 무엇이든", "🙋", 4],
];
for (const [title, description, emoji, sortOrder] of rooms) {
  await sql`insert into sherpy.chat_rooms (title, description, emoji, sort_order)
            values (${title}, ${description}, ${emoji}, ${sortOrder}) on conflict (title) do nothing`;
}
const [{ n }] = await sql`select count(*)::int n from sherpy.chat_rooms`;
console.log(`routes id seq ok · chat_rooms ${n}개`);
