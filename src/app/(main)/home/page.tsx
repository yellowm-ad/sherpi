"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Search, Play, Gauge, ShieldCheck, Navigation, ChevronRight, Plus, Users, Trees, GraduationCap, Mountain,
  Ruler, Clock, Heart, ShoppingBag, MessagesSquare, PenLine,
} from "lucide-react";
import AppHeader from "@/components/ui/AppHeader";
import WalkScoreCard from "@/components/weather/WalkScoreCard";
import RouteMap, { MAP_COLOR } from "@/components/map/RouteMap";
import RouteThumb from "@/components/map/RouteThumb";
import { useRobotStream } from "@/hooks/useRobotStream";
import { useUser } from "@/lib/session";
import { useMyRoutes, findRoute } from "@/lib/my-routes";
import { ROUTES, CROWD, CROWD_LABEL, CROWD_BADGE, MARKET, routeLength, routeDurationMin } from "@/lib/demo/data";
import { useDog } from "@/lib/dog";
import { useWalks, pullTrend } from "@/lib/my-walks";
import { useLiveWalk } from "@/lib/live-walk";
import { josa } from "@/lib/format";

const QUICK_PLACES = ["덕진공원", "전북대학교", "건지산"];
const CROWD_ICON = [Trees, GraduationCap, Mountain]; // CROWD 순서: 덕진공원 · 전북대 정문 · 건지산
type Room = { id: number; title: string; emoji: string; lastMessage: string; todayCount: number };

/** S06 홈 — 스티치 안(2026-10-25): 검색 · 히어로 · 실시간 HUD · 날씨 · 혼잡도 · 추천 코스 · 마켓/커뮤니티 (PRD F-5) */
export default function HomePage() {
  const router = useRouter();
  const { latest, state } = useRobotStream(1);
  const user = useUser();
  const mine = useMyRoutes();
  const dog = useDog();
  const walks = useWalks();
  const live = useLiveWalk();
  // 최근 7일 기록만 집계 — 렌더 중 Date.now() 대신 마운트 시각을 써서 하이드레이션 값이 흔들리지 않게
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!live) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [live]);
  const week = walks.filter((w) => now - Date.parse(w.startedAt) < 7 * 86_400_000);
  const trend = pullTrend(walks);
  const pullsThis = week.reduce((s, w) => s + w.pullCount, 0);

  const [q, setQ] = useState("");
  const searchMap = (query: string) => router.push(query ? `/map?q=${encodeURIComponent(query)}` : "/map");

  const [rooms, setRooms] = useState<Room[]>([]);
  useEffect(() => {
    fetch("/api/community/rooms").then((r) => (r.ok ? r.json() : { rooms: [] })).then((j) => setRooms(j.rooms ?? [])).catch(() => {});
  }, []);

  const following = latest?.mode === "follow";
  const route = findRoute(latest?.routeId) ?? ROUTES[0];
  const lines = useMemo(() => [{ id: route.id, points: route.points, color: MAP_COLOR.route, weight: 5 }], [route]);
  const markers = useMemo(
    () => (latest?.lat != null && latest.lng != null ? [{ lat: latest.lat, lng: latest.lng, label: "셰르피", kind: "robot" as const }] : []),
    [latest?.lat, latest?.lng],
  );

  const elapsed = live ? Math.max(0, Math.floor((now - live.startedAt) / 1000)) : 0;
  const clock = `${String(Math.floor(elapsed / 3600)).padStart(2, "0")}:${String(Math.floor(elapsed / 60) % 60).padStart(2, "0")}:${String(elapsed % 60).padStart(2, "0")}`;

  return (
    <div>
      <AppHeader latest={latest} state={state} />

      <div className="stagger flex flex-col gap-5 px-4 pt-2 pb-6">
        {/* 검색 + 빠른 장소 칩 */}
        <section style={{ "--i": 0 } as React.CSSProperties}>
          <form onSubmit={(e) => { e.preventDefault(); searchMap(q.trim()); }}
                className="flex items-center rounded-full border border-line bg-surface pl-4 shadow-soft transition focus-within:border-sherpy-600 focus-within:ring-4 focus-within:ring-sherpy-600/15">
            <Search size={19} className="shrink-0 text-sherpy-600" />
            <input value={q} onChange={(e) => setQ(e.target.value)} enterKeyHint="search" aria-label="산책할 곳 검색"
                   placeholder="어디로 산책할까요? (공원·주소·건물)"
                   className="h-12 min-w-0 flex-1 bg-transparent px-2.5 text-[15px] outline-none placeholder:text-muted" />
            <button type="submit" className="mr-1.5 flex h-9 items-center gap-1 rounded-full bg-sherpy-600 px-3.5 text-xs font-semibold text-white">
              찾기
            </button>
          </form>
          <div className="no-scrollbar -mx-4 mt-3 flex gap-2 overflow-x-auto px-4 pb-1">
            <Link href="/map" className="chip" data-active="true">전체</Link>
            {QUICK_PLACES.map((p) => <button key={p} onClick={() => searchMap(p)} className="chip">{p}</button>)}
            <Link href="/routes/new" className="chip"><Plus size={14} className="text-mint-700" />코스 만들기</Link>
          </div>
        </section>

        {/* 끝내지 않은 산책이 있으면 맨 위에서 이어갈 수 있게 */}
        {live && (
          <Link href="/walks/live" className="press animate-drop -mt-2 flex items-center gap-2 rounded-full bg-ink px-4 py-3 text-sm text-white shadow-float">
            <span className="text-level-3"><span className="live-dot" /></span>
            <span className="tabular flex-1 font-semibold">산책 기록 중 · {Math.floor(elapsed / 60)}분 경과</span>
            <span className="text-xs text-sherpy-100">이어하기</span>
            <ChevronRight size={16} />
          </Link>
        )}

        {/* 히어로 — 브랜드 한 줄 + 산책 시작 */}
        <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-sherpy-700 via-sherpy-600 to-sherpy-400 p-5 text-white shadow-lift" style={{ "--i": 1 } as React.CSSProperties}>
          <div className="relative z-10 flex flex-col gap-2">
            <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-white/20 px-2.5 py-1 text-[11px] font-semibold backdrop-blur-md">
              <ShieldCheck size={14} />
              {following ? "자율주행 · 장력 제어 가동 중" : state === "offline" ? "셰르피 연결 대기" : "셰르피 준비 완료"}
            </span>
            <h1 className="text-[26px] leading-[34px] font-bold tracking-tight">
              로봇이 줄을 잡고,<br />보호자는 지켜보기만.
            </h1>
            <p className="text-sm leading-snug text-white/90">
              {user ? `${user.nickname}님, ${josa(dog.name, "와", "과")} ` : ""}줄 당김 없는 편안하고 자유로운 산책을 시작하세요.
            </p>
            <div className="flex flex-wrap items-center gap-2.5 pt-2">
              <Link href="/walks/live" className="press flex items-center gap-2 rounded-full bg-surface px-5 py-3 text-sm font-semibold text-sherpy-600 shadow-float">
                <Play size={18} className="fill-sherpy-600" />셰르피와 산책 시작
              </Link>
              <Link href="/robot" className="press flex items-center gap-1.5 rounded-full bg-white/15 px-4 py-3 text-xs font-semibold backdrop-blur-md">
                <Gauge size={16} />대시보드
              </Link>
            </div>
          </div>
          {/* 배경 장식 — 로고의 강아지 실루엣 대신 큰 로봇 아이콘을 옅게 */}
          <svg viewBox="0 0 24 24" className="pointer-events-none absolute -right-6 -bottom-6 h-40 w-40 text-white/15" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
            <rect x="4" y="8" width="16" height="12" rx="3" /><path d="M12 8V4" /><circle cx="12" cy="3" r="1" /><circle cx="9" cy="14" r="1.2" /><circle cx="15" cy="14" r="1.2" />
          </svg>
        </section>

        {/* 실시간 위치 + 산책 HUD */}
        <section className="card-lift relative overflow-hidden" style={{ "--i": 2 } as React.CSSProperties}>
          <RouteMap center={route.points[0]} level={5} lines={lines} markers={markers} fitTo={route.points} fitPad={[50, 30, 30, 30]} className="h-48" />
          <span className="pointer-events-none absolute top-3 left-3 z-10 flex items-center gap-2 rounded-full border border-line bg-surface/90 px-3 py-1.5 text-[11px] font-bold text-sherpy-600 shadow-soft backdrop-blur-md">
            <span className="text-sherpy-600"><span className="live-dot" /></span>
            {latest?.gpsSrc === "robot" ? "로봇 GPS 실시간 위치" : "실시간 위치"}
          </span>

          <div className="p-4">
            <div className="mb-3 flex items-center justify-between border-b border-line/70 pb-2.5">
              <span className="flex min-w-0 items-center gap-1.5 text-sm font-bold">
                <Navigation size={17} className="shrink-0 text-sherpy-600" />
                <span className="truncate">{live ? "현재 산책 진행 중" : route.name}</span>
              </span>
              <span className={`flex shrink-0 items-center gap-1 text-[11px] font-semibold ${(latest?.safetyLevel ?? 0) === 0 ? "text-mint-700" : "text-level-1"}`}>
                <span className="h-1.5 w-1.5 rounded-full bg-current" />
                {latest ? ((latest.safetyLevel ?? 0) === 0 ? "장력 안정적" : `L${latest.safetyLevel} 주의`) : "상태 확인 중"}
              </span>
            </div>
            <div className="grid grid-cols-3 divide-x divide-line text-center">
              {live ? (
                <>
                  <Hud label="이동 거리" value={(live.dist / 1000).toFixed(2)} unit="km" primary />
                  <Hud label="산책 시간" value={clock} />
                  <Hud label="당김" value={String(live.pulls)} unit="회" />
                </>
              ) : (
                <>
                  <Hud label="장력" value={latest?.tensionN != null ? latest.tensionN.toFixed(1) : "—"} unit="N" primary />
                  <Hud label="줄 길이" value={latest?.leashLenM != null ? latest.leashLenM.toFixed(1) : "—"} unit="m" />
                  <Hud label="속도" value={(latest?.speedMps ?? latest?.speedCmd) != null ? (latest!.speedMps ?? latest!.speedCmd)!.toFixed(1) : "—"} unit="m/s" />
                </>
              )}
            </div>
            <Link href={live ? "/walks/live" : "/robot"} className="press mt-3 flex items-center justify-center gap-1 rounded-full bg-sherpy-50 py-2.5 text-xs font-semibold text-sherpy-700">
              {live ? "산책 화면으로" : "셰르피 제어하기"} <ChevronRight size={15} />
            </Link>
          </div>
        </section>

        <div style={{ "--i": 3 } as React.CSSProperties}><WalkScoreCard /></div>

        {/* 주변 혼잡도 — 명목상 기능 (PRD F-9) */}
        <section className="card p-4" style={{ "--i": 4 } as React.CSSProperties}>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="flex items-center gap-1.5 text-[17px] font-semibold"><Users size={20} className="text-sherpy-600" />주변 장소별 혼잡도</h2>
            <Link href="/map" className="text-[11px] font-semibold text-sherpy-600">지도에서 보기</Link>
          </div>
          <ul className="space-y-2">
            {CROWD.map((c, i) => {
              const Icon = CROWD_ICON[i % CROWD_ICON.length];
              return (
                <li key={c.areaCode}>
                  <button onClick={() => searchMap(c.name)} className="press flex w-full items-center justify-between rounded-2xl border border-line/70 p-2.5 text-left">
                    <span className="flex items-center gap-2.5">
                      <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-sherpy-50 text-sherpy-600"><Icon size={18} /></span>
                      <span className="text-[13px] font-bold">{c.name}</span>
                    </span>
                    <span className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold ${CROWD_BADGE[c.level]}`}>
                      <span className="h-1.5 w-1.5 rounded-full bg-current" />{CROWD_LABEL[c.level]}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          <p className="mt-2 text-[10px] text-muted">시연용 데이터 · 실제 유동인구 연동 전</p>
        </section>

        {/* 이번 주 리포트 — 당김 횟수는 셰르피만 낼 수 있는 데이터 (PRD F-6) */}
        <section className="card p-4" style={{ "--i": 5 } as React.CSSProperties}>
          <div className="flex items-center justify-between">
            <h2 className="text-[17px] font-semibold">최근 7일 · {dog.name}</h2>
            <Link href="/walks" className="text-[11px] font-semibold text-sherpy-600">전체 기록</Link>
          </div>
          <div className="mt-3 grid grid-cols-3 divide-x divide-line text-center">
            <Hud label="걸은 거리" value={(week.reduce((s, w) => s + w.distanceM, 0) / 1000).toFixed(1)} unit="km" primary />
            <Hud label="산책" value={String(week.length)} unit="회" />
            <Hud label="당김" value={String(pullsThis)} unit="회" />
          </div>
          <p className="mt-3 rounded-2xl bg-mint-50 px-3 py-2.5 text-xs text-mint-700">
            {trend == null ? "산책을 몇 번 더 기록하면 당김 변화를 알려드릴게요."
              : trend.pct < 0 ? <>최근 산책에서 당김이 <b className="tabular">{-trend.pct}%</b> 줄었어요. 리드줄 훈련이 효과를 보고 있어요.</>
              : trend.pct === 0 ? "당김 횟수가 지난번과 같아요. 꾸준함이 중요해요."
              : <>최근 산책에서 당김이 <b className="tabular">{trend.pct}%</b> 늘었어요. 출발 전 충분히 냄새 맡게 해 주세요.</>}
          </p>
        </section>

        {/* 추천 코스 */}
        <section style={{ "--i": 6 } as React.CSSProperties}>
          <div className="mb-3 flex items-end justify-between gap-2">
            <div>
              <h2 className="text-xl font-bold tracking-tight">{mine.length ? "내 코스 · 추천 코스" : "오늘의 추천 산책코스"}</h2>
              <p className="text-[13px] text-muted">덕진공원 근처, 셰르피가 다녀 본 길부터</p>
            </div>
            <Link href="/routes/new" className="flex shrink-0 items-center gap-1 rounded-full border border-sherpy-600 px-3 py-1.5 text-[11px] font-semibold text-sherpy-600">
              <PenLine size={14} />코스 만들기
            </Link>
          </div>
          <div className="no-scrollbar -mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-px-4 px-4 pb-2">
            {[...mine, ...ROUTES].map((r, i) => (
              <Link key={r.id} href={`/routes/${r.id}`} className="press card w-[78%] max-w-[300px] shrink-0 snap-start overflow-hidden">
                <div className="relative">
                  <RouteThumb points={r.points} className="h-32 w-full" />
                  <span className="absolute top-3 left-3 rounded-full bg-surface/90 px-2.5 py-1 text-[11px] font-bold text-sherpy-600 shadow-soft backdrop-blur-md">
                    {r.id > 1000 ? "내 코스" : i === mine.length ? "인기 추천 1위" : r.taught ? "자동주행 가능" : "추천 코스"}
                  </span>
                  <span className="absolute top-3 right-3 flex items-center gap-0.5 rounded-full bg-surface/85 px-2 py-1 text-[11px] font-semibold text-body backdrop-blur-md">
                    <Heart size={12} />{r.likeCount}
                  </span>
                </div>
                <div className="flex flex-col gap-2 p-4">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="truncate text-[17px] font-semibold">{r.name}</h3>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold ${r.difficulty === "쉬움" ? "bg-mint-50 text-mint-700" : r.difficulty === "보통" ? "bg-sherpy-50 text-sherpy-700" : "bg-level-2/10 text-level-2"}`}>
                      난이도 {r.difficulty}
                    </span>
                  </div>
                  <p className="tabular flex items-center gap-3 text-[13px] text-muted">
                    <span className="flex items-center gap-1"><Ruler size={14} />{(routeLength(r.points) / 1000).toFixed(1)} km</span>
                    <span className="flex items-center gap-1"><Clock size={14} />{routeDurationMin(r.points)}분</span>
                  </p>
                  {r.pois.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {r.pois.slice(0, 3).map((p, j) => <span key={j} className="rounded-md bg-bg px-2 py-0.5 text-[10px] font-semibold text-body">{p.label}</span>)}
                    </div>
                  )}
                  <span className="mt-1 rounded-full bg-sherpy-600 py-2.5 text-center text-xs font-semibold text-white">코스 보기</span>
                </div>
              </Link>
            ))}
          </div>
        </section>

        {/* 마켓(명목상, PRD F-8) · 커뮤니티 */}
        <section className="card p-4" style={{ "--i": 7 } as React.CSSProperties}>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-[17px] font-semibold"><ShoppingBag size={20} className="text-sherpy-600" />셰르피 마켓</h2>
            <Link href="/market" className="flex items-center text-[11px] font-semibold text-sherpy-600">전체보기<ChevronRight size={14} /></Link>
          </div>
          <div className="grid grid-cols-3 gap-2.5">
            {MARKET.slice(0, 3).map((m) => (
              <Link key={m.id} href="/market" className="press flex flex-col rounded-2xl border border-line/70 bg-sherpy-50/50 p-2">
                <span className="mb-2 flex aspect-square w-full items-center justify-center rounded-xl bg-surface text-4xl">{m.emoji}</span>
                <span className="truncate text-[11px] font-bold">{m.title}</span>
                <span className="tabular text-[11px] font-extrabold text-sherpy-600">₩{m.price.toLocaleString("ko-KR")}</span>
              </Link>
            ))}
          </div>
        </section>

        <section className="card p-4" style={{ "--i": 8 } as React.CSSProperties}>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-[17px] font-semibold"><MessagesSquare size={20} className="text-sherpy-600" />산책 커뮤니티</h2>
            <Link href="/community" className="flex items-center text-[11px] font-semibold text-sherpy-600">이야기 나누기<ChevronRight size={14} /></Link>
          </div>
          <ul className="space-y-2.5">
            {(rooms.length ? rooms.slice(0, 2) : [null, null]).map((r, i) => r ? (
              <li key={r.id}>
                <Link href={`/community/${r.id}`} className="press flex gap-3 rounded-2xl border border-line/70 bg-bg/60 p-2.5">
                  <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-xl ${i ? "bg-mint-50" : "bg-sherpy-50"}`}>{r.emoji}</span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2">
                      <span className="truncate text-xs font-bold">{r.title}</span>
                      {r.todayCount > 0 && <span className="tabular shrink-0 text-[11px] text-muted">오늘 {r.todayCount}개</span>}
                    </span>
                    <span className="mt-0.5 block truncate text-[13px] text-body">{r.lastMessage || "첫 이야기를 남겨 보세요"}</span>
                  </span>
                </Link>
              </li>
            ) : <li key={i} className="skeleton h-16 rounded-2xl" />)}
          </ul>
        </section>
      </div>
    </div>
  );
}

function Hud({ label, value, unit, primary }: { label: string; value: string; unit?: string; primary?: boolean }) {
  return (
    <div className="px-1">
      <span className="block text-[11px] font-semibold text-muted">{label}</span>
      <span className={`metric mt-0.5 block ${primary ? "text-sherpy-600" : ""}`}>
        {value}{unit && <span className="ml-0.5 text-[13px] font-medium text-ink">{unit}</span>}
      </span>
    </div>
  );
}
