"use client";

import { useEffect, useRef } from "react";
import { DEFAULT_HW } from "@/lib/sherpy/params";
import { project, type CamModel } from "@/lib/sherpy/core/camera";

/**
 * 셰르피 1인칭 카메라 — 강아지 검출 박스와 방향각 θ 를 영상 위에 그린다.
 *
 * scenery=true : 카메라가 없을 때(시뮬·시연) 공원 장면을 합성하고, 강아지를 참 위치(θ, d)에 그린다.
 * scenery=false: 실제 영상(RobotVideo) 위에 겹치는 투명 오버레이 — 박스는 텔레메트리 θ̂·d̂ 로 역투영한 위치.
 *
 * 카메라 모델은 파이프라인과 같다 (화각 ~100°, 640 px, 방사 왜곡 k1) — 그래서 박스 위치가 실제 검출 좌표와 일치한다.
 */
export interface PovProps {
  theta: number | null;          // rad 강아지 참 방향 (scenery 에서 강아지를 그릴 위치)
  d: number | null;              // m
  detect?: { u: number; h: number } | null; // 640px 카메라 좌표의 검출 (없으면 θ̂·d̂ 로 역투영)
  thetaEst?: number | null;
  dEst?: number | null;
  track?: "ok" | "coast" | "lost" | "fail";
  speed?: number;
  steer?: number;
  scenery?: boolean;
  className?: string;
  compact?: boolean;
}

const CAM: CamModel = { fx: DEFAULT_HW.camFx, fy: DEFAULT_HW.camFy, cx: DEFAULT_HW.camCx, k1: DEFAULT_HW.camK1, yaw: DEFAULT_HW.camYaw, W: DEFAULT_HW.camW };
const CAM_H = 0.32; // m 카메라 높이

export default function PovCamera(props: PovProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  const P = useRef(props);
  P.current = props;

  useEffect(() => {
    const cv = ref.current!;
    const ctx = cv.getContext("2d")!;
    const cs = getComputedStyle(document.documentElement);
    const tk = (k: string) => cs.getPropertyValue(`--color-${k}`).trim() || "#9aa";
    const C = {
      sky1: tk("sherpy-100"), sky2: tk("surface"), grass: tk("scene-grass"), grass2: tk("scene-grass-2"), path: tk("scene-path"), edge: tk("scene-edge"),
      tree: tk("scene-tree"), tree2: tk("scene-tree-2"), dog: tk("dog"), dogD: tk("dog-dark"), dogL: tk("dog-light"), ok: tk("mint"), warn: tk("level-1"), bad: tk("level-3"), ink: tk("ink"),
    };
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    let raf = 0, z = 0, sway = 0, last = performance.now(), t = 0;
    // 표시 θ·d 를 부드럽게
    let sTh = 0, sD = 1.6, sU = 320, sH = 80;

    const draw = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000); last = now; t += dt;
      const p = P.current;
      const w = cv.clientWidth * dpr, h = cv.clientHeight * dpr;
      if (cv.width !== Math.round(w) || cv.height !== Math.round(h)) { cv.width = Math.round(w); cv.height = Math.round(h); }
      const k = 1 - Math.exp(-dt / 0.15);
      // 화면 가로 = 카메라 640 px, 세로는 같은 배율로 가운데를 자른다
      const sc = w / CAM.W;
      const hz = h * 0.34; // 지평선 (카메라를 살짝 아래로 기울여 장착)
      ctx.clearRect(0, 0, w, h);

      if (p.scenery !== false) {
        z += (p.speed ?? 0) * dt * 0.5;
        sway += ((p.steer ?? 0) * w * 0.25 - sway) * (1 - Math.exp(-dt / 0.6));
        const vx = w / 2 - sway;
        const sky = ctx.createLinearGradient(0, 0, 0, hz);
        sky.addColorStop(0, C.sky1); sky.addColorStop(1, C.sky2);
        ctx.fillStyle = sky; ctx.fillRect(0, 0, w, hz);
        // 먼 숲
        ctx.fillStyle = C.tree;
        for (let i = 0; i < 14; i++) { const x = ((i / 14) * w * 1.3 - sway * 0.3) % (w * 1.3) - w * 0.15; ctx.beginPath(); ctx.arc(x, hz, w * 0.06 + (i % 3) * w * 0.012, Math.PI, 0); ctx.fill(); }
        const gr = ctx.createLinearGradient(0, hz, 0, h);
        gr.addColorStop(0, C.grass2); gr.addColorStop(1, C.grass);
        ctx.fillStyle = gr; ctx.fillRect(0, hz, w, h - hz);
        ctx.fillStyle = C.path;
        ctx.beginPath(); ctx.moveTo(vx - w * 0.02, hz); ctx.lineTo(vx + w * 0.02, hz); ctx.lineTo(w * 0.95, h); ctx.lineTo(w * 0.05, h); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = C.edge; ctx.lineWidth = 2 * dpr;
        for (let i = 0; i < 12; i++) {
          const q = ((i / 12 + z) % 1) ** 2;
          const y = hz + (h - hz) * q, half = w * 0.02 + w * 0.43 * q, cx = vx + (w / 2 - vx) * q;
          ctx.globalAlpha = 0.25; ctx.beginPath(); ctx.moveTo(cx - half, y); ctx.lineTo(cx + half, y); ctx.stroke();
        }
        ctx.globalAlpha = 1;
        for (let i = 0; i < 6; i++) {
          const q = ((i / 6 + z * 0.8) % 1) ** 2, side = i % 2 ? 1 : -1;
          const x = vx + side * (w * 0.08 + w * 0.7 * q), y = hz + (h - hz) * q, s = 4 * dpr + 120 * dpr * q;
          ctx.fillStyle = C.dogD; ctx.fillRect(x - s * 0.05, y - s, s * 0.1, s);
          ctx.fillStyle = i % 3 ? C.tree : C.tree2; ctx.beginPath(); ctx.arc(x, y - s * 1.1, s * 0.45, 0, Math.PI * 2); ctx.fill();
        }

        // 강아지 (뒤에서 본 모습) — 참 위치에 투영
        if (p.theta != null && p.d != null) {
          const pr = project(CAM, p.theta, p.d, DEFAULT_HW.dogHeight);
          if (pr) {
            const Z = p.d * Math.cos(p.theta - CAM.yaw);
            const gx = pr.u * sc, gy = hz + (CAM.fy * sc * CAM_H) / Math.max(0.3, Z);
            const H = pr.h * sc;
            const bob = Math.sin(t * 12) * H * 0.02 * Math.min(1, (p.speed ?? 0) * 3);
            drawDogBack(ctx, C, gx, gy + bob, H, t, p.speed ?? 0);
            // 리드줄 (화면 아래 가운데 = 로봇 → 강아지 하네스)
            ctx.strokeStyle = C.ok; ctx.lineWidth = 3 * dpr; ctx.globalAlpha = 0.9;
            ctx.beginPath(); ctx.moveTo(w / 2, h); ctx.quadraticCurveTo(w / 2, h * 0.8, gx, gy - H * 0.55); ctx.stroke(); ctx.globalAlpha = 1;
          }
        }
      }

      // ── 검출 박스 · 방향선 ──
      let det = p.detect ?? null;
      if (!det && p.thetaEst != null && p.dEst != null) det = project(CAM, p.thetaEst, p.dEst, DEFAULT_HW.dogHeight);
      const status = p.track ?? (det ? "ok" : "lost");
      if (det && status !== "fail") {
        sU += (det.u - sU) * k; sH += (det.h - sH) * k;
        const Z = Math.max(0.3, (CAM.fy * DEFAULT_HW.dogHeight) / Math.max(1, sH));
        const gy = hz + (CAM.fy * sc * CAM_H) / Z;
        const bh = sH * sc * 1.05, bw = bh * 0.95, bx = sU * sc - bw / 2, by = gy - bh;
        const col = status === "coast" ? C.warn : status === "lost" ? C.bad : C.ok;
        ctx.strokeStyle = col; ctx.lineWidth = 2.5 * dpr; ctx.setLineDash(status === "coast" ? [6 * dpr, 4 * dpr] : []);
        // 모서리 꺾쇠
        const c = Math.min(bw, bh) * 0.22;
        for (const [x0, y0, sx, sy] of [[bx, by, 1, 1], [bx + bw, by, -1, 1], [bx, by + bh, 1, -1], [bx + bw, by + bh, -1, -1]]) {
          ctx.beginPath(); ctx.moveTo(x0 + sx * c, y0); ctx.lineTo(x0, y0); ctx.lineTo(x0, y0 + sy * c); ctx.stroke();
        }
        ctx.setLineDash([]);
        // 중심 + 방향선
        ctx.strokeStyle = col; ctx.lineWidth = 1.5 * dpr;
        ctx.beginPath(); ctx.moveTo(sU * sc, by - 6 * dpr); ctx.lineTo(sU * sc, by + bh + 6 * dpr); ctx.stroke();
        ctx.beginPath(); ctx.arc(sU * sc, by + bh * 0.45, 4 * dpr, 0, Math.PI * 2); ctx.stroke();
        if (!p.compact) {
          sTh += ((p.thetaEst ?? p.theta ?? 0) - sTh) * k; sD += ((p.dEst ?? p.d ?? 0) - sD) * k;
          const label = `강아지  θ ${sTh >= 0 ? "+" : ""}${((sTh * 180) / Math.PI).toFixed(1)}°  d ${sD.toFixed(2)} m`;
          ctx.font = `700 ${11 * dpr}px Pretendard, sans-serif`;
          const tw = ctx.measureText(label).width + 12 * dpr;
          const lx = Math.min(w - tw - 4 * dpr, Math.max(4 * dpr, bx));
          ctx.fillStyle = col; ctx.fillRect(lx, by - 22 * dpr, tw, 18 * dpr);
          ctx.fillStyle = C.ink; ctx.fillText(label, lx + 6 * dpr, by - 9 * dpr);
        }
      }
      // 화면 중앙 기준선 (θ = 0)
      ctx.strokeStyle = "rgba(255,255,255,.5)"; ctx.lineWidth = dpr; ctx.setLineDash([3 * dpr, 5 * dpr]);
      ctx.beginPath(); ctx.moveTo(CAM.cx * sc, 0); ctx.lineTo(CAM.cx * sc, h); ctx.stroke(); ctx.setLineDash([]);

      if (status === "fail" || status === "lost") {
        ctx.fillStyle = "rgba(0,0,0,.45)"; ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = "#fff"; ctx.font = `800 ${(p.compact ? 11 : 15) * dpr}px Pretendard, sans-serif`; ctx.textAlign = "center";
        ctx.fillText(status === "fail" ? "카메라 신호 없음" : "강아지 추적 실패", w / 2, h / 2);
        ctx.textAlign = "start";
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return <canvas ref={ref} className={props.className ?? "absolute inset-0 h-full w-full"} aria-label="셰르피 1인칭 카메라와 강아지 검출 박스" />;
}

/** 뒤에서 본 강아지 — 발 위치(gx, gy), 키 H [px] */
function drawDogBack(ctx: CanvasRenderingContext2D, C: Record<string, string>, gx: number, gy: number, H: number, t: number, speed: number) {
  const w = H * 0.75;
  ctx.fillStyle = "rgba(0,0,0,.15)"; ctx.beginPath(); ctx.ellipse(gx, gy, w * 0.55, H * 0.06, 0, 0, Math.PI * 2); ctx.fill();
  const step = Math.sin(t * (4 + speed * 14)) * H * 0.05 * Math.min(1, speed * 3);
  ctx.fillStyle = C.dogD;
  for (const [dx, ph] of [[-0.28, 1], [0.28, -1]] as const) ctx.fillRect(gx + dx * w - w * 0.08, gy - H * 0.38 + ph * step, w * 0.16, H * 0.38 - ph * step);
  ctx.fillStyle = C.dog; ctx.beginPath(); ctx.ellipse(gx, gy - H * 0.5, w * 0.5, H * 0.25, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = C.dogL; ctx.beginPath(); ctx.ellipse(gx, gy - H * 0.38, w * 0.22, H * 0.12, 0, 0, Math.PI * 2); ctx.fill();
  // 머리 + 귀
  ctx.fillStyle = C.dog; ctx.beginPath(); ctx.ellipse(gx, gy - H * 0.82, w * 0.3, H * 0.17, 0, 0, Math.PI * 2); ctx.fill();
  for (const s of [-1, 1]) { ctx.fillStyle = C.dogD; ctx.beginPath(); ctx.moveTo(gx + s * w * 0.08, gy - H * 0.92); ctx.lineTo(gx + s * w * 0.28, gy - H * 1.05); ctx.lineTo(gx + s * w * 0.3, gy - H * 0.82); ctx.closePath(); ctx.fill(); }
  // 말린 꼬리
  const wag = Math.sin(t * (6 + speed * 6)) * w * 0.08;
  ctx.strokeStyle = C.dog; ctx.lineWidth = w * 0.13; ctx.lineCap = "round";
  ctx.beginPath(); ctx.arc(gx + wag, gy - H * 0.7, w * 0.13, Math.PI * 0.2, Math.PI * 1.7); ctx.stroke(); ctx.lineCap = "butt";
}
