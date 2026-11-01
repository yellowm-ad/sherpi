"use client";

import { useSim } from "../SimProvider";
import PageHeader from "@/components/ui/PageHeader";
import Transport from "@/components/sherpy/Transport";

const DEG = 180 / Math.PI;

/** 시뮬 실시간 수치 — 현재 프레임의 참값과 로봇이 아는 값(추정)을 나란히 */
export default function SimNumbers() {
  const { frame: f, result, s } = useSim();
  const e = f.est;
  const n = (v: number | null | undefined, k = 2) => (v == null ? "—" : v.toFixed(k));
  const rows: { title: string; cols?: [string, string]; items: [string, string, string?, string?][] }[] = [
    { title: "강아지 위치 — 참값 vs 추정", cols: ["참값", "로봇 추정"], items: [
      ["거리 d", n(f.dist, 3), n(e?.d, 3), "m"],
      ["방향 θ", n(f.theta * DEG, 2), e ? n(e.theta * DEG, 2) : "—", "°"],
      ["위치 x (오른쪽)", n(f.dog[0], 3), n(e?.x, 3), "m"],
      ["위치 y (전방)", n(f.dog[1], 3), n(e?.y, 3), "m"],
      ["위치 오차", "", e ? (Math.hypot(e.x - f.dog[0], e.y - f.dog[1]) * 100).toFixed(1) : "—", "cm"],
      ["필터 1σ", "", e ? (e.sigma * 100).toFixed(1) : "—", "cm"],
    ] },
    { title: "① 장력", cols: ["참값", "측정·추정"], items: [
      ["원시 장력", n(f.tension), n(e?.T), "N"], ["빠른 필터 (릴 제어)", "", n(e?.Tfast), "N"], ["F̂ (안전 판단)", "", n(f.filtered), "N"],
      ["HX711 원시값 X", "", e?.loadRaw != null ? Math.round(e.loadRaw).toLocaleString() : "—", "count"],
    ] },
    { title: "② 릴", cols: ["참값", "엔코더"], items: [
      ["인출길이 L", n(f.reel, 3), n(e?.L ?? f.encoder, 3), "m"], ["줄 경로 ℓ", n(f.ropePath, 3), "", "m"],
      ["AS5600 원시값", "", e?.encRaw != null ? String(e.encRaw) : "—", "/4096"],
    ] },
    { title: "③ 카메라", cols: ["", "측정"], items: [
      ["검출 중심 u", "", e?.camPx ? n(e.camPx.u, 1) : "—", "px"], ["박스 높이 h", "", e?.camPx ? n(e.camPx.h, 1) : "—", "px"],
      ["θ 측정", "", e?.thetaMeas != null ? n(e.thetaMeas * DEG, 2) : "—", "°"], ["카메라 거리", "", n(e?.dCam ?? f.camera), "m"],
      ["줄 거리 L + T/k", "", n(e?.dRope), "m"], ["줄 걸림 잔차", "", n(e?.snag, 3), "m"],
      ["추적 상태", "", e ? { ok: "추적", coast: "가림·예측", lost: "실패" }[e.track] : f.camera == null ? "실패" : "추적"],
    ] },
    { title: "로봇 · 명령", items: [
      ["위치", `${n(f.robot[0])}, ${n(f.robot[1])}`, "", "m"], ["방위 ψ", n(f.psi * DEG, 1), "", "°"],
      ["속도", n(f.rv), "", "m/s"], ["명령 속도", n(f.vCmd), "", "m/s"], ["조향 δ", n(f.steer * DEG, 1), "", "°"],
      ["모드", f.mode, ""], ["안전 단계", `L${f.level}`, ""],
      ["차체 이격", n(f.body, 3), "", "m"], ["줄 이격", n(f.rope, 3), "", "m"],
    ] },
  ];
  return (
    <div>
      <PageHeader title="실시간 수치" back />
      <div className="space-y-3 px-4 pt-3 pb-28">
        <div className="sticky top-14 z-20 -mx-4 bg-bg/90 px-4 py-2 backdrop-blur"><Transport /></div>
        {result.mode === "ref" && <p className="rounded-xl bg-sherpy-50 px-3 py-2 text-xs text-sherpy-700">기준 모드는 7.3 원본처럼 로봇이 참값을 그대로 쓴다고 가정해요. 센서 원시값·추정은 실전 모드에서 보여요.</p>}
        {rows.map((g) => (
          <section key={g.title} className="card overflow-hidden">
            <div className="flex items-center border-b border-line bg-sherpy-50/60 px-3 py-2">
              <h2 className="flex-1 text-sm font-bold">{g.title}</h2>
              {g.cols && <span className="grid w-40 grid-cols-2 text-right text-[10px] text-muted"><span>{g.cols[0]}</span><span>{g.cols[1]}</span></span>}
            </div>
            <dl className="divide-y divide-line">
              {g.items.map(([k, a, b, u]) => (
                <div key={k} className="flex items-baseline px-3 py-2">
                  <dt className="flex-1 text-xs text-body">{k}{u && <span className="ml-1 text-[10px] text-muted">{u}</span>}</dt>
                  {g.cols ? (
                    <dd className="tabular grid w-40 grid-cols-2 text-right text-sm"><span className="text-muted">{a}</span><b className="text-ink">{b}</b></dd>
                  ) : <dd className="tabular text-sm font-semibold">{a}</dd>}
                </div>
              ))}
            </dl>
          </section>
        ))}
        <p className="text-center text-[11px] text-muted">{s.env} · {s.scenario} · seed {s.fusion.seed}</p>
      </div>
    </div>
  );
}
