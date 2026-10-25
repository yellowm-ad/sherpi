"use client";

import { useEffect, useSyncExternalStore } from "react";
import { ROUTES, type DemoRoute } from "@/lib/demo/data";
import { useUser, type SessionUser } from "@/lib/session";

/**
 * 내 코스 — 로그인한 사용자가 직접 그린 코스 (PRD F-4).
 * 서버(/api/routes)에 계정별로 저장하고, 지도·코스 상세·셰르피 전송에서 공개 코스와 똑같이 꺼내 쓴다.
 * DB 없는 시연 배포에서는 브라우저에 계정별로 보관한다.
 * 내 코스 id 는 1001부터라 앱 내장 코스(12·15·18)와 겹치지 않는다.
 */
export type NewRoute = Omit<DemoRoute, "id" | "author" | "likeCount" | "taught" | "keyframes" | "difficulty">;

const listeners = new Set<() => void>();
const EMPTY: DemoRoute[] = [];
let owner: string | null = null;
let list: DemoRoute[] = EMPTY;
let demo = false;
/** 지금 계정의 목록을 한 번이라도 받아왔는지 — 수정 화면이 '없는 코스'와 '아직 로딩'을 구분하게 */
let loaded = false;

const localKey = (u: string) => `sherpy.routes.${u}`;

function emit(next: DemoRoute[]) {
  list = next;
  if (demo && owner) {
    try { localStorage.setItem(localKey(owner), JSON.stringify(next)); } catch { /* 무시 */ }
  }
  listeners.forEach((fn) => fn());
}

async function load(user: SessionUser | null) {
  const name = user?.username ?? null;
  if (name === owner) return;
  owner = name;
  loaded = false;
  if (!name) { loaded = true; return emit(EMPTY); }
  const r = await fetch("/api/routes/mine", { cache: "no-store" }).catch(() => null);
  if (owner !== name) return; // 그 사이 계정이 바뀜
  loaded = true;
  if (r?.ok) {
    demo = false;
    emit((await r.json()).routes);
  } else {
    demo = r?.status === 503;
    try { emit(JSON.parse(localStorage.getItem(localKey(name)) ?? "[]")); } catch { emit(EMPTY); }
  }
}

/** 현재 로그인 사용자의 코스 목록 (게스트면 빈 목록) */
export function useMyRoutes() {
  const user = useUser();
  useEffect(() => { load(user); }, [user]);
  return useSyncExternalStore(
    (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
    () => list,
    () => EMPTY,
  );
}

/** 내 코스 목록을 받아왔는지 */
export function useMyRoutesLoaded() {
  useMyRoutes();
  return useSyncExternalStore(
    (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
    () => loaded,
    () => false,
  );
}

const difficultyOf = (m: number): DemoRoute["difficulty"] => (m > 2500 ? "어려움" : m > 1200 ? "보통" : "쉬움");

/** 저장 — 실패하면 오류 문구를 던진다 */
export async function saveMyRoute(user: SessionUser, r: NewRoute & { distanceM: number }): Promise<DemoRoute> {
  if (!demo) {
    const res = await fetch("/api/routes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: r.name, description: r.description, isPublic: r.isPublic, points: r.points, pois: r.pois }),
    });
    const j = await res.json().catch(() => ({}));
    if (res.ok) { emit([j.route, ...list]); return j.route; }
    if (res.status !== 503) throw new Error(j.error ?? "저장에 실패했어요");
    demo = true;
  }
  const route: DemoRoute = {
    ...r, id: Math.max(1000, ...list.map((x) => x.id)) + 1,
    author: user.nickname, likeCount: 0, taught: false, keyframes: 0, difficulty: difficultyOf(r.distanceM),
  };
  emit([route, ...list]);
  return route;
}

/** 수정 — 경로가 바뀌면 티칭을 다시 해야 하므로 자동주행 표시를 끈다. 실패하면 오류 문구를 던진다 */
export async function updateMyRoute(id: number, r: NewRoute & { distanceM: number }): Promise<DemoRoute> {
  const prev = list.find((x) => x.id === id);
  if (!prev) throw new Error("내 코스에서 찾을 수 없어요");
  if (!demo) {
    const res = await fetch(`/api/routes/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: r.name, description: r.description, isPublic: r.isPublic, points: r.points, pois: r.pois }),
    });
    const j = await res.json().catch(() => ({}));
    if (res.ok) { emit(list.map((x) => (x.id === id ? j.route : x))); return j.route; }
    if (res.status !== 503) throw new Error(j.error ?? "수정에 실패했어요");
    demo = true;
  }
  const pathChanged = JSON.stringify(prev.points) !== JSON.stringify(r.points);
  const route: DemoRoute = {
    ...prev, name: r.name, description: r.description, isPublic: r.isPublic, points: r.points, pois: r.pois,
    difficulty: difficultyOf(r.distanceM),
    ...(pathChanged ? { taught: false, keyframes: 0 } : {}),
  };
  emit(list.map((x) => (x.id === id ? route : x)));
  return route;
}

export async function deleteMyRoute(id: number) {
  if (!demo) await fetch(`/api/routes/${id}`, { method: "DELETE" });
  emit(list.filter((r) => r.id !== id));
}

/** 티칭이 끝난 내 코스에 키프레임 수를 기록 — 이후 자동주행 가능 (PRD F-4 수용기준) */
export async function markTaught(id: number, keyframes: number) {
  emit(list.map((r) => (r.id === id ? { ...r, taught: true, keyframes } : r)));
  if (!demo) {
    await fetch(`/api/routes/${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ taught: true, keyframes }),
    }).catch(() => {});
  }
}

/** 내장 코스 + 지금 불러온 내 코스에서 찾는다 */
export function findRoute(id: number | null | undefined): DemoRoute | undefined {
  if (id == null) return undefined;
  return ROUTES.find((r) => r.id === id) ?? list.find((r) => r.id === id);
}
