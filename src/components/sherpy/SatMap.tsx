"use client";

import { useEffect, useRef, useState } from "react";
import { Layers, LocateFixed, MapPinOff } from "lucide-react";
import { loadKakaoMaps, MAP_COLOR } from "@/components/map/RouteMap";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * 실시간 위성지도 — 로봇 GPS 위치 + 강아지 추정 위치(목줄 끝) + 오차 원 + 걸어온 길.
 * 카카오맵 오버레이를 매번 새로 만들지 않고 한 번 만든 뒤 setPosition 으로 옮긴다 (4 Hz 갱신에도 깜빡이지 않게).
 *
 * ⚠️ 축척 감각: GPS 수평오차(2.5~5 m)가 줄 길이(1.2~3 m)보다 크다.
 *    지도의 강아지 점은 "로봇 GPS + 로봇이 잰 상대위치"라 상대위치는 cm 정확도지만 절대위치는 GPS 만큼 흔들린다.
 *    줄 끝의 정확한 모습은 탑뷰(TopView)가 보여 준다.
 */
export interface SatPoint { lat: number; lng: number }

// 카카오맵은 CSS 변수를 못 읽는다 — globals.css 토큰 값을 옮겨 둔다 (바꿀 땐 둘 다)
const DOG = "#E8A65C";     // --color-dog
const DOG_DARK = "#B86F2E"; // --color-dog-dark

export default function SatMap({
  robot, dog, radius, trail = [], heading, className = "h-64", zoom = 1, safety = 0,
}: {
  robot: SatPoint | null;
  dog: SatPoint | null;
  /** 강아지 위치 반경 m (추정 1σ ⊕ GPS 오차) */
  radius?: number;
  trail?: [number, number][];
  heading?: number | null;
  className?: string;
  /** 카카오 지도 레벨 (1 = 가장 확대) */
  zoom?: number;
  /** 안전 단계 0~3 — 목줄 선 색 (CSS 토큰 --color-level-N 을 실행 중에 읽는다) */
  safety?: number;
}) {
  const el = useRef<HTMLDivElement>(null);
  const S = useRef<any>({});
  const [ready, setReady] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [sky, setSky] = useState(true);
  const [follow, setFollow] = useState(true);
  const followRef = useRef(follow);
  followRef.current = follow;

  useEffect(() => {
    let alive = true;
    loadKakaoMaps().then((kakao: any) => {
      if (!alive || !el.current) return;
      const c = robot ?? { lat: 35.8479, lng: 127.1224 };
      const map = new kakao.maps.Map(el.current, { center: new kakao.maps.LatLng(c.lat, c.lng), level: zoom });
      map.setMapTypeId(kakao.maps.MapTypeId.HYBRID);
      kakao.maps.event.addListener(map, "dragstart", () => setFollow(false));
      const LL = (p: SatPoint) => new kakao.maps.LatLng(p.lat, p.lng);
      const s = S.current;
      s.kakao = kakao; s.map = map; s.LL = LL;
      s.trail = new kakao.maps.Polyline({ map, path: [], strokeWeight: 4, strokeColor: MAP_COLOR.trail, strokeOpacity: 0.85 });
      s.circle = new kakao.maps.Circle({ map, center: LL(c), radius: 3, strokeWeight: 1.5, strokeColor: DOG, strokeOpacity: 0.9, fillColor: DOG, fillOpacity: 0.22 });
      s.leash = new kakao.maps.Polyline({ map, path: [], strokeWeight: 3, strokeColor: "#ffffff", strokeOpacity: 0.95 });
      s.robotEl = document.createElement("div");
      s.robotEl.innerHTML = `<div style="position:relative;width:22px;height:22px"><div data-arrow style="position:absolute;left:5px;top:-7px;width:0;height:0;border-left:6px solid transparent;border-right:6px solid transparent;border-bottom:9px solid ${MAP_COLOR.routeDeep};transform-origin:6px 18px"></div><div style="width:22px;height:22px;border-radius:7px;background:${MAP_COLOR.route};border:3px solid #fff;box-shadow:0 0 0 5px rgba(43,102,255,.3)"></div></div>`;
      s.robot = new kakao.maps.CustomOverlay({ map, position: LL(c), content: s.robotEl, yAnchor: 0.5, xAnchor: 0.5, zIndex: 3 });
      s.dogEl = document.createElement("div");
      s.dogEl.innerHTML = `<div style="display:flex;flex-direction:column;align-items:center"><div style="width:18px;height:18px;border-radius:99px;background:${DOG};border:3px solid #fff;box-shadow:0 0 0 2px ${DOG_DARK}"></div><div style="margin-top:2px;font:700 10px Pretendard,sans-serif;color:#fff;text-shadow:0 1px 3px #000">강아지</div></div>`;
      s.dog = new kakao.maps.CustomOverlay({ map, position: LL(c), content: s.dogEl, yAnchor: 0.3, xAnchor: 0.5, zIndex: 4 });
      setReady(true);
    }).catch((e: Error) => alive && setErr(e.message));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const s = S.current;
    if (!ready || !s.map) return;
    s.map.setMapTypeId(sky ? s.kakao.maps.MapTypeId.HYBRID : s.kakao.maps.MapTypeId.ROADMAP);
  }, [ready, sky]);

  useEffect(() => {
    const s = S.current;
    if (!ready || !s.map) return;
    if (robot) {
      s.robot.setPosition(s.LL(robot));
      s.robot.setMap(s.map);
      const arrow = s.robotEl.querySelector("[data-arrow]") as HTMLElement;
      if (arrow) { arrow.style.display = heading == null ? "none" : "block"; arrow.style.transform = `rotate(${heading ?? 0}deg)`; }
      if (followRef.current) s.map.setCenter(s.LL(robot));
    } else s.robot.setMap(null);
    if (robot && dog) {
      s.dog.setPosition(s.LL(dog)); s.dog.setMap(s.map);
      s.leash.setPath([s.LL(robot), s.LL(dog)]); s.leash.setMap(s.map);
      const col = getComputedStyle(document.documentElement).getPropertyValue(`--color-level-${safety}`).trim();
      s.leash.setOptions({ strokeColor: col || "#ffffff" });
      s.circle.setPosition(s.LL(dog)); s.circle.setRadius(Math.max(0.5, radius ?? 3)); s.circle.setMap(s.map);
    } else { s.dog.setMap(null); s.leash.setMap(null); s.circle.setMap(null); }
    s.trail.setPath(trail.map((p) => new s.kakao.maps.LatLng(p[0], p[1])));
  }, [ready, robot, dog, radius, trail, heading, safety]);

  useEffect(() => {
    if (!ready || !el.current || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => { S.current.map?.relayout(); if (robot && followRef.current) S.current.map?.setCenter(S.current.LL(robot)); });
    ro.observe(el.current);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  if (err) {
    return (
      <div className={`${className} flex flex-col items-center justify-center gap-1 bg-sherpy-50 px-6 text-center`}>
        <MapPinOff className="text-sherpy-400" />
        <p className="text-sm font-semibold text-body">위성지도를 불러오지 못했습니다</p>
        <p className="text-[11px] text-muted">카카오 JS 키 도메인 등록을 확인하세요 (로컬은 localhost:3000 만)</p>
      </div>
    );
  }

  return (
    <div className={`relative ${className} bg-sherpy-900`}>
      <div ref={el} className="absolute inset-0" />
      {!ready && <div className="absolute inset-0 flex items-center justify-center text-xs text-white/70">위성지도 불러오는 중…</div>}
      <div className="absolute top-2 right-2 z-10 flex flex-col gap-1.5">
        <button onClick={() => setSky((v) => !v)} aria-label={sky ? "일반 지도로" : "위성사진으로"}
                className="press touch flex items-center justify-center gap-1 rounded-full bg-surface/90 px-3 text-[11px] font-semibold text-ink shadow">
          <Layers size={14} />{sky ? "위성" : "지도"}
        </button>
        {!follow && (
          <button onClick={() => { setFollow(true); if (robot) S.current.map?.setCenter(S.current.LL(robot)); }} aria-label="로봇 따라가기"
                  className="press touch flex items-center justify-center rounded-full bg-surface/90 text-sherpy-600 shadow">
            <LocateFixed size={16} />
          </button>
        )}
      </div>
    </div>
  );
}
