import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, hasDb, noDb } from "@/db";
import { robots } from "@/db/schema";
import { HealthSchema } from "@/lib/robot/types";
import { verifyRobotKey, requireRobotOwner } from "@/lib/robot/auth";

export const dynamic = "force-dynamic";

/**
 * PUT /api/robots/:id/health — 로봇(robot/agent.py)이 10초마다 + 점검 버튼 때 상태를 올린다. 로봇 키 필요.
 * GET /api/robots/:id/health — 로봇 관리 화면. 로봇 주인만.
 *
 * 와이파이 이름·내부 IP 는 주인 화면에만 보인다 (다른 사용자·비로그인 접근 불가).
 */
export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!hasDb) return noDb();
  const robotId = Number((await ctx.params).id);
  if (!Number.isInteger(robotId)) return NextResponse.json({ error: "invalid robot id" }, { status: 400 });

  const robot = await verifyRobotKey(robotId, req.headers.get("authorization"));
  if (!robot) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = HealthSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "validation failed", detail: parsed.error.format() }, { status: 422 });

  const now = new Date();
  await db.update(robots).set({ health: parsed.data, healthAt: now, lastSeenAt: now }).where(eq(robots.id, robotId));
  return NextResponse.json({ ok: true });
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!hasDb) return noDb();
  const robotId = Number((await ctx.params).id);
  if (!Number.isInteger(robotId)) return NextResponse.json({ error: "invalid robot id" }, { status: 400 });
  const denied = await requireRobotOwner(robotId);
  if (denied) return denied;

  const [r] = await db
    .select({ health: robots.health, healthAt: robots.healthAt, lastSeenAt: robots.lastSeenAt, streamUrl: robots.streamUrl, streamToken: robots.streamToken })
    .from(robots).where(eq(robots.id, robotId)).limit(1);
  return NextResponse.json({
    health: r?.health ?? null,
    healthAt: r?.healthAt ?? null,
    lastSeenAt: r?.lastSeenAt ?? null,
    streamUrl: r?.streamUrl ?? null,
    streamToken: r?.streamToken ?? null,
  }, { headers: { "Cache-Control": "no-store" } });
}
