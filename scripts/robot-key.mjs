// 로봇 등록·API 키 발급 — 로봇 1대마다 고유 시리얼·키·페어링 코드를 따로 만든다.
//
//   node scripts/robot-key.mjs                      로봇 목록 (키는 출력하지 않음)
//   node scripts/robot-key.mjs register <아이디> [이름]  새 로봇 등록 → 그 보호자 계정에 연결
//   node scripts/robot-key.mjs rotate <로봇id>          키 재발급 (분실·유출 시. 이전 키는 즉시 무효)
//
// 결과: robot/provision/<시리얼>.env  ← 이 파일을 해당 로봇의 ~/sherpy/robot/.env 로 복사한다.
// DB에는 bcrypt 해시만 저장한다. 평문 키는 provision 파일(.gitignore 대상)에만 있고 화면에 찍지 않는다.
import { config } from "dotenv";
import { neon } from "@neondatabase/serverless";
import bcrypt from "bcryptjs";
import { randomBytes, randomInt } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";

config({ path: ".env.local" });
const sql = neon(process.env.DATABASE_URL);
const [cmd, arg, nameArg] = process.argv.slice(2);

const newKey = () => randomBytes(24).toString("base64url");

function writeProvision(robot, key) {
  mkdirSync("robot/provision", { recursive: true });
  const path = `robot/provision/${robot.serial}.env`;
  writeFileSync(path, [
    `# ${robot.serial} (${robot.name}) — 이 로봇 전용. 다른 로봇에 복사하지 말 것`,
    "SHERPY_SERVER_URL=https://sherpy.vercel.app",
    `SHERPY_ROBOT_ID=${robot.id}`,
    `SHERPY_API_KEY=${key}`,
    "SHERPY_GPS_PORT=/dev/ttyAMA0",
    "SHERPY_GPS_ENABLED=0",
    "",
  ].join("\n"));
  return path;
}

if (cmd === "register") {
  if (!arg) throw new Error("사용법: register <보호자 아이디> [로봇 이름]");
  const [owner] = await sql`select id, username from sherpy.users where username = ${arg} and deleted_at is null`;
  if (!owner) throw new Error(`계정 없음: ${arg}`);
  const yymm = new Date().toISOString().slice(2, 7).replace("-", "");
  const [{ n }] = await sql`select count(*)::int as n from sherpy.robots`;
  const serial = `SHERPY-${yymm}-${String(n + 1).padStart(4, "0")}-${randomBytes(2).toString("hex").toUpperCase()}`;
  const key = newKey();
  const [robot] = await sql`insert into sherpy.robots (owner_id, serial, name, api_key_hash, pairing_code, fw_version)
    values (${owner.id}, ${serial}, ${nameArg ?? "셰르피"}, ${await bcrypt.hash(key, 10)}, ${String(randomInt(100000, 1000000))}, '0.1.0')
    returning id, serial, name`;
  console.log(`등록 완료: 로봇 #${robot.id} ${robot.serial} → 보호자 ${owner.username}`);
  console.log(`키 파일: ${writeProvision(robot, key)}  (키 값은 화면에 출력하지 않음)`);
} else if (cmd === "rotate") {
  const [robot] = await sql`select id, serial, name from sherpy.robots where id = ${Number(arg)}`;
  if (!robot) throw new Error(`로봇 #${arg} 없음`);
  const key = newKey();
  await sql`update sherpy.robots set api_key_hash = ${await bcrypt.hash(key, 10)} where id = ${robot.id}`;
  console.log(`키 재발급: 로봇 #${robot.id} ${robot.serial} — 이전 키는 이제 무효`);
  console.log(`키 파일: ${writeProvision(robot, key)}`);
} else {
  const list = await sql`select r.id, r.name, r.serial, u.username, r.last_seen_at
    from sherpy.robots r left join sherpy.users u on u.id = r.owner_id order by r.id`;
  if (!list.length) console.log("등록된 로봇 없음 — register 로 등록");
  for (const r of list) console.log(`#${r.id} ${r.name} ${r.serial} 보호자=${r.username} 마지막 접속=${r.last_seen_at ?? "없음"}`);
}
