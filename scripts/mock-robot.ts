/**
 * 모의 로봇 — 실제 로봇 없이 앱을 완성하기 위한 스크립트
 *
 * ★ PRD §13에서 가장 강조한 리스크 회피책이다.
 *   M2(로봇 연동)는 로봇 조립이 끝나야 검증되는데, 조립이 늦어지면
 *   앱 개발 전체가 멈춘다. 이 스크립트가 1Hz로 가짜 텔레메트리를 쏴서
 *   앱을 먼저 완성할 수 있게 한다.
 *
 * 사용법:
 *   1) npm run dev           (다른 터미널에서 Next 서버 실행)
 *   2) npm run mock:robot
 *
 * 산책 시나리오를 그대로 재현한다:
 *   대기 → 티칭 → 자동주행 → 개가 당김(L2) → 복귀 → 종료
 */

const SERVER = process.env.MOCK_SERVER_URL ?? "http://localhost:3000";
const ROBOT_ID = Number(process.env.MOCK_ROBOT_ID ?? 1);
const API_KEY = process.env.MOCK_ROBOT_API_KEY ?? "dev-robot-key-change-me";

// 전북대 일대 기준점
const BASE_LAT = 35.8465;
const BASE_LNG = 127.1295;

const F_SOFT = 8.0, F_HARD = 30.0, F_ESTOP = 40.0;

type Mode = "idle" | "teach" | "follow" | "estop";

let t = 0;
let mode: Mode = "idle";
let kfTotal = 0;
let kfIndex = 0;
let leash = 1.8;

function scenario(sec: number): Mode {
  if (sec < 5) return "idle";
  if (sec < 35) return "teach";
  return "follow";
}

/** 개가 당기는 상황을 주기적으로 섞는다 */
function tension(sec: number): number {
  const base = 6 + Math.sin(sec / 4) * 2.5;
  if (sec % 40 >= 20 && sec % 40 < 25) return base + 28;  // 강한 당김 → L2
  if (sec % 40 >= 12 && sec % 40 < 16) return base + 6;   // 가벼운 당김 → L1
  return Math.max(0.5, base);
}

function safetyLevel(f: number, l: number): number {
  if (f >= F_ESTOP || l >= 5.0) return 3;
  if (f >= F_HARD || l >= 4.5) return 2;
  if (f >= F_SOFT || l >= 3.0) return 1;
  return 0;
}

async function pollCommands() {
  try {
    const res = await fetch(`${SERVER}/api/robots/${ROBOT_ID}/commands/pending`, {
      headers: { Authorization: `Bearer ${API_KEY}` },
    });
    if (!res.ok) return;
    const { commands } = await res.json();

    for (const c of commands ?? []) {
      console.log(`  ← 명령 수신: ${c.type}`);
      if (c.type === "ESTOP") { mode = "estop"; console.log("  ⚠ 비상정지"); }
      if (c.type === "START_TEACH") { mode = "teach"; kfTotal = 0; kfIndex = 0; }
      if (c.type === "STOP_TEACH") { mode = "idle"; }
      if (c.type === "START_FOLLOW") { mode = "follow"; kfIndex = 0; }
      if (c.type === "PAUSE") { mode = "idle"; }
      if (c.type === "RESUME") { mode = "follow"; }

      await fetch(`${SERVER}/api/robots/${ROBOT_ID}/commands/${c.id}/ack`, {
        method: "POST",
        headers: { Authorization: `Bearer ${API_KEY}` },
      });
    }
  } catch { /* 서버가 아직 안 떴을 수 있다 */ }
}

async function tick() {
  t += 1;
  if (mode !== "estop") mode = scenario(t);

  const f = mode === "estop" ? 0 : tension(t);
  leash = Math.max(0.5, Math.min(4.9, leash + (Math.random() - 0.48) * 0.25));
  const lv = mode === "estop" ? 3 : safetyLevel(f, leash);

  if (mode === "teach") { kfTotal += Math.random() < 0.5 ? 1 : 0; }
  if (mode === "follow" && kfTotal > 0) { kfIndex = Math.min(kfTotal, kfIndex + (Math.random() < 0.4 ? 1 : 0)); }

  const speed = mode === "follow" ? (lv >= 2 ? 0.15 : 0.85 + Math.sin(t / 7) * 0.1) : 0;

  const payload = {
    ts: new Date().toISOString(),
    mode,
    safety_level: lv,
    faults: t % 90 === 0 ? ["F4"] : [],
    tension_n: Number(f.toFixed(2)),
    leash_len_m: Number(leash.toFixed(2)),
    speed_cmd: Number(speed.toFixed(3)),
    steer_cmd: Number((Math.sin(t / 5) * 0.3).toFixed(3)),
    lat: BASE_LAT + Math.sin(t / 30) * 0.0012,
    lng: BASE_LNG + Math.cos(t / 30) * 0.0012,
    gps_src: "robot" as const,
    // GPS 실측 — 지령보다 약간 느리고 흔들린다 (robot/bridge/gps.py)
    speed_mps: Number(Math.max(0, speed * 0.9 + (speed ? (Math.random() - 0.5) * 0.1 : 0)).toFixed(3)),
    heading_deg: Number(((360 - ((t * 180) / Math.PI / 30) % 360) % 360).toFixed(1)), // 반시계로 원을 돈다
    gps_sats: 8 + Math.round(Math.random() * 2),
    route_id: null,
    kf_index: kfIndex,
    kf_total: kfTotal,
    match_quality: Number((0.55 + Math.random() * 0.4).toFixed(2)),
    battery_v: null,
  };

  try {
    const res = await fetch(`${SERVER}/api/robots/${ROBOT_ID}/telemetry`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${API_KEY}` },
      body: JSON.stringify(payload),
    });
    const mark = res.ok ? "✓" : `✗ ${res.status}`;
    console.log(
      `${mark} t=${String(t).padStart(3)} ${mode.padEnd(6)} L${lv}  ` +
      `장력 ${payload.tension_n.toFixed(1).padStart(5)}N  ` +
      `줄 ${payload.leash_len_m.toFixed(2)}m  ` +
      `속도 지령 ${payload.speed_cmd.toFixed(2)} / 실측 ${payload.speed_mps.toFixed(2)}m/s  kf ${kfIndex}/${kfTotal}`,
    );
    if (!res.ok) console.log("   ", (await res.text()).slice(0, 200));
  } catch (e) {
    console.log(`✗ t=${t} 전송 실패 — 서버가 떠 있나요? (${SERVER})`);
  }

  await pollCommands();
}

console.log(`모의 로봇 시작 → ${SERVER} (robot ${ROBOT_ID})`);
console.log("시나리오: 0~5s 대기 → 5~35s 티칭 → 35s~ 자동주행 (20초마다 강한 당김)\n");
setInterval(tick, 1000);
