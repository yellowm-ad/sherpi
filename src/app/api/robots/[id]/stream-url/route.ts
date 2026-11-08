import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, hasDb, noDb } from "@/db";
import { robots } from "@/db/schema";
import { verifyRobotKey } from "@/lib/robot/auth";

/**
 * PUT /api/robots/:id/stream-url  — 로봇이 자기 영상(WHEP) 주소를 알린다. (robot/stream.py)
 * Cloudflare 임시 터널 주소는 켤 때마다 바뀌므로 로봇이 직접 올리고, 앱은 /api/me 로 받아 간다.
 * 로봇 키로만 바꿀 수 있다. { url: null } 이면 영상 꺼짐.
 */
const Body = z.object({
  url: z.string().url().max(300).refine((u) => u.startsWith("https://"), "https 주소만").nullable(),
  /** 시청 비밀번호 (robot/bridge/streamer.py 가 켤 때마다 새로 만듦). 예전 stream.py 는 안 보냄 */
  token: z.string().regex(/^[A-Za-z0-9_-]{16,64}$/).nullable().optional(),
});

export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!hasDb) return noDb();
  const robotId = Number((await ctx.params).id);
  if (!Number.isInteger(robotId)) return NextResponse.json({ error: "invalid robot id" }, { status: 400 });

  const robot = await verifyRobotKey(robotId, req.headers.get("authorization"));
  if (!robot) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "validation failed", detail: parsed.error.format() }, { status: 422 });

  const { url, token } = parsed.data;
  await db.update(robots).set({ streamUrl: url, streamToken: url ? token ?? null : null }).where(eq(robots.id, robotId));
  return NextResponse.json({ ok: true, streamUrl: url });
}
