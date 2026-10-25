"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Square, Video } from "lucide-react";
import Link from "next/link";
import RouteMap, { MAP_COLOR } from "@/components/map/RouteMap";
import SafetyBadge from "@/components/robot/SafetyBadge";
import EstopButton from "@/components/robot/EstopButton";
import Sheet from "@/components/ui/Sheet";
import { useRobotStream } from "@/hooks/useRobotStream";
import { THRESHOLDS, SAFETY_COLOR, FAULT_LABEL } from "@/lib/robot/types";
import { distM, ROUTES } from "@/lib/demo/data";
import { findRoute } from "@/lib/my-routes";
import { saveWalk } from "@/lib/my-walks";
import { getLiveWalk, saveLiveWalk, clearLiveWalk, newLiveWalk } from "@/lib/live-walk";

/** 한 번에 이만큼 넘게 튀면 코스가 바뀐 것으로 보고 거리에 더하지 않는다 (GPS 튐 방지) */
const JUMP_M = 80;
const MIN_SAVE_S = 10;

/**
 * S12 산책 중 화면 — 텔레메트리로 거리·당김을 자동 집계하고, 끝나면 기록으로 저장한다 (PRD F-6)
 * 진행 상황은 계속 저장되므로 화면을 떠났다 돌아와도(새로고침·탭 정리 포함) 이어서 기록한다.
 */
export default function LiveWalk() {
  const router = useRouter();
  const { latest, state } = useRobotStream(1);
  const agg = useRef(newLiveWalk());
  const startedAt = useRef(agg.current.startedAt);
  const [elapsed, setElapsed] = useState(0);
  const [endOpen, setEndOpen] = useState(false);
  const [trail, setTrail] = useState<[number, number][]>([]);
  const [resumed, setResumed] = useState(false);
  const [ready, setReady] = useState(false);
  const done = useRef(false); // 종료 후 이동하는 사이 들어온 텔레메트리가 기록을 되살리지 않게

  // 이어서 기록할 산책이 있으면 불러온다 — 집계 effect 보다 먼저 돌아야 한다
  useEffect(() => {
    const saved = getLiveWalk();
    if (saved) {
      agg.current = saved;
      startedAt.current = saved.startedAt;
      setTrail(saved.trail);
      setResumed(true);
    } else {
      saveLiveWalk(agg.current);
    }
    setReady(true);
  }, []);

  // 브라우저를 닫거나 새로고침하려 하면 한 번 묻는다 (기록은 저장돼 있어 다시 열면 이어진다)
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    addEventListener("beforeunload", warn);
    return () => removeEventListener("beforeunload", warn);
  }, []);

  // 경과 시간은 시작 시각과의 차로 계산 — 백그라운드 탭에서 타이머가 느려져도 어긋나지 않는다
  useEffect(() => {
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt.current) / 1000)), 500);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!latest || !ready || done.current) return;
    const a = agg.current;
    if (latest.lat != null && latest.lng != null) {
      const p: [number, number] = [latest.lat, latest.lng];
      const step = a.last ? distM(a.last, p) : 0;
      if (step < JUMP_M) a.dist += step;
      a.last = p;
      const prev = a.trail[a.trail.length - 1];
      if (!prev || prev[0] !== p[0] || prev[1] !== p[1]) {
        a.trail = step >= JUMP_M ? [p] : [...a.trail, p];
        setTrail(a.trail);
      }
    }
    const t = latest.tensionN ?? 0;
    a.maxT = Math.max(a.maxT, t);
    a.sumT += t; a.n++;
    a.maxV = Math.max(a.maxV, latest.speedCmd ?? 0);
    // 당김 횟수 — F_HARD를 넘어설 때마다 1회
    if (t >= THRESHOLDS.F_HARD && !a.pulling) { a.pulls++; a.pulling = true; navigator.vibrate?.(40); }
    if (t < THRESHOLDS.F_HARD) a.pulling = false;
    // 안전 경고 이력 — 등급이 올라가는 순간만 남긴다
    if (latest.safetyLevel > a.level && latest.safetyLevel >= 1) {
      const at = new Date(latest.ts).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false });
      const reason = latest.mode === "estop" ? "비상정지"
        : t >= THRESHOLDS.F_ESTOP ? "견인 한계 초과 — 정지"
        : t >= THRESHOLDS.F_HARD ? "견인 과다 — 자동 감속"
        : latest.faults[0] ? `${latest.faults[0]} ${FAULT_LABEL[latest.faults[0]] ?? ""}`.trim()
        : "강한 당김 — 감속";
      a.warnings.push({ at, level: latest.safetyLevel, reason });
    }
    a.level = latest.safetyLevel;
    saveLiveWalk(a);
  }, [latest, ready]);

  const route = findRoute(latest?.routeId ?? 12) ?? ROUTES[0];
  const lines = useMemo(() => [
    { id: "plan", points: route.points, color: MAP_COLOR.routeAlt, weight: 5, dashed: true },
    { id: "trail", points: trail, color: MAP_COLOR.trail, weight: 6 },
  ], [route, trail]);
  const markers = useMemo(() => latest?.lat != null ? [{ lat: latest.lat, lng: latest.lng!, label: "셰르피", kind: "robot" as const }] : [], [latest?.lat, latest?.lng]);

  const mm = String(Math.floor(elapsed / 60)).padStart(2, "0");
  const ss = String(elapsed % 60).padStart(2, "0");
  const a = agg.current;
  const tension = latest?.tensionN ?? null;
  const level = latest?.safetyLevel ?? 0;

  const finish = () => {
    done.current = true;
    clearLiveWalk();
    if (elapsed < MIN_SAVE_S) return router.replace("/walks");
    const w = saveWalk({
      routeId: route.id,
      startedAt: new Date(startedAt.current).toISOString(),
      durationS: elapsed,
      distanceM: Math.round(a.dist),
      avgSpeed: Math.round((a.dist / Math.max(1, elapsed)) * 100) / 100,
      maxSpeed: Math.round(a.maxV * 100) / 100,
      avgTensionN: Math.round((a.sumT / Math.max(1, a.n)) * 10) / 10,
      maxTensionN: Math.round(a.maxT * 10) / 10,
      pullCount: a.pulls,
      warnings: a.warnings,
      walkScore: 0,
      trail,
    });
    router.replace(`/walks/${w.id}`);
  };

  return (
    <div>
      <div className="relative">
        <RouteMap center={route.points[0]} lines={lines} markers={markers} fitTo={route.points} className="h-[52dvh]" />
        <div className="absolute top-3 right-3 z-10"><SafetyBadge level={level} compact /></div>
        <Link href="/robot/camera" className="press absolute top-3 left-3 z-10 flex h-10 items-center gap-1 rounded-full bg-ink/80 px-3 text-xs text-white">
          <Video size={14} /> 카메라
        </Link>
      </div>

      <div className="-mt-5 relative z-10 rounded-t-3xl bg-surface px-4 pt-5 shadow-[0_-8px_24px_rgb(15_23_42/0.08)]">
        <p className="flex items-center justify-center gap-1.5 text-xs text-muted">
          {state === "online" && <span className="text-level-3"><span className="live-dot" /></span>}
          {route.name} · {state === "online" ? (resumed ? "이어서 기록 중" : "기록 중") : "연결 확인 중"}
        </p>
        <p className="tabular mt-1 text-center text-5xl font-bold">{mm}:{ss}</p>
        <div className="mt-4 grid grid-cols-3 text-center">
          <M v={`${(a.dist / 1000).toFixed(2)}`} u="km" l="거리" />
          <M v={tension?.toFixed(1) ?? "—"} u="N" l="장력" color={level ? SAFETY_COLOR[level] : undefined} />
          {/* 당김이 늘 때마다 숫자가 톡 튀어 오른다 */}
          <M v={`${a.pulls}`} u="회" l="당김" popKey={a.pulls} />
        </div>
        <button onClick={() => setEndOpen(true)}
                className="press touch mt-6 flex w-full items-center justify-center gap-2 rounded-2xl bg-ink py-3.5 font-semibold text-white">
          <Square size={16} /> 산책 종료
        </button>
        <p className="mt-3 mb-28 text-center text-[11px] leading-relaxed text-muted">
          원격 정지는 보조 수단입니다. 긴급 상황에서는 로봇 본체의 물리 정지 버튼을 사용하세요.
        </p>
      </div>

      <EstopButton robotId={1} disabled={state === "offline"} />

      <Sheet open={endOpen} title="산책을 마칠까요?" confirmLabel={elapsed < MIN_SAVE_S ? "그냥 나가기" : "종료하고 저장"}
             onClose={() => setEndOpen(false)} onConfirm={finish}>
        <span className="tabular">{mm}:{ss} · {(a.dist / 1000).toFixed(2)}km · 최대 장력 {a.maxT.toFixed(1)}N · 당김 {a.pulls}회</span>
        <br />
        {elapsed < MIN_SAVE_S
          ? <span className="text-xs text-muted">{MIN_SAVE_S}초보다 짧은 산책은 기록하지 않아요.</span>
          : <span className="text-xs text-muted">리포트가 이 기기의 산책 기록에 저장됩니다.</span>}
      </Sheet>
    </div>
  );
}

function M({ v, u, l, color, popKey }: { v: string; u: string; l: string; color?: string; popKey?: number }) {
  return (
    <div>
      <p key={popKey} className={`tabular text-2xl font-bold transition-colors ${popKey ? "animate-pop" : ""}`} style={{ color }}>
        {v}<span className="ml-0.5 text-xs font-normal text-muted">{u}</span>
      </p>
      <p className="text-[11px] text-muted">{l}</p>
    </div>
  );
}
