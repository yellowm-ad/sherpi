"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Video, Play, Pause, CircleDot, Square, Gauge, Route as RouteIcon, TriangleAlert, Check, Clock, X, Loader, BatteryWarning } from "lucide-react";
import { useRobotStream, sendCommand } from "@/hooks/useRobotStream";
import TensionGauge from "@/components/robot/TensionGauge";
import LeashBar from "@/components/robot/LeashBar";
import SafetyBadge from "@/components/robot/SafetyBadge";
import EstopButton from "@/components/robot/EstopButton";
import Sheet from "@/components/ui/Sheet";
import { THRESHOLDS, FAULT_LABEL } from "@/lib/robot/types";
import { findRoute, useMyRoutes, markTaught } from "@/lib/my-routes";
import { useUser } from "@/lib/session";
import { ROUTES } from "@/lib/demo/data";
import { demoRobot, type CommandLog } from "@/lib/robot/demo-robot";
import { useBatteryTimer, BATTERY_SWAP_MIN, BATTERY_RUN_MIN } from "@/lib/battery";

const MODE = {
  idle:   { t: "대기",     c: "bg-line text-body" },
  teach:  { t: "티칭 중",   c: "bg-sherpy-100 text-sherpy-700" },
  follow: { t: "자동주행",  c: "bg-accent/15 text-accent" },
  estop:  { t: "비상정지",  c: "bg-level-3/15 text-level-3" },
} as const;

const CMD_LABEL: Record<string, string> = {
  ESTOP: "긴급 정지", START_TEACH: "티칭 시작", STOP_TEACH: "티칭 종료", START_FOLLOW: "자동주행 시작",
  PAUSE: "일시정지", RESUME: "재개", SET_ROUTE: "코스 지정", SET_SPEED_LIMIT: "속도 제한",
};

/** S10 — 셰르피 실시간 대시보드 (PRD F-1, F-2) */
export default function RobotDashboard() {
  // TODO(M1): 로그인 사용자의 로봇 id를 세션에서 가져올 것
  const robotId = 1;
  const { latest, state, demo, commands } = useRobotStream(robotId);
  const [busy, setBusy] = useState(false);
  const [confirmFollow, setConfirmFollow] = useState(false);
  const [limit, setLimit] = useState(1.2);
  const [pickOpen, setPickOpen] = useState(false);
  const mine = useMyRoutes();
  const prevLevel = useRef(0);
  const prevMode = useRef<string>("idle");
  const user = useUser();

  const offline = state !== "online" && state !== "stale";
  const level = latest?.safetyLevel ?? 0;
  const mode = latest?.mode ?? "idle";
  const route = findRoute(latest?.routeId);
  const battery = useBatteryTimer(mode === "teach" || mode === "follow");
  const gpsOk = latest?.gpsSrc === "robot" && (latest.gpsSats ?? 0) > 0;

  // L2 이상으로 올라가면 진동 + 게이지 카드 흔들림·번쩍임 (PRD F-1 수용기준)
  const [hit, setHit] = useState(false);
  const hitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (level >= 2 && level > prevLevel.current) {
      navigator.vibrate?.([200, 100, 200]);
      setHit(true);
      if (hitTimer.current) clearTimeout(hitTimer.current);
      hitTimer.current = setTimeout(() => setHit(false), 650);
    }
    prevLevel.current = level;
  }, [level]);
  useEffect(() => () => { if (hitTimer.current) clearTimeout(hitTimer.current); }, []);

  // 티칭 종료(teach → idle) 시 내 코스에 키프레임 수를 기록
  useEffect(() => {
    if (prevMode.current === "teach" && mode === "idle" && user && route && route.id > 1000 && latest?.kfIndex) {
      markTaught(route.id, latest.kfIndex);
    }
    prevMode.current = mode;
  }, [mode, user, route, latest?.kfIndex]);

  // 슬라이더는 로봇에 실제로 걸린 값에서 시작한다 (새로고침·다른 화면에서 돌아와도 1.2로 되돌아가지 않게)
  // TODO(M2): 실로봇은 텔레메트리에 speed_limit 을 실어 보내면 그 값을 쓴다
  useEffect(() => { if (demo) setLimit(demoRobot().limit); }, [demo]);

  const needsTeach = !!route && !route.taught;

  const cmd = async (type: string, payload: Record<string, unknown> = {}) => {
    setBusy(true);
    try { await sendCommand(robotId, type, payload); } finally { setBusy(false); }
  };

  const CONN = {
    connecting: { t: "연결 중",   c: "text-muted" },
    online:     { t: "온라인",    c: "text-level-0" },
    stale:      { t: "지연",      c: "text-level-1" },
    offline:    { t: "연결 끊김", c: "text-level-3" },
  }[state];

  const banner =
    level >= 3 ? { c: "bg-level-3", t: mode === "estop" ? "L3 정지: 비상정지 상태입니다. 주변을 확인한 뒤 재개하세요." : "L3 정지: 견인 한계 초과, 로봇이 정지했습니다." }
    : level === 2 ? { c: "bg-level-2", t: "L2 경고: 견인 과다, 감속 중" }
    : null;

  const kfPct = latest?.kfTotal ? ((latest.kfIndex ?? 0) / latest.kfTotal) * 100 : 0;

  return (
    <div className="px-4 pt-4">
      <header className="mb-3 flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold">셰르피</h1>
            <span key={mode} className={`animate-pop rounded-full px-2 py-0.5 text-[11px] font-semibold ${MODE[mode].c}`}>{MODE[mode].t}</span>
            {demo && <span className="rounded-full border border-dashed border-sherpy-400 px-2 py-0.5 text-[10px] text-sherpy-600">시연 모드</span>}
          </div>
          <p className={`mt-0.5 flex items-center gap-1.5 text-xs ${CONN.c}`}>
            {state === "online" ? <span className="live-dot" /> : <span className="inline-block h-[7px] w-[7px] rounded-full bg-current" />}
            {CONN.t}
            {latest && <span className="tabular text-muted"> · 마지막 수신 {new Date(latest.ts).toLocaleTimeString("ko-KR")}</span>}
          </p>
        </div>
        <SafetyBadge level={level} faults={latest?.faults ?? []} />
      </header>

      {banner && (
        <div className={`animate-drop sticky top-2 z-30 mb-3 flex items-center gap-2 rounded-2xl ${banner.c} p-3 text-sm font-semibold text-white shadow-lg`}>
          <TriangleAlert size={18} className="shrink-0" /> {banner.t}
        </div>
      )}

      {battery.swapDue && (
        <div className="animate-drop mb-3 flex items-center gap-2 rounded-2xl bg-level-1/15 p-3 text-sm text-body">
          <BatteryWarning size={18} className="shrink-0 text-level-1" />
          <p className="flex-1">
            <b className="text-level-1">배터리 교체 권장</b> — 주행 <span className="tabular">{battery.elapsedMin}</span>분 경과.
            <span className="text-xs text-muted"> 1개로 약 {BATTERY_RUN_MIN}분 가요.</span>
          </p>
          <button onClick={battery.reset} className="touch shrink-0 rounded-xl bg-surface px-3 text-xs font-semibold text-sherpy-700 shadow-sm">교체 완료</button>
        </div>
      )}

      {offline && state === "offline" && (
        <p className="mb-3 rounded-2xl bg-level-3/10 p-3 text-sm text-level-3">
          로봇과 연결되지 않았습니다. 제어 기능을 사용할 수 없습니다.
        </p>
      )}

      <section className={`card p-4 ${hit ? "animate-hit" : ""}`}
               style={{ "--flash": level >= 3 ? "rgb(220 38 38 / .55)" : "rgb(234 88 12 / .5)" } as React.CSSProperties}>
        <TensionGauge value={latest?.tensionN ?? null} />
        <div className="mt-2 flex justify-center gap-3 text-[10px] text-muted">
          <span>감속 {THRESHOLDS.F_SOFT}N</span><span>강한 견인 {THRESHOLDS.F_HARD}N</span><span>정지 {THRESHOLDS.F_ESTOP}N</span>
        </div>
      </section>

      <section className="card mt-3 p-4">
        <LeashBar value={latest?.leashLenM ?? null} />
      </section>

      <section className="mt-3 grid grid-cols-2 gap-3">
        <Stat label="실측 속도 (GPS)" value={gpsOk && latest?.speedMps != null ? latest.speedMps.toFixed(2) : "—"} unit={gpsOk ? "m/s" : ""} />
        <Stat label="지령 속도" value={latest?.speedCmd != null ? latest.speedCmd.toFixed(2) : "—"} unit="m/s" />
        <div className="card p-3">
          <p className="text-xs text-muted">조향</p>
          <div className="relative mt-3 h-2 rounded-full bg-line">
            <span className="absolute top-1/2 left-1/2 h-3 w-px -translate-y-1/2 bg-muted" />
            <span className="absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full bg-sherpy-600 shadow transition-[left] duration-500"
                  style={{ left: `${(((latest?.steerCmd ?? 0) + 1) / 2) * 100}%` }} />
          </div>
          <div className="mt-1.5 flex justify-between text-[10px] text-muted"><span>좌</span><span className="tabular">{(latest?.steerCmd ?? 0).toFixed(2)}</span><span>우</span></div>
        </div>
        <Stat label="매칭 신뢰도" value={latest?.matchQuality != null ? latest.matchQuality.toFixed(2) : "—"}
              warn={latest?.matchQuality != null && latest.matchQuality < THRESHOLDS.KF_MIN_QUALITY} />
        <Stat label="GPS" value={gpsOk ? `위성 ${latest!.gpsSats}` : latest?.gpsSrc === "robot" ? "측위 대기" : "휴대폰 위치"}
              unit={gpsOk && latest?.headingDeg != null ? `· ${Math.round(latest.headingDeg)}°` : ""} small={!gpsOk} />
        {latest?.batteryV != null
          ? <Stat label="배터리" value={latest.batteryV.toFixed(1)} unit="V" />
          : <Stat label="배터리 (주행 경과)" value={battery.elapsedMin != null ? String(battery.elapsedMin) : "—"}
                  unit={battery.elapsedMin != null ? `분 / ${BATTERY_SWAP_MIN}분` : ""} warn={battery.swapDue} warnText="교체" />}
      </section>

      {/* 코스 · 경로 진행 */}
      <section className="card mt-3 p-4">
        <div className="flex items-center justify-between text-sm">
          <span className="flex items-center gap-1.5 font-semibold"><RouteIcon size={16} className="text-sherpy-600" />{route?.name ?? "코스 미지정"}</span>
          <button onClick={() => setPickOpen(true)} disabled={offline || mode === "follow" || mode === "teach"} className="text-xs font-semibold text-sherpy-600 disabled:opacity-40">코스 변경</button>
        </div>
        <div className="mt-3 flex justify-between text-xs text-muted">
          <span>{mode === "teach" ? "키프레임 기록 중" : "경로 진행"}</span>
          <span className="tabular">
            {mode === "teach" ? `${latest?.kfIndex ?? 0}개` : latest?.kfTotal ? `${latest.kfIndex ?? 0} / ${latest.kfTotal}` : "—"}
          </span>
        </div>
        <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-line">
          <div className={`h-full transition-[width] duration-700 ${mode === "teach" ? "w-full animate-pulse bg-sherpy-400" : "bg-sherpy-600"}`}
               style={mode === "teach" ? undefined : { width: `${kfPct}%` }} />
        </div>
        {latest?.gpsSrc && <p className="mt-2 text-[10px] text-muted">위치 출처: {latest.gpsSrc === "phone" ? "보호자 휴대폰 GPS" : "로봇 GPS"}</p>}
      </section>

      {/* 제어 (PRD F-2) */}
      <section className="mt-4">
        <h2 className="mb-2 text-sm font-bold">제어</h2>
        <div className="grid grid-cols-2 gap-2">
          {mode === "teach" ? (
            <Btn onClick={() => cmd("STOP_TEACH")} disabled={offline || busy} icon={<Square size={16} />}>티칭 종료·저장</Btn>
          ) : (
            <Btn onClick={() => cmd("START_TEACH")} disabled={offline || busy || mode === "follow"} icon={<CircleDot size={16} />}>티칭 시작</Btn>
          )}
          <Btn onClick={() => setConfirmFollow(true)} disabled={offline || busy || mode === "follow" || mode === "teach" || needsTeach} primary icon={<Play size={16} />}>
            자동주행 시작
          </Btn>
          <Btn onClick={() => cmd("PAUSE")} disabled={offline || busy || mode !== "follow"} icon={<Pause size={16} />}>일시정지</Btn>
          <Btn onClick={() => cmd("RESUME")} disabled={offline || busy} icon={<Play size={16} />}>{mode === "estop" ? "정지 해제" : "재개"}</Btn>
        </div>

        {needsTeach && mode !== "teach" && (
          <p className="mt-2 rounded-xl bg-sherpy-50 px-3 py-2 text-xs text-sherpy-700">
            아직 티칭하지 않은 코스예요. [티칭 시작] 후 송신기로 한 번 몰고 [티칭 종료·저장]하면 자동주행할 수 있어요.
          </p>
        )}

        <div className="card mt-2 p-4">
          <div className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-1.5"><Gauge size={16} className="text-sherpy-600" />최대 속도 제한</span>
            <span className="tabular font-semibold">{limit.toFixed(1)} m/s</span>
          </div>
          <input type="range" min={0.5} max={1.5} step={0.1} value={limit} disabled={offline}
                 onChange={(e) => setLimit(Number(e.target.value))}
                 // 끌기를 마쳤을 때(터치·마우스) 또는 방향키를 뗐을 때 한 번만 보낸다
                 onPointerUp={(e) => cmd("SET_SPEED_LIMIT", { limit: Number(e.currentTarget.value) })}
                 onKeyUp={(e) => e.key.startsWith("Arrow") && cmd("SET_SPEED_LIMIT", { limit: Number(e.currentTarget.value) })}
                 className="mt-3 w-full accent-sherpy-600" />
        </div>

        <Link href="/robot/camera" className="press touch mt-2 flex items-center justify-center gap-2 rounded-xl bg-sherpy-900 py-3 text-sm font-semibold text-white">
          <Video size={16} /> 실시간 카메라 보기
        </Link>
      </section>

      {/* 명령 상태 pending → sent → acked | expired */}
      {commands.length > 0 && (
        <section className="card mt-3 p-4">
          <h2 className="mb-2 text-sm font-bold">최근 명령</h2>
          <ul className="space-y-1.5">
            {commands.slice(0, 5).map((c) => <CmdRow key={c.id} c={c} />)}
          </ul>
        </section>
      )}

      {latest?.faults?.length ? (
        <section className="mt-3 rounded-2xl bg-level-1/10 p-3 text-xs text-body">
          {latest.faults.map((f) => <p key={f}><b>{f}</b> {FAULT_LABEL[f]}</p>)}
        </section>
      ) : null}

      <p className="mt-4 mb-28 text-center text-[11px] leading-relaxed text-muted">
        원격 정지는 보조 수단입니다.<br />
        긴급 상황에서는 로봇 본체의 물리 정지 버튼을 사용하세요.
      </p>

      <EstopButton robotId={robotId} disabled={offline} />

      <Sheet open={pickOpen} title="주행할 코스 선택" cancelLabel="닫기" onClose={() => setPickOpen(false)}>
        <ul className="-mx-1 max-h-[45dvh] space-y-1.5 overflow-y-auto px-1">
          {[...mine, ...ROUTES].map((r) => (
            <li key={r.id}>
              <button onClick={() => { cmd("SET_ROUTE", { route_id: r.id }); setPickOpen(false); }}
                      className={`touch flex w-full items-center gap-2 rounded-xl border px-3 py-2.5 text-left ${r.id === latest?.routeId ? "border-sherpy-600 bg-sherpy-50" : "border-line"}`}>
                {r.id > 1000 && <span className="rounded-full bg-sherpy-600 px-2 py-0.5 text-[10px] font-semibold text-white">내 코스</span>}
                <span className="flex-1 truncate font-semibold text-ink">{r.name}</span>
                <span className="text-[11px] text-muted">{r.taught ? "자동주행 가능" : "티칭 필요"}</span>
              </button>
            </li>
          ))}
        </ul>
        {mine.length === 0 && <p className="mt-2 text-xs text-muted">지도에서 코스를 그려 저장하면 여기서 바로 불러올 수 있어요.</p>}
      </Sheet>

      <Sheet
        open={confirmFollow}
        title="자동주행을 시작할까요?"
        confirmLabel="시작"
        onClose={() => setConfirmFollow(false)}
        onConfirm={() => cmd("START_FOLLOW")}
      >
        <p>주변에 사람·차량이 없는지 확인하셨나요?</p>
        <p className="mt-2 text-xs text-muted">
          코스: {route?.name ?? "—"} · 최대 {limit.toFixed(1)} m/s<br />
          원격 정지는 네트워크를 거쳐 약 1초 지연될 수 있습니다. 로봇 곁에서 지켜봐 주세요.
        </p>
      </Sheet>
    </div>
  );
}

function CmdRow({ c }: { c: CommandLog }) {
  const S = {
    pending: { i: <Clock size={13} />, t: "대기", cl: "text-muted" },
    sent:    { i: <Loader size={13} className="animate-spin" />, t: "전송됨", cl: "text-sherpy-600" },
    acked:   { i: <Check size={13} />, t: c.ackedAt ? `확인 ${((c.ackedAt - c.issuedAt) / 1000).toFixed(1)}s` : "확인", cl: "text-level-0" },
    expired: { i: <X size={13} />, t: "만료 — 다시 시도", cl: "text-level-3" },
  }[c.status];
  return (
    <li className="flex items-center justify-between text-sm">
      <span className={c.type === "ESTOP" ? "font-semibold text-level-3" : ""}>{CMD_LABEL[c.type] ?? c.type}</span>
      <span className={`tabular flex items-center gap-1 text-xs ${S.cl}`}>{S.i}{S.t}</span>
    </li>
  );
}

function Stat({ label, value, unit, warn, warnText = "낮음", small }: { label: string; value: string; unit?: string; warn?: boolean; warnText?: string; small?: boolean }) {
  return (
    <div className={`card p-3 ${warn ? "border-level-1 bg-level-1/5" : ""}`}>
      <p className="text-xs text-muted">{label}{warn && ` · ${warnText}`}</p>
      <p className={`tabular mt-1 font-semibold ${small ? "text-base text-muted" : "text-xl"} ${warn ? "text-level-1" : ""}`}>
        {value}{unit && <span className="ml-0.5 text-xs font-normal text-muted">{unit}</span>}
      </p>
    </div>
  );
}

function Btn({ children, onClick, disabled, primary, icon }: {
  children: React.ReactNode; onClick: () => void; disabled?: boolean; primary?: boolean; icon?: React.ReactNode;
}) {
  return (
    <button onClick={onClick} disabled={disabled}
      className={[
        "press touch flex items-center justify-center gap-1.5 rounded-xl py-3 text-sm font-semibold disabled:opacity-40 disabled:active:scale-100",
        primary ? "bg-sherpy-600 text-white" : "border border-line bg-surface text-body",
      ].join(" ")}>
      {icon}{children}
    </button>
  );
}
