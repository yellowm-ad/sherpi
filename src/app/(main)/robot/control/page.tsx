"use client";

import { useEffect, useRef, useState } from "react";
import { Play, Pause, CircleDot, Square, Gauge, Route as RouteIcon, Check, Clock, X, Loader } from "lucide-react";
import { useRobot } from "../RobotProvider";
import { sendCommand } from "@/hooks/useRobotStream";
import PageHeader from "@/components/ui/PageHeader";
import Sheet from "@/components/ui/Sheet";
import EstopButton from "@/components/robot/EstopButton";
import { FAULT_LABEL } from "@/lib/robot/types";
import { DEFAULT_PARAMS } from "@/lib/sherpy/params";
import { findRoute, useMyRoutes, markTaught } from "@/lib/my-routes";
import { useUser } from "@/lib/session";
import { ROUTES } from "@/lib/demo/data";
import { demoRobot, type CommandLog } from "@/lib/robot/demo-robot";

const CMD_LABEL: Record<string, string> = {
  ESTOP: "긴급 정지", START_TEACH: "티칭 시작", STOP_TEACH: "티칭 종료", START_FOLLOW: "자동주행 시작",
  PAUSE: "일시정지", RESUME: "재개", SET_ROUTE: "코스 지정", SET_SPEED_LIMIT: "속도 제한",
};

/** S10-제어 — 티칭·자동주행·일시정지·재개, 최대 속도 제한, 코스, 명령 기록 (PRD F-2) */
export default function RobotControl() {
  const { robotId, latest, state, demo, commands } = useRobot();
  const [busy, setBusy] = useState(false);
  const [confirmFollow, setConfirmFollow] = useState(false);
  const [limit, setLimit] = useState(DEFAULT_PARAMS.robotMax);
  const [pickOpen, setPickOpen] = useState(false);
  const mine = useMyRoutes();
  const prevMode = useRef<string>("idle");
  const user = useUser();
  const offline = state !== "online" && state !== "stale";
  const mode = latest?.mode ?? "idle";
  const route = findRoute(latest?.routeId);
  const needsTeach = !!route && !route.taught;

  // 티칭 종료(teach → idle) 시 내 코스에 키프레임 수를 기록
  useEffect(() => {
    if (prevMode.current === "teach" && mode === "idle" && user && route && route.id > 1000 && latest?.kfIndex) markTaught(route.id, latest.kfIndex);
    prevMode.current = mode;
  }, [mode, user, route, latest?.kfIndex]);

  // 슬라이더는 로봇에 실제로 걸린 값에서 시작한다
  // TODO(M2): 실로봇은 텔레메트리에 speed_limit 을 실어 보내면 그 값을 쓴다
  useEffect(() => { if (demo) setLimit(demoRobot().limit); }, [demo]);

  const cmd = async (type: string, payload: Record<string, unknown> = {}) => {
    setBusy(true);
    try { await sendCommand(robotId, type, payload); } finally { setBusy(false); }
  };
  const kfPct = latest?.kfTotal ? ((latest.kfIndex ?? 0) / latest.kfTotal) * 100 : 0;

  return (
    <div className="px-4">
      <div className="-mx-4 mb-3"><PageHeader title="주행 제어 · 코스" back /></div>

      <section className="card p-4">
        <div className="flex items-center justify-between text-sm">
          <span className="flex items-center gap-1.5 font-semibold"><RouteIcon size={16} className="text-sherpy-600" />{route?.name ?? "코스 미지정"}</span>
          <button onClick={() => setPickOpen(true)} disabled={offline || mode === "follow" || mode === "teach"} className="touch text-xs font-semibold text-sherpy-600 disabled:opacity-40">코스 변경</button>
        </div>
        <div className="mt-3 flex justify-between text-xs text-muted">
          <span>{mode === "teach" ? "키프레임 기록 중" : "경로 진행"}</span>
          <span className="tabular">{mode === "teach" ? `${latest?.kfIndex ?? 0}개` : latest?.kfTotal ? `${latest.kfIndex ?? 0} / ${latest.kfTotal}` : "—"}</span>
        </div>
        <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-line">
          <div className={`h-full transition-[width] duration-700 ${mode === "teach" ? "w-full animate-pulse bg-sherpy-400" : "bg-sherpy-600"}`} style={mode === "teach" ? undefined : { width: `${kfPct}%` }} />
        </div>
      </section>

      <section className="mt-3 grid grid-cols-2 gap-2">
        {mode === "teach"
          ? <Btn onClick={() => cmd("STOP_TEACH")} disabled={offline || busy} icon={<Square size={16} />}>티칭 종료·저장</Btn>
          : <Btn onClick={() => cmd("START_TEACH")} disabled={offline || busy || mode === "follow"} icon={<CircleDot size={16} />}>티칭 시작</Btn>}
        <Btn onClick={() => setConfirmFollow(true)} disabled={offline || busy || mode === "follow" || mode === "teach" || needsTeach} primary icon={<Play size={16} />}>자동주행 시작</Btn>
        <Btn onClick={() => cmd("PAUSE")} disabled={offline || busy || mode !== "follow"} icon={<Pause size={16} />}>일시정지</Btn>
        <Btn onClick={() => cmd("RESUME")} disabled={offline || busy} icon={<Play size={16} />}>{mode === "estop" || (latest?.safetyLevel ?? 0) >= 3 ? "정지 해제" : "재개"}</Btn>
      </section>
      {needsTeach && mode !== "teach" && (
        <p className="mt-2 rounded-xl bg-sherpy-50 px-3 py-2 text-xs text-sherpy-700">
          아직 티칭하지 않은 코스예요. [티칭 시작] 후 송신기로 한 번 몰고 [티칭 종료·저장]하면 자동주행할 수 있어요.
        </p>
      )}
      {(latest?.safetyLevel ?? 0) >= 3 && (
        <p className="mt-2 rounded-xl bg-level-3/10 px-3 py-2 text-xs text-level-3">
          L3 정지는 자동으로 풀리지 않아요. 원인(장력·센서)이 사라진 뒤 [정지 해제]를 누르면 로봇이 다시 확인하고 풀어 줍니다.
        </p>
      )}

      <div className="card mt-3 p-4">
        <div className="flex items-center justify-between text-sm">
          <span className="flex items-center gap-1.5"><Gauge size={16} className="text-sherpy-600" />최대 속도 제한</span>
          <span className="tabular font-semibold">{limit.toFixed(2)} m/s</span>
        </div>
        <input type="range" min={0.3} max={1.2} step={0.05} value={limit} disabled={offline}
               onChange={(e) => setLimit(Number(e.target.value))}
               onPointerUp={(e) => cmd("SET_SPEED_LIMIT", { limit: Number(e.currentTarget.value) })}
               onKeyUp={(e) => e.key.startsWith("Arrow") && cmd("SET_SPEED_LIMIT", { limit: Number(e.currentTarget.value) })}
               className="mt-3 w-full accent-sherpy-600" aria-label="최대 속도 제한" />
        <p className="mt-1 text-[11px] text-muted">SHERPY 7.3 기본 로봇 최대속도 {DEFAULT_PARAMS.robotMax} m/s · 강아지 목표속도 {DEFAULT_PARAMS.dogSpeed} m/s</p>
      </div>

      {commands.length > 0 && (
        <section className="card mt-3 p-4">
          <h2 className="mb-2 text-sm font-bold">최근 명령</h2>
          <ul className="space-y-1.5">{commands.slice(0, 8).map((c) => <CmdRow key={c.id} c={c} />)}</ul>
        </section>
      )}

      {latest?.faults?.length ? (
        <section className="mt-3 rounded-2xl bg-level-1/10 p-3 text-xs text-body">
          {latest.faults.map((f) => <p key={f}><b>{f}</b> {FAULT_LABEL[f]}</p>)}
        </section>
      ) : null}

      <p className="mt-4 mb-28 text-center text-[11px] leading-relaxed text-muted">원격 정지는 보조 수단입니다.<br />긴급 상황에서는 로봇 본체의 물리 정지 버튼을 사용하세요.</p>
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
      </Sheet>
      <Sheet open={confirmFollow} title="자동주행을 시작할까요?" confirmLabel="시작" onClose={() => setConfirmFollow(false)} onConfirm={() => cmd("START_FOLLOW")}>
        <p>주변에 사람·차량이 없는지 확인하셨나요?</p>
        <p className="mt-2 text-xs text-muted">
          코스: {route?.name ?? "—"} · 최대 {limit.toFixed(2)} m/s<br />
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

function Btn({ children, onClick, disabled, primary, icon }: { children: React.ReactNode; onClick: () => void; disabled?: boolean; primary?: boolean; icon?: React.ReactNode }) {
  return (
    <button onClick={onClick} disabled={disabled}
      className={["press touch flex items-center justify-center gap-1.5 rounded-xl py-3 text-sm font-semibold disabled:opacity-40 disabled:active:scale-100",
        primary ? "bg-sherpy-600 text-white" : "border border-line bg-surface text-body"].join(" ")}>
      {icon}{children}
    </button>
  );
}
