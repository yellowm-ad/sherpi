"use client";

import { Play, Pause, RotateCcw } from "lucide-react";
import { useSim } from "@/app/(main)/sim/SimProvider";

/** 재생 조작 — ▶/Ⅱ · 처음으로 · 배속 · 시간 탐색(안전 이벤트 표시) */
export default function Transport({ compact }: { compact?: boolean }) {
  const { time, setTime, playing, setPlaying, rate, setRate, duration, result } = useSim();
  return (
    <div className={compact ? "" : "card p-3"}>
      <div className="flex items-center gap-2">
        <button onClick={() => setPlaying(!playing)} aria-label={playing ? "일시정지" : "재생"}
                className="press touch flex items-center justify-center gap-1 rounded-xl bg-sherpy-600 px-4 text-sm font-semibold text-white">
          {playing ? <Pause size={16} /> : <Play size={16} />}{playing ? "일시정지" : "재생"}
        </button>
        <button onClick={() => { setTime(0); setPlaying(false); }} aria-label="처음으로" className="press touch flex items-center justify-center rounded-xl border border-line"><RotateCcw size={16} /></button>
        <p className="tabular flex-1 text-right text-base font-bold">{time.toFixed(2)}<small className="text-xs font-normal text-muted"> / {duration.toFixed(0)} 초</small></p>
        <select value={rate} onChange={(e) => setRate(Number(e.target.value))} aria-label="재생 속도"
                className="touch rounded-xl border border-line bg-surface px-2 text-sm">
          {[0.25, 0.5, 1, 2, 4].map((r) => <option key={r} value={r}>{r}×</option>)}
        </select>
      </div>
      <div className="relative mt-3">
        <input type="range" min={0} max={duration} step={0.04} value={time} aria-label="시간 탐색"
               onChange={(e) => setTime(Number(e.target.value))} className="w-full accent-sherpy-600" />
        {result.events.map((e, i) => (
          <span key={i} title={`${e.t.toFixed(2)}초 ${e.reason}`}
                className={`pointer-events-none absolute -top-1 h-2 w-2 -translate-x-1/2 rounded-full ${e.level === 3 ? "bg-level-3" : "bg-level-2"}`}
                style={{ left: `${(e.t / duration) * 100}%` }} />
        ))}
      </div>
      <div className="tabular flex justify-between text-[10px] text-muted">{[0, 10, 20, 30, 40].map((x) => <span key={x}>{x}s</span>)}</div>
    </div>
  );
}
