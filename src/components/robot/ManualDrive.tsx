"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Gamepad2, Loader, Unplug, FlaskConical, Zap } from "lucide-react";
import { sendCommand } from "@/hooks/useRobotStream";
import type { RobotHealth } from "@/lib/robot/types";

/**
 * 수동 조종 (주행 제어 → [수동] 탭) — 티칭 때 사람이 조이스틱으로 로봇을 몬다.
 *
 * 폰 ──wss──▶ Cloudflare 임시 터널 ──▶ 파이 robot/bridge/joystick.py ──▶ motor.py
 *  · 서버 명령 큐(1초 지연)를 거치지 않고 파이와 직접 주고받는다 (보통 0.05~0.15초).
 *  · 누르고 있는 동안만 20번/초 보낸다. 손을 떼면 0 을 보내고, 파이는 0.3초 동안 신호가 없으면 스스로 멈춘다.
 *  · 전진만 (후진 없음). 속도 상한은 파이 설정(SHERPY_JOY_MAX). 판단은 파이 한 곳에서만 한다.
 *  · 로봇이 '시험 모드'면 바퀴로 신호를 보내지 않고 보낼 값(us)만 돌려준다 — 배선 전 시험용.
 */

type Ack = { t: "ack"; seq: number; ok: boolean; reason: string | null; note: string | null; steer: number; speed: number; steerUs: number; throttleUs: number };
type Hello = { t: "hello"; live: boolean; max: number; deadman: number; motorError: string | null };
type Conn = "off" | "starting" | "connecting" | "ready" | "error";

const SEND_MS = 50;      // 20번/초
const DEMO_MAX = 0.25;   // 로봇 없을 때 체험용 (robot/bridge/config.py JOY_MAX_THROTTLE 기본값)

/** robot/bridge/motor.py to_us 와 같은 계산 — 체험 모드 표시용 */
const toUs = (steer: number, speed: number) => [Math.round(1500 + steer * 500), Math.round(1500 + speed * 500)] as const;

export default function ManualDrive({ robotId, demo, offline }: { robotId: number | null; demo: boolean; offline: boolean }) {
  const [h, setH] = useState<RobotHealth | null>(null);
  const [hAt, setHAt] = useState(0);        // 그 상태를 로봇이 올린 시각
  const startedAt = useRef(0);              // [연결]을 누른 시각 — 그 전 상태(옛 주소·옛 오류)는 믿지 않는다
  const [conn, setConn] = useState<Conn>("off");
  const [err, setErr] = useState<string | null>(null);
  const [hello, setHello] = useState<Hello | null>(null);
  const [ack, setAck] = useState<Ack | null>(null);
  const [halt, setHalt] = useState<string | null>(null);
  const [rtt, setRtt] = useState<number | null>(null);
  const [stick, setStick] = useState({ x: 0, y: 0, on: false });

  const ws = useRef<WebSocket | null>(null);
  const seq = useRef(0);
  const pos = useRef({ x: 0, y: 0 });
  const sendTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const pad = useRef<HTMLDivElement | null>(null);
  const wanted = useRef(false); // 사용자가 [연결]을 누른 상태인지 (끊기면 다시 붙을지 판단)

  const local = demo || robotId == null;

  // ── 로봇 상태(health) — 조종 주소·비밀번호가 여기로 온다 ──
  const loadHealth = useCallback(async () => {
    if (local) return;
    try {
      const r = await fetch(`/api/robots/${robotId}/health`, { cache: "no-store" });
      if (r.ok) { const j = await r.json(); setH(j.health); setHAt(j.healthAt ? Date.parse(j.healthAt) : 0); }
    } catch { /* 다음 주기 */ }
  }, [robotId, local]);

  useEffect(() => {
    loadHealth();
    const t = setInterval(() => { if (!document.hidden) loadHealth(); }, conn === "starting" ? 1500 : 4000);
    return () => clearInterval(t);
  }, [loadHealth, conn]);

  // ── 보내기 ──
  const send = (m: object) => {
    const s = ws.current;
    if (s && s.readyState === WebSocket.OPEN) s.send(JSON.stringify(m));
  };
  const sendStick = useCallback(() => {
    const { x, y } = pos.current;
    if (local) {
      const steer = Math.abs(x) < 0.08 ? 0 : x;
      const speed = y < 0.08 ? 0 : y * DEMO_MAX;
      const [su, tu] = toUs(steer, speed);
      setAck({ t: "ack", seq: seq.current++, ok: true, reason: null, note: y <= -0.3 ? "후진은 아직 지원하지 않아요" : null, steer, speed, steerUs: su, throttleUs: tu });
      return;
    }
    send({ t: "joy", x: Number(x.toFixed(3)), y: Number(y.toFixed(3)), seq: seq.current++ });
  }, [local]);

  const release = useCallback(() => {
    if (sendTimer.current) clearInterval(sendTimer.current);
    sendTimer.current = null;
    pos.current = { x: 0, y: 0 };
    setStick({ x: 0, y: 0, on: false });
    sendStick(); // 0 = 멈춤 (파이 데드맨이 한 번 더 지킨다)
  }, [sendStick]);

  // ── 연결 ──
  const openSocket = useCallback((url: string, token: string) => {
    ws.current?.close();
    setConn("connecting");
    const s = new WebSocket(url.replace(/^https:/, "wss:"));
    ws.current = s;
    s.onopen = () => { seq.current = 0; s.send(JSON.stringify({ t: "auth", token })); };
    s.onmessage = (e) => {
      let m: { t?: string; [k: string]: unknown };
      try { m = JSON.parse(String(e.data)); } catch { return; }
      if (m.t === "hello") { setHello(m as unknown as Hello); setConn("ready"); setErr(null); }
      else if (m.t === "ack") { setAck(m as unknown as Ack); if ((m as unknown as Ack).ok) setHalt(null); }
      else if (m.t === "halt") setHalt(String(m.reason ?? "멈췄어요"));
      else if (m.t === "pong" && typeof m.id === "number") setRtt(Math.round(performance.now() - m.id));
    };
    s.onclose = (e) => {
      if (ws.current !== s) return;
      ws.current = null;
      if (sendTimer.current) { clearInterval(sendTimer.current); sendTimer.current = null; setStick({ x: 0, y: 0, on: false }); }
      setHello(null);
      setRtt(null);
      if (!wanted.current) { setConn("off"); return; }
      setConn("error");
      setErr(e.code === 4001 ? "비밀번호가 맞지 않아요 — 연결을 다시 켜 주세요" : e.code === 4002 ? "다른 기기가 조종을 가져갔어요" : "조종 연결이 끊겼어요 — 로봇은 스스로 멈췄어요");
    };
  }, []);

  // 로봇이 주소를 올리면 붙는다 (끊긴 뒤 자동으로 다시 붙지는 않는다 — 사용자가 다시 누른다)
  useEffect(() => {
    if (local || !wanted.current || conn !== "starting" || !h?.joy || h.busy === "joy_on" || hAt < startedAt.current) return;
    openSocket(h.joy.url, h.joy.token);
  }, [h?.joy, h?.busy, hAt, conn, local, openSocket]);
  useEffect(() => {
    if (conn !== "starting" || hAt < startedAt.current) return;
    if (h?.joyError && !h.joy && h.busy !== "joy_on") { setConn("error"); setErr(h.joyError); }
  }, [h, hAt, conn]);
  // 30초 안에 준비가 안 되면 포기
  useEffect(() => {
    if (conn !== "starting") return;
    const t = setTimeout(() => { setConn("error"); setErr("로봇이 응답하지 않아요 — 파이 연결을 확인하고 다시 눌러 주세요"); }, 30_000);
    return () => clearTimeout(t);
  }, [conn]);

  // 지연 측정 (연결 중 1초마다)
  useEffect(() => {
    if (conn !== "ready") return;
    const t = setInterval(() => send({ t: "ping", id: performance.now() }), 1000);
    return () => clearInterval(t);
  }, [conn]);

  // 화면을 떠나거나 앱이 가려지면 멈춤
  useEffect(() => {
    const onHide = () => { if (document.hidden) release(); };
    document.addEventListener("visibilitychange", onHide);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      if (sendTimer.current) clearInterval(sendTimer.current);
      wanted.current = false;
      ws.current?.close();
    };
  }, [release]);

  const start = async () => {
    setErr(null);
    wanted.current = true;
    startedAt.current = Date.now() - 2000; // 서버 시계와 조금 어긋나도 괜찮게
    setConn("starting"); // 이미 켜져 있어도 보낸다 — 로봇이 지금 주소를 다시 올려 준다
    try { await sendCommand(robotId, "JOY_ON"); }
    catch (e) { setConn("error"); setErr(e instanceof Error ? e.message : "명령을 보내지 못했어요"); }
  };
  const stop = async () => {
    wanted.current = false;
    release();
    ws.current?.close();
    ws.current = null;
    setConn("off");
    try { await sendCommand(robotId, "JOY_OFF"); } catch { /* 파이가 터널을 계속 열어 둘 뿐 — 조종은 이미 끊김 */ }
    setTimeout(loadHealth, 1500);
  };

  // ── 조이스틱 ──
  const usable = local || conn === "ready";
  const moveTo = (cx: number, cy: number) => {
    const el = pad.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const R = r.width / 2;
    let x = (cx - (r.left + R)) / R;
    let y = -(cy - (r.top + R)) / R; // 위 = 앞
    const d = Math.hypot(x, y);
    if (d > 1) { x /= d; y /= d; }
    pos.current = { x, y };
    setStick({ x, y, on: true });
  };
  const onDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!usable) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    moveTo(e.clientX, e.clientY);
    sendStick();
    if (sendTimer.current) clearInterval(sendTimer.current);
    sendTimer.current = setInterval(sendStick, SEND_MS);
  };
  const onMove = (e: React.PointerEvent<HTMLDivElement>) => { if (sendTimer.current) moveTo(e.clientX, e.clientY); };

  const live = local ? false : !!hello?.live;
  const max = local ? DEMO_MAX : hello?.max ?? null;
  const working = conn === "starting" || conn === "connecting";

  return (
    <div>
      {/* 연결 */}
      {!local && (
        conn === "ready"
          ? <button onClick={stop} className="press touch flex w-full items-center justify-center gap-2 rounded-2xl border border-line bg-surface py-3.5 text-sm font-bold text-ink">
              <Unplug size={18} />조종 연결 끊기
            </button>
          : <button onClick={start} disabled={offline || working}
              className="press touch flex w-full items-center justify-center gap-2 rounded-2xl bg-sherpy-600 py-3.5 text-sm font-bold text-white disabled:opacity-40">
              {working ? <Loader size={18} className="animate-spin" /> : <Gamepad2 size={18} />}
              {conn === "starting" ? "로봇이 연결 준비 중… (최대 20초)" : conn === "connecting" ? "연결하는 중…" : "수동 조종 연결"}
            </button>
      )}
      {!local && offline && <p className="mt-2 text-xs text-muted">로봇이 연결돼 있지 않아요. 파이 전원을 켜고 1~2분 기다리세요.</p>}
      {err && <p className="mt-2 rounded-xl bg-level-3/10 px-3 py-2 text-xs text-level-3">{err}</p>}

      {/* 상태 */}
      <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[11px]">
        {local
          ? <Badge tone="muted" icon={<FlaskConical size={12} />}>체험 모드 — 로봇 없음</Badge>
          : conn === "ready" && (live
            ? <Badge tone="danger" icon={<Zap size={12} />}>실제 출력 — 바퀴가 움직여요</Badge>
            : <Badge tone="muted" icon={<FlaskConical size={12} />}>시험 모드 — 모터에 신호 안 보냄</Badge>)}
        {conn === "ready" && <Badge tone="muted">지연 <span className="tabular">{rtt != null ? `${rtt}ms` : "—"}</span></Badge>}
        {max != null && <Badge tone="muted">속도 상한 <span className="tabular">{Math.round(max * 100)}%</span></Badge>}
      </div>
      {hello?.motorError && <p className="mt-2 rounded-xl bg-level-1/10 px-3 py-2 text-[11px] text-level-1">{hello.motorError}</p>}

      {/* 조이스틱 */}
      <div className="mt-4 flex justify-center">
        <div ref={pad} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={release} onPointerCancel={release} onLostPointerCapture={() => sendTimer.current && release()}
          role="application" aria-label="조이스틱 — 누른 채로 끌면 움직이고, 손을 떼면 멈춰요"
          className={`relative aspect-square w-60 touch-none select-none rounded-full border-2 ${usable ? "border-sherpy-600/40 bg-sherpy-50" : "border-line bg-line/40 opacity-50"}`}>
          <span className="absolute left-1/2 top-2 -translate-x-1/2 text-[10px] font-semibold text-muted">앞</span>
          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[10px] font-semibold text-muted">왼쪽</span>
          <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] font-semibold text-muted">오른쪽</span>
          <span className="absolute bottom-2 left-1/2 -translate-x-1/2 text-[10px] text-muted">(후진 없음)</span>
          <span className="absolute left-1/2 top-1/2 h-px w-full -translate-x-1/2 bg-line" />
          <span className="absolute left-1/2 top-1/2 h-full w-px -translate-y-1/2 bg-line" />
          <span className={`absolute h-20 w-20 rounded-full shadow-lg ${stick.on ? "bg-sherpy-600" : "bg-sherpy-400"}`}
            style={{ left: `calc(50% + ${stick.x * 50}% - 2.5rem)`, top: `calc(50% - ${stick.y * 50}% - 2.5rem)`, transition: stick.on ? "none" : "left .15s, top .15s" }} />
        </div>
      </div>
      <p className="mt-2 text-center text-xs text-muted">{usable ? "누른 채로 끌면 움직이고, 손을 떼면 바로 멈춰요" : "먼저 [수동 조종 연결]을 눌러 주세요"}</p>

      {halt && conn === "ready" && <p className="mt-2 rounded-xl bg-level-1/10 px-3 py-2 text-center text-xs text-level-1">{halt}</p>}
      {ack && !ack.ok && ack.reason && <p className="mt-2 rounded-xl bg-level-3/10 px-3 py-2 text-center text-xs text-level-3">{ack.reason}</p>}
      {ack?.note && stick.on && <p className="mt-2 text-center text-xs text-level-1">{ack.note}</p>}

      {/* 로봇이 실제로 낸(시험 모드면 낼) 값 */}
      <section className="card mt-3 grid grid-cols-2 gap-3 p-4">
        <Meter label="조향" value={ack ? ack.steer : 0} sub={ack ? `${ack.steerUs} us` : "—"} signed />
        <Meter label="속도" value={ack ? ack.speed : 0} sub={ack ? `${ack.throttleUs} us` : "—"} />
      </section>
      <p className="mt-1 text-[10px] text-muted">로봇이 돌려준 값이에요 (중립 1500 us · 조향 1000~2000 · 스로틀은 전진만 1500~2000).</p>
    </div>
  );
}

function Badge({ children, tone, icon }: { children: React.ReactNode; tone: "muted" | "danger"; icon?: React.ReactNode }) {
  return (
    <span className={`flex items-center gap-1 rounded-full px-2 py-0.5 font-semibold ${tone === "danger" ? "bg-level-3 text-white" : "bg-line text-body"}`}>
      {icon}{children}
    </span>
  );
}

function Meter({ label, value, sub, signed }: { label: string; value: number; sub: string; signed?: boolean }) {
  const pct = Math.round(Math.abs(value) * 100);
  return (
    <div>
      <div className="flex items-baseline justify-between text-xs text-body">
        {label}
        <span className="tabular text-sm font-semibold text-ink">{signed && value !== 0 ? (value > 0 ? "오른쪽 " : "왼쪽 ") : ""}{pct}%</span>
      </div>
      <div className="relative mt-1.5 h-2 overflow-hidden rounded-full bg-line">
        {signed
          ? <div className="absolute inset-y-0 bg-sherpy-600" style={{ left: value < 0 ? `${50 - pct / 2}%` : "50%", width: `${pct / 2}%` }} />
          : <div className="absolute inset-y-0 left-0 bg-sherpy-600" style={{ width: `${pct}%` }} />}
      </div>
      <p className="tabular mt-1 text-[10px] text-muted">{sub}</p>
    </div>
  );
}
