"use client";

import { useEffect, useRef, useState } from "react";
import { MapPinOff } from "lucide-react";

/* eslint-disable @typescript-eslint/no-explicit-any */
declare global {
  interface Window { kakao: any }
}

export interface MapLine { id: number | string; points: [number, number][]; color: string; weight?: number; dashed?: boolean }
export interface MapMarker { lat: number; lng: number; label: string; kind?: "poi" | "robot" | "point" | "place" }
/** 지도를 옮길 곳 — key 가 바뀔 때만 이동한다 (같은 곳을 다시 검색해도 다시 이동) */
export interface MapFocus { lat: number; lng: number; level?: number; key: number }
export interface MapCircle { lat: number; lng: number; radius: number; color: string; label?: string }

const KEY = process.env.NEXT_PUBLIC_KAKAO_MAP_KEY;

/** 지도 위 색 — 카카오맵은 CSS 변수를 못 읽어서 globals.css 토큰 값을 여기 그대로 옮겨 둔다 (바꿀 땐 둘 다) */
export const MAP_COLOR = {
  route: "#2B66FF",     // --color-sherpy-600 — 코스 선
  routeDeep: "#1E4ED8", // --color-sherpy-700
  routeAlt: "#6E8EFF",  // --color-sherpy-400 — 선택 안 된 다른 코스
  trail: "#00B574",     // 민트 — 실제로 걸은 길·로봇 위치
} as const;
let loader: Promise<any> | null = null;

/** 카카오맵 SDK를 한 번만 로드한다 (autoload=false → kakao.maps.load). services = 장소·주소 검색 */
function loadKakao(): Promise<any> {
  if (typeof window === "undefined") return Promise.reject();
  if (window.kakao?.maps?.LatLng) return Promise.resolve(window.kakao);
  if (loader) return loader;
  loader = new Promise((resolve, reject) => {
    if (!KEY) return reject(new Error("NEXT_PUBLIC_KAKAO_MAP_KEY 미설정"));
    const s = document.createElement("script");
    s.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${KEY}&autoload=false&libraries=services`;
    s.async = true;
    s.onload = () => window.kakao.maps.load(() => resolve(window.kakao));
    s.onerror = () => { loader = null; reject(new Error("카카오맵 SDK 로드 실패")); };
    document.head.appendChild(s);
  });
  return loader;
}

/**
 * 카카오맵 래퍼 — 코스 그리기 / 궤적 표시 공용 (PRD §10-3 RouteMap)
 * 색은 CSS 토큰을 읽어서 넘긴다. 카카오맵은 CSS 변수를 이해하지 못한다.
 */
export function loadKakaoMaps() { return loadKakao(); }

// 끌어서 옮길 수 있는 경유점 — CustomOverlay 는 드래그가 안 돼서 Marker + 작은 원 이미지를 쓴다
const DOT = `data:image/svg+xml;utf8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22"><circle cx="11" cy="11" r="7" fill="${MAP_COLOR.route}" stroke="#fff" stroke-width="3"/></svg>')}`;

export default function RouteMap({
  center, level = 4, lines = [], markers = [], circles = [], fitTo, fitPad = [40, 40, 40, 40], focus, onMapClick, onPointDrag, className = "h-64",
}: {
  center: [number, number];
  level?: number;
  lines?: MapLine[];
  markers?: MapMarker[];
  circles?: MapCircle[];
  fitTo?: [number, number][];
  /** 화면 맞춤 여백 [위, 오른쪽, 아래, 왼쪽] — 지도 위에 겹친 검색창·카드를 피한다 */
  fitPad?: [number, number, number, number];
  focus?: MapFocus | null;
  onMapClick?: (lat: number, lng: number) => void;
  /** 주면 kind="point" 마커를 끌어서 옮길 수 있다 — index 는 point 마커들 사이의 순번 */
  onPointDrag?: (index: number, lat: number, lng: number) => void;
  className?: string;
}) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<any>(null);
  const drawn = useRef<any[]>([]);
  const clickRef = useRef(onMapClick);
  const dragRef = useRef(onPointDrag);
  dragRef.current = onPointDrag;
  const [err, setErr] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  clickRef.current = onMapClick;

  useEffect(() => {
    let alive = true;
    loadKakao()
      .then((kakao) => {
        if (!alive || !el.current) return;
        map.current = new kakao.maps.Map(el.current, {
          center: new kakao.maps.LatLng(center[0], center[1]),
          level,
        });
        kakao.maps.event.addListener(map.current, "click", (e: any) => {
          clickRef.current?.(e.latLng.getLat(), e.latLng.getLng());
        });
        setReady(true);
      })
      .catch((e) => alive && setErr(String(e.message ?? e)));
    return () => { alive = false; };
    // 지도는 한 번만 만든다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 오버레이 다시 그리기
  useEffect(() => {
    const kakao = window.kakao;
    if (!ready || !map.current || !kakao) return;
    drawn.current.forEach((o) => o.setMap(null));
    drawn.current = [];
    const LL = (lat: number, lng: number) => new kakao.maps.LatLng(lat, lng);

    for (const c of circles) {
      drawn.current.push(new kakao.maps.Circle({
        map: map.current, center: LL(c.lat, c.lng), radius: c.radius,
        strokeWeight: 1, strokeColor: c.color, strokeOpacity: 0.6,
        fillColor: c.color, fillOpacity: 0.22,
      }));
      if (c.label) drawn.current.push(new kakao.maps.CustomOverlay({
        map: map.current, position: LL(c.lat, c.lng), yAnchor: 0.5,
        content: `<div style="font:600 11px Pretendard,sans-serif;color:${c.color};background:#fff;padding:2px 8px;border-radius:99px;border:1px solid ${c.color}">${c.label}</div>`,
      }));
    }

    for (const l of lines) {
      if (l.points.length < 2) continue;
      drawn.current.push(new kakao.maps.Polyline({
        map: map.current, path: l.points.map((p) => LL(p[0], p[1])),
        strokeWeight: l.weight ?? 5, strokeColor: l.color, strokeOpacity: 0.9,
        strokeStyle: l.dashed ? "shortdash" : "solid",
      }));
    }

    let pointIdx = 0;
    for (const m of markers) {
      if (m.kind === "point" && dragRef.current) {
        const i = pointIdx++;
        const mk = new kakao.maps.Marker({
          map: map.current, position: LL(m.lat, m.lng), draggable: true, title: m.label,
          image: new kakao.maps.MarkerImage(DOT, new kakao.maps.Size(22, 22), { offset: new kakao.maps.Point(11, 11) }),
        });
        kakao.maps.event.addListener(mk, "dragend", () => {
          const p = mk.getPosition();
          dragRef.current?.(i, p.getLat(), p.getLng());
        });
        drawn.current.push(mk);
        continue;
      }
      const style =
        m.kind === "robot"
          ? `width:18px;height:18px;border-radius:99px;background:${MAP_COLOR.trail};border:3px solid #fff;box-shadow:0 0 0 6px rgba(0,181,116,.28)`
          : m.kind === "point"
          ? `width:12px;height:12px;border-radius:99px;background:${MAP_COLOR.route};border:2px solid #fff`
          : m.kind === "place"
          ? `font:700 12px Pretendard,sans-serif;background:${MAP_COLOR.routeDeep};color:#fff;padding:5px 12px;border-radius:99px;box-shadow:0 8px 24px rgba(43,102,255,.25);white-space:nowrap`
          : `font:600 11px Pretendard,sans-serif;background:#fff;color:${MAP_COLOR.routeDeep};padding:3px 9px;border-radius:99px;border:1px solid #DCE1FF;box-shadow:0 2px 8px rgba(26,32,44,.08);white-space:nowrap`;
      drawn.current.push(new kakao.maps.CustomOverlay({
        map: map.current, position: LL(m.lat, m.lng), yAnchor: m.kind === "poi" || !m.kind ? 1.3 : 0.5,
        content: m.kind === "robot" || m.kind === "point" ? `<div title="${m.label}" style="${style}"></div>` : `<div style="${style}">${m.label}</div>`,
      }));
    }
  }, [ready, lines, markers, circles]);

  // 화면 맞춤은 fitTo 가 바뀔 때만 — 그리는 중에 선이 바뀔 때마다 지도가 튀지 않게
  // 마지막으로 요청된 화면 — 크기가 바뀌어 다시 맞출 때 이걸 다시 적용한다 (검색 이동을 코스 맞춤이 덮지 않게)
  const lastView = useRef<"fit" | "focus">("fit");
  const fitRef = useRef<() => void>(() => {});
  fitRef.current = () => {
    const kakao = window.kakao;
    if (!map.current || !kakao || !fitTo || fitTo.length < 2) return;
    const b = new kakao.maps.LatLngBounds();
    fitTo.forEach((p) => b.extend(new kakao.maps.LatLng(p[0], p[1])));
    map.current.setBounds(b, ...fitPad);
  };
  useEffect(() => {
    if (!ready || !fitTo) return;
    lastView.current = "fit";
    fitRef.current();
    // 여백은 화면마다 고정값이라 fitTo 가 바뀔 때만 맞춘다
  }, [ready, fitTo]);

  // 컨테이너 크기가 바뀌면(등장 애니메이션·회전·키보드) 지도를 다시 깔고 코스를 다시 맞춘다
  // — 안 그러면 처음 잡힌 작은 크기대로 가운데만 그려지고 나머지는 회색으로 남는다
  useEffect(() => {
    if (!ready || !el.current || typeof ResizeObserver === "undefined") return;
    let last = "";
    const ro = new ResizeObserver(([e]) => {
      const size = `${Math.round(e.contentRect.width)}x${Math.round(e.contentRect.height)}`;
      if (size === last) return;
      last = size;
      map.current?.relayout();
      if (lastView.current === "focus") focusRef.current();
      else fitRef.current();
    });
    ro.observe(el.current);
    return () => ro.disconnect();
  }, [ready]);

  // 검색한 곳으로 이동
  const focusRef = useRef<() => void>(() => {});
  focusRef.current = () => {
    const kakao = window.kakao;
    if (!map.current || !kakao || !focus) return;
    if (focus.level) map.current.setLevel(focus.level);
    map.current.setCenter(new kakao.maps.LatLng(focus.lat, focus.lng));
  };
  useEffect(() => {
    if (!ready || !focus) return;
    lastView.current = "focus";
    focusRef.current();
  }, [ready, focus]);

  if (err) {
    return (
      <div className={`${className} flex flex-col items-center justify-center gap-2 bg-sherpy-50 px-6 text-center`}>
        <MapPinOff className="text-sherpy-400" />
        <p className="text-sm font-semibold text-body">지도를 불러오지 못했습니다</p>
        <p className="text-xs text-muted">
          카카오 개발자 콘솔에서 이 주소({typeof location !== "undefined" ? location.origin : ""})를
          JavaScript SDK 도메인에 등록했는지 확인하세요.
        </p>
        {/* 로컬 개발은 localhost:3000 만 등록돼 있다 (docs/SETUP.md) — 다른 포트로 띄웠을 때 바로 알 수 있게 */}
        {typeof location !== "undefined" && location.hostname === "localhost" && location.port !== "3000" && (
          <p className="rounded-lg bg-level-1/10 px-3 py-2 text-xs text-body">
            로컬 개발은 <b>localhost:3000</b> 만 등록돼 있어요. <code>npm run dev</code> 를 기본 포트로 실행하세요.
          </p>
        )}
      </div>
    );
  }

  return (
    <div className={`${className} relative bg-sherpy-50`}>
      <div ref={el} className="absolute inset-0" />
      {!ready && <div className="absolute inset-0 flex items-center justify-center text-xs text-muted">지도 불러오는 중…</div>}
    </div>
  );
}
