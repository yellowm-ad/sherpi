"use client";

import { useEffect, useRef, useState } from "react";
import { demoRobot, type CommandLog } from "@/lib/robot/demo-robot";
import { SESSION_EVENT } from "@/lib/session";

export interface TelemetryRow {
  id: number;
  robotId: number;
  ts: string;
  mode: "idle" | "teach" | "follow" | "estop";
  safetyLevel: number;
  faults: string[];
  tensionN: number | null;
  leashLenM: number | null;
  speedCmd: number | null;
  steerCmd: number | null;
  lat: number | null;
  lng: number | null;
  gpsSrc: "phone" | "robot" | null;
  /** GPS 실측 지면속도 — speedCmd(지령)와 비교해 실제로 얼마나 가는지 본다 */
  speedMps: number | null;
  headingDeg: number | null;
  gpsSats: number | null;
  routeId: number | null;
  kfIndex: number | null;
  kfTotal: number | null;
  matchQuality: number | null;
  batteryV: number | null;
  /** 강아지 위치 추정 — 로봇 기준 방향각 θ(°, +오른쪽)·거리 d̂·1σ·추적 상태 (구버전 로봇이면 undefined) */
  dogBearingDeg?: number | null;
  dogDistM?: number | null;
  dogSigmaM?: number | null;
  dogTrack?: "ok" | "coast" | "lost" | null;
  tensionFiltN?: number | null;
}

export type ConnState = "connecting" | "online" | "stale" | "offline";

/**
 * 내 로봇 id — 로그인한 보호자에게 등록된 로봇(robots.owner_id). 로봇마다 키가 따로라
 * 앱도 로봇 번호를 고정하지 않고 계정 기준으로 찾는다.
 * 게스트·DB 없음·등록된 로봇 없음이면 null → 브라우저 안의 가상 셰르피(demo-robot)로 시연.
 * 한 번만 묻고 결과를 모듈에 보관한다.
 */
type MyRobot = { id: number; streamUrl: string | null; streamToken?: string | null };
/** 영상 주소 + 시청 비밀번호를 한 문자열로 (#t=…, 프래그먼트라 네트워크로 나가지 않음) — RobotVideo 가 나눠 쓴다 */
const streamOf = (r: MyRobot | null | undefined) => (r?.streamUrl ? r.streamUrl + (r.streamToken ? `#t=${r.streamToken}` : "") : null);
const fetchMyRobot = (): Promise<MyRobot | null> =>
  fetch("/api/me", { cache: "no-store" })
    .then((r) => r.json())
    .then((j) => (j.robots?.[0] as MyRobot | undefined) ?? null)
    .catch(() => null);

let mine: Promise<MyRobot | null> | null = null;
/**
 * "로봇 있음"만 기억한다. "없음"(게스트·로그인 전)은 기억하지 않는다 —
 * 핸드폰에서 로그인 전에 홈을 먼저 열면 '없음'이 굳어 로그인 후에도 가상 로봇에 머물던 문제.
 */
export function myRobot() {
  if (!mine) {
    const p: Promise<MyRobot | null> = fetchMyRobot().then((r) => {
      if (!r && mine === p) mine = null;
      return r;
    });
    mine = p;
  }
  return mine;
}
/** 로그인·로그아웃·계정 전환 시 다시 찾게 한다 */
export function resetMyRobot() {
  mine = null;
}
export function myRobotId() {
  return myRobot().then((r) => r?.id ?? null);
}

export function isDemoMode() {
  return myRobotId().then((id) => id == null);
}

/**
 * 로봇 텔레메트리 SSE 구독.
 *
 * Vercel 함수 실행시간 제한(Hobby 300초) 때문에 스트림이 주기적으로 끊긴다.
 * EventSource가 자동 재연결하고 Last-Event-ID로 유실분을 이어받는다.
 * 3초 이상 수신이 없으면 stale, 10초면 offline으로 본다. (PRD F-1 수용기준)
 */
export function useRobotStream() {
  const [robotId, setRobotId] = useState<number | null>(null);
  // 로봇이 올린 영상 주소 (Cloudflare 임시 터널은 켤 때마다 바뀌므로 15초마다 다시 묻는다)
  const [streamUrl, setStreamUrl] = useState<string | null>(null);
  const [latest, setLatest] = useState<TelemetryRow | null>(null);
  const [state, setState] = useState<ConnState>("connecting");
  const [demo, setDemo] = useState(false);
  const [commands, setCommands] = useState<CommandLog[]>([]);
  const lastRecvRef = useRef<number>(Date.now());
  // 로그인 상태가 바뀌면 1 올려서 연결을 처음부터 다시 맺는다
  const [epoch, setEpoch] = useState(0);

  useEffect(() => {
    const onSession = () => { resetMyRobot(); setEpoch((n) => n + 1); };
    window.addEventListener(SESSION_EVENT, onSession);
    return () => window.removeEventListener(SESSION_EVENT, onSession);
  }, []);

  useEffect(() => {
    let cleanup = () => {};
    let alive = true;

    const watchdog = setInterval(() => {
      const gap = Date.now() - lastRecvRef.current;
      if (gap > 10_000) setState("offline");
      else if (gap > 3_000) setState((s) => (s === "connecting" ? s : "stale"));
    }, 1000);

    myRobot().then((robot) => {
      if (!alive) return;
      const robotId = robot?.id ?? null;
      const isDemo = robotId == null;
      setDemo(isDemo);
      setRobotId(robotId);
      setStreamUrl(streamOf(robot));

      if (isDemo) {
        const bot = demoRobot();
        cleanup = bot.subscribe(() => {
          setLatest(bot.latest);
          setCommands(bot.commands);
          lastRecvRef.current = Date.now();
          setState("online");
        });
        return;
      }

      const es = new EventSource(`/api/robots/${robotId}/stream`);
      es.addEventListener("telemetry", (e) => {
        try {
          const row = JSON.parse((e as MessageEvent).data) as TelemetryRow;
          setLatest(row);
          lastRecvRef.current = Date.now();
          setState("online");
        } catch {
          /* 파싱 실패는 무시하고 다음 프레임을 기다린다 */
        }
      });
      es.onerror = () => {
        // EventSource는 스스로 재연결한다. 상태만 낮춰 표시.
        setState((s) => (s === "online" ? "stale" : s));
      };

      // 명령 상태(pending → sent → acked | expired) 표시용 폴링
      const poll = setInterval(async () => {
        try {
          const r = await fetch(`/api/robots/${robotId}/commands`);
          const j = await r.json();
          setCommands(
            (j.commands ?? []).map((c: { id: number; type: string; status: CommandLog["status"]; issuedAt: string; ackedAt?: string }) => ({
              id: c.id, type: c.type, status: c.status,
              issuedAt: Date.parse(c.issuedAt), ackedAt: c.ackedAt ? Date.parse(c.ackedAt) : undefined,
            })),
          );
        } catch { /* 다음 주기에 다시 */ }
      }, 2000);

      const streamPoll = setInterval(() => {
        fetchMyRobot().then((r) => alive && setStreamUrl(streamOf(r)));
      }, 15000);

      cleanup = () => { es.close(); clearInterval(poll); clearInterval(streamPoll); };
    });

    return () => {
      alive = false;
      clearInterval(watchdog);
      cleanup();
    };
  }, [epoch]);

  return { robotId, streamUrl, latest, state, demo, commands, lastRecvAt: lastRecvRef.current };
}

/** 명령 발신 헬퍼 — 시연 모드면 가상 셰르피로 보낸다. robotId 를 모르면 내 로봇으로 보낸다 */
export async function sendCommand(robotId: number | null | undefined, type: string, payload: Record<string, unknown> = {}) {
  robotId = robotId ?? (await myRobotId());
  if (robotId == null) return { ok: true, command: demoRobot().command(type, payload) };

  const res = await fetch(`/api/robots/${robotId}/commands`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type, payload }),
  });
  if (!res.ok) throw new Error(`명령 전송 실패 (${res.status})`);
  return res.json();
}
