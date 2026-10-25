"use client";

import { useEffect, useRef, useState } from "react";
import { demoRobot, type CommandLog } from "@/lib/robot/demo-robot";

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
}

export type ConnState = "connecting" | "online" | "stale" | "offline";

/**
 * 실연동 / 시연 모드 판별.
 * /api/health 의 robotLive 가 false 면(실로봇 미연결) 브라우저 안의 가상 셰르피(demo-robot)를 쓴다.
 * 한 번만 묻고 결과를 모듈에 보관한다.
 */
let demoFlag: Promise<boolean> | null = null;
export function isDemoMode() {
  if (!demoFlag) {
    demoFlag = fetch("/api/health")
      .then((r) => r.json())
      .then((j) => !j.robotLive)
      .catch(() => true);
  }
  return demoFlag;
}

/**
 * 로봇 텔레메트리 SSE 구독.
 *
 * Vercel 함수 실행시간 제한(Hobby 300초) 때문에 스트림이 주기적으로 끊긴다.
 * EventSource가 자동 재연결하고 Last-Event-ID로 유실분을 이어받는다.
 * 3초 이상 수신이 없으면 stale, 10초면 offline으로 본다. (PRD F-1 수용기준)
 */
export function useRobotStream(robotId: number | null) {
  const [latest, setLatest] = useState<TelemetryRow | null>(null);
  const [state, setState] = useState<ConnState>("connecting");
  const [demo, setDemo] = useState(false);
  const [commands, setCommands] = useState<CommandLog[]>([]);
  const lastRecvRef = useRef<number>(Date.now());

  useEffect(() => {
    if (robotId == null) return;
    let cleanup = () => {};
    let alive = true;

    const watchdog = setInterval(() => {
      const gap = Date.now() - lastRecvRef.current;
      if (gap > 10_000) setState("offline");
      else if (gap > 3_000) setState((s) => (s === "connecting" ? s : "stale"));
    }, 1000);

    isDemoMode().then((isDemo) => {
      if (!alive) return;
      setDemo(isDemo);

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

      cleanup = () => { es.close(); clearInterval(poll); };
    });

    return () => {
      alive = false;
      clearInterval(watchdog);
      cleanup();
    };
  }, [robotId]);

  return { latest, state, demo, commands, lastRecvAt: lastRecvRef.current };
}

/** 명령 발신 헬퍼 — 시연 모드면 가상 셰르피로 보낸다 */
export async function sendCommand(robotId: number, type: string, payload: Record<string, unknown> = {}) {
  if (await isDemoMode()) return { ok: true, command: demoRobot().command(type, payload) };

  const res = await fetch(`/api/robots/${robotId}/commands`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type, payload }),
  });
  if (!res.ok) throw new Error(`명령 전송 실패 (${res.status})`);
  return res.json();
}
