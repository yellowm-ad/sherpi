"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { LineChart, Gauge, SlidersHorizontal, Video, FlaskConical, Sigma, TriangleAlert, BatteryWarning, Pause, Play, Map as MapIcon, Eye, ChevronRight, Power } from "lucide-react";
import { useRobot } from "./RobotProvider";
import { sendCommand } from "@/hooks/useRobotStream";
import SafetyBadge from "@/components/robot/SafetyBadge";
import EstopButton from "@/components/robot/EstopButton";
import RobotVideo from "@/components/robot/RobotVideo";
import TopView from "@/components/sherpy/TopView";
import SatMap from "@/components/sherpy/SatMap";
import PovCamera from "@/components/sherpy/PovCamera";
import DangerCard from "@/components/sherpy/DangerCard";
import FolderList from "@/components/sherpy/FolderList";
import { THRESHOLDS, FAULT_LABEL } from "@/lib/robot/types";
import { DEFAULT_PARAMS } from "@/lib/sherpy/params";
import { findRoute } from "@/lib/my-routes";
import { useBatteryTimer } from "@/lib/battery";

const MODE = {
  idle:   { t: "대기",     c: "bg-line text-body" },
  teach:  { t: "티칭 중",   c: "bg-sherpy-100 text-sherpy-700" },
  follow: { t: "자동주행",  c: "bg-accent/15 text-accent" },
  estop:  { t: "비상정지",  c: "bg-level-3/15 text-level-3" },
} as const;

/**
 * S10 — 셰르피 첫 화면 (PRD F-1, F-2)
 * 한눈에: 위성지도 위 로봇·목줄·강아지 + 위에서 본 확대 + 카메라 + 위험 수치.
 * 자세한 것은 아래 폴더(그래프·수치·제어·카메라·시뮬레이션·수학 모델)로 들어가서 본다.
 */
export default function RobotHome() {
  const { robotId, streamUrl, latest, state, demo, trail, dogGeo, commands } = useRobot();
  const [view, setView] = useState<"map" | "top">("map");
  const [busy, setBusy] = useState(false);
  const offline = state !== "online" && state !== "stale";
  const level = latest?.safetyLevel ?? 0;
  const mode = latest?.mode ?? "idle";
  const route = findRoute(latest?.routeId);
  const battery = useBatteryTimer(mode === "teach" || mode === "follow");
  const stream = streamUrl;

  // L2 이상으로 올라가면 진동 + 카드 흔들림 (PRD F-1 수용기준)
  const [hit, setHit] = useState(false);
  const prevLevel = useRef(0);
  useEffect(() => {
    if (level >= 2 && level > prevLevel.current) {
      navigator.vibrate?.([200, 100, 200]);
      setHit(true);
      const t = setTimeout(() => setHit(false), 650);
      prevLevel.current = level;
      return () => clearTimeout(t);
    }
    prevLevel.current = level;
  }, [level]);

  const th = latest?.dogBearingDeg != null ? (latest.dogBearingDeg * Math.PI) / 180 : null;
  const d = latest?.dogDistM ?? null;
  const sigma = latest?.dogSigmaM ?? 0.05;
  const rel = th != null && d != null ? { x: d * Math.sin(th), y: d * Math.cos(th) } : null;
  const steerLim = (DEFAULT_PARAMS.steerMax * Math.PI) / 180;

  const cmd = async (type: string) => { setBusy(true); try { await sendCommand(robotId, type); } finally { setBusy(false); } };

  const banner =
    level >= 3 ? { c: "bg-level-3", t: mode === "estop" ? "L3 정지: 비상정지 상태입니다. 주변을 확인한 뒤 재개하세요." : `L3 정지: ${latest?.faults.map((f) => FAULT_LABEL[f]).filter(Boolean)[0] ?? "견인 한계 초과"} — 로봇이 멈췄습니다.` }
    : level === 2 ? { c: "bg-level-2", t: "L2 경고: 견인 과다, 감속 중" }
    : null;

  const topScene = {
    robot: { x: 0, y: 0, psi: 0, steer: (latest?.steerCmd ?? 0) * steerLim, v: latest?.speedCmd ?? 0 },
    dog: null,
    dogEst: rel ? { x: rel.x, y: rel.y, major: sigma / Math.SQRT2, minor: sigma / Math.SQRT2, angle: 0, track: latest?.dogTrack ?? "ok" } : null,
    tension: latest?.tensionN ?? 0, reel: latest?.leashLenM ?? 1.6, level, warn: THRESHOLDS.F_WARN, stop: THRESHOLDS.F_STOP,
    hold: level >= 3, fovDeg: 100,
  };
  const robotPos = latest?.lat != null && latest.lng != null ? { lat: latest.lat, lng: latest.lng } : null;

  return (
    <div className="px-4 pt-4">
      <header className="mb-3 flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold">셰르피</h1>
            <span key={mode} className={`animate-pop rounded-full px-2 py-0.5 text-[11px] font-semibold ${MODE[mode].c}`}>{MODE[mode].t}</span>
            {demo && <span className="rounded-full border border-dashed border-sherpy-400 px-2 py-0.5 text-[10px] text-sherpy-600">시연 모드</span>}
          </div>
          <p className={`mt-0.5 flex items-center gap-1.5 text-xs ${state === "online" ? "text-level-0" : state === "stale" ? "text-level-1" : state === "offline" ? "text-level-3" : "text-muted"}`}>
            {state === "online" ? <span className="live-dot" /> : <span className="inline-block h-[7px] w-[7px] rounded-full bg-current" />}
            {{ connecting: "연결 중", online: "온라인", stale: "지연", offline: "연결 끊김" }[state]}
            {latest && <span className="tabular text-muted"> · {new Date(latest.ts).toLocaleTimeString("ko-KR")}</span>}
          </p>
        </div>
        <SafetyBadge level={level} compact />
      </header>

      {banner && (
        <div className={`animate-drop sticky top-2 z-30 mb-3 flex items-center gap-2 rounded-2xl ${banner.c} p-3 text-sm font-semibold text-white shadow-lg`}>
          <TriangleAlert size={18} className="shrink-0" /> {banner.t}
        </div>
      )}
      {battery.swapDue && (
        <div className="animate-drop mb-3 flex items-center gap-2 rounded-2xl bg-level-1/15 p-3 text-sm text-body">
          <BatteryWarning size={18} className="shrink-0 text-level-1" />
          <p className="flex-1"><b className="text-level-1">배터리 교체 권장</b> — 주행 <span className="tabular">{battery.elapsedMin}</span>분 경과</p>
          <button onClick={battery.reset} className="touch shrink-0 rounded-xl bg-surface px-3 text-xs font-semibold text-sherpy-700 shadow-sm">교체 완료</button>
        </div>
      )}
      {state === "offline" && <p className="mb-3 rounded-2xl bg-level-3/10 p-3 text-sm text-level-3">로봇과 연결되지 않았습니다. 제어 기능을 사용할 수 없습니다.</p>}

      {/* ── 히어로: 위성지도 ↔ 위에서 본 확대 ── */}
      <section className={`card-lift relative overflow-hidden ${hit ? "animate-hit" : ""}`}
               style={{ "--flash": level >= 3 ? "rgb(220 38 38 / .55)" : "rgb(234 88 12 / .5)" } as React.CSSProperties}>
        <div className="absolute top-2 left-2 z-20 flex rounded-full bg-surface/90 p-0.5 shadow" role="tablist" aria-label="보기 전환">
          {([["map", "위성지도", MapIcon], ["top", "줄 끝 확대", Eye]] as const).map(([k, l, Icon]) => (
            <button key={k} role="tab" aria-selected={view === k} onClick={() => setView(k)}
                    className={`flex min-h-[36px] items-center gap-1 rounded-full px-3 text-[11px] font-semibold ${view === k ? "bg-sherpy-600 text-white" : "text-body"}`}>
              <Icon size={13} />{l}
            </button>
          ))}
        </div>
        {view === "map" ? (
          <SatMap className="h-72" robot={robotPos} dog={dogGeo} radius={dogGeo?.radius} trail={trail} heading={latest?.headingDeg}
                  safety={level} />
        ) : (
          <TopView mode="robot" className="h-72" scene={topScene} smooth={0.3} initialSpan={4.5} />
        )}
        {/* 반대쪽 보기를 작은 창으로 — 누르면 바꾼다 */}
        <button onClick={() => setView(view === "map" ? "top" : "map")} aria-label={view === "map" ? "줄 끝 확대 보기로" : "위성지도로"}
                className="absolute bottom-2 left-2 z-20 h-24 w-24 overflow-hidden rounded-2xl border-2 border-surface shadow-lg">
          {view === "map" ? <TopView mode="robot" className="h-full w-full" scene={{ ...topScene, labels: false }} smooth={0.3} initialSpan={4.5} controls={false} />
            : <div className="flex h-full w-full flex-col items-center justify-center gap-1 bg-sherpy-900 text-white"><MapIcon size={20} /><span className="text-[10px]">위성지도</span></div>}
        </button>
        {view === "map" && dogGeo && (
          <p className="tabular absolute right-2 bottom-2 z-20 rounded-full bg-surface/90 px-2.5 py-1 text-[10px] text-body shadow">
            강아지 위치 반경 ±{dogGeo.radius.toFixed(1)} m <span className="text-muted">(GPS 포함)</span>
          </p>
        )}
      </section>

      {/* ── 카메라 + 주행 요약 ── */}
      <section className="mt-3 grid grid-cols-[1.25fr_1fr] gap-3">
        <Link href="/robot/camera" className="press relative aspect-video self-start overflow-hidden rounded-2xl bg-sherpy-900">
          {stream ? (
            <>
              <RobotVideo base={stream} />
              <PovCamera scenery={false} compact theta={null} d={null} thetaEst={th} dEst={d} track={latest?.dogTrack ?? undefined} />
            </>
          ) : (
            <PovCamera compact theta={th} d={d} thetaEst={th} dEst={d} track={latest?.dogTrack ?? undefined} speed={latest?.speedCmd ?? 0} steer={latest?.steerCmd ?? 0} />
          )}
          <span className="absolute top-1.5 left-1.5 flex items-center gap-1 rounded-full bg-black/55 px-2 py-0.5 text-[10px] font-semibold text-white">
            <Video size={11} /> {stream ? "LIVE" : "시연 화면"}
          </span>
        </Link>
        <div className="card flex flex-col justify-between p-3">
          <div>
            <p className="text-[11px] text-muted">속도 (지령 / GPS)</p>
            <p className="tabular text-lg font-bold">{latest?.speedCmd?.toFixed(2) ?? "—"}<span className="text-xs font-normal text-muted"> / {latest?.speedMps?.toFixed(2) ?? "—"} m/s</span></p>
          </div>
          <div>
            <p className="truncate text-[11px] text-muted">{route?.name ?? "코스 미지정"}</p>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-line">
              <div className="h-full bg-sherpy-600 transition-[width] duration-700" style={{ width: `${latest?.kfTotal ? ((latest.kfIndex ?? 0) / latest.kfTotal) * 100 : 0}%` }} />
            </div>
          </div>
          {mode === "follow" ? (
            <button onClick={() => cmd("PAUSE")} disabled={offline || busy} className="press touch mt-1 flex items-center justify-center gap-1 rounded-xl border border-line text-xs font-semibold disabled:opacity-40"><Pause size={14} />일시정지</button>
          ) : mode === "estop" || level >= 3 ? (
            <button onClick={() => cmd("RESUME")} disabled={offline || busy} className="press touch mt-1 flex items-center justify-center gap-1 rounded-xl bg-sherpy-600 text-xs font-semibold text-white disabled:opacity-40"><Play size={14} />정지 해제</button>
          ) : (
            <Link href="/robot/control" className="press touch mt-1 flex items-center justify-center gap-1 rounded-xl bg-sherpy-600 text-xs font-semibold text-white">주행 시작하기<ChevronRight size={14} /></Link>
          )}
        </div>
      </section>

      {/* ── 위험 요약 ── */}
      <div className="mt-3">
        <DangerCard level={level} reason={level >= 2 ? (latest?.faults.map((f) => FAULT_LABEL[f]).find(Boolean) ?? null) : null}
                    notes={latest?.dogTrack === "coast" ? ["카메라 일시 가림 — 예측으로 추적 중"] : []}
                    tension={latest?.tensionFiltN ?? latest?.tensionN ?? null} reel={latest?.leashLenM ?? null} dist={d}
                    thetaDeg={latest?.dogBearingDeg ?? null} sigma={latest?.dogSigmaM ?? null} track={latest?.dogTrack ?? null}
                    warn={THRESHOLDS.F_WARN} stop={THRESHOLDS.F_STOP} reelMax={THRESHOLDS.L_MAX} />
      </div>

      {/* ── 폴더 ── */}
      <FolderList title="자세히 보기" items={[
        { href: "/robot/charts", icon: LineChart, title: "실시간 그래프", desc: "당기는 힘·줄 길이·강아지 거리·방향 추이" },
        { href: "/robot/numbers", icon: Gauge, title: "실시간 수치", desc: "로봇이 재고 계산한 값 전체" },
        { href: "/robot/control", icon: SlidersHorizontal, title: "주행 제어 · 코스", desc: "티칭·자동주행·속도 제한·명령 기록", badge: commands.some((c) => c.status === "pending" || c.status === "sent") ? "전송 중" : undefined },
        { href: "/robot/camera", icon: Video, title: "카메라 전체화면", desc: "로봇 눈으로 본 강아지" },
        { href: "/robot/system", icon: Power, title: "로봇 관리", desc: "연결 상태 · 카메라 켜기/끄기 · 점검 · 끄기" },
      ]} />
      <FolderList title="개발 · 검증 (팀용)" items={[
        { href: "/sim", icon: FlaskConical, title: "시뮬레이션 랩", desc: "SHERPY 7.3 엔진 · 고장 시나리오 실험" },
        { href: "/sim/model", icon: Sigma, title: "수학 모델", desc: "T·L·θ 구하기 → 통합 → 안전 판단 → 명령" },
      ]} />

      <p className="mt-4 mb-28 text-center text-[11px] leading-relaxed text-muted">
        원격 정지는 보조 수단입니다.<br />긴급 상황에서는 로봇 본체의 물리 정지 버튼을 사용하세요.
      </p>
      <EstopButton robotId={robotId} disabled={offline} />
    </div>
  );
}
