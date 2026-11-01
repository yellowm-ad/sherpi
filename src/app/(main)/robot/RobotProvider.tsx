"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useRobotStream, type TelemetryRow, type ConnState } from "@/hooks/useRobotStream";
import type { CommandLog } from "@/lib/robot/demo-robot";
import { dogLatLng, dogRadius } from "@/lib/sherpy/geo";

/**
 * /robot 아래 모든 화면(첫 화면·그래프·수치·제어·카메라)이 같은 텔레메트리 스트림과 기록을 공유한다.
 * 레이아웃에 두기 때문에 폴더 사이를 오가도 연결이 끊기지 않고 그래프 기록이 이어진다.
 */
export interface Sample {
  t: number;              // s (첫 수신 기준)
  tension: number | null; // N 원시/빠른 필터
  filt: number | null;    // N F̂
  reel: number | null;    // m
  dist: number | null;    // m d̂
  theta: number | null;   // ° θ̂
  sigma: number | null;   // m
  vCmd: number | null;
  vGps: number | null;
  steer: number | null;
  level: number;
}

interface Ctx {
  robotId: number;
  latest: TelemetryRow | null;
  state: ConnState;
  demo: boolean;
  commands: CommandLog[];
  history: Sample[];
  trail: [number, number][];
  /** 강아지 지도 위치 (로봇 GPS + 방위 + θ̂·d̂) */
  dogGeo: { lat: number; lng: number; radius: number } | null;
}

const RobotCtx = createContext<Ctx | null>(null);
const MAX = 480; // 4 Hz 시연 = 2분, 1 Hz 실로봇 = 8분

export default function RobotProvider({ children }: { children: React.ReactNode }) {
  // TODO(M1): 로그인 사용자의 로봇 id를 세션에서 가져올 것
  const robotId = 1;
  const { latest, state, demo, commands } = useRobotStream(robotId);
  const [history, setHistory] = useState<Sample[]>([]);
  const [trail, setTrail] = useState<[number, number][]>([]);
  const t0 = useRef<number | null>(null);
  const lastId = useRef<number | null>(null);

  useEffect(() => {
    if (!latest || latest.id === lastId.current) return;
    lastId.current = latest.id;
    const ts = Date.parse(latest.ts);
    if (t0.current == null) t0.current = ts;
    const s: Sample = {
      t: (ts - t0.current) / 1000,
      tension: latest.tensionN, filt: latest.tensionFiltN ?? latest.tensionN, reel: latest.leashLenM,
      dist: latest.dogDistM ?? null, theta: latest.dogBearingDeg ?? null, sigma: latest.dogSigmaM ?? null,
      vCmd: latest.speedCmd, vGps: latest.speedMps, steer: latest.steerCmd, level: latest.safetyLevel,
    };
    setHistory((h) => (h.length >= MAX ? [...h.slice(h.length - MAX + 1), s] : [...h, s]));
    if (latest.lat != null && latest.lng != null) {
      const p: [number, number] = [latest.lat, latest.lng];
      setTrail((tr) => {
        const l = tr[tr.length - 1];
        if (l && Math.abs(l[0] - p[0]) < 1e-6 && Math.abs(l[1] - p[1]) < 1e-6) return tr;
        return tr.length >= 600 ? [...tr.slice(1), p] : [...tr, p];
      });
    }
  }, [latest]);

  const dogGeo = useMemo(() => {
    if (!latest || latest.lat == null || latest.lng == null || latest.dogDistM == null || latest.dogBearingDeg == null) return null;
    const th = (latest.dogBearingDeg * Math.PI) / 180;
    const p = dogLatLng({ lat: latest.lat, lng: latest.lng }, latest.headingDeg ?? 0, { xr: latest.dogDistM * Math.sin(th), yr: latest.dogDistM * Math.cos(th) });
    return { ...p, radius: dogRadius(latest.dogSigmaM ?? 0.1, latest.gpsSats) };
  }, [latest]);

  const value = useMemo(() => ({ robotId, latest, state, demo, commands, history, trail, dogGeo }), [latest, state, demo, commands, history, trail, dogGeo]);
  return <RobotCtx.Provider value={value}>{children}</RobotCtx.Provider>;
}

export function useRobot() {
  const c = useContext(RobotCtx);
  if (!c) throw new Error("useRobot 은 /robot 레이아웃 안에서만");
  return c;
}
