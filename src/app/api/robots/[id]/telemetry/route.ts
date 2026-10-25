import { NextRequest, NextResponse } from "next/server";
import { db, hasDb, noDb } from "@/db";
import { robotTelemetry, robots } from "@/db/schema";
import { eq } from "drizzle-orm";
import { TelemetrySchema } from "@/lib/robot/types";
import { verifyRobotKey } from "@/lib/robot/auth";

/**
 * POST /api/robots/:id/telemetry
 * 로봇이 1Hz로 상태를 올린다. 지속 연결을 쓰지 않으므로
 * 네트워크가 끊겼다 붙어도 다음 POST부터 자동 복구된다.
 * 배열로 보내면 버퍼링된 묶음을 한 번에 받는다.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!hasDb) return noDb();
  const { id } = await ctx.params;
  const robotId = Number(id);
  if (!Number.isInteger(robotId)) {
    return NextResponse.json({ error: "invalid robot id" }, { status: 400 });
  }

  const robot = await verifyRobotKey(robotId, req.headers.get("authorization"));
  if (!robot) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json();
  const items = Array.isArray(body) ? body : [body];

  const parsed = items.map((it) => TelemetrySchema.safeParse(it));
  const bad = parsed.findIndex((p) => !p.success);
  if (bad >= 0) {
    return NextResponse.json(
      { error: "validation failed", index: bad, detail: (parsed[bad] as any).error.format() },
      { status: 422 },
    );
  }

  const rows = parsed.map((p) => {
    const t = (p as any).data;
    return {
      robotId,
      ts: new Date(t.ts),
      mode: t.mode,
      safetyLevel: t.safety_level,
      faults: t.faults ?? [],
      tensionN: t.tension_n ?? null,
      leashLenM: t.leash_len_m ?? null,
      speedCmd: t.speed_cmd ?? null,
      steerCmd: t.steer_cmd ?? null,
      lat: t.lat ?? null,
      lng: t.lng ?? null,
      gpsSrc: t.gps_src ?? null,
      speedMps: t.speed_mps ?? null,
      headingDeg: t.heading_deg ?? null,
      gpsSats: t.gps_sats ?? null,
      routeId: t.route_id ?? null,
      kfIndex: t.kf_index ?? null,
      kfTotal: t.kf_total ?? null,
      matchQuality: t.match_quality ?? null,
      batteryV: t.battery_v ?? null,
    };
  });

  await db.insert(robotTelemetry).values(rows);
  await db.update(robots).set({ lastSeenAt: new Date() }).where(eq(robots.id, robotId));

  return NextResponse.json({ ok: true, accepted: rows.length });
}
