"use client";

import { ShieldCheck, ShieldAlert, TriangleAlert, OctagonX } from "lucide-react";
import { SAFETY_COLOR } from "@/lib/robot/types";
import { useTween } from "@/hooks/useTween";

const ICON = [ShieldCheck, ShieldAlert, TriangleAlert, OctagonX];
const TITLE = ["안전하게 따라가는 중", "주의", "강하게 당기는 중 · 감속", "멈춤 (안전 정지)"];

/**
 * 첫 화면 위험 요약 — 안전 단계 + 핵심 4수치(장력 F̂, 줄 L, 거리 d̂, 방향 θ̂).
 * 색만으로 구분하지 않는다(아이콘·글자 병기). 수치는 tabular.
 */
export default function DangerCard({
  level, reason, notes = [], tension, reel, dist, thetaDeg, sigma, track, warn, stop, reelMax,
}: {
  level: number; reason?: string | null; notes?: string[];
  tension: number | null; reel: number | null; dist: number | null; thetaDeg: number | null; sigma?: number | null;
  track?: "ok" | "coast" | "lost" | null;
  warn: number; stop: number; reelMax: number;
}) {
  const lv = Math.max(0, Math.min(3, level)) as 0 | 1 | 2 | 3;
  const Icon = ICON[lv];
  const T = useTween(tension ?? 0, 300);
  const max = stop * 1.3;
  const pct = Math.min(100, (T / max) * 100);
  return (
    <section className="card overflow-hidden" aria-live="polite">
      <div className="flex items-center gap-3 p-3" style={{ background: `color-mix(in srgb, ${SAFETY_COLOR[lv]} 12%, transparent)` }}>
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-white" style={{ background: SAFETY_COLOR[lv] }}>
          <Icon size={20} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold" style={{ color: SAFETY_COLOR[lv] }}>L{lv} · {TITLE[lv]}</p>
          <p className="truncate text-xs text-body">{reason ?? notes[0] ?? "강아지를 정상적으로 따라가고 있어요"}</p>
        </div>
      </div>
      <div className="px-3 pt-2.5">
        <div className="flex items-baseline justify-between text-xs text-muted">
          <span>강아지가 당기는 힘 <small className="text-[10px]">(장력 F̂)</small></span>
          <span className="tabular text-base font-bold text-ink">{tension == null ? "—" : T.toFixed(1)}<small className="ml-0.5 text-xs font-normal text-muted">N</small></span>
        </div>
        <div className="relative mt-1.5 h-2.5 rounded-full bg-line">
          <div className="h-full rounded-full transition-[background-color] duration-300"
               style={{ width: `${pct.toFixed(1)}%`, backgroundColor: T >= stop ? SAFETY_COLOR[3] : T >= warn ? SAFETY_COLOR[2] : T >= warn / 2 ? SAFETY_COLOR[1] : SAFETY_COLOR[0] }} />
          {[[warn, "경고"], [stop, "정지"]].map(([v, l]) => (
            <span key={l} className="absolute -top-0.5 h-3.5 w-0.5 rounded bg-ink/50" style={{ left: `${((v as number) / max) * 100}%` }}>
              <span className="absolute top-4 -translate-x-1/2 text-[9px] whitespace-nowrap text-muted">{l} {v}</span>
            </span>
          ))}
        </div>
      </div>
      <dl className="mt-5 grid grid-cols-3 divide-x divide-line border-t border-line text-center">
        <Num label="줄 길이" value={reel?.toFixed(2)} unit="m" sub={reel != null ? `최대 ${reelMax} m` : undefined} warn={reel != null && reel >= 0.92 * reelMax} />
        <Num label="강아지 거리" value={dist?.toFixed(2)} unit="m" sub={sigma != null ? `±${(sigma * 100).toFixed(0)} cm` : undefined} />
        <Num label="강아지 방향" value={thetaDeg != null ? `${thetaDeg >= 0 ? "+" : ""}${thetaDeg.toFixed(1)}` : undefined} unit="°"
             sub={track === "coast" ? "가림·예측 중" : track === "lost" ? "추적 실패" : thetaDeg != null ? (Math.abs(thetaDeg) < 2 ? "정면" : thetaDeg > 0 ? "오른쪽" : "왼쪽") : undefined}
             warn={track === "coast" || track === "lost"} />
      </dl>
    </section>
  );
}

function Num({ label, value, unit, sub, warn }: { label: string; value?: string; unit: string; sub?: string; warn?: boolean }) {
  return (
    <div className="px-1 py-2.5">
      <dt className="text-[11px] text-muted">{label}</dt>
      <dd className={`tabular text-lg font-bold ${warn ? "text-level-1" : "text-ink"}`}>{value ?? "—"}<small className="ml-0.5 text-[10px] font-normal text-muted">{unit}</small></dd>
      {sub && <dd className={`text-[10px] ${warn ? "text-level-1" : "text-muted"}`}>{sub}</dd>}
    </div>
  );
}
