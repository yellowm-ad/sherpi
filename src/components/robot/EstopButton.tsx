"use client";

import { useEffect, useRef, useState } from "react";
import { sendCommand } from "@/hooks/useRobotStream";

const HOLD_MS = 1000;
const R = 44; // 진행 고리 반지름 (viewBox 100)
const C = 2 * Math.PI * R;

/**
 * 비상정지 플로팅 버튼.
 *
 * ⚠️ 안전 정책 (PRD §6 F-2)
 * 원격 정지는 보조 수단이다. 명령이 네트워크를 경유하므로 약 1초의 지연과
 * 단절 가능성이 있다. 1차 안전장치는 로봇 본체의 ESC 전원 스위치(모터 전원 차단)이며,
 * 이 문구를 UI에도 노출한다.
 *
 * 오작동 방지를 위해 1초 길게 누르기로 발동한다.
 * 누르는 동안 고리가 차오르고(게임의 "길게 눌러 확정" 패턴), 손을 떼면 고리가 빠르게 되감긴다.
 * 키보드(Space/Enter 길게)로도 발동할 수 있다.
 * 1초 전에 떼면 "더 길게"라는 안내를 잠깐 띄운다 — 실패했을 때 그 자리에서 알려주는 튜토리얼.
 * 스크롤하는 동안에는 작게 줄어들어 뒤 카드를 덜 가리고, 멈추면 원래 크기로 돌아온다.
 */
export default function EstopButton({ robotId, disabled }: { robotId: number | null; disabled?: boolean }) {
  const [holding, setHolding] = useState(false);
  const [status, setStatus] = useState<"idle" | "sending" | "ok" | "fail">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reset = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [hint, setHint] = useState(false);
  const hintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [scrolling, setScrolling] = useState(false);

  useEffect(() => {
    let idle: ReturnType<typeof setTimeout> | null = null;
    const onScroll = () => {
      setScrolling(true);
      if (idle) clearTimeout(idle);
      idle = setTimeout(() => setScrolling(false), 700);
    };
    addEventListener("scroll", onScroll, { passive: true });
    return () => {
      removeEventListener("scroll", onScroll);
      if (idle) clearTimeout(idle);
      [timer, reset, hintTimer].forEach((t) => t.current && clearTimeout(t.current));
    };
  }, []);

  const start = () => {
    if (disabled || holding || status === "sending") return;
    setHolding(true);
    navigator.vibrate?.(15);
    timer.current = setTimeout(fire, HOLD_MS);
  };

  const cancel = () => {
    setHolding(false);
    if (timer.current) {
      // 아직 발동 전에 뗐다 = 너무 짧게 누름
      clearTimeout(timer.current);
      timer.current = null;
      setHint(true);
      if (hintTimer.current) clearTimeout(hintTimer.current);
      hintTimer.current = setTimeout(() => setHint(false), 2500);
    }
  };

  const fire = async () => {
    timer.current = null;
    setHint(false);
    setHolding(false);
    setStatus("sending");
    try {
      await sendCommand(robotId, "ESTOP");
      navigator.vibrate?.([80, 40, 80]);
      setStatus("ok");
    } catch {
      setStatus("fail");
    }
    if (reset.current) clearTimeout(reset.current);
    reset.current = setTimeout(() => setStatus("idle"), 4000);
  };

  const isKey = (e: React.KeyboardEvent) => e.key === " " || e.key === "Enter";

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-24 z-50 mx-auto flex max-w-[480px] flex-col items-end gap-2 px-4 [&>*]:pointer-events-auto">
      {status === "fail" && (
        <p role="alert" className="animate-drop max-w-[200px] rounded-lg bg-level-3 px-3 py-2 text-xs text-white">
          전송 실패 — 로봇 본체의 모터 전원 스위치를 끄세요
        </p>
      )}
      {hint && status === "idle" && (
        <p role="status" className="animate-drop max-w-[210px] rounded-lg bg-ink px-3 py-2 text-xs text-white">
          1초 이상 눌러야 정지돼요<br /><span className="text-[10px] opacity-75">원격 정지는 보조 수단입니다</span>
        </p>
      )}
      {status === "ok" && (
        <p role="status" className="animate-drop rounded-lg bg-level-0 px-3 py-2 text-xs text-white">
          정지 명령 전송됨
        </p>
      )}
      <button
        onPointerDown={(e) => {
          // 손가락이 버튼 밖으로 살짝 밀려도 계속 누르는 것으로 본다. 캡처 실패는 무시 — 정지 발동이 우선
          try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* 무시 */ }
          start();
        }}
        onPointerUp={cancel}
        onPointerCancel={cancel}
        onPointerLeave={cancel}
        onLostPointerCapture={cancel}
        onKeyDown={(e) => { if (isKey(e) && !e.repeat) { e.preventDefault(); start(); } }}
        onKeyUp={(e) => { if (isKey(e)) cancel(); }}
        onBlur={cancel}
        onContextMenu={(e) => e.preventDefault()}
        disabled={disabled || status === "sending"}
        aria-label="비상 정지 (1초간 길게 누르기)"
        style={{ transition: holding ? `scale ${HOLD_MS}ms linear` : "scale .35s var(--ease-spring)", transformOrigin: "bottom right" }}
        className={[
          "touch relative h-20 w-20 touch-none select-none whitespace-pre-line rounded-full bg-level-3 text-sm font-bold leading-tight text-white shadow-lg shadow-level-3/40 ring-4 ring-white",
          "disabled:opacity-40",
          holding ? "scale-90" : scrolling ? "scale-75" : "",
          status === "ok" ? "animate-hit" : "",
        ].join(" ")}
      >
        {/* 차오르는 고리 — 1초 동안 선형으로, 떼면 0.2초 만에 되감김 */}
        <svg viewBox="0 0 100 100" className="pointer-events-none absolute -inset-4 -rotate-90 overflow-visible" aria-hidden>
          <circle cx="50" cy="50" r={R} fill="none" stroke="var(--color-level-3)" strokeWidth="5" strokeLinecap="round"
                  strokeDasharray={C}
                  style={{
                    strokeDashoffset: holding ? 0 : C,
                    transition: holding ? `stroke-dashoffset ${HOLD_MS}ms linear` : "stroke-dashoffset .2s ease-out",
                  }} />
        </svg>
        <span className="relative">{status === "sending" ? "전송 중" : holding ? "계속\n누르세요" : "긴급\n정지"}</span>
      </button>
      <p aria-hidden className={`rounded-full bg-surface/90 px-2 py-0.5 text-[10px] text-muted shadow-sm transition-opacity duration-200 ${scrolling ? "opacity-0" : ""}`}>
        1초 길게 누르기
      </p>
    </div>
  );
}
