"use client";

import { useCallback, useEffect, useState } from "react";
import { Cable, Loader, Check, X, Minus, ArrowDown, Hash } from "lucide-react";
import { useRobot } from "../../RobotProvider";
import { sendCommand } from "@/hooks/useRobotStream";
import PageHeader from "@/components/ui/PageHeader";
import type { RobotHealth, Wiring } from "@/lib/robot/types";

/**
 * 배선 점검 — 조립 가이드(docs/assembly-guide.html) 단계마다 한 번씩 누른다. (robot/bridge/wiring.py)
 *
 * 부품이 '직접 대답'하는지로 판단한다. 그리고 웹이 정한 시험값을 보내
 *   웹 → 서버 → 파이 → 구동부 드라이버(PCA9685, 비어 있는 CH15) 에 그대로 써지고 다시 읽히는지,
 *   웹이 정한 숫자가 본체 표시기에 뜨는지,
 *   장력 센서(HX711) · 줄 길이 센서(AS5600) 값이 웹까지 올라오는지
 * 를 한 화면에서 본다. 조향·ESC 채널은 읽기만 해서 바퀴가 움직일 일은 없다.
 */
type HealthRes = { health: RobotHealth | null; healthAt: string | null };
type Req = { us: number; code: number; reqAt: number };
type Ok = boolean | null;

const ONLINE_SEC = 25;
const WATCH_SEC = 6; // wiring.py ESTOP_WATCH_SEC

export default function WiringCheck() {
  const { robotId, demo } = useRobot();
  const [res, setRes] = useState<HealthRes | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [req, setReq] = useState<Req | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (robotId == null) return;
    try {
      const r = await fetch(`/api/robots/${robotId}/health`, { cache: "no-store" });
      if (r.ok) setRes(await r.json());
    } catch { /* 다음 주기에 */ }
  }, [robotId]);

  const h = res?.health ?? null;
  const w = h?.wiring ?? null;
  const done = !!(req && w && w.reqAt === req.reqAt);
  const running = !!req && !done && now - req.reqAt < 40_000;

  useEffect(() => {
    load();
    const id = setInterval(() => { if (!document.hidden) { load(); setNow(Date.now()); } }, running ? 1500 : 3000);
    return () => clearInterval(id);
  }, [load, running]);
  useEffect(() => {          // 진행 막대용 — 0.25초마다
    if (!running) return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [running]);

  const ageSec = res?.healthAt ? (now - new Date(res.healthAt).getTime()) / 1000 : Infinity;
  const online = ageSec < ONLINE_SEC && !h?.shuttingDown;
  const busyOther = !!h?.busy && h.busy !== "wiring";

  const start = async () => {
    setErr(null);
    // 매번 다른 값 — 그래야 '전에 남아 있던 값'이 아니라 '방금 보낸 값'이 도착했는지 알 수 있다
    const r: Req = { us: 1100 + Math.round(Math.random() * 800), code: 1000 + Math.floor(Math.random() * 9000), reqAt: Date.now() };
    try {
      await sendCommand(robotId, "WIRING_CHECK", r);
      setReq(r);
      setNow(Date.now());
    } catch (e) {
      setErr(e instanceof Error ? e.message : "명령을 보내지 못했어요");
    }
  };

  if (demo || robotId == null) {
    return (
      <div className="px-4">
        <div className="-mx-4 mb-3"><PageHeader title="배선 점검" back /></div>
        <p className="card p-4 text-sm text-body">이 계정에 등록된 로봇이 없어요. 로봇을 등록하면 조립 단계마다 부품 연결을 여기서 확인할 수 있어요.</p>
      </div>
    );
  }

  // 지금 화면의 결과: 내가 방금 누른 점검 결과, 없으면 마지막 점검 결과
  const shown = w;
  const mine = done;
  const stages = shown ? stageList(shown, h!) : [];
  const passed = countPassed(stages);
  const elapsed = req ? (now - req.reqAt) / 1000 : 0;

  return (
    <div className="px-4 pb-28">
      <div className="-mx-4 mb-3"><PageHeader title="배선 점검" back /></div>

      <section className="card p-4">
        <p className="text-sm text-body">
          조립 가이드의 단계를 하나 끝낼 때마다 누르세요. 부품이 <b>직접 대답하는지</b> 확인하고,
          웹에서 정한 시험값이 구동부 드라이버·표시기까지 그대로 가는지 봅니다.
        </p>
        <p className="mt-1.5 text-[11px] text-muted">바퀴는 움직이지 않아요 — 조향·ESC 채널은 읽기만 하고, 시험값은 비어 있는 채널(CH15)에 썼다가 지웁니다. 선을 꽂고 뺄 때는 꼭 파이를 끈 상태에서.</p>
        <button onClick={start} disabled={!online || running || busyOther}
          className="press touch mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-sherpy-600 py-3.5 text-sm font-bold text-white disabled:opacity-40">
          {running ? <Loader size={18} className="animate-spin" /> : <Cable size={18} />}
          {running ? "점검 중…" : !online ? "로봇 연결 안 됨" : busyOther ? "로봇이 다른 작업 중" : "배선 점검 시작"}
        </button>
        {err && <p className="mt-2 rounded-xl bg-level-3/10 px-3 py-2 text-xs text-level-3">{err}</p>}
      </section>

      {/* ── 점검 중 안내: 사람이 해 줄 것 ── */}
      {running && req && (
        <section className="card mt-3 border-sherpy-600/40 p-4">
          <div className="h-1.5 overflow-hidden rounded-full bg-line">
            <div className="h-full bg-sherpy-600 transition-[width] duration-200" style={{ width: `${Math.min(100, (elapsed / (WATCH_SEC + 4)) * 100)}%` }} />
          </div>
          <ul className="mt-3 space-y-2 text-sm">
            <li className="flex items-start gap-2"><Hash size={18} className="mt-0.5 shrink-0 text-sherpy-600" />
              <span>본체 표시기에 <b className="tabular text-base">{String(req.code).padStart(4, "0")}</b> 가 뜨는지 보세요</span></li>
          </ul>
          <p className="mt-2 text-[11px] text-muted">{h?.busy === "wiring" ? "로봇이 점검하는 중…" : "로봇에 명령 전달 중… (보통 1~2초)"}</p>
        </section>
      )}
      {req && !running && !done && (
        <p className="mt-3 rounded-xl bg-level-2/10 px-3 py-2 text-xs text-level-2">
          40초 동안 결과가 오지 않았어요. 파이의 에이전트가 새 버전인지 확인하세요 (파이에서 <span className="tabular">git pull</span> → <span className="tabular">sudo systemctl restart sherpy-agent</span>).
        </p>
      )}

      {/* ── 신호 경로 ── */}
      {shown && (
        <section className="card mt-3 p-4">
          <div className="mb-1 flex items-center justify-between">
            <h2 className="text-sm font-bold">신호 경로</h2>
            <span className="text-[11px] text-muted">{mine ? "방금 점검" : `마지막 점검 ${fmtAgo(now / 1000 - shown.at)}`}</span>
          </div>
          <Path w={shown} req={mine ? req : null} />
        </section>
      )}

      {/* ── 조립 단계별 ── */}
      {shown && (
        <section className="card mt-3 p-4">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-bold">조립 단계별</h2>
            <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${passed > 0 ? "bg-level-0/15 text-level-0" : "bg-line text-muted"}`}>
              {passed > 0 ? `${passed}단계까지 통과` : "1단계부터"}
            </span>
          </div>
          {shown.error && <p className="mb-2 rounded-xl bg-level-3/10 px-3 py-2 text-xs text-level-3">점검 중 오류: {shown.error}</p>}
          <ol className="space-y-3">
            {stages.map((s) => (
              <li key={s.no}>
                <p className="text-xs font-semibold text-muted"><span className="tabular">{s.no}</span>단계 · {s.title}</p>
                <ul className="mt-1 divide-y divide-line rounded-xl border border-line">
                  {s.items.map((it) => (
                    <li key={it.label} className="px-3 py-2">
                      <div className="flex items-center gap-2 text-sm">
                        <Mark ok={it.ok} />
                        <span className="flex-1 text-body">{it.label}</span>
                        <span className="tabular text-xs text-muted">{it.value}</span>
                      </div>
                      {it.hint && it.ok !== true && <p className="mt-1 pl-6 text-[11px] leading-relaxed text-muted">{it.hint}</p>}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
          <p className="mt-3 text-[11px] leading-relaxed text-muted">
            아직 꽂지 않은 부품은 <X size={11} className="inline text-level-3" /> 로 나오는 게 정상이에요. 이번 단계 부품이 <Check size={11} className="inline text-level-0" /> 가 되면 다음 단계로 넘어가세요.
            {shown.tookMs != null && <> · 점검 <span className="tabular">{(shown.tookMs / 1000).toFixed(1)}</span>초</>}
          </p>
        </section>
      )}

      {!shown && online && !running && (
        <p className="mt-3 text-center text-xs text-muted">아직 배선 점검 기록이 없어요. [배선 점검 시작]을 눌러 보세요.</p>
      )}
    </div>
  );
}

/* ── 신호 경로: 웹 → 파이 → 부품 / 부품 → 웹 ── */
function Path({ w, req }: { w: Wiring; req: Req | null }) {
  const p = w.pca9685;
  const loop = p?.loop;
  const hx = w.hx711;
  const as = w.as5600;
  const tmOk = w.tmRed?.ok === true || w.tmBlue?.ok === true;
  const rows: { label: string; ok: Ok; value: string }[] = [
    { label: "웹 → 로봇(파이) 명령 도착", ok: req ? true : null, value: req ? `시험값 ${req.us}µs · ${req.code}` : "이전 점검" },
    { label: "파이 → 구동부 드라이버 (PCA9685)", ok: loop ? loop.match : p?.ok === false ? false : null,
      value: loop ? `보냄 ${loop.sent} → 읽음 ${loop.back ?? "—"}µs` : p?.ok === false ? "드라이버 응답 없음" : "—" },
    { label: "파이 → 본체 표시기", ok: tmOk ? true : w.tmRed?.ok === false && w.tmBlue?.ok === false ? false : null,
      value: tmOk ? `${String(w.code ?? 0).padStart(4, "0")} 표시` : "표시기 응답 없음" },
    { label: "장력 센서 (HX711) → 웹", ok: hx?.ok ?? null,
      value: hx?.ok && hx.raw?.length ? `값 ${hx.raw[hx.raw.length - 1].toLocaleString()}` : hx?.ok === false ? "응답 없음" : "—" },
    { label: "줄 길이 센서 (AS5600) → 웹", ok: as?.ok ?? null,
      value: as?.ok ? `각도 ${as.angle ?? "—"} / 4095` : as?.ok === false ? "응답 없음" : "—" },
  ];
  return (
    <ul>
      {rows.map((r, i) => (
        <li key={r.label}>
          {i === 1 && <ArrowDown size={14} className="mx-auto my-0.5 text-muted" />}
          {i === 3 && <p className="mt-2 mb-1 text-[11px] font-semibold text-muted">센서 → 웹</p>}
          <div className="flex items-center gap-2 py-1.5 text-sm">
            <Mark ok={r.ok} />
            <span className="flex-1 text-body">{r.label}</span>
            <span className="tabular text-xs text-muted">{r.value}</span>
          </div>
        </li>
      ))}
      {loop && !loop.match && p?.ok && (
        <p className="mt-1 text-[11px] text-level-3">드라이버는 대답하는데 값이 다르게 읽혀요. SDA·SCL 점퍼가 헐겁거나 선이 너무 길 수 있어요 — 다시 꽂고 한 번 더 점검하세요.</p>
      )}
    </ul>
  );
}

/* ── 조립 단계별 항목 (가이드 단계 번호 그대로) ── */
type Item = { label: string; ok: Ok; value: string; hint?: string };
type Stage = { no: string; title: string; items: Item[] };

function stageList(w: Wiring, h: RobotHealth): Stage[] {
  const hub = w.hub;
  const pw = h.power;
  const as = w.as5600;
  const p = w.pca9685;
  const hx = w.hx711;
  const g = w.gps;
  const tmItem = (name: string, t: Wiring["tmRed"], pins: string): Item => ({
    label: name, ok: t?.ok ?? null,
    value: t?.ok ? `${String(t.code ?? 0).padStart(4, "0")} 표시` : t?.ok === false ? "응답 없음" : t?.error ?? "—",
    hint: `CLK·DIO 를 ${pins} 에 꽂았는지, 둘이 바뀌지 않았는지 확인. 모듈 핀 순서는 CLK·DIO·GND·5V — "5V" 핀은 3.3V 레일에. 표시기에 숫자가 떠야 해요.`,
  });

  const magnetTxt = { ok: "자석 OK", weak: "자석 약함 → 더 가까이", strong: "자석 강함 → 더 멀리", none: "자석 없음" } as const;

  return [
    { no: "1", title: "파이 설정", items: [
      { label: "I2C 켜짐 (/dev/i2c-1)", ok: hub?.i2c ?? null, value: hub?.i2c ? "켜짐" : "꺼짐", hint: "sudo raspi-config nonint do_i2c 0 → 재부팅" },
      { label: "UART 켜짐 (/dev/ttyAMA0)", ok: hub?.uart ?? null, value: hub?.uart ? "켜짐" : "꺼짐", hint: "/boot/firmware/config.txt 에 dtparam=uart0=on → 재부팅" },
      { label: "전원 (저전압 없음)", ok: pw.undervoltNow == null ? null : !pw.undervoltNow,
        value: pw.undervoltNow ? "지금 저전압!" : pw.undervoltSinceBoot ? "켜진 뒤 저전압 있었음" : pw.undervoltNow == null ? "—" : "정상",
        hint: "5V 5A(27W) 전원으로. 폰 충전기는 부품을 붙이면 전압이 떨어져요." },
    ] },
    { no: "2", title: "브레드보드 허브", items: [
      { label: "I2C 줄 (SDA·SCL)", ok: hub?.i2c ? (as?.ok || p?.ok ? true : null) : false,
        value: as?.ok || p?.ok ? "부품이 대답함" : "부품을 꽂으면 확인",
        hint: "허브만 꽂은 지금은 대답할 부품이 없어 웹으로는 알 수 없어요. 멀티미터로 3.3V 레일 ↔ GND 레일이 3.2~3.4V 인지 재세요. 3단계(AS5600)를 꽂으면 여기도 ✓ 가 돼요." },
    ] },
    { no: "3", title: "줄 길이 엔코더 AS5600", items: [
      { label: "AS5600 대답 (0x36)", ok: as?.ok ?? null, value: as?.ok ? "연결됨" : as?.ok === false ? "응답 없음" : as?.error ?? "—",
        hint: "Grove 선: 검정 GND · 빨강 3.3V(5V 아님) · 흰 SDA 줄 · 노랑 SCL 줄. 흰·노랑이 바뀌면 대답이 없어요." },
      { label: "자석", ok: as?.ok ? as.magnet === "ok" : null, value: as?.ok && as.magnet ? `${magnetTxt[as.magnet]} · ${as.angle}` : "—",
        hint: "칩 정중앙 위 1~3mm. 돌릴 때 각도가 0~4095 로 변해야 해요. 안 변하면 축 방향 자석(지름 방향 필요)." },
    ] },
    { no: "4", title: "PWM 드라이버 PCA9685", items: [
      { label: "PCA9685 대답 (0x40)", ok: p?.ok ?? null, value: p?.ok ? "연결됨" : p?.ok === false ? "응답 없음" : p?.error ?? "—",
        hint: "로직 핀 4개: GND · SCL · SDA · VCC(3.3V). V+ 는 비워 둠. 두 장을 같이 꽂으면 주소가 겹쳐요." },
      { label: "시험값 왕복 (CH15)", ok: p?.loop ? p.loop.match : null, value: p?.loop ? `${p.loop.sent} → ${p.loop.back ?? "—"}µs` : "—",
        hint: "웹에서 정한 값이 드라이버에 그대로 써지는지. 다르면 SDA·SCL 점퍼 접촉 불량." },
    ] },
    { no: "5", title: "표시기 ①·② (TM1637)", items: [
      tmItem("① 장력", w.tmRed, "38번(GPIO20)·40번(GPIO21)"),
      tmItem("② 줄 길이", w.tmBlue, "35번(GPIO19)·37번(GPIO26)"),
    ] },
    { no: "7", title: "장력 HX711 + 로드셀", items: [
      { label: "HX711 대답", ok: hx?.ok ?? null, value: hx?.ok ? "연결됨" : hx?.ok === false ? "응답 없음" : hx?.error ?? "—",
        hint: "DAT → 29번(GPIO5), CLK → 31번(GPIO6), VDD → 3.3V, VCC → 5V, GND. VDD·VCC 를 바꿔 꽂지 않기." },
      { label: "로드셀 값", ok: hx?.ok ? hx.cell === "ok" : null,
        value: hx?.ok && hx.raw?.length ? `${hx.raw[hx.raw.length - 1].toLocaleString()} (흔들림 ${(hx.spread ?? 0).toLocaleString()})` : "—",
        hint: "값이 끝에 붙거나 크게 출렁이면 로드셀 선: 빨강 E+ · 검정 E− · 흰 S− · 초록 S+ 납땜 확인." },
    ] },
    { no: "8", title: "GPS NEO-6M", items: [
      { label: "GPS 문장 수신", ok: g?.ok ?? null,
        value: g?.ok ? `${g.sentences}문장` : g?.bytes ? `잡음 ${g.bytes}바이트` : g?.port === false ? "UART 꺼짐" : g?.ok === false ? "들어오는 것 없음" : g?.error ?? "—",
        hint: g?.bytes ? "바이트는 오는데 문장이 안 맞아요 → TX/RX 엇갈림 또는 속도(9600) 확인." : "GPS TX → 10번(RXD), GPS RX → 8번(TXD) 교차 · VCC 5V · GND." },
      { label: "측위", ok: g?.ok ? !!g.fix : null, value: g?.ok ? (g.fix ? `측위됨 · 위성 ${g.sats ?? "—"}` : `대기 · 위성 ${g.sats ?? 0}`) : "—",
        hint: "실내에선 측위가 안 되는 게 정상. 실외 하늘 보이는 곳에서 1~5분." },
    ] },
    { no: "9", title: "구동부 (조향 CH0 · ESC CH1)", items: [
      { label: "모터 출력", ok: h.motorLive ? true : null, value: h.motorLive ? "실제 출력 (SHERPY_MOTOR=on)" : "시험 모드 — 신호 안 보냄",
        hint: h.motorError ?? "9단계 전에는 시험 모드가 정상. 바퀴를 띄운 뒤 robot/.env 에 SHERPY_MOTOR=on." },
      { label: "조향 신호 (CH0)", ok: h.motorLive && p?.ok ? near(p.steerUs, 1000, 2000) : null, value: us(p?.steerUs), hint: "실제 출력이면 가운데 1500µs 근처가 나와야 해요." },
      { label: "ESC 신호 (CH1)", ok: h.motorLive && p?.ok ? near(p.throttleUs, 1500, 1500, 15) : null, value: us(p?.throttleUs),
        hint: "멈춰 있을 때 1500µs(중립)여야 ESC 가 출발하지 않아요. ESC 는 이 신호를 받은 뒤에 켜세요." },
    ] },
    { no: "+", title: "카메라 (지금 점검 기준)", items: [
      { label: "카메라", ok: h.devices?.camera ?? null, value: h.devices?.camera ? "연결됨" : h.devices?.camera === false ? "없음" : "점검 전",
        hint: "로봇 관리 → [지금 점검] 결과예요. 리본 방향(파란 면)과 잠금 확인." },
    ] },
  ];
}

/** 1·2·3·4 처럼 순서대로 이어서 통과한 마지막 단계 번호 */
function countPassed(stages: Stage[]): number {
  let n = 0;
  for (const s of stages) {
    const no = Number(s.no);
    if (!Number.isFinite(no)) break;
    const need = s.no === "2" ? s.items.every((i) => i.ok !== false) : s.items.every((i) => i.ok === true);
    if (!need) break;
    n = no;
  }
  return n;
}

const near = (v: number | null | undefined, lo: number, hi: number, tol = 10): boolean | null =>
  v == null ? false : v >= lo - tol && v <= hi + tol;
const us = (v: number | null | undefined) => (v == null ? "출력 없음" : `${v}µs`);

function Mark({ ok }: { ok: Ok }) {
  if (ok === true) return <Check size={16} className="shrink-0 text-level-0" />;
  if (ok === false) return <X size={16} className="shrink-0 text-level-3" />;
  return <Minus size={16} className="shrink-0 text-muted" />;
}

function fmtAgo(s: number) {
  if (!isFinite(s)) return "—";
  if (s < 60) return `${Math.max(0, Math.round(s))}초 전`;
  if (s < 3600) return `${Math.round(s / 60)}분 전`;
  return `${Math.round(s / 3600)}시간 전`;
}
