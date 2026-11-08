"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_PARAMS, K, type EnvKey, type ScenarioKey, type SimParams } from "@/lib/sherpy/params";
import { runSim, DEFAULT_FUSION, type FusionOpts, type SimResult, type SimFrame } from "@/lib/sherpy/simulate";

/**
 * 시뮬레이션 랩 공용 상태 — /sim 아래 첫 화면·그래프·수치·설정·파이프라인·결과가 함께 쓴다.
 * 변수가 바뀌면 40초(1,001 프레임)를 다시 계산하고, 재생은 계산과 분리돼 있다 (7.3 과 같은 구조).
 */
export type SimMode = "ref" | "fusion";
export interface SimSettings {
  p: SimParams;
  env: EnvKey;
  scenario: ScenarioKey;
  mode: SimMode;
  fusion: Pick<FusionOpts, "reelMode" | "smoothAccel" | "seed"> & { l2Mode: "slow" | "directional"; predict: boolean; encCross: boolean; ffMode: "fixed" | "ekf" };
}
export const DEFAULT_SETTINGS: SimSettings = {
  p: DEFAULT_PARAMS, env: "park", scenario: "normal", mode: "fusion",
  fusion: { reelMode: "tension", smoothAccel: true, seed: 1, l2Mode: "slow", predict: false, encCross: false, ffMode: "fixed" },
};

interface Ctx {
  s: SimSettings;
  set: (patch: Partial<SimSettings>) => void;
  setP: (k: keyof SimParams, v: number) => void;
  result: SimResult;
  frame: SimFrame;
  idx: number;
  time: number;
  setTime: (t: number) => void;
  playing: boolean;
  setPlaying: (v: boolean) => void;
  rate: number;
  setRate: (r: number) => void;
  duration: number;
}

const SimCtx = createContext<Ctx | null>(null);
const KEY = "sherpy.sim.settings";

export default function SimProvider({ children }: { children: React.ReactNode }) {
  const [s, setS] = useState<SimSettings>(DEFAULT_SETTINGS);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [rate, setRate] = useState(1);
  const loaded = useRef(false);
  // 시뮬레이션은 브라우저에서만 계산·그린다 (서버와 부동소수 표기가 달라 하이드레이션이 어긋나지 않게)
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // 마지막 실험 설정 기억 (이 기기에서만)
  useEffect(() => {
    let saved: SimSettings | null = null;
    try { saved = JSON.parse(localStorage.getItem(KEY) ?? "null"); } catch { /* 저장된 설정 없음 */ }
    if (saved?.p) setS({ ...DEFAULT_SETTINGS, ...saved, p: { ...DEFAULT_PARAMS, ...saved.p }, fusion: { ...DEFAULT_SETTINGS.fusion, ...saved.fusion } });
    loaded.current = true;
  }, []);
  useEffect(() => {
    if (!loaded.current) return;
    try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* 사생활 보호 모드 — 이번 세션만 */ }
  }, [s]);

  const result = useMemo(
    () => runSim(s.p, s.env, s.scenario, s.mode, { ...DEFAULT_FUSION, ...s.fusion }),
    [s],
  );
  const duration = K.FRAMES * K.DT;

  // 다시 계산하면 처음부터
  useEffect(() => { setTime(0); setPlaying(false); }, [result]);

  // 재생 루프 — 실제 경과 시간 × 배속
  useEffect(() => {
    if (!playing) return;
    let raf = 0, last: number | null = null;
    const loop = (now: number) => {
      if (last != null) setTime((t) => Math.min(duration, t + ((now - last!) / 1000) * rate));
      last = now;
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [playing, rate, duration]);
  useEffect(() => { if (time >= duration) setPlaying(false); }, [time, duration]);

  const idx = Math.min(K.FRAMES, Math.max(0, Math.round(time / K.DT)));
  const frame = result.frames[idx];

  const value: Ctx = {
    s,
    set: (patch) => setS((o) => ({ ...o, ...patch })),
    setP: (k, v) => setS((o) => {
      const p = { ...o.p, [k]: v };
      // L2 < L3 조건 자동 유지 (7.3 과 동일)
      if (k === "warn" && v >= p.stop) p.stop = v + 1;
      if (k === "stop" && v <= p.warn) p.warn = v - 1;
      return { ...o, p };
    }),
    result, frame, idx, time, setTime, playing,
    setPlaying: (v) => { if (v && time >= duration) setTime(0); setPlaying(v); },
    rate, setRate, duration,
  };
  return <SimCtx.Provider value={value}>{mounted ? children : <div className="px-4 pt-6"><div className="skeleton h-80 rounded-3xl" /><div className="skeleton mt-3 h-24 rounded-2xl" /></div>}</SimCtx.Provider>;
}

export function useSim() {
  const c = useContext(SimCtx);
  if (!c) throw new Error("useSim 은 /sim 레이아웃 안에서만");
  return c;
}
