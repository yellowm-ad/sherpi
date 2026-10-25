import { and, asc, eq, inArray, isNull, type SQL } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { routes, routePoints, routePois, users } from "@/db/schema";
import type { DemoRoute, PoiType } from "@/lib/demo/data";
import { routeLength } from "@/lib/demo/data";

export const LatLng = z.tuple([z.number().min(-90).max(90), z.number().min(-180).max(180)]);

export const NewRouteSchema = z.object({
  name: z.string().trim().min(1).max(40),
  description: z.string().trim().max(60).optional().default(""),
  isPublic: z.boolean().default(true),
  points: z.array(LatLng).min(2, "경유점은 2개 이상이어야 해요").max(500),
  pois: z.array(z.object({
    type: z.enum(["water", "bag", "shade", "caution", "petfriendly"]),
    lat: z.number(), lng: z.number(), label: z.string().max(30).optional(),
  })).max(50).default([]),
});

export function difficultyOf(distM: number): DemoRoute["difficulty"] {
  return distM > 2500 ? "어려움" : distM > 1200 ? "보통" : "쉬움";
}

/** DB 로우들을 앱이 쓰는 코스 모양(DemoRoute)으로 묶는다 */
export async function loadRoutes(where: SQL | undefined): Promise<DemoRoute[]> {
  const rows = await db
    .select({ r: routes, author: users.nickname })
    .from(routes)
    .innerJoin(users, eq(users.id, routes.userId))
    .where(where)
    .orderBy(asc(routes.createdAt));
  if (rows.length === 0) return [];
  const ids = rows.map((x) => x.r.id);
  const [pts, pois] = await Promise.all([
    db.select().from(routePoints).where(inArray(routePoints.routeId, ids)).orderBy(asc(routePoints.seq)),
    db.select().from(routePois).where(inArray(routePois.routeId, ids)),
  ]);
  return rows.reverse().map(({ r, author }) => ({
    id: r.id,
    name: r.name,
    description: r.description ?? "",
    author,
    difficulty: (r.difficulty as DemoRoute["difficulty"]) ?? "쉬움",
    likeCount: r.likeCount,
    isPublic: r.isPublic,
    taught: r.taught,
    keyframes: r.keyframes,
    points: pts.filter((p) => p.routeId === r.id).map((p) => [p.lat, p.lng] as [number, number]),
    pois: pois.filter((p) => p.routeId === r.id).map((p) => ({ type: p.type as PoiType, lat: p.lat, lng: p.lng, label: p.label ?? "" })),
  }));
}

export const ownRoutes = (userId: number) => and(eq(routes.userId, userId), isNull(routes.deletedAt));
export const visibleRoute = (id: number) => and(eq(routes.id, id), isNull(routes.deletedAt));

export async function createRoute(userId: number, input: z.infer<typeof NewRouteSchema>) {
  const dist = routeLength(input.points);
  const [r] = await db.insert(routes).values({
    userId,
    name: input.name,
    description: input.description || null,
    distanceM: Math.round(dist),
    estDurationS: Math.round(dist / 1.0), // 1.0 m/s 기준 (PRD F-4)
    difficulty: difficultyOf(dist),
    isPublic: input.isPublic,
  }).returning({ id: routes.id });
  await db.insert(routePoints).values(input.points.map((p, seq) => ({ routeId: r.id, seq, lat: p[0], lng: p[1] })));
  if (input.pois.length) {
    await db.insert(routePois).values(input.pois.map((p) => ({ routeId: r.id, type: p.type, lat: p.lat, lng: p.lng, label: p.label ?? null })));
  }
  return r.id;
}

/** 코스 수정 — 경유점·편의시설은 통째로 갈아 끼운다. 경로가 바뀌면 티칭을 다시 해야 한다 (PRD F-4) */
export async function updateRoute(id: number, input: z.infer<typeof NewRouteSchema>) {
  const before = await db.select({ lat: routePoints.lat, lng: routePoints.lng }).from(routePoints)
    .where(eq(routePoints.routeId, id)).orderBy(asc(routePoints.seq));
  const pathChanged = before.length !== input.points.length
    || before.some((p, i) => Math.abs(p.lat - input.points[i][0]) > 1e-7 || Math.abs(p.lng - input.points[i][1]) > 1e-7);
  const dist = routeLength(input.points);

  await db.batch([
    db.update(routes).set({
      name: input.name,
      description: input.description || null,
      distanceM: Math.round(dist),
      estDurationS: Math.round(dist / 1.0),
      difficulty: difficultyOf(dist),
      isPublic: input.isPublic,
      ...(pathChanged ? { taught: false, keyframes: 0 } : {}),
    }).where(eq(routes.id, id)),
    db.delete(routePoints).where(eq(routePoints.routeId, id)),
    db.delete(routePois).where(eq(routePois.routeId, id)),
    db.insert(routePoints).values(input.points.map((p, seq) => ({ routeId: id, seq, lat: p[0], lng: p[1] }))),
    ...(input.pois.length
      ? [db.insert(routePois).values(input.pois.map((p) => ({ routeId: id, type: p.type, lat: p.lat, lng: p.lng, label: p.label ?? null })))]
      : []),
  ] as const);
  return pathChanged;
}
