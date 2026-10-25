"use client";

import { useEffect, useSyncExternalStore } from "react";

/**
 * 게스트 우선 세션 (클라이언트).
 * 로그인 없이 모든 화면을 둘러볼 수 있고, 코스 저장·채팅처럼
 * "내 것"이 생기는 순간에만 로그인을 권한다.
 *
 * 실제 인증은 서버(/api/auth/*, httpOnly 쿠키)가 한다. 여기는 /api/me 결과를 캐시해 나눠 쓸 뿐이다.
 * DB가 없는 시연 배포(/api/me → demo:true)에서는 브라우저에만 보관하는 시연용 로그인으로 동작한다.
 */
export interface SessionUser {
  id?: number;
  username: string;
  nickname: string;
  role?: string;
}

type State = { loaded: boolean; demo: boolean; user: SessionUser | null };

const LOCAL_KEY = "sherpy.user";
const listeners = new Set<() => void>();
let state: State = { loaded: false, demo: false, user: null };
let loading: Promise<void> | null = null;
const SERVER: State = { loaded: false, demo: false, user: null };

function set(next: Partial<State>) {
  state = { ...state, ...next };
  listeners.forEach((fn) => fn());
}

function readLocal(): SessionUser | null {
  try { return JSON.parse(localStorage.getItem(LOCAL_KEY) ?? "null"); } catch { return null; }
}

export function refreshSession() {
  loading = fetch("/api/me", { cache: "no-store" })
    .then((r) => r.json())
    .then((j) => set({ loaded: true, demo: !!j.demo, user: j.demo ? readLocal() : j.user }))
    .catch(() => set({ loaded: true, demo: true, user: readLocal() }));
  return loading;
}

async function call(path: string, body: unknown): Promise<string | null> {
  const r = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) return j.error ?? "요청에 실패했어요";
  set({ loaded: true, demo: false, user: j.user });
  return null;
}

/** 로그인 — 실패하면 오류 문구를 돌려준다 */
export async function login(username: string, password: string): Promise<string | null> {
  if (!state.loaded) await refreshSession();
  if (state.demo) {
    const u = { username, nickname: username };
    try { localStorage.setItem(LOCAL_KEY, JSON.stringify(u)); } catch { /* 무시 */ }
    set({ user: u });
    return null;
  }
  return call("/api/auth/login", { username, password });
}

export async function signup(username: string, password: string, nickname: string): Promise<string | null> {
  if (!state.loaded) await refreshSession();
  if (state.demo) return login(username, password).then((e) => { set({ user: { username, nickname } }); return e; });
  return call("/api/auth/signup", { username, password, nickname });
}

export async function logout() {
  try { localStorage.removeItem(LOCAL_KEY); } catch { /* 무시 */ }
  if (!state.demo) await fetch("/api/auth/login", { method: "DELETE" }).catch(() => {});
  set({ user: null });
}

function useSession(): State {
  const s = useSyncExternalStore(
    (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
    () => state,
    () => SERVER,
  );
  useEffect(() => { if (!state.loaded && !loading) refreshSession(); }, []);
  return s;
}

/** null = 게스트 */
export function useUser(): SessionUser | null {
  return useSession().user;
}

/** 세션 확인이 끝났는지 — 끝나기 전의 null 은 '게스트'가 아니라 '아직 모름' */
export function useSessionLoaded(): boolean {
  return useSession().loaded;
}
