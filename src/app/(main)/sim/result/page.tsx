"use client";

import { useMemo } from "react";
import { Download } from "lucide-react";
import { useSim } from "../SimProvider";
import PageHeader from "@/components/ui/PageHeader";
import { runSim, DEFAULT_FUSION } from "@/lib/sherpy/simulate";
import { ENV_LABEL, SCENARIO_LABEL } from "@/lib/sherpy/params";

/** 실험 결과 — 40초 요약, 안전 이벤트, 기준(7.3) ↔ 실전 비교, JSON 내보내기 */
export default function SimResult() {
  const { s, result, setTime } = useSim();
  const other = useMemo(() => runSim(s.p, s.env, s.scenario, result.mode === "ref" ? "fusion" : "ref", { ...DEFAULT_FUSION, ...s.fusion }), [s, result.mode]);
  const [ref, fus] = result.mode === "ref" ? [result, other] : [other, result];
  const last = result.frames[result.frames.length - 1];
  const jitter = (r: typeof result) => r.frames.slice(1).reduce((a, f, i) => a + Math.abs(f.rv - r.frames[i].rv), 0);

  const exportJson = () => {
    const blob = new Blob([JSON.stringify({
      config: s.p, environment: s.env, scenario: s.scenario, mode: result.mode, fusion: s.fusion,
      summary: { peak: result.peak, stopTime: result.stopTime, minRope: result.minRope, finalDist: last.dist, metrics: result.metrics, calib: result.calib },
      events: result.events,
      frames: result.frames.map((f) => ({ t: f.t, robot: f.robot, dog: f.dog, psi: f.psi, rv: f.rv, dist: f.dist, reel: f.reel, tension: f.tension, filtered: f.filtered, rope: f.rope, body: f.body, mode: f.mode, level: f.level, theta: f.theta,
        est: f.est ? { x: f.est.x, y: f.est.y, d: f.est.d, theta: f.est.theta, sigma: f.est.sigma, track: f.est.track } : null })),
    }, null, 1)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `SHERPY-실험결과-${s.env}-${s.scenario}-${result.mode}.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <div>
      <PageHeader title="실험 결과" back right={<button onClick={exportJson} className="touch flex items-center gap-1 px-2 text-xs font-semibold text-sherpy-600"><Download size={14} />JSON</button>} />
      <div className="space-y-3 px-4 pt-3 pb-28">
        <p className="text-xs text-muted">{ENV_LABEL[s.env]} / {SCENARIO_LABEL[s.scenario]} · {result.mode === "ref" ? "기준 모드" : "실전 모드"} · 40초 전체</p>
        <section className="grid grid-cols-2 gap-2">
          <Tile k="최대 원시 장력" v={`${result.peak.toFixed(2)} N`} />
          <Tile k="최초 L3 정지 명령" v={result.stopTime == null ? "발생 없음" : `${result.stopTime.toFixed(2)} 초`} warn={result.stopTime != null} />
          <Tile k="최소 리드줄 이격" v={`${result.minRope.toFixed(3)} m`} warn={result.minRope < 0} />
          <Tile k="최종 상대거리" v={`${last.dist.toFixed(2)} m`} />
          {result.metrics && <>
            <Tile k="강아지 위치 오차 RMS" v={`${(result.metrics.posRms * 100).toFixed(1)} cm`} />
            <Tile k="방향각 오차 RMS" v={`${result.metrics.thetaRmsDeg.toFixed(2)}°`} />
          </>}
          {result.calib && <Tile k="로드셀 보정 R²" v={result.calib.r2.toFixed(6)} />}
          {result.calib && <Tile k="보정 잔차 RMSE" v={`${result.calib.rmse.toFixed(3)} N`} />}
        </section>

        <section className="card p-3">
          <h2 className="mb-2 text-sm font-bold">안전 이벤트 <span className="tabular text-muted">{result.events.length}</span></h2>
          {result.events.length ? (
            <ul className="space-y-1.5">
              {result.events.map((e, i) => (
                <li key={i}>
                  <button onClick={() => setTime(e.t)} className="press flex w-full items-center gap-2 rounded-xl border border-line px-3 py-2 text-left">
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold text-white ${e.level === 2 ? "bg-level-2" : "bg-level-3"}`}>L{e.level ?? 3}</span>
                    <span className="tabular text-xs text-muted">{e.t.toFixed(2)}초</span>
                    <span className="flex-1 text-sm font-semibold">{e.reason}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : <p className="text-sm text-muted">40초 동안 L2·L3 이벤트 없음</p>}
          <p className="mt-2 text-[11px] text-muted">L3 는 HOLD 유지 · 자동 복귀 없음. 이벤트를 누르면 그 시점으로 이동해요.</p>
        </section>

        <section className="card overflow-hidden">
          <h2 className="border-b border-line bg-sherpy-50/60 px-3 py-2 text-sm font-bold">기준(7.3) ↔ 실전 비교 — 같은 환경·시나리오</h2>
          <table className="tabular w-full text-xs">
            <thead><tr className="text-muted"><th className="px-3 py-1.5 text-left font-normal">항목</th><th className="font-normal">기준 7.3</th><th className="pr-3 font-normal">실전</th></tr></thead>
            <tbody className="divide-y divide-line">
              {([
                ["로봇이 아는 값", "참값", "센서→추정"],
                ["최초 L3", ref.stopTime == null ? "없음" : `${ref.stopTime.toFixed(2)}s`, fus.stopTime == null ? "없음" : `${fus.stopTime.toFixed(2)}s`],
                ["L3 원인", ref.events.find((e) => (e.level ?? 3) === 3)?.reason ?? "—", fus.events.find((e) => e.level === 3)?.reason ?? "—"],
                ["최대 원시 장력", `${ref.peak.toFixed(1)} N`, `${fus.peak.toFixed(1)} N`],
                ["속도 변동 Σ|Δv|", `${jitter(ref).toFixed(1)}`, `${jitter(fus).toFixed(1)}`],
                ["최종 거리", `${ref.frames[1000].dist.toFixed(2)} m`, `${fus.frames[1000].dist.toFixed(2)} m`],
              ] as const).map(([k, a, b]) => (
                <tr key={k}><td className="px-3 py-2 text-body">{k}</td><td className="text-center">{a}</td><td className="pr-3 text-center font-semibold">{b}</td></tr>
              ))}
            </tbody>
          </table>
          <p className="px-3 py-2 text-[11px] leading-snug text-muted">실전 모드의 감지 지연(로드셀 0.2 s, 카메라 0.5 s)은 순간 누락에 정지가 남발되지 않게 둔 시간 기준 판정 때문이에요.</p>
        </section>
      </div>
    </div>
  );
}

function Tile({ k, v, warn }: { k: string; v: string; warn?: boolean }) {
  return (
    <div className={`card p-3 ${warn ? "border-level-3/40 bg-level-3/5" : ""}`}>
      <p className="text-[11px] text-muted">{k}</p>
      <p className={`tabular mt-0.5 text-base font-bold ${warn ? "text-level-3" : ""}`}>{v}</p>
    </div>
  );
}
