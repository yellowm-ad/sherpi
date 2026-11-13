"use client";

import { useEffect, useRef } from "react";

/**
 * S01 첫 화면 배경 — 잔잔하게 일렁이는 실크 물결 (갤럭시 웨어러블·빅스비 모션 느낌).
 * 캔버스 한 장에 반투명 물결 띠 여러 겹 + 가장자리 흰 광택선.
 * 각 띠의 곡선 제어점이 서로 다른 느린 주기로 흔들려서 반복이 눈에 띄지 않는다.
 * 움직임 줄이기 설정이면 한 장면만 그리고 멈춘다.
 */

type RGB = [number, number, number];

function readToken(name: string, fallback: string): RGB {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
  const hex = v.startsWith("#") ? v.slice(1) : fallback.slice(1);
  const n = parseInt(hex.length === 3 ? hex.split("").map((c) => c + c).join("") : hex.slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const rgba = ([r, g, b]: RGB, a: number) => `rgba(${r},${g},${b},${a})`;

export default function WaveBackground({ className = "" }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const c400 = readToken("--color-sherpy-400", "#6E8EFF");
    const c600 = readToken("--color-sherpy-600", "#2B66FF");
    const c700 = readToken("--color-sherpy-700", "#1E4ED8");
    const c100 = readToken("--color-sherpy-100", "#DCE1FF");
    const white: RGB = [255, 255, 255];

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let w = 0, h = 0, raf = 0;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    // 느린 흔들림: 서로 어긋난 주기 두 개를 섞는다
    const sway = (t: number, phase: number, amp: number) =>
      (Math.sin(t * 0.00031 + phase) * 0.65 + Math.sin(t * 0.00019 + phase * 1.7) * 0.35) * amp;

    /** 왼쪽 위 커다란 실크 — 왼쪽 가장자리에서 위쪽 가장자리로 휘어 나간다 */
    const topSheet = (t: number, k: number) => {
      const p = new Path2D();
      const a = sway(t, k * 1.3, 0.035);
      const b = sway(t, k * 2.1 + 1, 0.04);
      p.moveTo(0, h * (0.2 + k * 0.08 + a));
      p.bezierCurveTo(
        w * (0.35 + b), h * (0.16 + k * 0.05 + a),
        w * (0.42 - b), h * (0.02 + k * 0.03),
        w * (0.5 + k * 0.22 + a), 0,
      );
      return p;
    };

    /** 오른쪽 아래 물결 — 왼쪽 아래에서 오른쪽 가장자리로 솟는다 (k 클수록 아래·진함) */
    const bottomSheet = (t: number, k: number) => {
      const p = new Path2D();
      const a = sway(t, k * 1.9 + 2, 0.03);
      const b = sway(t, k * 1.1 + 4, 0.045);
      p.moveTo(w * (0.15 + k * 0.2 + a), h);
      p.bezierCurveTo(
        w * (0.45 + b), h * (0.86 - k * 0.02 + a),
        w * (0.6 - b), h * (0.62 + k * 0.08),
        w, h * (0.52 + k * 0.12 + a),
      );
      return p;
    };

    const fillBelow = (edge: Path2D, close: (p: Path2D) => void) => {
      const p = new Path2D(edge);
      close(p);
      return p;
    };

    const draw = (t: number) => {
      ctx.clearRect(0, 0, w, h);

      // 바탕 — 아주 옅은 푸른 빛
      const bg = ctx.createLinearGradient(0, 0, w, h);
      bg.addColorStop(0, rgba(c100, 0.9));
      bg.addColorStop(0.45, rgba(white, 1));
      bg.addColorStop(1, rgba(c100, 0.75));
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);

      // 왼쪽 위 실크 두 겹
      for (let k = 0; k < 2; k++) {
        const edge = topSheet(t, k);
        const area = fillBelow(edge, (p) => { p.lineTo(0, 0); p.closePath(); });
        const g = ctx.createLinearGradient(0, 0, w * 0.6, h * 0.3);
        g.addColorStop(0, rgba(c400, 0.38 - k * 0.12));
        g.addColorStop(1, rgba(c100, 0.05));
        ctx.fillStyle = g;
        ctx.fill(area);
      }

      // 오른쪽 아래 물결 세 겹 — 바깥(옅음) → 구석(진한 코발트)
      const layers = [
        { from: c100, to: c400, a0: 0.25, a1: 0.45 },
        { from: c400, to: c600, a0: 0.18, a1: 0.6 },
        { from: c600, to: c700, a0: 0.55, a1: 0.95 },
      ];
      layers.forEach((L, k) => {
        const edge = bottomSheet(t, k);
        const area = fillBelow(edge, (p) => { p.lineTo(w, h); p.closePath(); });
        const g = ctx.createLinearGradient(w * 0.3, h * 0.6, w, h);
        g.addColorStop(0, rgba(L.from, L.a0));
        g.addColorStop(1, rgba(L.to, L.a1));
        ctx.fillStyle = g;
        ctx.fill(area);
      });

      // 광택선 — 각 물결 가장자리에 흰 빛이 얇게 번진다
      ctx.save();
      ctx.lineCap = "round";
      const edges = [topSheet(t, 0), topSheet(t, 1), bottomSheet(t, 0), bottomSheet(t, 1), bottomSheet(t, 2)];
      edges.forEach((e, i) => {
        ctx.shadowColor = rgba(white, 0.9);
        ctx.shadowBlur = 10;
        ctx.strokeStyle = rgba(white, i === 4 ? 0.55 : 0.8);
        ctx.lineWidth = 1.2;
        ctx.stroke(e);
      });
      ctx.restore();
    };

    resize();
    const start = performance.now() - 20000; // 첫 장면부터 곡선이 자연스럽게 어긋나 있게
    const loop = (now: number) => {
      draw(now - start);
      raf = requestAnimationFrame(loop);
    };
    if (reduce) draw(20000);
    else raf = requestAnimationFrame(loop);

    const ro = new ResizeObserver(() => { resize(); if (reduce) draw(20000); });
    ro.observe(canvas);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, []);

  return <canvas ref={ref} aria-hidden className={`pointer-events-none absolute inset-0 h-full w-full ${className}`} />;
}
