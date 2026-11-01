"use client";

import { THRESHOLDS } from "@/lib/robot/types";
import { useTween } from "@/hooks/useTween";

const MAX = 50; // N — 게이지 상한

/** 반원 게이지. 임계선 3개(F_CAUTION 8 주의 / F_WARN 16 경고 / F_STOP 35 정지) — SHERPY 7.3를 눈금으로 표시 */
export default function TensionGauge({ value }: { value: number | null }) {
  const raw = value ?? 0;
  const v = useTween(raw, 600);
  const ratio = Math.max(0, Math.min(1, v / MAX));

  // 반원 경로: r=80, 중심(100,100), 180°(왼쪽) → 0°(오른쪽)
  const R = 80;
  const LEN = Math.PI * R;

  const color =
    raw >= THRESHOLDS.F_STOP ? "var(--color-level-3)"
    : raw >= THRESHOLDS.F_WARN ? "var(--color-level-2)"
    : raw >= THRESHOLDS.F_CAUTION ? "var(--color-level-1)"
    : "var(--color-level-0)";

  const tickAngle = (n: number) => Math.PI * (1 - n / MAX);
  const tick = (n: number) => {
    const a = tickAngle(n);
    // 서버/브라우저 부동소수 끝자리 차이로 하이드레이션이 어긋나지 않게 반올림
    const r2 = (x: number) => Math.round(x * 100) / 100;
    return {
      x1: r2(100 + (R - 10) * Math.cos(a)), y1: r2(100 - (R - 10) * Math.sin(a)),
      x2: r2(100 + (R + 8) * Math.cos(a)),  y2: r2(100 - (R + 8) * Math.sin(a)),
    };
  };

  return (
    <div className="flex flex-col items-center">
      <svg viewBox="0 0 200 118" className="w-full max-w-[260px]" role="img" aria-label={`장력 ${raw.toFixed(1)}뉴턴`}>
        <path d={`M 20 100 A ${R} ${R} 0 0 1 180 100`} fill="none"
              stroke="var(--color-line)" strokeWidth="14" strokeLinecap="round" />
        <path d={`M 20 100 A ${R} ${R} 0 0 1 180 100`} fill="none"
              stroke={color} strokeWidth="14" strokeLinecap="round"
              strokeDasharray={`${LEN * ratio} ${LEN}`}
              style={{ transition: "stroke .3s ease", filter: raw >= THRESHOLDS.F_WARN ? `drop-shadow(0 0 6px ${color})` : undefined }} />

        {/* 바늘 끝 — 현재 값 위치에 빛나는 점 */}
        <circle cx={Math.round((100 + R * Math.cos(Math.PI * (1 - ratio))) * 100) / 100} cy={Math.round((100 - R * Math.sin(Math.PI * (1 - ratio))) * 100) / 100} r="5"
                fill="white" stroke={color} strokeWidth="3" />

        {[THRESHOLDS.F_CAUTION, THRESHOLDS.F_WARN, THRESHOLDS.F_STOP].map((n) => {
          const t = tick(n);
          return <line key={n} {...t} stroke="var(--color-muted)" strokeWidth="2" />;
        })}

        <text x="100" y="86" textAnchor="middle"
              className="tabular fill-[var(--color-ink)] text-[30px] font-bold">
          {v.toFixed(1)}
        </text>
        <text x="100" y="105" textAnchor="middle" className="fill-[var(--color-muted)] text-[12px]">
          N
        </text>
      </svg>
      <p className="mt-1 text-xs text-muted">견인 장력 · 상한 {MAX}N</p>
    </div>
  );
}
