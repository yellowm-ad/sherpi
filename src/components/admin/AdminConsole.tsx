"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Activity, Bot, Flag, Users, LogOut, CheckCircle2, XCircle, RefreshCw, Zap, Unplug, TriangleAlert, ScanEye, ExternalLink,
} from "lucide-react";
import { useRobotStream, sendCommand } from "@/hooks/useRobotStream";
import { broadcastInject } from "@/lib/robot/demo-robot";
import { THRESHOLDS, FAULT_LABEL } from "@/lib/robot/types";
import { REPORT_LABEL, type ReportReason } from "@/lib/report-reasons";
import { DEOKJIN } from "@/components/weather/WalkScoreCard";
import SafetyBadge from "@/components/robot/SafetyBadge";

type Tab = "overview" | "robot" | "reports" | "users";

/** 어드민 콘솔 — 연동 상태 점검 · 시연 리허설 · 신고 처리 · 회원 제재 */
export default function AdminConsole() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("overview");
  const TABS: [Tab, string, React.ReactNode][] = [
    ["overview", "개요", <Activity key="a" size={16} />],
    ["robot", "로봇", <Bot key="b" size={16} />],
    ["reports", "신고", <Flag key="c" size={16} />],
    ["users", "회원", <Users key="d" size={16} />],
  ];

  return (
    <div className="min-h-dvh bg-bg pb-10">
      <header className="sticky top-0 z-30 bg-sherpy-900 px-4 pt-3 text-white">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[11px] text-sherpy-100/70">SHERPY ADMIN</p>
            <h1 className="text-lg font-bold">운영 콘솔</h1>
          </div>
          <div className="flex items-center gap-1">
            <Link href="/home" className="touch flex items-center gap-1 px-2 text-xs text-sherpy-100"><ExternalLink size={14} />앱</Link>
            <button onClick={async () => { await fetch("/api/admin/login", { method: "DELETE" }); router.refresh(); }}
                    className="touch flex items-center gap-1 px-2 text-xs text-sherpy-100"><LogOut size={14} />나가기</button>
          </div>
        </div>
        <nav className="mt-2 flex">
          {TABS.map(([k, label, icon]) => (
            <button key={k} onClick={() => setTab(k)}
                    className={`touch relative flex flex-1 items-center justify-center gap-1 text-sm font-semibold ${tab === k ? "text-white" : "text-sherpy-100/60"}`}>
              {icon}{label}
              {tab === k && <span className="absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-accent" />}
            </button>
          ))}
        </nav>
      </header>
      <div className="px-4 pt-4">
        {tab === "overview" && <Overview />}
        {tab === "robot" && <RobotPanel />}
        {tab === "reports" && <Reports />}
        {tab === "users" && <UsersPanel />}
      </div>
    </div>
  );
}

/* ── 개요: 연동 상태 + 통계 ─────────────────────── */
function Overview() {
  const [status, setStatus] = useState<Record<string, string | boolean | null> | null>(null);
  const [stats, setStats] = useState<Record<string, number> | null>(null);
  const [weather, setWeather] = useState<{ code: number; status?: Record<string, string>; error?: string } | null>(null);

  const load = useCallback(() => {
    fetch("/api/admin/status").then((r) => r.json()).then(setStatus).catch(() => {});
    fetch("/api/admin/users").then((r) => (r.ok ? r.json() : null)).then((j) => setStats(j?.stats ?? null)).catch(() => {});
    setWeather(null);
    fetch(`/api/weather?lat=${DEOKJIN.lat}&lng=${DEOKJIN.lng}`).then(async (r) => {
      const j = await r.json().catch(() => ({}));
      setWeather({ code: r.status, status: j.status, error: j.error });
    }).catch(() => setWeather({ code: 0, error: "network" }));
  }, []);
  useEffect(load, [load]);

  const checks: [string, boolean | undefined, string][] = [
    ["DB (Neon · sherpy 스키마)", status?.db as boolean, "커뮤니티·로그인·내 코스 저장"],
    ["카카오맵 JS 키", status?.kakaoKey as boolean, "지도"],
    ["공공데이터 서비스키", status?.weatherKey as boolean, "기상청 단기예보"],
    ["로봇 영상 주소", status?.streamBase as boolean, "WebRTC 카메라 — 카메라 모듈 확보 후"],
    ["세션 서명키", status?.sessionSecret as boolean, "로그인 쿠키"],
  ];

  return (
    <>
      <div className="grid grid-cols-4 gap-2 text-center">
        {([["회원", stats?.users], ["코스", stats?.routes], ["24h 메시지", stats?.messagesToday], ["대기 신고", stats?.pendingReports]] as const).map(([l, v]) => (
          <div key={l} className={`card p-2.5 ${l === "대기 신고" && (v ?? 0) > 0 ? "border-level-2 bg-level-2/5" : ""}`}>
            <p className="tabular text-xl font-bold">{v ?? "—"}</p>
            <p className="text-[10px] text-muted">{l}</p>
          </div>
        ))}
      </div>

      <section className="card mt-3 p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold">연동 상태</h2>
          <button onClick={load} className="flex items-center gap-1 text-xs text-sherpy-600"><RefreshCw size={13} />다시 확인</button>
        </div>
        <ul className="mt-2 space-y-2">
          {checks.map(([label, ok, note]) => (
            <li key={label} className="flex items-center gap-2 text-sm">
              {ok ? <CheckCircle2 size={16} className="shrink-0 text-level-0" /> : <XCircle size={16} className="shrink-0 text-muted" />}
              <span className="flex-1">{label}<span className="block text-[11px] text-muted">{note}</span></span>
              <span className={`text-xs font-semibold ${ok ? "text-level-0" : "text-muted"}`}>{status ? (ok ? "설정됨" : "미설정") : "…"}</span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-[11px] text-muted">환경: {String(status?.env ?? "…")}{status?.commit ? ` · ${status.commit}` : ""}</p>
      </section>

      <section className="card mt-3 p-4">
        <h2 className="text-sm font-bold">날씨 API 실시간 점검 (덕진공원)</h2>
        {!weather ? <p className="mt-2 text-xs text-muted">호출 중…</p> : weather.code === 200 ? (
          <ul className="mt-2 space-y-1 text-xs">
            {Object.entries(weather.status ?? {}).map(([k, v]) => (
              <li key={k} className="flex justify-between"><span className="text-muted">{({ kmaNow: "기상청 초단기실황", kmaForecast: "기상청 단기예보" } as Record<string, string>)[k] ?? k}</span>
                <span className={v === "ok" ? "font-semibold text-level-0" : "text-level-2"}>{v === "ok" ? "정상" : v}</span></li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-xs text-level-2">
            {weather.code === 503 ? "서비스키 미설정 — scripts/set_weather_key.py 로 등록하세요" : `${weather.code} ${weather.error ?? ""} ${JSON.stringify(weather.status ?? {})}`}
          </p>
        )}
        <p className="mt-2 text-[11px] text-muted">처음 신청한 키는 기상청 서버에 반영되기까지 1~2시간 걸릴 수 있어요.</p>
      </section>
    </>
  );
}

/* ── 로봇: 실시간 모니터 + 시연 리허설 ─────────────── */
function RobotPanel() {
  const { latest, state, demo, commands } = useRobotStream(1);
  const inject = broadcastInject;

  return (
    <>
      <section className="card p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold">셰르피 #1 {demo && <span className="ml-1 text-[11px] font-normal text-sherpy-600">시연 모드</span>}</h2>
          <SafetyBadge level={latest?.safetyLevel ?? 0} compact />
        </div>
        <p className="mt-1 text-xs text-muted">연결 {state} · 모드 {latest?.mode ?? "—"} · 코스 {latest?.routeId ?? "—"}</p>
        <div className="mt-3 grid grid-cols-3 gap-2 text-center">
          {([["장력", latest?.tensionN, "N"], ["줄", latest?.leashLenM, "m"], ["속도", latest?.speedCmd, "m/s"],
             ["조향", latest?.steerCmd, ""], ["매칭", latest?.matchQuality, ""], ["KF", latest?.kfIndex, `/${latest?.kfTotal ?? "—"}`]] as const).map(([l, v, u]) => (
            <div key={l} className="rounded-xl bg-bg p-2">
              <p className="text-[10px] text-muted">{l}</p>
              <p className="tabular text-sm font-bold">{v == null ? "—" : typeof v === "number" ? (Number.isInteger(v) ? v : v.toFixed(2)) : v}<span className="text-[10px] font-normal text-muted">{u}</span></p>
            </div>
          ))}
        </div>
        {!!latest?.faults?.length && <p className="mt-2 text-xs text-level-2">{latest.faults.map((f) => `${f} ${FAULT_LABEL[f]}`).join(" · ")}</p>}
      </section>

      <section className="card mt-3 p-4">
        <h2 className="text-sm font-bold">시연 리허설 — 상황 주입</h2>
        <p className="mt-1 text-[11px] text-muted">발표 전에 경고 화면이 제대로 뜨는지 확인할 때 써요. 가상 셰르피(시연 모드)에 적용되며, 같은 브라우저의 다른 탭에 열린 앱 화면에도 함께 전달돼요.</p>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <Inject onClick={() => inject("pull")} icon={<Zap size={15} />} label="강아지 급당김" sub="릴이 풀어 주며 경고 근처까지 (7.3 물리)" disabled={!demo} />
          <Inject onClick={() => inject("overload")} icon={<TriangleAlert size={15} />} label="견인 한계 초과" sub="L3 정지 · 원인 해소 후 재개" disabled={!demo} />
          <Inject onClick={() => inject("dip")} icon={<ScanEye size={15} />} label="경로 매칭 저하" sub="F4 · 자동주행 중에만" disabled={!demo} />
          <Inject onClick={() => inject("disconnect")} icon={<Unplug size={15} />} label="10초 연결 끊김" sub="지연 → 연결 끊김 표시" disabled={!demo} />
        </div>
      </section>

      <section className="card mt-3 p-4">
        <h2 className="text-sm font-bold">명령 보내기</h2>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {["START_TEACH", "STOP_TEACH", "START_FOLLOW", "PAUSE", "RESUME", "ESTOP"].map((c) => (
            <button key={c} onClick={() => sendCommand(1, c)}
                    className={`rounded-full px-3 py-1.5 text-xs font-semibold ring-1 ${c === "ESTOP" ? "bg-level-3 text-white ring-level-3" : "ring-line"}`}>{c}</button>
          ))}
        </div>
        <ul className="mt-3 space-y-1 text-xs">
          {commands.slice(0, 6).map((c) => (
            <li key={c.id} className="flex justify-between"><span>{c.type}</span>
              <span className={c.status === "acked" ? "text-level-0" : c.status === "expired" ? "text-level-3" : "text-muted"}>
                {c.status}{c.ackedAt ? ` ${((c.ackedAt - c.issuedAt) / 1000).toFixed(1)}s` : ""}
              </span></li>
          ))}
        </ul>
      </section>

      <section className="card mt-3 p-4">
        <h2 className="text-sm font-bold">안전 임계값 (읽기 전용)</h2>
        <p className="mt-1 text-[11px] text-muted">로봇 walkbot/config.py 와 반드시 같아야 해요. 앱에서 바꾸지 않습니다.</p>
        <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
          {Object.entries(THRESHOLDS).map(([k, v]) => (
            <div key={k} className="flex justify-between"><dt className="text-muted">{k}</dt><dd className="tabular font-semibold">{v}</dd></div>
          ))}
        </dl>
      </section>
    </>
  );
}

function Inject({ onClick, icon, label, sub, disabled }: { onClick: () => void; icon: React.ReactNode; label: string; sub: string; disabled?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled} className="rounded-xl border border-line p-3 text-left active:bg-bg disabled:opacity-40">
      <span className="flex items-center gap-1 text-xs font-bold text-ink">{icon}{label}</span>
      <span className="mt-0.5 block text-[10px] text-muted">{sub}</span>
    </button>
  );
}

/* ── 신고 처리 ─────────────────────────────── */
type Report = {
  id: number; reason: ReportReason; detail: string | null; status: string; snapshot: string | null; createdAt: string;
  reporter: string; reportedId: number; reported: string; reportedStatus: string; room: string | null; messageDeletedAt: string | null;
};

function Reports() {
  const [list, setList] = useState<Report[] | null>(null);
  const load = useCallback(() => {
    fetch("/api/admin/reports", { cache: "no-store" }).then((r) => (r.ok ? r.json() : { reports: [] })).then((j) => setList(j.reports)).catch(() => setList([]));
  }, []);
  useEffect(load, [load]);

  const act = async (id: number, body: Record<string, unknown>) => {
    await fetch(`/api/admin/reports/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    load();
  };

  if (!list) return <p className="text-sm text-muted">불러오는 중…</p>;
  if (list.length === 0) return <p className="card p-6 text-center text-sm text-muted">접수된 신고가 없어요.</p>;

  return (
    <ul className="space-y-2">
      {list.map((r) => (
        <li key={r.id} className={`card p-4 ${r.status === "PENDING" ? "border-level-2" : "opacity-70"}`}>
          <div className="flex items-center justify-between text-xs">
            <span className="font-bold text-level-3">{REPORT_LABEL[r.reason] ?? r.reason}</span>
            <span className="text-muted">{new Date(r.createdAt).toLocaleString("ko-KR")}</span>
          </div>
          <p className="mt-1 text-xs text-muted">{r.room} · {r.reporter} → <b className="text-ink">{r.reported}</b>{r.reportedStatus !== "ACTIVE" && " (정지됨)"}</p>
          {r.snapshot && <p className="mt-2 rounded-lg bg-bg px-3 py-2 text-sm">&ldquo;{r.snapshot}&rdquo;{r.messageDeletedAt && <span className="ml-1 text-[10px] text-muted">(삭제됨)</span>}</p>}
          {r.detail && <p className="mt-1 text-xs text-body">상세: {r.detail}</p>}
          {r.status === "PENDING" ? (
            <div className="mt-3 grid grid-cols-3 gap-1.5 text-xs font-semibold">
              <button onClick={() => act(r.id, { status: "DISMISSED" })} className="rounded-lg py-2 ring-1 ring-line">기각</button>
              <button onClick={() => act(r.id, { status: "RESOLVED", deleteMessage: true })} className="rounded-lg bg-level-2/10 py-2 text-level-2">메시지 삭제</button>
              <button onClick={() => act(r.id, { status: "RESOLVED", deleteMessage: true, suspendUser: true })} className="rounded-lg bg-level-3 py-2 text-white">삭제+정지</button>
            </div>
          ) : (
            <p className="mt-2 text-[11px] font-semibold text-muted">{r.status === "RESOLVED" ? "처리 완료" : "기각됨"}</p>
          )}
        </li>
      ))}
    </ul>
  );
}

/* ── 회원 ─────────────────────────────────── */
type U = { id: number; username: string; nickname: string; role: string; accountStatus: string; createdAt: string; routes: number; messages: number };

function UsersPanel() {
  const [list, setList] = useState<U[] | null>(null);
  const load = useCallback(() => {
    fetch("/api/admin/users", { cache: "no-store" }).then((r) => (r.ok ? r.json() : { users: [] })).then((j) => setList(j.users)).catch(() => setList([]));
  }, []);
  useEffect(load, [load]);

  const toggle = async (u: U) => {
    await fetch(`/api/admin/users/${u.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accountStatus: u.accountStatus === "ACTIVE" ? "SUSPENDED" : "ACTIVE" }),
    });
    load();
  };

  if (!list) return <p className="text-sm text-muted">불러오는 중…</p>;
  if (list.length === 0) return <p className="card p-6 text-center text-sm text-muted">가입한 회원이 없어요.</p>;

  return (
    <ul className="card divide-y divide-line">
      {list.map((u) => (
        <li key={u.id} className="flex items-center gap-3 px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{u.nickname} <span className="font-normal text-muted">@{u.username}</span></p>
            <p className="tabular text-[11px] text-muted">코스 {u.routes} · 메시지 {u.messages} · {new Date(u.createdAt).toLocaleDateString("ko-KR")} 가입</p>
          </div>
          <button onClick={() => toggle(u)}
                  className={`rounded-full px-3 py-1.5 text-xs font-semibold ${u.accountStatus === "ACTIVE" ? "ring-1 ring-line" : "bg-level-3 text-white"}`}>
            {u.accountStatus === "ACTIVE" ? "정지" : "정지 해제"}
          </button>
        </li>
      ))}
    </ul>
  );
}
