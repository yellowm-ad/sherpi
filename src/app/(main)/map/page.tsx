"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { Plus, Users, Heart, Lock, LogIn, Pencil, X, PenLine } from "lucide-react";
import RouteMap, { type MapFocus } from "@/components/map/RouteMap";
import PlaceSearch, { type Place } from "@/components/map/PlaceSearch";
import { DEOKJIN } from "@/components/weather/WalkScoreCard";
import { ROUTES, CROWD, CROWD_LABEL, routeLength, routeDurationMin, type DemoRoute } from "@/lib/demo/data";
import { useMyRoutes } from "@/lib/my-routes";
import { useUser } from "@/lib/session";

const ROUTE_COLORS = ["#2563EB", "#06B6D4", "#1D4ED8"];
const CROWD_COLOR = ["", "#16A34A", "#CA8A04", "#DC2626"];

/** S07 지도 — 코스 탐색(추천 / 내 코스) + 장소 검색 + 혼잡도(명목상) (PRD F-4, F-9) */
export default function MapPage() {
  const user = useUser();
  const mine = useMyRoutes();
  const [tab, setTab] = useState<"pub" | "mine">("pub");
  const [picked, setPicked] = useState<number | null>(null);
  const [showCrowd, setShowCrowd] = useState(false);
  // 검색한 곳 — 지도를 옮기고, 거기서 바로 코스를 그리러 갈 수 있게
  const [place, setPlace] = useState<Place | null>(null);
  const [focus, setFocus] = useState<MapFocus | null>(null);
  const onPlace = (p: Place) => { setPlace(p); setFocus({ lat: p.lat, lng: p.lng, level: 4, key: Date.now() }); };

  const list: DemoRoute[] = tab === "pub" ? ROUTES : mine;
  const selected = list.some((r) => r.id === picked) ? picked : list[0]?.id ?? null;

  const lines = useMemo(
    () => list.map((r, i) => ({
      id: r.id, points: r.points,
      color: ROUTE_COLORS[i % ROUTE_COLORS.length],
      weight: r.id === selected ? 7 : 4,
      dashed: r.id !== selected,
    })),
    [list, selected],
  );
  const markers = useMemo(
    () => [
      ...list.map((r) => ({ lat: r.points[0][0], lng: r.points[0][1], label: r.name })),
      ...(place ? [{ lat: place.lat, lng: place.lng, label: place.name, kind: "place" as const }] : []),
    ],
    [list, place],
  );
  const circles = useMemo(
    () => (showCrowd ? CROWD.map((c) => ({ lat: c.lat, lng: c.lng, radius: 180, color: CROWD_COLOR[c.level], label: `${c.name} · ${CROWD_LABEL[c.level]}` })) : []),
    [showCrowd],
  );
  const sel = list.find((r) => r.id === selected);
  // 고른 코스로 지도가 따라간다 (추천 코스도 마찬가지)
  const fitTo = useMemo(() => sel?.points, [sel]);

  // 카드를 옆으로 넘기면 가운데 온 카드가 선택된다 — 지도와 카드가 항상 같은 코스를 가리키게
  const rail = useRef<HTMLDivElement>(null);
  const scrollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onRailScroll = () => {
    if (scrollTimer.current) clearTimeout(scrollTimer.current);
    scrollTimer.current = setTimeout(() => {
      const el = rail.current;
      if (!el) return;
      const mid = el.scrollLeft + el.clientWidth / 2;
      let best: { id: number; d: number } | null = null;
      for (const c of Array.from(el.children) as HTMLElement[]) {
        const d = Math.abs(c.offsetLeft + c.offsetWidth / 2 - mid);
        if (!best || d < best.d) best = { id: Number(c.dataset.id), d };
      }
      if (best && best.id !== selected) setPicked(best.id);
    }, 120);
  };
  const pick = (id: number, el: HTMLElement) => {
    setFocus(null);
    setPicked(id);
    el.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
  };

  return (
    <div className="relative">
      <RouteMap center={[DEOKJIN.lat, DEOKJIN.lng]} level={5} lines={lines} markers={markers} circles={circles} fitTo={fitTo} fitPad={[180, 40, 190, 40]} focus={focus}
                className="h-[calc(100dvh-4.5rem)]" />

      {/* 상단 컨트롤 — 검색 / 탭·혼잡도 / 코스 만들기 */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 space-y-2 p-3">
        <PlaceSearch onPick={onPlace} near={sel?.points[0] ?? [DEOKJIN.lat, DEOKJIN.lng]} />
        <div className="flex items-center gap-2">
          <div className="pointer-events-auto flex flex-1 rounded-2xl bg-surface/95 p-1 shadow-md backdrop-blur">
            {([["pub", "추천 코스"], ["mine", `내 코스${user ? ` ${mine.length}` : ""}`]] as const).map(([k, label]) => (
              <button key={k} onClick={() => setTab(k)}
                      className={`touch flex-1 rounded-xl text-sm font-semibold transition ${tab === k ? "bg-sherpy-600 text-white" : "text-body"}`}>
                {label}
              </button>
            ))}
          </div>
          <button onClick={() => setShowCrowd((v) => !v)}
                  className={`touch pointer-events-auto flex items-center gap-1 self-stretch rounded-2xl px-3 text-xs font-semibold shadow-md ${showCrowd ? "bg-sherpy-600 text-white" : "bg-surface text-body"}`}>
            <Users size={15} /> 혼잡도
          </button>
        </div>
        <div className="flex items-start justify-between gap-2">
          {place ? (
            <div className="animate-fade pointer-events-auto flex min-w-0 items-center gap-1 rounded-full bg-surface pl-1 shadow-lg">
              <Link href={`/routes/new?lat=${place.lat}&lng=${place.lng}&name=${encodeURIComponent(place.name)}`}
                    className="flex h-10 min-w-0 items-center gap-1 rounded-full bg-sherpy-600 px-3.5 text-sm font-semibold text-white">
                <PenLine size={15} className="shrink-0" /><span className="truncate">여기서 코스 만들기</span>
              </Link>
              <button onClick={() => setPlace(null)} aria-label="검색한 곳 지우기" className="flex h-10 w-9 items-center justify-center text-muted"><X size={16} /></button>
            </div>
          ) : (
            <Link href="/routes/new" aria-label="코스 만들기"
                  className="pointer-events-auto flex h-11 items-center gap-1 rounded-full bg-sherpy-600 px-4 text-sm font-semibold text-white shadow-lg">
              <Plus size={16} /> 코스 만들기
            </Link>
          )}
          {showCrowd && (
            <div className="animate-fade pointer-events-auto shrink-0 rounded-xl bg-surface/95 p-2.5 text-[11px] shadow-md">
              {[1, 2, 3].map((l) => (
                <p key={l} className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ background: CROWD_COLOR[l] }} />{CROWD_LABEL[l]}</p>
              ))}
              <p className="mt-1 text-muted">시연용 데이터</p>
            </div>
          )}
        </div>
      </div>

      {/* 하단 코스 카드 */}
      <div className="absolute inset-x-0 bottom-3 z-10">
        {tab === "mine" && !user ? (
          <Empty icon={<Lock size={20} />} title="로그인하면 내가 짠 코스를 저장하고 꺼내 쓸 수 있어요"
                 action={<Link href="/login?next=/map" className="flex items-center justify-center gap-1.5 rounded-xl bg-sherpy-600 py-2.5 text-sm font-semibold text-white"><LogIn size={16} />로그인</Link>} />
        ) : tab === "mine" && mine.length === 0 ? (
          <Empty icon={<Plus size={20} />} title="아직 저장한 코스가 없어요"
                 action={<Link href="/routes/new" className="block rounded-xl bg-sherpy-600 py-2.5 text-center text-sm font-semibold text-white">첫 코스 그리기</Link>} />
        ) : (
          <div ref={rail} onScroll={onRailScroll} className="no-scrollbar flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-px-4 px-4 pb-1">
            {list.map((r) => (
              <div key={r.id} data-id={r.id} role="button" tabIndex={0} aria-pressed={r.id === selected}
                   onClick={(e) => pick(r.id, e.currentTarget)}
                   onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && e.target === e.currentTarget && pick(r.id, e.currentTarget)}
                   className={`card w-[78%] shrink-0 snap-center p-4 text-left shadow-lg transition duration-300 ${r.id === selected ? "border-sherpy-600 ring-2 ring-sherpy-600/20" : "scale-[.96] opacity-90"}`}>
                <div className="flex items-center gap-1.5">
                  {tab === "mine" && <span className="rounded-full bg-sherpy-600 px-2 py-0.5 text-[11px] font-semibold text-white">내 코스</span>}
                  <span className="rounded-full bg-sherpy-50 px-2 py-0.5 text-[11px] font-semibold text-sherpy-700">{r.difficulty}</span>
                  {r.taught && <span className="rounded-full bg-accent/10 px-2 py-0.5 text-[11px] font-semibold text-accent">자동주행 가능</span>}
                  <span className="ml-auto flex items-center gap-0.5 text-xs text-muted"><Heart size={12} />{r.likeCount}</span>
                </div>
                <p className="mt-2 truncate font-bold">{r.name}</p>
                <p className="tabular text-xs text-muted">{(routeLength(r.points) / 1000).toFixed(2)}km · 약 {routeDurationMin(r.points)}분 · by {r.author}</p>
                <div className="mt-3 flex gap-2">
                  <Link href={`/routes/${r.id}`} className="press block flex-1 rounded-xl bg-sherpy-600 py-2 text-center text-sm font-semibold text-white">
                    코스 보기
                  </Link>
                  {tab === "mine" && (
                    <Link href={`/routes/${r.id}/edit`} aria-label={`${r.name} 수정`}
                          className="press flex items-center gap-1 rounded-xl border border-line px-3 text-sm font-semibold text-sherpy-700">
                      <Pencil size={14} /> 수정
                    </Link>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Empty({ icon, title, action }: { icon: React.ReactNode; title: string; action: React.ReactNode }) {
  return (
    <div className="card mx-4 p-4 shadow-lg">
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-sherpy-50 text-sherpy-600">{icon}</span>
        <p className="text-sm font-semibold">{title}</p>
      </div>
      <div className="mt-3">{action}</div>
    </div>
  );
}
