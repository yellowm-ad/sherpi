import { NextRequest, NextResponse } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db, hasDb, noDb } from "@/db";
import { routes } from "@/db/schema";
import { getSessionUser } from "@/lib/auth";
import { NewRouteSchema, loadRoutes, updateRoute, visibleRoute } from "@/lib/routes-db";

type Ctx = { params: Promise<{ id: string }> };

async function owned(id: number, userId: number) {
  const [r] = await db.select({ id: routes.id }).from(routes)
    .where(and(eq(routes.id, id), eq(routes.userId, userId), isNull(routes.deletedAt))).limit(1);
  return !!r;
}

/** GET /api/routes/:id — 공개 코스 또는 내 코스 */
export async function GET(_req: NextRequest, ctx: Ctx) {
  if (!hasDb) return noDb();
  const id = Number((await ctx.params).id);
  const me = await getSessionUser();
  const [r] = await loadRoutes(visibleRoute(id));
  if (!r || (!r.isPublic && !(me && (await owned(id, me.id))))) {
    return NextResponse.json({ error: "코스를 찾을 수 없어요" }, { status: 404 });
  }
  return NextResponse.json({ route: r });
}

const Patch = z.object({ taught: z.literal(true), keyframes: z.number().int().min(1).max(100000) });

/** PATCH /api/routes/:id — 티칭 완료 기록 (소유자만) */
export async function PATCH(req: NextRequest, ctx: Ctx) {
  if (!hasDb) return noDb();
  const id = Number((await ctx.params).id);
  const me = await getSessionUser();
  if (!me || !(await owned(id, me.id))) return NextResponse.json({ error: "권한이 없어요" }, { status: 403 });
  const parsed = Patch.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 422 });
  await db.update(routes).set({ taught: true, keyframes: parsed.data.keyframes }).where(eq(routes.id, id));
  return NextResponse.json({ ok: true });
}

/** PUT /api/routes/:id — 코스 수정 (소유자만). 경로가 바뀌면 티칭 기록을 지운다 */
export async function PUT(req: NextRequest, ctx: Ctx) {
  if (!hasDb) return noDb();
  const id = Number((await ctx.params).id);
  const me = await getSessionUser();
  if (!me || !(await owned(id, me.id))) return NextResponse.json({ error: "권한이 없어요" }, { status: 403 });
  if (me.accountStatus !== "ACTIVE") return NextResponse.json({ error: "이용이 정지된 계정이에요" }, { status: 403 });
  const parsed = NewRouteSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "입력을 확인하세요" }, { status: 422 });
  }
  await updateRoute(id, parsed.data);
  const [route] = await loadRoutes(visibleRoute(id));
  return NextResponse.json({ route });
}

/** DELETE /api/routes/:id — 소프트 삭제 (소유자만) */
export async function DELETE(_req: NextRequest, ctx: Ctx) {
  if (!hasDb) return noDb();
  const id = Number((await ctx.params).id);
  const me = await getSessionUser();
  if (!me || !(await owned(id, me.id))) return NextResponse.json({ error: "권한이 없어요" }, { status: 403 });
  await db.update(routes).set({ deletedAt: new Date() }).where(eq(routes.id, id));
  return NextResponse.json({ ok: true });
}
