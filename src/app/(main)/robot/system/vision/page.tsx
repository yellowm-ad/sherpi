"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Eye, EyeOff, Loader, ArrowUp, ArrowLeft, ArrowRight, Hand, Octagon, Gauge, ThumbsUp, RotateCcw } from "lucide-react";
import { useRobot } from "../../RobotProvider";
import { sendCommand } from "@/hooks/useRobotStream";
import PageHeader from "@/components/ui/PageHeader";
import type { RobotHealth, VisionResult } from "@/lib/robot/types";

/**
 * 자율주행 인식 테스트 (로봇 관리 → 하위 화면)
 *
 * 파이 카메라 → YOLO 객체 인식 + 바닥 색 검사 → "계속/천천히/기다림/옆으로 피함/멈춤" 판단 (robot/bridge/avoid.py)
 * 판단 규칙은 로봇 한 곳에만 있고, 이 화면은 결과·사진을 보여 주고 값 조정·표본 저장 명령만 보낸다.
 * 바퀴는 움직이지 않는다 — 실제 주행 연동은 모터 제어 프로그램이 붙은 뒤 (PRD 확인 필요).
 */
type VisionRes = { result: VisionResult | null; frame: string | null; at: string | null };
type P = VisionResult["params"];

const DECISION: Record<VisionResult["decision"], { label: string; color: string; icon: React.ReactNode }> = {
  GO: { label: "계속 가요", color: "var(--color-level-0)", icon: <ArrowUp size={26} /> },
  SLOW: { label: "천천히", color: "var(--color-level-1)", icon: <Gauge size={26} /> },
  AVOID_LEFT: { label: "왼쪽으로 피해요", color: "var(--color-level-2)", icon: <ArrowLeft size={26} /> },
  AVOID_RIGHT: { label: "오른쪽으로 피해요", color: "var(--color-level-2)", icon: <ArrowRight size={26} /> },
  WAIT: { label: "멈춰서 기다려요", color: "var(--color-level-2)", icon: <Hand size={26} /> },
  STOP: { label: "멈춤 — 길이 막힘", color: "var(--color-level-3)", icon: <Octagon size={26} /> },
};

// [키, 이름, 최소, 최대, 간격, 단위, 설명] — 범위는 avoid.py Params.RANGES 와 같게
const SLIDERS: [keyof P, string, number, number, number, string, string][] = [
  ["stop_near", "멈춤 거리", 0.2, 0.98, 0.02, "", "클수록 더 가까이 와야 멈춤"],
  ["slow_near", "감속 거리", 0.1, 0.95, 0.02, "", "멈춤 거리보다 작게"],
  ["corridor", "통로 폭", 0.15, 0.95, 0.05, "", "로봇+여유 폭 (화면 맨 아래 기준)"],
  ["horizon", "지평선 높이", 0.15, 0.8, 0.01, "", "사진의 회색 가로선이 실제 지평선에 오게"],
  ["conf", "인식 신뢰도", 0.1, 0.9, 0.05, "", "낮추면 더 많이 잡지만 헛것도 늘어요"],
  ["wait_s", "기다리는 시간", 0, 15, 0.5, "초", "사람·동물 앞에서 기다린 뒤 피함"],
  ["floor_tol", "바닥 색 허용", 5, 90, 1, "", "그림자에 자꾸 멈추면 올리세요"],
];
const DEFAULTS: P = { conf: 0.35, stop_near: 0.6, slow_near: 0.35, corridor: 0.45, horizon: 0.42, wait_s: 3, floor_on: true, floor_tol: 30, ignore_dog: true, imgsz: 320 };

export default function VisionTest() {
  const { robotId, demo } = useRobot();
  const [h, setH] = useState<RobotHealth | null>(null);
  const [healthAt, setHealthAt] = useState<number>(0);
  const [v, setV] = useState<VisionRes | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [sent, setSent] = useState<{ type: string; at: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [p, setP] = useState<P | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const dirty = useRef<number>(0); // 마지막으로 값을 바꾼 시각 — 그동안은 로봇 값으로 덮어쓰지 않는다
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const running = !!h?.vision;
  // 직접 보기 (폰 ↔ 파이 터널) — 연결되면 서버 경유 0.7초 가져오기를 멈춘다
  const [live, setLive] = useState<"off" | "connecting" | "on">("off");
  const [rtt, setRtt] = useState<number | null>(null);
  const liveUrl = running ? h?.visionLive?.url ?? null : null;
  const liveToken = running ? h?.visionLive?.token ?? null : null;

  const loadHealth = useCallback(async () => {
    if (robotId == null) return;
    try {
      const r = await fetch(`/api/robots/${robotId}/health`, { cache: "no-store" });
      if (r.ok) { const j = await r.json(); setH(j.health); setHealthAt(j.healthAt ? Date.parse(j.healthAt) : 0); }
    } catch { /* 다음 주기 */ }
  }, [robotId]);

  const loadVision = useCallback(async () => {
    if (robotId == null) return;
    try {
      const r = await fetch(`/api/robots/${robotId}/vision`, { cache: "no-store" });
      if (r.ok) {
        const j: VisionRes = await r.json();
        setV(j);
        if (j.result && Date.now() - dirty.current > 3000) setP(j.result.params);
      }
    } catch { /* 다음 주기 */ }
  }, [robotId]);

  useEffect(() => {
    loadHealth(); loadVision();
    const a = setInterval(() => { if (!document.hidden) { loadHealth(); setNow(Date.now()); } }, 3000);
    return () => clearInterval(a);
  }, [loadHealth, loadVision]);

  // 인식 중이면 0.7초마다 사진·결과 (직접 보기가 안 될 때만)
  useEffect(() => {
    if (!running || live === "on") return;
    const b = setInterval(() => { if (!document.hidden) { loadVision(); setNow(Date.now()); } }, 700);
    return () => clearInterval(b);
  }, [running, live, loadVision]);

  // 직접 보기 — 파이가 터널 주소를 올리면 붙는다. 끊기면 3초 뒤 다시 (보기 전용이라 자동 재연결 OK)
  useEffect(() => {
    if (!liveUrl || !liveToken) { setLive("off"); return; }
    let ws: WebSocket | null = null;
    let closed = false;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let ping: ReturnType<typeof setInterval> | null = null;
    const open = () => {
      if (closed) return;
      setLive("connecting");
      ws = new WebSocket(liveUrl.replace(/^https:/, "wss:"));
      ws.onopen = () => ws?.send(JSON.stringify({ t: "auth", token: liveToken }));
      ws.onmessage = (e) => {
        let m: { t?: string; result?: VisionResult; frame?: string; id?: number };
        try { m = JSON.parse(String(e.data)); } catch { return; }
        if (m.t === "hello") {
          setLive("on");
          ping = setInterval(() => ws?.readyState === 1 && ws.send(JSON.stringify({ t: "ping", id: Date.now() })), 2000);
        } else if (m.t === "pong" && typeof m.id === "number") {
          setRtt(Date.now() - m.id);
        } else if (m.t === "frame" && m.result && typeof m.frame === "string") {
          const at = new Date().toISOString();
          setV({ result: m.result, frame: m.frame, at });
          setNow(Date.now());
          if (Date.now() - dirty.current > 3000) setP(m.result.params);
        }
      };
      ws.onclose = (e) => {
        if (ping) clearInterval(ping);
        ping = null;
        setLive("off");
        setRtt(null);
        if (!closed && e.code !== 4001) retry = setTimeout(open, 3000); // 4001 = 비밀번호 틀림 → health 갱신 기다림
      };
    };
    open();
    return () => {
      closed = true;
      if (retry) clearTimeout(retry);
      if (ping) clearInterval(ping);
      ws?.close();
    };
  }, [liveUrl, liveToken]);

  const cmd = async (type: string, payload: Record<string, unknown> = {}) => {
    setErr(null);
    try {
      await sendCommand(robotId, type, payload);
      if (type === "VISION_ON" || type === "VISION_OFF") setSent({ type, at: Date.now() });
      setTimeout(loadHealth, 1500);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "명령을 보내지 못했어요");
    }
  };

  useEffect(() => {
    if (!sent || !h) return;
    if ((sent.type === "VISION_ON" && (h.vision || h.visionError)) || (sent.type === "VISION_OFF" && !h.vision)) setSent(null);
  }, [h, sent]);

  const change = (patch: Partial<P>) => {
    if (!p) return;
    const next = { ...p, ...patch };
    if (next.slow_near > next.stop_near) next.slow_near = next.stop_near;
    setP(next);
    dirty.current = Date.now();
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => cmd("VISION_SET", next), 500);
  };

  const mark = (kind: "missed" | "false_stop" | "good", label: string) => {
    cmd("VISION_MARK", { kind });
    setToast(`"${label}" 표본을 파이에 저장했어요`);
    setTimeout(() => setToast(null), 2500);
  };

  if (demo || robotId == null) {
    return (
      <div className="px-4">
        <div className="-mx-4 mb-3"><PageHeader title="자율주행 인식 테스트" back /></div>
        <p className="card p-4 text-sm text-body">이 계정에 등록된 로봇이 없어요. 로봇을 등록하면 카메라로 장애물 인식을 시험할 수 있어요.</p>
      </div>
    );
  }

  const online = now - healthAt < 25_000;
  const waiting = sent && now - sent.at < 25_000 ? sent.type : null;
  const working = h?.busy === "vision_on" || h?.busy === "vision_off" || !!waiting;
  const r = v?.result ?? null;
  const ageS = v?.at ? (now - Date.parse(v.at)) / 1000 : Infinity;
  const stale = running && ageS > 4;
  const d = r ? DECISION[r.decision] : null;

  return (
    <div className="px-4 pb-28">
      <div className="-mx-4 mb-3"><PageHeader title="자율주행 인식 테스트" back /></div>

      <p className="mb-3 text-xs leading-relaxed text-muted">
        카메라로 앞을 보고 <b className="text-body">멈출지·기다릴지·옆으로 피할지</b> 판단만 해요. <b className="text-body">바퀴는 움직이지 않아요.</b>{" "}
        로봇을 손에 들거나 받침대에 올리고 앞에 사람·물건을 놓아 보세요.
      </p>

      {/* ── 켜기 / 끄기 ── */}
      <button onClick={() => cmd(running ? "VISION_OFF" : "VISION_ON")} disabled={!online || working}
        className={["press touch flex w-full items-center justify-center gap-2 rounded-2xl py-4 text-base font-bold disabled:opacity-40",
          running ? "border border-line bg-surface text-ink" : "bg-sherpy-600 text-white"].join(" ")}>
        {working ? <Loader size={20} className="animate-spin" /> : running ? <EyeOff size={20} /> : <Eye size={20} />}
        {working ? (waiting === "VISION_OFF" || h?.busy === "vision_off" ? "끄는 중…" : "켜는 중… (모델 준비 최대 20초)") : running ? "인식 끄기" : "인식 시작"}
      </button>
      {!online && <p className="mt-2 text-xs text-muted">로봇이 연결돼 있지 않아요. 파이 전원을 켜고 1~2분 기다리세요.</p>}
      {!running && h?.stream && <p className="mt-2 text-xs text-muted">시작하면 영상 송출은 꺼져요 (카메라는 한 프로그램만 쓸 수 있어요).</p>}
      {h?.visionError && !running && !working && <p className="mt-2 rounded-xl bg-level-3/10 px-3 py-2 text-xs text-level-3">{h.visionError}</p>}
      {err && <p className="mt-2 rounded-xl bg-level-3/10 px-3 py-2 text-xs text-level-3">{err}</p>}

      {running && (
        <>
          {/* ── 판단 ── */}
          <section className="card mt-3 flex items-center gap-3 p-4" style={{ borderLeft: `6px solid ${d?.color ?? "var(--color-line)"}` }}>
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-white" style={{ background: d?.color ?? "var(--color-muted)" }}>
              {d?.icon ?? <Loader size={22} className="animate-spin" />}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-lg font-bold text-ink">{d?.label ?? "준비 중…"}</p>
              <p className="text-xs text-body">{r?.reason ?? "첫 화면을 기다리는 중"}{r?.waitLeft != null && <> · <span className="tabular">{r.waitLeft.toFixed(1)}초</span> 더 기다림</>}</p>
            </div>
          </section>

          {/* ── 사진 ── */}
          <section className="relative mt-3 overflow-hidden rounded-2xl bg-ink/90" style={{ aspectRatio: "16 / 9" }}>
            {v?.frame
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={`data:image/jpeg;base64,${v.frame}`} alt="로봇 카메라 인식 화면" className="h-full w-full object-cover" />
              : <div className="flex h-full items-center justify-center text-xs text-white/70">사진을 기다리는 중…</div>}
            <span className={`absolute right-2 top-2 rounded-full px-2 py-0.5 text-[10px] font-semibold ${stale ? "bg-level-3 text-white" : "bg-black/50 text-white"}`}>
              {stale ? "끊김" : live === "on" ? "직접 연결" : "서버 경유"} · <span className="tabular">{live === "on" && rtt != null ? `${rtt}ms` : isFinite(ageS) ? `${ageS.toFixed(1)}초 전` : "—"}</span>
            </span>
          </section>
          {live !== "on" && (
            <p className="mt-1 text-[11px] text-muted">
              {live === "connecting" ? "로봇에 직접 연결하는 중… (그동안은 서버를 거쳐 1~3초 늦게 보여요)"
                : h?.visionLiveError ? `직접 연결 안 됨 — 서버를 거쳐 1~3초 늦게 보여요 (${h.visionLiveError})`
                : "직접 연결 준비 중 — 그동안은 서버를 거쳐 1~3초 늦게 보여요"}
            </p>
          )}
          <p className="mt-1 text-[10px] text-muted">색 사다리꼴 = 로봇이 지나갈 통로 · 빨강 박스 = 통로 안 · 노랑 = 옆길 · 초록 = 우리 강아지 · 하늘색 선 = 바닥이 이어지는 끝 · 흰 화살표 = 길 방향</p>

          {/* ── 막힘 정도 ── */}
          {r && (
            <section className="card mt-3 p-4">
              <h2 className="mb-2 text-sm font-bold">어디가 막혔나</h2>
              <div className="grid grid-cols-3 gap-2 text-center">
                {(["left", "center", "right"] as const).map((z) => (
                  <div key={z}>
                    <div className="relative mx-auto h-16 w-8 overflow-hidden rounded-md bg-line">
                      <div className="absolute inset-x-0 bottom-0" style={{ height: `${r.zones[z] * 100}%`,
                        background: r.zones[z] >= r.params.stop_near ? "var(--color-level-3)" : r.zones[z] >= r.params.slow_near ? "var(--color-level-1)" : "var(--color-level-0)" }} />
                    </div>
                    <p className="mt-1 text-xs text-body">{z === "left" ? "왼쪽" : z === "center" ? "앞" : "오른쪽"}</p>
                    <p className="tabular text-[11px] text-muted">{Math.round(r.zones[z] * 100)}%</p>
                  </div>
                ))}
              </div>
              <ul className="mt-3 divide-y divide-line text-sm">
                {r.objects.length === 0 && <li className="py-1.5 text-xs text-muted">인식된 물체 없음</li>}
                {r.objects.map((o, i) => (
                  <li key={i} className="flex items-center gap-2 py-1.5">
                    <span className="flex-1 text-body">{o.label}<small className="ml-1 text-[10px] text-muted">{o.cls}</small></span>
                    <span className="text-[11px] text-muted">{o.ours ? (o.zone === "center" && o.near >= r.params.stop_near ? "바로 앞 · 멈춤" : "따라가는 중") : o.zone == null ? "무시" : o.zone === "center" ? "통로 안" : o.zone === "left" ? "왼쪽" : "오른쪽"}</span>
                    <span className="tabular w-20 text-right text-[11px] text-muted">{Math.round(o.conf * 100)}% · {Math.round(o.near * 100)}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-[11px] text-muted">
                <span className="tabular">{r.fps.toFixed(1)}</span> fps · 한 장 <span className="tabular">{r.inferMs}</span>ms · 모델 {r.model ?? "없음"}
              </p>
              {r.note && <p className="mt-1 rounded-lg bg-level-1/10 px-2 py-1 text-[11px] text-level-1">{r.note}</p>}
            </section>
          )}

          {/* ── 잘 안 될 때: 표본 저장 ── */}
          <section className="card mt-3 p-4">
            <h2 className="text-sm font-bold">판단이 틀렸나요?</h2>
            <p className="mt-1 text-xs text-muted">지금 장면을 파이에 저장해 둬요 (robot/vision_log). 모아서 값을 고치거나 다시 학습하는 데 써요.</p>
            <div className="mt-3 grid grid-cols-3 gap-2">
              <MarkBtn onClick={() => mark("missed", "놓쳤어요")} label="놓쳤어요" sub="막혔는데 계속" n={r?.marks.missed} />
              <MarkBtn onClick={() => mark("false_stop", "괜히 멈췄어요")} label="괜히 멈춤" sub="비었는데 멈춤" n={r?.marks.false_stop} />
              <MarkBtn onClick={() => mark("good", "잘했어요")} label="잘했어요" sub="맞는 판단" n={r?.marks.good} icon />
            </div>
            {toast && <p className="mt-2 text-center text-xs text-level-0">{toast}</p>}
          </section>

          {/* ── 값 조정 ── */}
          {p && (
            <section className="card mt-3 p-4">
              <div className="mb-1 flex items-center justify-between">
                <h2 className="text-sm font-bold">판단 값 조정</h2>
                <button onClick={() => change(DEFAULTS)} className="touch flex items-center gap-1 px-2 text-xs text-muted"><RotateCcw size={13} />기본값</button>
              </div>
              {SLIDERS.map(([k, label, lo, hi, step, unit, hint]) => (
                <label key={k} className="block py-1.5">
                  <span className="flex items-baseline justify-between text-xs text-body">
                    {label}
                    <output className="tabular text-sm font-semibold text-ink">{(p[k] as number).toFixed(step < 0.1 ? 2 : step < 1 ? 1 : 0)}<small className="ml-0.5 text-[10px] font-normal text-muted">{unit}</small></output>
                  </span>
                  <input type="range" min={lo} max={hi} step={step} value={p[k] as number} aria-label={label}
                         onChange={(e) => change({ [k]: Number(e.target.value) } as Partial<P>)} className="w-full accent-sherpy-600" />
                  <span className="text-[10px] text-muted">{hint}</span>
                </label>
              ))}
              <div className="mt-2 flex flex-wrap gap-1.5">
                <button className="chip touch" data-active={p.floor_on} onClick={() => change({ floor_on: !p.floor_on })}>바닥 색 검사 {p.floor_on ? "켬" : "끔"}</button>
                <button className="chip touch" data-active={p.ignore_dog} onClick={() => change({ ignore_dog: !p.ignore_dog })}>우리 강아지 구분 {p.ignore_dog ? "켬" : "끔"}</button>
              </div>
              <p className="mt-2 text-[10px] text-muted">바닥 색 검사 = 인식 모델이 모르는 기둥·턱·벽을 &apos;바닥이 끊긴 곳&apos;으로 잡아요. 그림자·잔디 경계에 속을 수 있어요.</p>
            </section>
          )}
        </>
      )}

      <p className="mt-4 text-center text-[11px] leading-relaxed text-muted">
        카메라 판단은 보조 수단이에요. 1차 안전장치는 리드줄 장력 정지와 본체 물리 정지 버튼입니다.
      </p>
    </div>
  );
}

function MarkBtn({ onClick, label, sub, n, icon }: { onClick: () => void; label: string; sub: string; n?: number; icon?: boolean }) {
  return (
    <button onClick={onClick} className="press touch flex flex-col items-center justify-center gap-0.5 rounded-xl border border-line bg-surface px-1 py-2.5 text-center">
      <span className="flex items-center gap-1 text-sm font-semibold text-ink">{icon && <ThumbsUp size={13} />}{label}</span>
      <span className="text-[10px] text-muted">{sub}</span>
      {n != null && <span className="tabular text-[10px] text-muted">저장 {n}</span>}
    </button>
  );
}
