"use client";

import { use, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Heart, Send, Clock, Ruler, Mountain, Info, Check, Trash2, Pencil } from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import RouteMap, { MAP_COLOR } from "@/components/map/RouteMap";
import Sheet from "@/components/ui/Sheet";
import { sendCommand } from "@/hooks/useRobotStream";
import { ROUTES, routeLength, routeDurationMin, POI_LABEL } from "@/lib/demo/data";
import { useMyRoutes, deleteMyRoute } from "@/lib/my-routes";
import { useLoginGate } from "@/components/ui/LoginGate";
import { josa } from "@/lib/format";

/** S08 코스 상세 + 셰르피에 전송 (PRD F-4) */
export default function RouteDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const mine = useMyRoutes();
  const { user, guard, gate } = useLoginGate();
  const isMine = mine.some((x) => x.id === Number(id));
  const r = ROUTES.find((x) => x.id === Number(id)) ?? mine.find((x) => x.id === Number(id));
  const [delOpen, setDelOpen] = useState(false);
  const router = useRouter();
  const [liked, setLiked] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);
  const [sent, setSent] = useState(false);

  const lines = useMemo(() => (r ? [{ id: r.id, points: r.points, color: MAP_COLOR.route, weight: 6 }] : []), [r]);
  const markers = useMemo(
    () => (r ? r.pois.map((p) => ({ lat: p.lat, lng: p.lng, label: `${POI_LABEL[p.type]} · ${p.label}` })) : []),
    [r],
  );

  if (!r) return <><PageHeader title="코스" back /><p className="p-6 text-center text-muted">{Number(id) > 1000 ? "로그인한 계정의 코스예요. 로그인 후 다시 열어주세요." : "코스를 찾을 수 없습니다."}</p></>;

  const send = async () => {
    await sendCommand(1, "SET_ROUTE", { route_id: r.id });
    setSent(true);
    setTimeout(() => router.push("/robot"), 900);
  };

  return (
    <div>
      <PageHeader title={r.name} back right={
        <button onClick={() => guard("좋아요를 누르려면", () => setLiked((v) => !v))} aria-label="좋아요" className="touch flex items-center justify-center">
          <Heart size={20} className={liked ? "fill-level-3 text-level-3" : "text-muted"} />
        </button>
      } />
      <RouteMap center={r.points[0]} lines={lines} markers={markers} fitTo={r.points} className="h-72" />

      <div className="px-4 pt-4">
        <p className="text-sm text-body">{r.description}</p>
        <p className="mt-1 flex items-center gap-1.5 text-xs text-muted">
          {isMine && <span className="rounded-full bg-sherpy-600 px-2 py-0.5 text-[10px] font-semibold text-white">내 코스</span>}
          by {r.author} · ♥ {r.likeCount + (liked ? 1 : 0)}{isMine && (r.isPublic ? " · 공개" : " · 비공개")}
        </p>

        <div className="mt-4 grid grid-cols-3 gap-2">
          <Info3 icon={<Ruler size={16} />} label="거리" value={`${(routeLength(r.points) / 1000).toFixed(2)}km`} />
          <Info3 icon={<Clock size={16} />} label="예상" value={`${routeDurationMin(r.points)}분`} />
          <Info3 icon={<Mountain size={16} />} label="난이도" value={r.difficulty} />
        </div>

        {r.pois.length > 0 && <section className="card mt-3 p-4">
          <h2 className="text-sm font-bold">코스 위 편의시설</h2>
          <ul className="mt-2 space-y-1.5 text-sm">
            {r.pois.map((p, i) => (
              <li key={i} className="flex justify-between"><span className="text-muted">{POI_LABEL[p.type]}</span><span>{p.label}</span></li>
            ))}
          </ul>
        </section>}

        <section className="card mt-3 p-4">
          <h2 className="text-sm font-bold">셰르피 주행 상태</h2>
          <p className="mt-1 text-sm">
            {r.taught
              ? <>티칭 완료 · 키프레임 <b className="tabular">{r.keyframes}</b>개 — 바로 자동주행할 수 있어요.</>
              : "아직 티칭하지 않은 코스예요. 전송 후 한 번 직접 몰아서 경로를 기억시켜 주세요."}
          </p>
          <p className="mt-2 flex gap-1.5 rounded-xl bg-sherpy-50 p-2.5 text-[11px] leading-relaxed text-sherpy-700">
            <Info size={14} className="mt-0.5 shrink-0" />
            지도에 그린 선이 곧바로 자율주행 경로가 되지는 않습니다. 셰르피는 카메라로 본 장면을 기억해 되짚어 가요(티칭 → 자동주행).
          </p>
        </section>

        <button onClick={() => setSendOpen(true)} disabled={sent}
                className="touch mt-4 mb-6 flex w-full items-center justify-center gap-2 rounded-2xl bg-sherpy-600 py-3.5 font-semibold text-white disabled:bg-level-0">
          {sent ? <><Check size={18} /> 전송 완료 — 대시보드로 이동</> : <><Send size={18} /> 셰르피에 전송</>}
        </button>
        {isMine && user && (
          <div className="-mt-3 mb-6 grid grid-cols-2 gap-2">
            <Link href={`/routes/${r.id}/edit`} className="touch flex items-center justify-center gap-1.5 rounded-2xl border border-line bg-surface text-sm font-semibold text-sherpy-700">
              <Pencil size={15} /> 코스 수정
            </Link>
            <button onClick={() => setDelOpen(true)} className="touch flex items-center justify-center gap-1.5 rounded-2xl border border-line bg-surface text-sm font-semibold text-level-3">
              <Trash2 size={15} /> 삭제
            </button>
          </div>
        )}
      </div>

      <Sheet open={sendOpen} title="이 코스를 셰르피에 보낼까요?" confirmLabel="전송" onClose={() => setSendOpen(false)} onConfirm={send}>
        <b>{r.name}</b>{josa(r.name, "를", "을").slice(r.name.length)} 주행 코스로 지정합니다.
        {r.taught ? " 대시보드에서 자동주행을 시작할 수 있어요." : " 티칭 모드로 한 번 주행해 주세요."}
      </Sheet>
      <Sheet open={delOpen} title="이 코스를 삭제할까요?" confirmLabel="삭제" danger onClose={() => setDelOpen(false)}
             onConfirm={() => { if (user) deleteMyRoute(r.id); router.replace("/map"); }}>
        <b>{r.name}</b>{josa(r.name, "가", "이").slice(r.name.length)} 내 코스에서 사라집니다.
      </Sheet>
      {gate}
    </div>
  );
}

function Info3({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="card p-3 text-center">
      <span className="mx-auto flex justify-center text-sherpy-600">{icon}</span>
      <p className="mt-1 text-[11px] text-muted">{label}</p>
      <p className="tabular text-sm font-bold">{value}</p>
    </div>
  );
}
