"use client";

import Link from "next/link";
import { useMemo } from "react";
import { LineChart, Gauge, Settings2, Workflow, ClipboardList, Sigma, Bot, ChevronLeft } from "lucide-react";
import { useSim } from "./SimProvider";
import TopView from "@/components/sherpy/TopView";
import SatMap from "@/components/sherpy/SatMap";
import PovCamera from "@/components/sherpy/PovCamera";
import DangerCard from "@/components/sherpy/DangerCard";
import FolderList from "@/components/sherpy/FolderList";
import Transport from "@/components/sherpy/Transport";
import { ENV_LABEL, SCENARIO_LABEL, K } from "@/lib/sherpy/params";
import { simToLatLng, SIM_ANCHOR } from "@/lib/sherpy/geo";

/**
 * 시뮬레이션 랩 첫 화면 — SHERPY 7.3 엔진(기준) / 센서·추정 파이프라인(실전)
 * 위에서 본 애니메이션 + 위성지도(덕진공원에 얹음) + 1인칭 카메라 + 위험 요약, 나머지는 폴더로.
 */
export default function SimHome() {
  const { s, result, frame, idx, time } = useSim();
  const fusion = result.mode === "fusion";
  const est = frame.est;

  const trails = useMemo(() => {
    const r: [number, number][] = [], d: [number, number][] = [];
    for (let i = 0; i <= idx; i += 4) { r.push(result.frames[i].robot); d.push(result.frames[i].dog); }
    return { r, d };
  }, [result, idx]);

  const lastEvent = [...result.events].reverse().find((e) => e.t <= time + 1e-9);
  const failCam = s.scenario === "camera" && time >= K.FAULT_T;

  const robotGeo = simToLatLng(frame.robot[0], frame.robot[1]);
  const dogPt = est ? [est.x, est.y] : frame.dog;
  const dogGeo = simToLatLng(dogPt[0], dogPt[1]);
  const geoTrail = useMemo(() => trails.r.filter((_, i) => i % 3 === 0).map(([x, y]) => { const g = simToLatLng(x, y); return [g.lat, g.lng] as [number, number]; }), [trails]);

  return (
    <div className="pb-28">
      <header className="flex items-center gap-1 px-2 pt-3">
        <Link href="/robot" aria-label="셰르피로" className="touch flex items-center justify-center"><ChevronLeft size={24} /></Link>
        <div className="flex-1">
          <h1 className="text-lg font-bold">시뮬레이션 랩</h1>
          <p className="text-[11px] text-muted">SHERPY 7.3 기준 엔진 · {fusion ? "실전 모드 (센서 → 추정 → 판단)" : "기준 모드 (7.3 원본 그대로)"}</p>
        </div>
      </header>

      <div className="px-4">
        <Link href="/sim/settings" className="no-scrollbar mt-2 flex gap-1.5 overflow-x-auto">
          <span className="chip" data-active="true">{fusion ? "실전 모드" : "기준 모드"}</span>
          <span className="chip">{ENV_LABEL[s.env]}</span>
          <span className="chip">{SCENARIO_LABEL[s.scenario]}</span>
          {fusion && <span className="chip">{s.fusion.reelMode === "tension" ? "릴 장력 제어" : s.fusion.reelMode === "flexi" ? "Flexi 태엽 릴" : s.fusion.reelMode === "position" ? "릴 위치 제어" : "카메라만"}</span>}
        </Link>

        <section className="card-lift relative mt-3 overflow-hidden">
          <TopView mode="world" className="h-80" smooth={0.06} initialSpan={6.5}
            scene={{
              robot: { x: frame.robot[0], y: frame.robot[1], psi: frame.psi, steer: frame.steer, v: frame.rv },
              dog: { x: frame.dog[0], y: frame.dog[1] },
              dogEst: est ? { x: est.x, y: est.y, major: est.ellipse.major, minor: est.ellipse.minor, angle: est.ellipse.angle, track: est.track } : null,
              tension: frame.tension, reel: frame.reel, level: frame.level, warn: s.p.warn, stop: s.p.stop, hold: frame.mode === "HOLD",
              obstacles: result.obstacles, half: result.half, clearance: s.p.clearance,
              trailRobot: trails.r, trailDog: trails.d, fovDeg: fusion ? 100 : undefined,
            }} />
          <div className="pointer-events-none absolute top-2 left-2 flex flex-col gap-1 text-[10px]">
            <span className="rounded-full bg-surface/90 px-2 py-0.5 font-semibold shadow">🐕 참 위치{fusion && <> · <span className="text-sherpy-600">◯ 추정(1σ·2σ)</span></>}</span>
            {frame.mode === "HOLD" && <span className="w-fit rounded-full bg-level-3 px-2 py-0.5 font-bold text-white shadow">HOLD · 정지 유지</span>}
          </div>
        </section>

        <div className="mt-3"><Transport /></div>

        <section className="mt-3 grid grid-cols-2 gap-3">
          <div className="relative aspect-square overflow-hidden rounded-2xl">
            <SatMap className="h-full" robot={robotGeo} dog={dogGeo} radius={est ? Math.max(0.3, est.sigma * 2) : 0.3}
                    trail={geoTrail} heading={SIM_ANCHOR.headingDeg + (frame.psi * 180) / Math.PI} safety={frame.level} />
            <span className="pointer-events-none absolute bottom-1.5 left-1.5 z-10 rounded-full bg-black/55 px-2 py-0.5 text-[10px] text-white">덕진공원에 얹은 실험 좌표</span>
          </div>
          <div className="relative aspect-square overflow-hidden rounded-2xl bg-sherpy-900">
            <PovCamera theta={frame.theta} d={frame.dist} detect={est ? est.camPx : frame.camera != null ? undefined : null}
                       thetaEst={est?.theta ?? frame.theta} dEst={est?.d ?? frame.dist}
                       track={failCam ? "fail" : est?.track ?? (frame.camera == null ? "lost" : "ok")} speed={frame.rv} steer={frame.steer / 0.6} compact />
            <span className="pointer-events-none absolute top-1.5 left-1.5 rounded-full bg-black/55 px-2 py-0.5 text-[10px] font-semibold text-white">카메라 (합성)</span>
          </div>
        </section>

        <div className="mt-3">
          <DangerCard level={frame.level} reason={frame.level >= 2 ? lastEvent?.reason ?? null : null} notes={est?.notes ?? []}
                      tension={frame.filtered} reel={frame.reel} dist={est?.d ?? frame.dist}
                      thetaDeg={((est?.theta ?? frame.theta) * 180) / Math.PI} sigma={est?.sigma ?? null} track={est?.track ?? null}
                      warn={s.p.warn} stop={s.p.stop} reelMax={s.p.reelMax} />
        </div>

        <FolderList title="실험 자세히" items={[
          { href: "/sim/charts", icon: LineChart, title: "실시간 그래프", desc: "장력·속도·거리·이격·방향각·추정오차 (40초)" },
          { href: "/sim/numbers", icon: Gauge, title: "실시간 수치", desc: "참값 vs 추정값, 센서 원시값" },
          { href: "/sim/pipeline", icon: Workflow, title: "변수 3개 처리 과정", desc: "T·L·θ 구하기 → 통합 → 안전 판단 → 명령", badge: fusion ? undefined : "실전 모드" },
          { href: "/sim/settings", icon: Settings2, title: "실험 설정", desc: "환경·시나리오·변수 13개·모드" },
          { href: "/sim/result", icon: ClipboardList, title: "실험 결과 · 이벤트", desc: `${result.events.length ? `${result.events.length}건 · ` : ""}요약·7.3 비교·데이터 내보내기`, tone: result.stopTime != null ? "warn" : "default" },
          { href: "/sim/model", icon: Sigma, title: "수학 모델 · 검증", desc: "공식, 어려웠던 점과 해법, 검증 결과" },
          { href: "/robot", icon: Bot, title: "실제 셰르피로", desc: "같은 파이프라인이 로봇에서 돈다" },
        ]} />
      </div>
    </div>
  );
}
