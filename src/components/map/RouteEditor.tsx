"use client";

import { useEffect, useMemo, useState } from "react";
import { Undo2, Trash2, Check, X, RefreshCcw, Info } from "lucide-react";
import RouteMap, { type MapFocus } from "@/components/map/RouteMap";
import PlaceSearch, { type Place } from "@/components/map/PlaceSearch";
import { DEOKJIN } from "@/components/weather/WalkScoreCard";
import { POI_LABEL, distM, routeLength, type DemoRoute, type PoiType } from "@/lib/demo/data";

export interface RouteDraft {
  name: string;
  description: string;
  isPublic: boolean;
  points: [number, number][];
  pois: { type: PoiType; lat: number; lng: number; label: string }[];
  distanceM: number;
}

type Poi = { type: PoiType; lat: number; lng: number; label?: string };

/**
 * 코스 편집기 — S09 코스 만들기와 코스 수정이 같이 쓴다 (PRD F-4)
 * 지도를 탭해 경유점을 잇고, 찍은 점은 끌어서 옮긴다. 위쪽 검색으로 다른 동네로 옮겨 가 그릴 수 있다.
 */
export default function RouteEditor({ initial, start, draftKey, saveLabel, savedLabel, onSave, needLogin }: {
  /** 수정할 코스 — 없으면 새 코스 */
  initial?: DemoRoute;
  /** 새 코스를 시작할 지도 위치 (지도 탭에서 검색한 곳) */
  start?: Place | null;
  /** 주면 그리던 내용을 sessionStorage 에 보관 — 로그인하러 다녀와도 남아 있게 */
  draftKey?: string;
  saveLabel: string;
  savedLabel: string;
  /** 성공하면 resolve, 실패하면 오류 문구를 던진다 */
  onSave: (d: RouteDraft) => Promise<void>;
  /** 로그인 전이면 저장 버튼이 로그인부터 시킨다 */
  needLogin?: (run: () => void) => void;
}) {
  const [desc, setDesc] = useState(initial?.description ?? "");
  const [points, setPoints] = useState<[number, number][]>(initial?.points ?? []);
  const [pois, setPois] = useState<Poi[]>(initial?.pois ?? []);
  const [poiMode, setPoiMode] = useState<PoiType | null>(null);
  const [name, setName] = useState(initial?.name ?? "");
  const [isPublic, setPublic] = useState(initial?.isPublic ?? true);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);

  // 지도 시작 위치 — 수정이면 그 코스, 검색해서 왔으면 그곳, 아니면 덕진공원
  const [center] = useState<[number, number]>(() =>
    initial?.points[0] ?? (start ? [start.lat, start.lng] : [DEOKJIN.lat, DEOKJIN.lng]));
  const [fitTo] = useState(() => initial?.points);
  const [focus, setFocus] = useState<MapFocus | null>(null);
  const [place, setPlace] = useState<Place | null>(start ?? null);

  const [restored, setRestored] = useState(!draftKey);
  useEffect(() => {
    if (!draftKey) return;
    try {
      const d = JSON.parse(sessionStorage.getItem(draftKey) ?? "null");
      if (d) {
        setPoints(d.points ?? []); setPois(d.pois ?? []); setName(d.name ?? ""); setDesc(d.desc ?? ""); setPublic(d.isPublic ?? true);
        // 검색해서 새로 온 게 아니면 그리던 곳으로 지도를 옮긴다
        if (!start && d.points?.length) setFocus({ lat: d.points[0][0], lng: d.points[0][1], key: Date.now() });
      }
    } catch { /* 초안 없음 */ }
    setRestored(true);
  }, [draftKey, start]);
  useEffect(() => {
    if (!draftKey || !restored || saved) return;
    try { sessionStorage.setItem(draftKey, JSON.stringify({ points, pois, name, desc, isPublic })); } catch { /* 무시 */ }
  }, [draftKey, restored, saved, points, pois, name, desc, isPublic]);

  const dist = routeLength(points);
  const difficulty = dist > 2500 ? "어려움" : dist > 1200 ? "보통" : "쉬움";
  const canSave = points.length >= 2 && name.trim().length > 0 && !saving;
  const closed = points.length > 2 && distM(points[0], points[points.length - 1]) < 15;
  const pathChanged = !!initial && JSON.stringify(initial.points) !== JSON.stringify(points);

  const onClick = (lat: number, lng: number) => {
    if (poiMode) { setPois((p) => [...p, { type: poiMode, lat, lng }]); setPoiMode(null); }
    else setPoints((p) => [...p, [lat, lng]]);
  };
  const onDrag = (i: number, lat: number, lng: number) =>
    setPoints((p) => p.map((x, j) => (j === i ? [lat, lng] : x)));

  const onPlace = (p: Place) => {
    setPlace(p);
    setFocus({ lat: p.lat, lng: p.lng, level: 3, key: Date.now() });
  };

  const lines = useMemo(() => [{ id: "edit", points, color: "#2563EB", weight: 6 }], [points]);
  const markers = useMemo(() => [
    ...points.map((p, i) => ({ lat: p[0], lng: p[1], label: `경유점 ${i + 1}`, kind: "point" as const })),
    ...pois.map((p) => ({ lat: p.lat, lng: p.lng, label: POI_LABEL[p.type] })),
    ...(place ? [{ lat: place.lat, lng: place.lng, label: place.name, kind: "place" as const }] : []),
  ], [points, pois, place]);

  const save = async () => {
    if (saved || saving) return;
    setSaveErr(null); setSaving(true);
    try {
      await onSave({
        name: name.trim(),
        description: desc.trim() || "내가 그린 코스",
        isPublic,
        points,
        pois: pois.map((p) => ({ ...p, label: p.label || POI_LABEL[p.type] })),
        distanceM: dist,
      });
      setSaved(true);
      if (draftKey) try { sessionStorage.removeItem(draftKey); } catch { /* 무시 */ }
    } catch (e) {
      setSaveErr(e instanceof Error ? e.message : "저장에 실패했어요");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="relative">
        <RouteMap center={center} level={4} lines={lines} markers={markers} fitTo={fitTo} fitPad={[100, 40, 70, 40]} focus={focus}
                  onMapClick={onClick} onPointDrag={onDrag} className="h-[46dvh]" />
        <div className="pointer-events-none absolute inset-x-0 top-0 z-10 space-y-2 p-3">
          <PlaceSearch onPick={onPlace} near={points[0] ?? center} />
          <p className="mx-auto w-fit rounded-full bg-ink/80 px-3 py-1.5 text-xs text-white">
            {poiMode ? `지도를 탭해 '${POI_LABEL[poiMode]}' 위치를 찍으세요`
              : points.length ? "탭해서 이어 그리기 · 점을 끌어서 옮기기" : "지도를 탭해 경유점을 이어 그리세요"}
          </p>
        </div>
        <div className="absolute right-3 bottom-3 z-10 flex gap-2">
          {points.length > 2 && !closed && (
            <button onClick={() => setPoints((p) => [...p, p[0]])} aria-label="출발점으로 이어 한 바퀴 만들기"
                    className="flex h-11 items-center gap-1 rounded-full bg-surface px-3 text-xs font-semibold text-sherpy-700 shadow-md">
              <RefreshCcw size={15} /> 한 바퀴로
            </button>
          )}
          <button onClick={() => setPoints((p) => p.slice(0, -1))} aria-label="되돌리기" className="touch flex items-center justify-center rounded-full bg-surface shadow-md"><Undo2 size={18} /></button>
          <button onClick={() => { setPoints([]); setPois([]); }} aria-label="전체 지우기" className="touch flex items-center justify-center rounded-full bg-surface text-level-3 shadow-md"><Trash2 size={18} /></button>
        </div>
      </div>

      <div className="px-4 pt-4 pb-6">
        <div className="grid grid-cols-3 gap-2 text-center">
          <Box label="거리" value={`${(dist / 1000).toFixed(2)}km`} />
          <Box label="예상 시간" value={`${Math.round(dist / 60)}분`} />
          <Box label="난이도" value={points.length >= 2 ? difficulty : "—"} />
        </div>

        {pathChanged && initial?.taught && (
          <p className="mt-3 flex gap-1.5 rounded-xl bg-level-1/10 p-2.5 text-[11px] leading-relaxed text-body">
            <Info size={14} className="mt-0.5 shrink-0 text-level-1" />
            경로를 바꾸면 셰르피가 기억한 길과 달라져요. 저장 후 티칭을 한 번 다시 해 주세요.
          </p>
        )}

        <p className="mt-4 mb-2 text-sm font-bold">편의시설 추가</p>
        <div className="flex flex-wrap gap-2">
          {(Object.keys(POI_LABEL) as PoiType[]).map((t) => (
            <button key={t} onClick={() => setPoiMode(poiMode === t ? null : t)}
                    className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${poiMode === t ? "border-sherpy-600 bg-sherpy-600 text-white" : "border-line bg-surface text-body"}`}>
              {POI_LABEL[t]}
            </button>
          ))}
        </div>
        {pois.length > 0 && (
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {pois.map((p, i) => (
              <li key={i} className="flex items-center gap-0.5 rounded-full bg-sherpy-50 py-1 pr-1 pl-2.5 text-xs text-sherpy-700">
                {p.label || POI_LABEL[p.type]}
                <button onClick={() => setPois((x) => x.filter((_, j) => j !== i))} aria-label={`${p.label || POI_LABEL[p.type]} 빼기`}
                        className="flex h-6 w-6 items-center justify-center rounded-full"><X size={13} /></button>
              </li>
            ))}
          </ul>
        )}

        <label className="mt-4 block text-sm font-bold" htmlFor="rname">코스 이름</label>
        <input id="rname" value={name} onChange={(e) => setName(e.target.value)} maxLength={30} placeholder="예) 덕진공원 연못 반바퀴"
               className="mt-2 w-full rounded-xl border border-line bg-surface px-4 py-3 text-base outline-none focus:border-sherpy-600" />

        <input value={desc} onChange={(e) => setDesc(e.target.value)} maxLength={60} placeholder="한 줄 메모 (선택) — 예) 해 진 뒤 추천"
               className="mt-2 w-full rounded-xl border border-line bg-surface px-4 py-3 text-base outline-none focus:border-sherpy-600" />

        <label className="mt-3 flex items-center justify-between rounded-xl border border-line bg-surface px-4 py-3 text-sm">
          공개 코스로 공유
          <input type="checkbox" checked={isPublic} onChange={(e) => setPublic(e.target.checked)} className="h-5 w-5 accent-sherpy-600" />
        </label>

        <button onClick={() => (needLogin ? needLogin(save) : save())} disabled={!canSave || saved}
                className="touch mt-4 flex w-full items-center justify-center gap-2 rounded-2xl bg-sherpy-600 py-3.5 font-semibold text-white disabled:opacity-40">
          {saved ? <><Check size={18} /> {savedLabel}</> : saving ? "저장하는 중…" : saveLabel}
        </button>
        {saveErr && <p role="alert" className="mt-2 text-center text-xs text-level-3">{saveErr}</p>}
        {points.length < 2 && <p className="mt-2 text-center text-xs text-muted">경유점을 2개 이상 찍으면 저장할 수 있어요</p>}
      </div>
    </>
  );
}

function Box({ label, value }: { label: string; value: string }) {
  return (
    <div className="card p-3">
      <p className="text-[11px] text-muted">{label}</p>
      <p className="tabular font-bold">{value}</p>
    </div>
  );
}
