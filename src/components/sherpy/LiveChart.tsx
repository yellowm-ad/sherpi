"use client";

/**
 * 시계열 그래프 (SVG) — 여러 계열 + 임계선 + 현재 시점 커서.
 * 색은 토큰 이름(var(--color-…))으로 받는다. 숫자 범례는 tabular.
 */
export interface Series { key: string; label: string; color: string; values: (number | null)[]; dashed?: boolean }

export default function LiveChart({
  title, unit, t, series, thresholds = [], cursor, tMax, yMin, yMax, height = 150, note,
}: {
  title: string; unit: string;
  t: number[];
  series: Series[];
  thresholds?: { v: number; label: string; color: string }[];
  cursor?: number;
  tMax?: number;
  yMin?: number; yMax?: number;
  height?: number;
  note?: string;
}) {
  const W = 440, H = height, L = 34, R = 8, Tp = 10, B = 20;
  const t0 = t[0] ?? 0, t1 = tMax ?? t[t.length - 1] ?? 1;
  const vals = series.flatMap((s) => s.values.filter((v): v is number => v != null && Number.isFinite(v)));
  let lo = yMin ?? Math.min(0, ...vals);
  let hi = yMax ?? Math.max(1, ...vals, ...thresholds.map((x) => x.v)) * 1.08;
  if (hi - lo < 1e-6) { hi = lo + 1; }
  const X = (x: number) => L + ((x - t0) / Math.max(1e-6, t1 - t0)) * (W - L - R);
  const Y = (v: number) => Tp + (1 - (v - lo) / (hi - lo)) * (H - Tp - B);
  const ci = cursor != null ? nearest(t, cursor) : t.length - 1;
  const step = Math.max(1, Math.floor(t.length / 400)); // 점이 많으면 솎아서 그린다

  const path = (vs: (number | null)[]) => {
    let d = "", pen = false;
    for (let i = 0; i < t.length; i += step) {
      const v = vs[i];
      if (v == null || !Number.isFinite(v) || (cursor != null && t[i] > cursor + 1e-9)) { pen = false; continue; }
      d += `${pen ? "L" : "M"}${X(t[i]).toFixed(1)},${Y(Math.max(lo, Math.min(hi, v))).toFixed(1)}`;
      pen = true;
    }
    return d;
  };
  const ticks = niceTicks(t0, t1, 4);

  return (
    <figure className="card p-3">
      <figcaption className="flex items-baseline justify-between">
        <span className="text-sm font-bold">{title}</span><span className="text-[11px] text-muted">{unit}</span>
      </figcaption>
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px]">
        {series.map((s) => {
          const v = s.values[ci];
          return (
            <span key={s.key} className="tabular flex items-center gap-1">
              <i className="inline-block h-0.5 w-3 rounded" style={{ background: s.color }} />
              <span className="text-muted">{s.label}</span>
              <b className="text-ink">{v == null ? "—" : v.toFixed(2)}</b>
            </span>
          );
        })}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="mt-1 w-full" role="img" aria-label={`${title} 그래프`}>
        {[0, 0.5, 1].map((f) => {
          const v = lo + (hi - lo) * (1 - f);
          return (
            <g key={f}>
              <line x1={L} x2={W - R} y1={Y(v)} y2={Y(v)} stroke="var(--color-line)" />
              <text x={L - 4} y={Y(v) + 3} textAnchor="end" fontSize="9" fill="var(--color-muted)">{fmt(v)}</text>
            </g>
          );
        })}
        {thresholds.map((th) => th.v >= lo && th.v <= hi && (
          <g key={th.label}>
            <line x1={L} x2={W - R} y1={Y(th.v)} y2={Y(th.v)} stroke={th.color} strokeDasharray="4 4" />
            <text x={W - R} y={Y(th.v) - 3} textAnchor="end" fontSize="9" fill={th.color}>{th.label} {th.v}</text>
          </g>
        ))}
        {series.map((s) => <path key={s.key} d={path(s.values)} fill="none" stroke={s.color} strokeWidth="1.7" strokeDasharray={s.dashed ? "4 3" : undefined} />)}
        {cursor != null && <line x1={X(cursor)} x2={X(cursor)} y1={Tp - 4} y2={H - B + 2} stroke="var(--color-sherpy-700)" strokeDasharray="3 2" />}
        {ticks.map((x) => <text key={x} x={X(x)} y={H - 5} textAnchor="middle" fontSize="9" fill="var(--color-muted)">{fmt(x)}s</text>)}
      </svg>
      {note && <p className="mt-1 text-[11px] leading-snug text-muted">{note}</p>}
    </figure>
  );
}

function nearest(t: number[], x: number) {
  let lo = 0, hi = t.length - 1;
  while (lo < hi) { const m = (lo + hi) >> 1; if (t[m] < x) lo = m + 1; else hi = m; }
  return Math.max(0, Math.min(t.length - 1, lo));
}
function fmt(v: number) { return Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(2); }
function niceTicks(a: number, b: number, n: number) {
  const span = b - a; if (span <= 0) return [a];
  const raw = span / n, p = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 5, 10].map((m) => m * p).find((s) => s >= raw) ?? raw;
  const out: number[] = [];
  for (let x = Math.ceil(a / step) * step; x <= b + 1e-9; x += step) out.push(Math.round(x * 1000) / 1000);
  return out;
}
