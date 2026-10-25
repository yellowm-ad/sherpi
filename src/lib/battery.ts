"use client";

import { useEffect, useState } from "react";

/**
 * 배터리 교체 안내 — 3S 5300mAh 1개로 약 30분, 4개 교대로 약 2시간 (BOM).
 * 전압 ADC 가 없어 battery_v 가 null 이므로, 주행을 시작한 시각부터 잰 경과시간으로 안내한다.
 * 새로고침해도 이어지게 브라우저에 보관하고, [교체 완료]를 누르면 다시 잰다.
 */
export const BATTERY_SWAP_MIN = 25;
export const BATTERY_RUN_MIN = 30;
const KEY = "sherpy.batteryStart";

function read(): number | null {
  try {
    const v = Number(localStorage.getItem(KEY));
    // 반나절 넘은 기록은 지난 시연 것 — 버린다
    return v && Date.now() - v < 12 * 3600_000 ? v : null;
  } catch { return null; }
}

export function useBatteryTimer(driving: boolean) {
  const [start, setStart] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => { setStart(read()); }, []);

  // 처음 움직이기 시작한 순간부터 잰다
  useEffect(() => {
    if (!driving || start != null || read() != null) return;
    const t = Date.now();
    try { localStorage.setItem(KEY, String(t)); } catch { /* 저장 못 해도 이번 화면에선 잰다 */ }
    setStart(t);
  }, [driving, start]);

  useEffect(() => {
    if (start == null) return;
    const id = setInterval(() => setNow(Date.now()), 10_000);
    return () => clearInterval(id);
  }, [start]);

  const reset = () => {
    try { localStorage.removeItem(KEY); } catch { /* 무시 */ }
    setStart(null);
  };

  const elapsedMin = start == null ? null : Math.max(0, Math.floor((now - start) / 60_000));
  return { elapsedMin, swapDue: elapsedMin != null && elapsedMin >= BATTERY_SWAP_MIN, reset };
}
