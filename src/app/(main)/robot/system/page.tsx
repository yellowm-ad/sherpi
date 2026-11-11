"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Wifi, WifiOff, Video, VideoOff, Stethoscope, Power, RotateCw, Loader, Check, X, Minus, ChevronRight, ScanEye } from "lucide-react";
import { useRobot } from "../RobotProvider";
import { sendCommand } from "@/hooks/useRobotStream";
import PageHeader from "@/components/ui/PageHeader";
import Sheet from "@/components/ui/Sheet";
import type { RobotHealth } from "@/lib/robot/types";

/**
 * 로봇 관리 — 터미널 대신 버튼으로 (robot/agent.py)
 *   연결 상태(와이파이·신호·서버 응답) · 카메라 송출 켜기/끄기 · 조종 준비 점검 · 다시 시작 / 안전하게 끄기
 *
 * 파이는 전원만 켜면 에이전트가 저절로 서버에 붙는다(systemd). 웹이 꺼진 파이를 켤 수는 없다.
 * 보안: 이 화면의 데이터·명령은 로봇 주인 계정만 (서버 requireRobotOwner). 로봇은 정해진 명령 이름만 실행한다.
 */
type HealthRes = { health: RobotHealth | null; healthAt: string | null; streamUrl: string | null };

const ONLINE_SEC = 25; // 10초마다 보고 → 25초 넘게 없으면 끊김으로 본다

export default function RobotSystem() {
  const { robotId, demo } = useRobot();
  const [res, setRes] = useState<HealthRes | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [sent, setSent] = useState<{ type: string; at: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<"REBOOT" | "POWER_OFF" | null>(null);

  const load = useCallback(async () => {
    if (robotId == null) return;
    try {
      const r = await fetch(`/api/robots/${robotId}/health`, { cache: "no-store" });
      if (r.ok) setRes(await r.json());
    } catch { /* 다음 주기에 다시 */ }
  }, [robotId]);

  useEffect(() => {
    load();
    const id = setInterval(() => { if (!document.hidden) { load(); setNow(Date.now()); } }, 3000);
    return () => clearInterval(id);
  }, [load]);

  const h = res?.health ?? null;
  const ageSec = res?.healthAt ? (now - new Date(res.healthAt).getTime()) / 1000 : Infinity;
  const online = ageSec < ONLINE_SEC && !h?.shuttingDown;
  // 버튼을 누른 뒤 로봇이 처리할 때까지 (보통 1~15초) 진행 중으로 보여준다
  const waiting = sent && now - sent.at < 20_000 ? sent.type : null;
  const busy = h?.busy ?? null;
  const camOn = !!h?.stream;
  const camWorking = busy === "camera_on" || busy === "camera_off" || waiting === "CAMERA_ON" || waiting === "CAMERA_OFF";
  const checking = busy === "check" || waiting === "SYS_CHECK";
  const driving = h?.mode === "follow" || h?.mode === "teach";

  // 로봇이 처리하면(상태가 바뀌면) 대기 표시를 지운다
  useEffect(() => {
    if (!sent || !h) return;
    if ((sent.type === "CAMERA_ON" && h.stream) || (sent.type === "CAMERA_OFF" && !h.stream && !h.busy)
      || (sent.type === "SYS_CHECK" && h.checkedAt && h.checkedAt * 1000 > sent.at)) setSent(null);
  }, [h, sent]);

  const cmd = async (type: string, payload: Record<string, unknown> = {}) => {
    setErr(null);
    try {
      await sendCommand(robotId, type, payload);
      setSent({ type, at: Date.now() });
      setTimeout(load, 1500);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "명령을 보내지 못했어요");
    }
  };

  if (demo || robotId == null) {
    return (
      <div className="px-4">
        <div className="-mx-4 mb-3"><PageHeader title="로봇 관리" back /></div>
        <p className="card p-4 text-sm text-body">이 계정에 등록된 로봇이 없어요. 로봇을 등록하면 연결 상태 확인·카메라 켜기·끄기를 여기서 할 수 있어요.</p>
      </div>
    );
  }

  const checks = h ? checklist(h, online) : [];
  const ready = online && checks.filter((c) => c.need).every((c) => c.ok === true);

  return (
    <div className="px-4 pb-28">
      <div className="-mx-4 mb-3"><PageHeader title="로봇 관리" back /></div>

      {/* ── 연결 상태 ── */}
      <section className={`card p-4 ${online ? "" : "bg-level-3/5"}`}>
        <div className="flex items-center gap-3">
          <span className={`flex h-11 w-11 items-center justify-center rounded-full ${online ? "bg-level-0/15 text-level-0" : "bg-line text-muted"}`}>
            {online ? <Wifi size={22} /> : <WifiOff size={22} />}
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-bold text-ink">
              {h?.shuttingDown ? (h.shuttingDown === "poweroff" ? "꺼지는 중" : "다시 시작하는 중") : online ? "연결됨" : "연결 안 됨"}
            </p>
            <p className="truncate text-xs text-muted">
              {online && h
                ? <>와이파이 <b className="text-body">{h.wifi.ssid ?? "알 수 없음"}</b>{h.wifi.signal != null && <> · 신호 <span className="tabular">{h.wifi.signal}%</span></>}{h.serverMs != null && <> · 응답 <span className="tabular">{h.serverMs}ms</span></>}</>
                : h?.shuttingDown === "poweroff" ? "초록 불이 꺼지면 전원을 빼도 돼요."
                : "파이 전원을 켜면 1~2분 안에 연결돼요."}
            </p>
          </div>
        </div>
        {!online && res?.healthAt && <p className="mt-2 text-[11px] text-muted">마지막 연결 {fmtAgo(ageSec)}</p>}
      </section>

      {/* ── 큰 버튼 두 개 ── */}
      <section className="mt-3 grid grid-cols-2 gap-2">
        <BigBtn onClick={() => cmd(camOn ? "CAMERA_OFF" : "CAMERA_ON")} disabled={!online || camWorking} active={camOn}
                icon={camWorking ? <Loader size={22} className="animate-spin" /> : camOn ? <VideoOff size={22} /> : <Video size={22} />}
                title={camWorking ? (busy === "camera_off" || waiting === "CAMERA_OFF" ? "끄는 중…" : "켜는 중… (최대 15초)") : camOn ? "카메라 끄기" : "카메라 켜기"}
                sub={camOn ? "지금 송출 중" : "영상 송출 시작"} />
        <BigBtn onClick={() => cmd("SYS_CHECK")} disabled={!online || checking}
                icon={checking ? <Loader size={22} className="animate-spin" /> : <Stethoscope size={22} />}
                title={checking ? "점검 중…" : "지금 점검"} sub="연결·전원·부품 확인" />
      </section>
      {camOn && (
        <Link href="/robot/camera" className="press touch mt-2 flex items-center justify-center gap-1 rounded-xl bg-sherpy-600 text-sm font-semibold text-white">
          영상 보기<ChevronRight size={16} />
        </Link>
      )}
      <Link href="/robot/system/vision" className="press card mt-2 flex items-center gap-3 p-3">
        <span className={`flex h-10 w-10 items-center justify-center rounded-full ${h?.vision ? "bg-sherpy-600 text-white" : "bg-sherpy-50 text-sherpy-600"}`}><ScanEye size={20} /></span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-bold text-ink">자율주행 인식 테스트</span>
          <span className="block text-[11px] text-muted">{h?.vision ? "지금 인식 중" : "카메라로 장애물 보고 멈춤·피함 판단 (바퀴는 안 움직임)"}</span>
        </span>
        <ChevronRight size={18} className="text-muted" />
      </Link>
      {h?.streamError && !camOn && !camWorking && <p className="mt-2 rounded-xl bg-level-3/10 px-3 py-2 text-xs text-level-3">카메라를 켜지 못했어요: {h.streamError}</p>}
      {err && <p className="mt-2 rounded-xl bg-level-3/10 px-3 py-2 text-xs text-level-3">{err}</p>}

      {/* ── 조종 준비 점검 ── */}
      {h && (
        <section className="card mt-3 p-4">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-bold">조종 준비</h2>
            <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${ready ? "bg-level-0/15 text-level-0" : "bg-level-2/15 text-level-2"}`}>{ready ? "조종 가능" : "확인 필요"}</span>
          </div>
          <ul className="divide-y divide-line">
            {checks.map((c) => (
              <li key={c.label} className="flex items-center gap-2 py-2 text-sm">
                <Mark ok={c.ok} />
                <span className="flex-1 text-body">{c.label}{!c.need && <span className="ml-1 text-[10px] text-muted">(선택)</span>}</span>
                <span className="tabular text-xs text-muted">{c.value}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[11px] text-muted">
            {h.checkedAt ? <>부품 점검 {fmtAgo((now / 1000) - h.checkedAt)} · </> : null}
            {h.ip && <>같은 와이파이에서 SSH: <span className="tabular">ssh pi@{h.ip}</span></>}
          </p>
        </section>
      )}

      {/* ── 전원 ── */}
      <section className="card mt-3 p-4">
        <h2 className="text-sm font-bold">파이 전원</h2>
        <p className="mt-1 text-xs text-muted">배터리를 그냥 빼면 SD카드가 망가질 수 있어요. 먼저 [안전하게 끄기]를 누르고, 초록 불이 꺼진 뒤 전원을 빼세요.</p>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button onClick={() => setConfirm("REBOOT")} disabled={!online || driving}
                  className="press touch flex items-center justify-center gap-1.5 rounded-xl border border-line bg-surface py-3 text-sm font-semibold text-body disabled:opacity-40">
            <RotateCw size={16} />다시 시작
          </button>
          <button onClick={() => setConfirm("POWER_OFF")} disabled={!online || driving}
                  className="press touch flex items-center justify-center gap-1.5 rounded-xl border border-level-3/40 bg-surface py-3 text-sm font-semibold text-level-3 disabled:opacity-40">
            <Power size={16} />안전하게 끄기
          </button>
        </div>
        {driving && <p className="mt-2 text-[11px] text-level-2">주행 중에는 끄거나 다시 시작할 수 없어요. 먼저 일시정지하세요.</p>}
        {h?.rejected && <p className="mt-2 text-[11px] text-level-3">로봇이 요청을 거절했어요 (주행 중).</p>}
      </section>

      <p className="mt-4 text-center text-[11px] leading-relaxed text-muted">
        원격 조작은 보조 수단입니다. 긴급 상황에서는 로봇 본체의 물리 정지 버튼을 사용하세요.<br />
        영상은 파이와 같은 와이파이/핫스팟에 있는 기기에서 가장 잘 보여요.
      </p>

      <Sheet open={confirm !== null} danger={confirm === "POWER_OFF"}
             title={confirm === "POWER_OFF" ? "파이를 끌까요?" : "파이를 다시 시작할까요?"}
             confirmLabel={confirm === "POWER_OFF" ? "끄기" : "다시 시작"}
             onClose={() => setConfirm(null)}
             onConfirm={() => { if (confirm) cmd(confirm, { confirm: true }); setConfirm(null); }}>
        {confirm === "POWER_OFF"
          ? <p>카메라 송출을 끝내고 파이를 끕니다. <b>웹에서는 다시 켤 수 없어요</b> — 다시 쓰려면 전원을 뺐다 꽂아야 해요.</p>
          : <p>1~2분 동안 연결이 끊겼다가 저절로 다시 붙어요. 카메라 송출은 꺼집니다.</p>}
      </Sheet>
    </div>
  );
}

type Check = { label: string; ok: boolean | null; value: string; need: boolean };

/** need = 조종하려면 꼭 필요한 항목. 센서가 아직 없는 단계라 엔코더·GPS 는 선택 */
function checklist(h: RobotHealth, online: boolean): Check[] {
  const d = h.devices;
  const sig = h.wifi.signal;
  return [
    { label: "서버 연결", ok: online, value: online ? (h.serverMs != null ? `${h.serverMs}ms` : "연결됨") : "끊김", need: true },
    { label: "와이파이 신호", ok: sig == null ? null : sig >= 40, value: sig == null ? "—" : `${sig}%${sig < 40 ? " 약함" : ""}`, need: true },
    { label: "전원 (저전압 없음)", ok: h.power.undervoltNow == null ? null : !h.power.undervoltNow,
      value: h.power.undervoltNow ? "지금 저전압!" : h.power.undervoltSinceBoot ? "켜진 뒤 저전압 있었음" : h.power.undervoltNow == null ? "—" : "정상", need: true },
    { label: "온도", ok: h.cpuTemp == null ? null : h.cpuTemp < 80, value: h.cpuTemp == null ? "—" : `${h.cpuTemp.toFixed(0)}°C`, need: true },
    { label: "모터 드라이버 (PCA9685)", ok: d?.motorDriver ?? null, value: dev(d?.motorDriver), need: true },
    { label: "카메라", ok: d?.camera ?? null, value: dev(d?.camera), need: false },
    { label: "줄 길이 센서 (AS5600)", ok: d?.encoder ?? null, value: dev(d?.encoder), need: false },
    { label: "GPS 포트", ok: h.gpsPort, value: h.gpsPort ? "있음" : "없음", need: false },
  ];
}
const dev = (v: boolean | null | undefined) => (v === true ? "연결됨" : v === false ? "응답 없음" : "점검 전");

function Mark({ ok }: { ok: boolean | null }) {
  if (ok === true) return <Check size={16} className="text-level-0" />;
  if (ok === false) return <X size={16} className="text-level-3" />;
  return <Minus size={16} className="text-muted" />;
}

function fmtAgo(s: number) {
  if (!isFinite(s)) return "—";
  if (s < 60) return `${Math.max(0, Math.round(s))}초 전`;
  if (s < 3600) return `${Math.round(s / 60)}분 전`;
  return `${Math.round(s / 3600)}시간 전`;
}

function BigBtn({ onClick, disabled, icon, title, sub, active }: { onClick: () => void; disabled?: boolean; icon: React.ReactNode; title: string; sub: string; active?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled}
      className={["press flex min-h-28 flex-col items-center justify-center gap-1.5 rounded-2xl p-3 text-center disabled:opacity-40 disabled:active:scale-100",
        active ? "bg-sherpy-600 text-white" : "border border-line bg-surface text-ink"].join(" ")}>
      {icon}
      <span className="text-sm font-bold">{title}</span>
      <span className={`text-[11px] ${active ? "text-white/80" : "text-muted"}`}>{sub}</span>
    </button>
  );
}
