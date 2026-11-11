import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, hasDb, noDb } from "@/db";
import { robots } from "@/db/schema";
import { VisionUploadSchema } from "@/lib/robot/types";
import { verifyRobotKey, requireRobotOwner } from "@/lib/robot/auth";

export const dynamic = "force-dynamic";

/**
 * PUT /api/robots/:id/vision — 로봇(robot/bridge/vision.py)이 인식 테스트 중 0.5초마다 결과+사진을 올린다. 로봇 키 필요.
 *   { result: null, frame: null } = 테스트 종료 (사진 지움)
 * GET /api/robots/:id/vision — [자율주행 인식 테스트] 화면. 로봇 주인만.
 *
 * 카메라 사진이라 주인 외에는 절대 내주지 않는다. 기록은 남기지 않고 최신 1장만 덮어쓴다.
 */
export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!hasDb) return noDb();
  const robotId = Number((await ctx.params).id);
  if (!Number.isInteger(robotId)) return NextResponse.json({ error: "invalid robot id" }, { status: 400 });

  const robot = await verifyRobotKey(robotId, req.headers.get("authorization"));
  if (!robot) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = VisionUploadSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "validation failed", detail: parsed.error.format() }, { status: 422 });

  const now = new Date();
  const { result, frame } = parsed.data;
  await db.update(robots)
    .set({ vision: result, visionFrame: result ? frame : null, visionAt: result ? now : null, lastSeenAt: now })
    .where(eq(robots.id, robotId));
  return NextResponse.json({ ok: true });
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!hasDb) return noDb();
  const robotId = Number((await ctx.params).id);
  if (!Number.isInteger(robotId)) return NextResponse.json({ error: "invalid robot id" }, { status: 400 });
  const denied = await requireRobotOwner(robotId);
  if (denied) return denied;

  const [r] = await db
    .select({ vision: robots.vision, frame: robots.visionFrame, at: robots.visionAt })
    .from(robots).where(eq(robots.id, robotId)).limit(1);
  return NextResponse.json(
    { result: r?.vision ?? null, frame: r?.frame ?? null, at: r?.at ?? null },
    { headers: { "Cache-Control": "no-store" } },
  );
}
