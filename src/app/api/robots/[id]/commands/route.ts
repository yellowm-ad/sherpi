import { NextRequest, NextResponse } from "next/server";
import { db, hasDb, noDb } from "@/db";
import { robotCommands } from "@/db/schema";
import { and, eq, desc, gt, count } from "drizzle-orm";
import { CommandSchema, CONFIRM_COMMANDS } from "@/lib/robot/types";
import { requireRobotOwner } from "@/lib/robot/auth";
import { getSessionUser } from "@/lib/auth";

const RATE_PER_MIN = 30; // 버튼 연타·스크립트 남용 방지 (ESTOP 은 제한 없음)

/** POST /api/robots/:id/commands — 앱이 명령을 큐에 넣는다 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!hasDb) return noDb();
  const { id } = await ctx.params;
  const robotId = Number(id);

  const denied = await requireRobotOwner(robotId);
  if (denied) return denied;
  const parsed = CommandSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid command" }, { status: 422 });
  }
  const { type, payload } = parsed.data;
  if ((CONFIRM_COMMANDS as readonly string[]).includes(type) && payload.confirm !== true) {
    return NextResponse.json({ error: "확인이 필요한 명령이에요" }, { status: 422 });
  }
  if (type !== "ESTOP") {
    const [{ n }] = await db.select({ n: count() }).from(robotCommands)
      .where(and(eq(robotCommands.robotId, robotId), gt(robotCommands.issuedAt, new Date(Date.now() - 60_000))));
    if (n >= RATE_PER_MIN) return NextResponse.json({ error: "명령이 너무 잦아요. 잠시 뒤 다시 시도하세요" }, { status: 429 });
  }

  const me = await getSessionUser();
  const [row] = await db
    .insert(robotCommands)
    .values({ robotId, issuedBy: me?.id ?? null, type, payload })
    .returning();

  return NextResponse.json({ ok: true, command: row }, { status: 201 });
}

/** GET /api/robots/:id/commands — 최근 명령 이력 (앱 표시용) */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!hasDb) return noDb();
  const { id } = await ctx.params;
  const denied = await requireRobotOwner(Number(id));
  if (denied) return denied;
  const rows = await db
    .select()
    .from(robotCommands)
    .where(eq(robotCommands.robotId, Number(id)))
    .orderBy(desc(robotCommands.issuedAt))
    .limit(20);

  return NextResponse.json({ commands: rows });
}
