"use client";

import { use, useMemo } from "react";
import { TriangleAlert } from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import RouteMap, { MAP_COLOR } from "@/components/map/RouteMap";
import { routeById } from "@/lib/demo/data";
import { findRoute } from "@/lib/my-routes";
import { useWalks, isLocalWalk } from "@/lib/my-walks";
import { SAFETY_COLOR } from "@/lib/robot/types";

/** S13 산책 기록 상세 — 자동 리포트 (PRD F-6) */
export default function WalkDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const walks = useWalks();
  const w = walks.find((x) => x.id === Number(id));
  const r = w ? routeById(w.routeId) ?? findRoute(w.routeId) : undefined;
  // 내가 기록한 산책은 실제로 지나간 궤적을, 시연 기록은 코스 선을 그린다
  const path = w?.trail && w.trail.length > 1 ? w.trail : r?.points;
  const lines = useMemo(() => (path ? [{ id: "walk", points: path, color: MAP_COLOR.trail, weight: 6 }] : []), [path]);

  if (!w || !path) return <><PageHeader title="산책 기록" back /><p className="p-6 text-center text-muted">기록이 없습니다.</p></>;
  const d = new Date(w.startedAt);

  return (
    <div>
      <PageHeader title={`${d.getMonth() + 1}월 ${d.getDate()}일 산책`} back />
      <RouteMap center={path[0]} lines={lines} fitTo={path} className="h-56" />
      <div className="px-4 pt-4 pb-8">
        <p className="text-sm text-muted">{r?.name ?? "자유 산책"} · {d.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })} 시작{w.walkScore ? ` · 산책적합도 ${w.walkScore}점` : ""}
          {isLocalWalk(w.id) && <span className="ml-1.5 rounded-full bg-sherpy-600 px-1.5 py-0.5 text-[10px] font-semibold text-white">이 기기에 저장됨</span>}</p>
        <p className="tabular mt-1 text-2xl font-bold">
          {(w.distanceM / 1000).toFixed(2)}km · {Math.round(w.durationS / 60)}분
        </p>

        <div className="mt-4 grid grid-cols-2 gap-2">
          <Cell label="평균 속도" value={`${w.avgSpeed} m/s`} />
          <Cell label="최고 속도" value={`${w.maxSpeed} m/s`} />
          <Cell label="평균 장력" value={`${w.avgTensionN} N`} />
          <Cell label="최대 장력" value={`${w.maxTensionN} N`} />
          <Cell label="당김 횟수" value={`${w.pullCount}회`} hl />
          <Cell label="안전 경고" value={`${w.warnings.length}회`} />
        </div>

        <section className="card mt-3 p-4">
          <h2 className="text-sm font-bold">안전 경고 이력</h2>
          {w.warnings.length === 0 ? (
            <p className="mt-2 text-sm text-muted">경고 없이 끝났어요.</p>
          ) : (
            <ul className="mt-2 space-y-2">
              {w.warnings.map((x, i) => (
                <li key={i} className="flex items-center gap-2 text-sm">
                  <TriangleAlert size={16} style={{ color: SAFETY_COLOR[x.level] }} />
                  <span className="tabular text-muted">{x.at}</span>
                  <span>L{x.level} {x.reason}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

function Cell({ label, value, hl }: { label: string; value: string; hl?: boolean }) {
  return (
    <div className={`card p-3 ${hl ? "border-sherpy-400 bg-sherpy-50" : ""}`}>
      <p className="text-xs text-muted">{label}</p>
      <p className="tabular mt-0.5 text-lg font-bold">{value}</p>
    </div>
  );
}
