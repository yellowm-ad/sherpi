import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, hasDb } from "@/db";
import { robots } from "@/db/schema";
import { getSessionUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * GET /api/me — 로그인 사용자 또는 { user: null }(게스트). DB 없으면 demo:true
 * robots: 이 계정에 등록된 로봇 (로봇마다 API 키가 따로 — scripts/robot-key.mjs 로 발급)
 */
export async function GET() {
  if (!hasDb) return NextResponse.json({ user: null, demo: true, robots: [] });
  const user = await getSessionUser();
  const mine = user
    ? await db.select({ id: robots.id, name: robots.name, serial: robots.serial, lastSeenAt: robots.lastSeenAt, streamUrl: robots.streamUrl, streamToken: robots.streamToken })
        .from(robots).where(eq(robots.ownerId, user.id)).orderBy(robots.id)
    : [];
  return NextResponse.json({ user, robots: mine });
}
