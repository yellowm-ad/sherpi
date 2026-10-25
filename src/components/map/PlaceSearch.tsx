"use client";

import { useEffect, useRef, useState } from "react";
import { Search, X, MapPin, Building2, LocateFixed, Loader2 } from "lucide-react";
import { loadKakaoMaps } from "@/components/map/RouteMap";

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface Place { name: string; address: string; lat: number; lng: number; kind: "address" | "place" }

/**
 * 장소·주소 검색 — 지역명, 지번·도로명 주소, 건물·가게 이름 (카카오 services 라이브러리)
 * 주소로 먼저 찾고(지번·도로명), 이어서 키워드(장소·건물)로 찾아 합쳐 보여준다.
 * 덕진공원 밖에서도 코스를 짤 수 있게 지도를 원하는 곳으로 옮기는 용도.
 */
export default function PlaceSearch({ onPick, near, initialQuery, className = "" }: {
  onPick: (p: Place) => void;
  /** 주면 열자마자 이 검색어로 찾아 첫 결과로 이동 — 홈 검색창·칩에서 넘어올 때 */
  initialQuery?: string;
  /** 이 근처 결과를 먼저 — 보통 현재 지도 중심 */
  near?: [number, number];
  className?: string;
}) {
  const [q, setQ] = useState(initialQuery ?? "");
  const [results, setResults] = useState<Place[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const search = async (e?: React.FormEvent, opts?: { query?: string; autoPick?: boolean }) => {
    e?.preventDefault();
    const query = (opts?.query ?? q).trim();
    if (!query) return;
    setBusy(true); setMsg(null);
    try {
      const kakao = await loadKakaoMaps();
      const { services } = kakao.maps;
      const geocoder = new services.Geocoder();
      const places = new services.Places();

      const byAddress = new Promise<Place[]>((resolve) => {
        geocoder.addressSearch(query, (data: any[], status: string) => {
          if (status !== services.Status.OK) return resolve([]);
          resolve(data.slice(0, 3).map((d) => ({
            name: d.road_address?.building_name || d.address_name,
            address: d.road_address?.address_name ?? d.address?.address_name ?? d.address_name,
            lat: Number(d.y), lng: Number(d.x), kind: "address" as const,
          })));
        });
      });
      const byKeyword = new Promise<Place[]>((resolve) => {
        const opts = near ? { location: new kakao.maps.LatLng(near[0], near[1]), sort: services.SortBy.ACCURACY } : {};
        places.keywordSearch(query, (data: any[], status: string) => {
          if (status !== services.Status.OK) return resolve([]);
          resolve(data.slice(0, 8).map((d) => ({
            name: d.place_name,
            address: d.road_address_name || d.address_name,
            lat: Number(d.y), lng: Number(d.x), kind: "place" as const,
          })));
        }, opts);
      });

      const list = [...(await byAddress), ...(await byKeyword)];
      if (opts?.autoPick && list.length) { pick(list[0]); return; }
      setResults(list);
      if (list.length === 0) setMsg("검색 결과가 없어요. 동 이름이나 지번·도로명(예: 덕진동1가 664-14, 권삼득로 390)으로도 찾아보세요.");
    } catch {
      setResults([]);
      setMsg("지도 서비스를 불러오지 못했어요");
    } finally {
      setBusy(false);
    }
  };

  // 홈에서 검색어를 들고 왔으면 한 번만 바로 찾는다
  useEffect(() => {
    if (initialQuery) search(undefined, { query: initialQuery, autoPick: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialQuery]);

  const pick = (p: Place) => {
    setResults(null); setMsg(null); setQ(p.name);
    input.current?.blur();
    onPick(p);
  };

  const locate = () => {
    if (!navigator.geolocation) return setMsg("이 브라우저는 위치를 지원하지 않아요");
    setBusy(true); setMsg(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => { setBusy(false); pick({ name: "내 위치", address: "", lat: pos.coords.latitude, lng: pos.coords.longitude, kind: "place" }); },
      () => { setBusy(false); setMsg("위치 권한을 허용하면 내 주변에서 코스를 짤 수 있어요"); },
      { enableHighAccuracy: true, timeout: 8000 },
    );
  };

  const clear = () => { setQ(""); setResults(null); setMsg(null); input.current?.focus(); };

  return (
    <div className={`pointer-events-auto relative ${className}`}>
      <form onSubmit={search} className="flex items-center gap-1 rounded-full border border-line bg-surface/95 pl-4 shadow-lift backdrop-blur transition focus-within:border-sherpy-600 focus-within:ring-4 focus-within:ring-sherpy-600/15">
        <Search size={18} className="shrink-0 text-sherpy-600" />
        <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} enterKeyHint="search"
               placeholder="어디로 산책할까요? (지역·주소·건물)"
               aria-label="장소 검색"
               className="h-11 min-w-0 flex-1 bg-transparent px-1 text-base outline-none placeholder:text-muted" />
        {busy ? <Loader2 size={17} className="mx-3 shrink-0 animate-spin text-muted" />
          : q && <button type="button" onClick={clear} aria-label="검색어 지우기" className="touch flex shrink-0 items-center justify-center text-muted"><X size={17} /></button>}
        <button type="button" onClick={locate} aria-label="내 위치로" className="touch mr-1 flex shrink-0 items-center justify-center rounded-full text-sherpy-600">
          <LocateFixed size={18} />
        </button>
      </form>

      {(results?.length || msg) ? (
        <div className="animate-fade absolute inset-x-0 top-13 z-20 max-h-[50dvh] overflow-y-auto rounded-2xl border border-line bg-surface shadow-float">
          {msg && <p className="px-4 py-3 text-xs text-muted">{msg}</p>}
          {results?.map((p, i) => (
            <button key={`${p.lat},${p.lng},${i}`} onClick={() => pick(p)}
                    className="flex w-full items-start gap-2.5 border-b border-line px-4 py-2.5 text-left last:border-0 active:bg-sherpy-50">
              {p.kind === "address"
                ? <Building2 size={16} className="mt-0.5 shrink-0 text-sherpy-600" />
                : <MapPin size={16} className="mt-0.5 shrink-0 text-sherpy-600" />}
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold">{p.name}</span>
                {p.address && p.address !== p.name && <span className="block truncate text-xs text-muted">{p.address}</span>}
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
