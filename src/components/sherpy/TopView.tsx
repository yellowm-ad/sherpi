"use client";

import { useEffect, useRef, useState } from "react";
import { Plus, Minus, Crosshair } from "lucide-react";

/**
 * 위에서 내려다본 셰르피 — 로봇·리드줄·강아지·추정 위치·장애물
 *
 * mode="world": 지역 좌표(x 오른쪽, y 전방)를 위가 전방이 되게 그린다. 카메라는 로봇–강아지 중간을 따라간다. (시뮬레이터)
 * mode="robot": 로봇을 화면 아래쪽 가운데에 고정하고 로봇 전방이 항상 위. (실제 로봇 대시보드 — 텔레메트리 θ·d 만으로 그린다)
 *
 * 장면 값은 매 렌더마다 바뀌어도 되고(scene prop), 캔버스는 60fps 로 목표값을 부드럽게 따라간다(smooth τ).
 */
export interface TopScene {
  robot: { x: number; y: number; psi: number; steer?: number; v?: number };
  dog?: { x: number; y: number } | null;
  dogEst?: { x: number; y: number; major: number; minor: number; angle: number; track?: "ok" | "coast" | "lost" } | null;
  tension: number;
  reel: number;
  level: number;
  warn: number;
  stop: number;
  hold?: boolean;
  obstacles?: { x: number; y: number; r: number }[];
  half?: number | null;
  clearance?: number;
  trailRobot?: [number, number][];
  trailDog?: [number, number][];
  fovDeg?: number;
  /** 화면에 장력·길이 라벨 */
  labels?: boolean;
}

type Tok = Record<string, string>;
const TOKENS = ["scene-grass", "scene-grass-2", "scene-path", "scene-edge", "scene-tree", "scene-tree-2", "scene-shadow",
  "dog", "dog-dark", "dog-light", "robot-body", "robot-dark", "level-0", "level-1", "level-2", "level-3", "sherpy-600", "sherpy-400", "mint", "ink", "muted", "surface"];

function readTokens(): Tok {
  const cs = getComputedStyle(document.documentElement);
  const t: Tok = {};
  for (const k of TOKENS) t[k] = cs.getPropertyValue(`--color-${k}`).trim() || "#8a9a9a";
  return t;
}

/** 잔디 결 — 한 번 만들어 패턴으로 깐다 (월드에 고정돼 카메라와 함께 흐른다) */
function grassTile(tok: Tok, dpr: number) {
  const s = Math.round(160 * dpr);
  const c = document.createElement("canvas");
  c.width = c.height = s;
  const g = c.getContext("2d")!;
  g.fillStyle = tok["scene-grass"]; g.fillRect(0, 0, s, s);
  let seed = 11;
  const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 260; i++) {
    g.strokeStyle = i % 3 ? tok["scene-grass-2"] : "rgba(255,255,255,.18)";
    g.lineWidth = dpr * (0.6 + r());
    const x = r() * s, y = r() * s, h = (3 + r() * 5) * dpr;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + (r() - 0.5) * 3 * dpr, y - h); g.stroke();
  }
  return c;
}

const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const lerpAng = (a: number, b: number, k: number) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * k;

export function tensionColor(tok: Tok, T: number, warn: number, stop: number) {
  return T >= stop ? tok["level-3"] : T >= warn ? tok["level-2"] : T >= warn / 2 ? tok["level-1"] : tok["mint"];
}

export default function TopView({
  scene, mode = "world", className = "h-72", smooth = 0.08, initialSpan = 6, showTruth = true, controls = true,
}: {
  scene: TopScene;
  mode?: "world" | "robot";
  className?: string;
  /** 표시값이 목표값을 따라가는 시정수 [s] — 텔레메트리(1~4 Hz)는 0.3 정도로 크게 */
  smooth?: number;
  /** 화면 짧은 변에 담을 거리 [m] */
  initialSpan?: number;
  showTruth?: boolean;
  /** 확대·축소 버튼 (작은 미리보기 창에서는 끈다) */
  controls?: boolean;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef(scene);
  sceneRef.current = scene;
  const [span, setSpan] = useState(initialSpan);
  const spanRef = useRef(span);
  spanRef.current = span;
  const truthRef = useRef(showTruth);
  truthRef.current = showTruth;

  useEffect(() => {
    const cv = ref.current!;
    const ctx = cv.getContext("2d")!;
    const tok = readTokens();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const tile = grassTile(tok, dpr);
    const pattern = ctx.createPattern(tile, "repeat")!;
    let raf = 0, last = performance.now(), anim = 0;
    // 화면에 그리는 값 (목표값을 지수평활로 따라간다)
    let D: { rx: number; ry: number; psi: number; steer: number; dx: number; dy: number; ex: number; ey: number; eMaj: number; eMin: number; eAng: number; T: number; L: number; camX: number; camY: number; dogHead: number; gait: number; reelRot: number } | null = null;

    const draw = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      anim += dt;
      const S = sceneRef.current;
      const w = cv.clientWidth, h = cv.clientHeight;
      if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
      const dogT = S.dog ?? (S.dogEst ? { x: S.dogEst.x, y: S.dogEst.y } : { x: S.robot.x + 1.6 * Math.sin(S.robot.psi), y: S.robot.y + 1.6 * Math.cos(S.robot.psi) });
      const est = S.dogEst;
      const k = smooth <= 0 ? 1 : 1 - Math.exp(-dt / smooth);
      if (!D) {
        D = { rx: S.robot.x, ry: S.robot.y, psi: S.robot.psi, steer: S.robot.steer ?? 0, dx: dogT.x, dy: dogT.y, ex: est?.x ?? dogT.x, ey: est?.y ?? dogT.y,
          eMaj: est?.major ?? 0, eMin: est?.minor ?? 0, eAng: est?.angle ?? 0, T: S.tension, L: S.reel, camX: S.robot.x, camY: S.robot.y, dogHead: S.robot.psi, gait: 0, reelRot: 0 };
      }
      const pdx = D.dx, pdy = D.dy, pL = D.L;
      D.rx = lerp(D.rx, S.robot.x, k); D.ry = lerp(D.ry, S.robot.y, k); D.psi = lerpAng(D.psi, S.robot.psi, k);
      D.steer = lerp(D.steer, S.robot.steer ?? 0, k);
      D.dx = lerp(D.dx, dogT.x, k); D.dy = lerp(D.dy, dogT.y, k);
      if (est) { D.ex = lerp(D.ex, est.x, k); D.ey = lerp(D.ey, est.y, k); D.eMaj = lerp(D.eMaj, est.major, k); D.eMin = lerp(D.eMin, est.minor, k); D.eAng = lerpAng(D.eAng, est.angle, k); }
      D.T = lerp(D.T, S.tension, k); D.L = lerp(D.L, S.reel, k);
      // 강아지 머리 방향 = 이동 방향 (거의 안 움직이면 로봇 반대쪽을 본다)
      const vdx = (D.dx - pdx) / Math.max(dt, 1e-3), vdy = (D.dy - pdy) / Math.max(dt, 1e-3);
      const sp = Math.hypot(vdx, vdy);
      const awayHead = Math.atan2(D.dx - D.rx, D.dy - D.ry);
      D.dogHead = lerpAng(D.dogHead, sp > 0.08 ? Math.atan2(vdx, vdy) : awayHead, 1 - Math.exp(-dt / 0.25));
      D.gait += dt * (2 + sp * 9);
      D.reelRot += (D.L - pL) / 0.028; // 드럼 반경 ~28 mm

      // ── 뷰 변환 ──
      const span = spanRef.current;
      const scale = (Math.min(w, h) / span) * dpr;
      let toS: (x: number, y: number) => [number, number];
      let rot = 0; // 월드 각도 → 화면 회전 보정
      if (mode === "world") {
        const tx = (D.rx + D.dx) / 2, ty = (D.ry + D.dy) / 2 + 0.3;
        D.camX = lerp(D.camX, tx, 1 - Math.exp(-dt / 0.6)); D.camY = lerp(D.camY, ty, 1 - Math.exp(-dt / 0.6));
        const cx = (w * dpr) / 2, cy = (h * dpr) / 2;
        toS = (x, y) => [cx + (x - D!.camX) * scale, cy - (y - D!.camY) * scale];
      } else {
        const cx = (w * dpr) / 2, cy = h * dpr * 0.74;
        const c = Math.cos(D.psi), s = Math.sin(D.psi);
        toS = (x, y) => { const ex = x - D!.rx, ey = y - D!.ry; return [cx + (ex * c - ey * s) * scale, cy - (ex * s + ey * c) * scale]; };
        rot = -D.psi;
      }
      const m = (v: number) => v * scale;

      // ── 바닥 ──
      ctx.save();
      const [ox, oy] = toS(0, 0);
      ctx.fillStyle = pattern;
      ctx.translate(ox, oy); ctx.rotate(rot);
      ctx.fillRect(-w * dpr * 3, -h * dpr * 3, w * dpr * 6, h * dpr * 6);
      ctx.restore();

      if (mode === "world" && S.half) {
        // 산책로 띠
        const yTop = D.camY + span * 2, yBot = D.camY - span * 2;
        const [a] = toS(-S.half, 0), [b] = toS(S.half, 0);
        const g = ctx.createLinearGradient(a, 0, b, 0);
        g.addColorStop(0, tok["scene-edge"]); g.addColorStop(0.04, tok["scene-path"]); g.addColorStop(0.96, tok["scene-path"]); g.addColorStop(1, tok["scene-edge"]);
        ctx.fillStyle = g;
        const [, t1] = toS(0, yTop), [, t2] = toS(0, yBot);
        ctx.fillRect(a, t1, b - a, t2 - t1);
        // 보도블록 줄눈 (1 m 마다)
        ctx.strokeStyle = "rgba(0,0,0,.05)"; ctx.lineWidth = dpr;
        for (let y = Math.floor(yBot); y < yTop; y += 1) { const [, sy] = toS(0, y); ctx.beginPath(); ctx.moveTo(a, sy); ctx.lineTo(b, sy); ctx.stroke(); }
        ctx.setLineDash([8 * dpr, 6 * dpr]); ctx.strokeStyle = tok["scene-edge"]; ctx.lineWidth = 1.5 * dpr;
        for (const x of [-S.half, S.half]) { const [sx] = toS(x, 0); ctx.beginPath(); ctx.moveTo(sx, t1); ctx.lineTo(sx, t2); ctx.stroke(); }
        ctx.setLineDash([]);
      }

      if (mode === "robot") {
        // 거리 고리 1·2·3 m
        const [rx, ry] = toS(D.rx, D.ry);
        ctx.strokeStyle = "rgba(255,255,255,.55)"; ctx.lineWidth = dpr; ctx.setLineDash([4 * dpr, 5 * dpr]);
        ctx.font = `${600} ${10 * dpr}px Pretendard, sans-serif`; ctx.fillStyle = "rgba(255,255,255,.85)";
        for (const r of [1, 2, 3]) { ctx.beginPath(); ctx.arc(rx, ry, m(r), 0, Math.PI * 2); ctx.stroke(); ctx.fillText(`${r} m`, rx + m(r) * 0.71 + 3 * dpr, ry - m(r) * 0.71); }
        ctx.setLineDash([]);
      }

      // 궤적
      const trail = (pts: [number, number][] | undefined, color: string, dash: boolean) => {
        if (!pts || pts.length < 2) return;
        ctx.strokeStyle = color; ctx.lineWidth = 2 * dpr; ctx.globalAlpha = 0.55; ctx.setLineDash(dash ? [5 * dpr, 5 * dpr] : []);
        ctx.beginPath(); pts.forEach(([x, y], i) => { const [sx, sy] = toS(x, y); if (i) ctx.lineTo(sx, sy); else ctx.moveTo(sx, sy); }); ctx.stroke();
        ctx.globalAlpha = 1; ctx.setLineDash([]);
      };
      trail(S.trailRobot, tok["sherpy-600"], false);
      trail(S.trailDog, tok["dog-dark"], true);

      // 장애물 = 나무 (그림자 → 안전 여유 고리 → 수관)
      for (const o of S.obstacles ?? []) {
        const [sx, sy] = toS(o.x, o.y);
        if (S.clearance != null) {
          ctx.setLineDash([4 * dpr, 4 * dpr]); ctx.strokeStyle = tok["level-1"]; ctx.lineWidth = 1.2 * dpr;
          ctx.beginPath(); ctx.arc(sx, sy, m(o.r + S.clearance + 0.23), 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
        }
        ctx.fillStyle = tok["scene-shadow"]; ctx.beginPath(); ctx.ellipse(sx + m(0.08), sy + m(0.1), m(o.r * 1.05), m(o.r), 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = tok["scene-tree"]; ctx.beginPath(); ctx.arc(sx, sy, m(o.r), 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = tok["scene-tree-2"];
        for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2 + 0.6; ctx.beginPath(); ctx.arc(sx + Math.cos(a) * m(o.r * 0.45), sy + Math.sin(a) * m(o.r * 0.45), m(o.r * 0.4), 0, Math.PI * 2); ctx.fill(); }
        ctx.fillStyle = "rgba(255,255,255,.25)"; ctx.beginPath(); ctx.arc(sx - m(o.r * 0.3), sy - m(o.r * 0.3), m(o.r * 0.25), 0, Math.PI * 2); ctx.fill();
      }

      const [rsx, rsy] = toS(D.rx, D.ry);
      const robotRot = mode === "world" ? D.psi : 0;

      // 카메라 화각
      if (S.fovDeg) {
        const half = (S.fovDeg / 2) * (Math.PI / 180);
        const g = ctx.createRadialGradient(rsx, rsy, 0, rsx, rsy, m(3.2));
        g.addColorStop(0, "rgba(255,255,255,.28)"); g.addColorStop(1, "rgba(255,255,255,0)");
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.moveTo(rsx, rsy);
        ctx.arc(rsx, rsy, m(3.2), -Math.PI / 2 + robotRot - half, -Math.PI / 2 + robotRot + half); ctx.closePath(); ctx.fill();
      }

      // 리드줄 — 팽팽하면 직선, 느슨하면 처짐(남는 길이만큼), 색 = 장력 단계
      const dogDraw = truthRef.current && S.dog ? { x: D.dx, y: D.dy } : { x: D.ex, y: D.ey };
      const [dsx, dsy] = toS(dogDraw.x, dogDraw.y);
      const reelBack = 0.12; // 릴은 로봇 뒤쪽 위
      const [ax, ay] = toS(D.rx - Math.sin(D.psi) * reelBack, D.ry - Math.cos(D.psi) * reelBack);
      const dd = Math.hypot(dsx - ax, dsy - ay) / scale;
      const slack = Math.max(0, D.L - dd);
      const sag = D.T > 1 ? 0 : Math.min(0.35, Math.sqrt(Math.max(0, slack * dd)) * 0.5) * Math.sin(anim * 1.3) * 0.6 + Math.min(0.35, slack * 0.6);
      const nx = -(dsy - ay), ny = dsx - ax, nl = Math.hypot(nx, ny) || 1;
      const mx = (ax + dsx) / 2 + (nx / nl) * m(sag), my = (ay + dsy) / 2 + (ny / nl) * m(sag);
      const rc = tensionColor(tok, D.T, S.warn, S.stop);
      ctx.strokeStyle = "rgba(0,0,0,.18)"; ctx.lineWidth = 4 * dpr;
      ctx.beginPath(); ctx.moveTo(ax + 2 * dpr, ay + 3 * dpr); ctx.quadraticCurveTo(mx + 2 * dpr, my + 3 * dpr, dsx + 2 * dpr, dsy + 3 * dpr); ctx.stroke();
      ctx.strokeStyle = rc; ctx.lineWidth = (D.T >= S.warn ? 3.6 : 2.6) * dpr;
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.quadraticCurveTo(mx, my, dsx, dsy); ctx.stroke();
      if (S.labels !== false) {
        const lx = (ax + dsx) / 2, ly = (ay + dsy) / 2;
        const txt = `${D.T.toFixed(1)} N · L ${D.L.toFixed(2)} m`;
        ctx.font = `700 ${11 * dpr}px Pretendard, sans-serif`;
        const tw = ctx.measureText(txt).width + 12 * dpr;
        ctx.fillStyle = "rgba(255,255,255,.92)";
        roundRect(ctx, lx + 12 * dpr, ly - 10 * dpr, tw, 20 * dpr, 10 * dpr); ctx.fill();
        ctx.fillStyle = rc === tok["mint"] ? tok["ink"] : rc; ctx.fillText(txt, lx + 18 * dpr, ly + 4 * dpr);
      }

      // 추정 위치: 1σ·2σ 오차 타원
      if (est) {
        const [esx, esy] = toS(D.ex, D.ey);
        const ang = -(D.eAng + (mode === "robot" ? D.psi : 0));
        const col = est.track === "lost" ? tok["level-3"] : est.track === "coast" ? tok["level-1"] : tok["sherpy-600"];
        for (const [kσ, a] of [[2, 0.1], [1, 0.2]] as const) {
          ctx.fillStyle = hexA(col, a);
          ctx.beginPath(); ctx.ellipse(esx, esy, Math.max(3 * dpr, m(D.eMaj * kσ)), Math.max(3 * dpr, m(D.eMin * kσ)), ang, 0, Math.PI * 2); ctx.fill();
        }
        ctx.strokeStyle = col; ctx.lineWidth = 1.4 * dpr; ctx.setLineDash([3 * dpr, 3 * dpr]);
        ctx.beginPath(); ctx.ellipse(esx, esy, Math.max(3 * dpr, m(D.eMaj * 2)), Math.max(3 * dpr, m(D.eMin * 2)), ang, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
        if (truthRef.current && S.dog) {
          // 추정 중심 십자
          ctx.strokeStyle = col; ctx.lineWidth = 2 * dpr;
          ctx.beginPath(); ctx.moveTo(esx - 6 * dpr, esy); ctx.lineTo(esx + 6 * dpr, esy); ctx.moveTo(esx, esy - 6 * dpr); ctx.lineTo(esx, esy + 6 * dpr); ctx.stroke();
        }
      }

      // 강아지 (위에서 본 시바)
      const dogRot = mode === "world" ? D.dogHead : D.dogHead - D.psi;
      drawDog(ctx, tok, dsx, dsy, dogRot, scale, D.gait, anim, sp);

      // 로봇
      drawRobot(ctx, tok, rsx, rsy, robotRot, scale, D.steer, D.reelRot, S.level, S.hold ?? false, anim);

      // 축척 막대
      ctx.fillStyle = "rgba(255,255,255,.9)";
      const bar = m(1);
      roundRect(ctx, 10 * dpr, h * dpr - 26 * dpr, bar + 46 * dpr, 18 * dpr, 9 * dpr); ctx.fill();
      ctx.fillStyle = tok["ink"]; ctx.fillRect(18 * dpr, h * dpr - 18 * dpr, bar, 2 * dpr);
      ctx.font = `600 ${10 * dpr}px Pretendard, sans-serif`; ctx.fillText("1 m", 22 * dpr + bar, h * dpr - 13 * dpr);

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [mode, smooth]);

  return (
    <div className={`relative overflow-hidden ${className}`}>
      <canvas ref={ref} className="absolute inset-0 h-full w-full" role="img"
              aria-label={`위에서 본 로봇과 강아지 — 장력 ${scene.tension.toFixed(1)} 뉴턴, 줄 ${scene.reel.toFixed(2)} 미터`} />
      {controls && <div className="absolute right-2 bottom-2 flex flex-col gap-1">
        <button aria-label="확대" onClick={() => setSpan((s) => Math.max(2.5, s / 1.35))} className="press touch flex items-center justify-center rounded-full bg-surface/90 text-ink shadow"><Plus size={16} /></button>
        <button aria-label="축소" onClick={() => setSpan((s) => Math.min(30, s * 1.35))} className="press touch flex items-center justify-center rounded-full bg-surface/90 text-ink shadow"><Minus size={16} /></button>
        {span !== initialSpan && <button aria-label="원래 배율" onClick={() => setSpan(initialSpan)} className="press touch flex items-center justify-center rounded-full bg-surface/90 text-ink shadow"><Crosshair size={16} /></button>}
      </div>}
    </div>
  );
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

/** "#RRGGBB" → rgba(…, a) */
function hexA(hex: string, a: number) {
  const h = hex.replace("#", "");
  if (h.length !== 6) return hex;
  return `rgba(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},${a})`;
}

/** 로봇 (위에서): 차체 0.45 × 0.6 m, 앞바퀴 조향, 뒤쪽 릴 드럼(회전), 앞쪽 카메라, 상태 LED */
function drawRobot(ctx: CanvasRenderingContext2D, tok: Tok, x: number, y: number, rot: number, s: number, steer: number, reelRot: number, level: number, hold: boolean, t: number) {
  const m = (v: number) => v * s;
  ctx.save(); ctx.translate(x, y); ctx.rotate(rot);
  // 그림자
  ctx.fillStyle = tok["scene-shadow"]; roundRect(ctx, -m(0.22) + m(0.04), -m(0.3) + m(0.05), m(0.44), m(0.6), m(0.09)); ctx.fill();
  // 바퀴 (앞 2개는 조향각만큼 돌아간다)
  ctx.fillStyle = tok["robot-dark"];
  for (const [wx, wy, st] of [[-0.25, -0.18, steer], [0.25, -0.18, steer], [-0.25, 0.18, 0], [0.25, 0.18, 0]] as const) {
    ctx.save(); ctx.translate(m(wx), m(wy)); ctx.rotate(st); roundRect(ctx, -m(0.045), -m(0.075), m(0.09), m(0.15), m(0.03)); ctx.fill(); ctx.restore();
  }
  // 차체
  const g = ctx.createLinearGradient(-m(0.2), 0, m(0.2), 0);
  g.addColorStop(0, tok["robot-body"]); g.addColorStop(0.5, tok["sherpy-400"]); g.addColorStop(1, tok["robot-body"]);
  ctx.fillStyle = g; roundRect(ctx, -m(0.2), -m(0.29), m(0.4), m(0.58), m(0.08)); ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,.5)"; ctx.lineWidth = Math.max(1, m(0.008)); ctx.stroke();
  // 카메라 (앞)
  ctx.fillStyle = tok["robot-dark"]; roundRect(ctx, -m(0.05), -m(0.31), m(0.1), m(0.06), m(0.02)); ctx.fill();
  ctx.fillStyle = "#9ad"; ctx.beginPath(); ctx.arc(0, -m(0.29), m(0.018), 0, Math.PI * 2); ctx.fill();
  // 릴 드럼 (뒤) — 줄이 풀리면 돈다
  ctx.fillStyle = tok["surface"]; ctx.beginPath(); ctx.arc(0, m(0.12), m(0.085), 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = tok["muted"]; ctx.lineWidth = Math.max(1, m(0.01));
  for (let i = 0; i < 3; i++) { const a = reelRot + (i * Math.PI * 2) / 3; ctx.beginPath(); ctx.moveTo(0, m(0.12)); ctx.lineTo(Math.cos(a) * m(0.07), m(0.12) + Math.sin(a) * m(0.07)); ctx.stroke(); }
  ctx.beginPath(); ctx.arc(0, m(0.12), m(0.085), 0, Math.PI * 2); ctx.stroke();
  // 상태 LED
  const led = level >= 3 ? tok["level-3"] : level === 2 ? tok["level-2"] : level === 1 ? tok["level-1"] : tok["mint"];
  const blink = hold ? (Math.sin(t * 10) > 0 ? 1 : 0.25) : 1;
  ctx.globalAlpha = blink; ctx.fillStyle = led; ctx.beginPath(); ctx.arc(0, -m(0.1), m(0.035), 0, Math.PI * 2); ctx.fill();
  ctx.globalAlpha = 0.3 * blink; ctx.beginPath(); ctx.arc(0, -m(0.1), m(0.08), 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1;
  ctx.restore();
}

/** 강아지 (위에서 본 시바): 몸통·머리·귀·주둥이·꼬리(흔들림)·다리(걸음) — 몸길이 약 0.55 m */
function drawDog(ctx: CanvasRenderingContext2D, tok: Tok, x: number, y: number, rot: number, s: number, gait: number, t: number, speed: number) {
  const m = (v: number) => v * s;
  ctx.save(); ctx.translate(x, y); ctx.rotate(rot);
  // 그림자
  ctx.fillStyle = tok["scene-shadow"]; ctx.beginPath(); ctx.ellipse(m(0.03), m(0.04), m(0.13), m(0.3), 0, 0, Math.PI * 2); ctx.fill();
  // 다리 (대각선 짝이 같이 움직이는 속보)
  ctx.fillStyle = tok["dog-dark"];
  const amp = Math.min(1, speed * 2.5) * m(0.05);
  for (const [lx, ly, ph] of [[-0.09, -0.14, 0], [0.09, -0.14, Math.PI], [-0.09, 0.15, Math.PI], [0.09, 0.15, 0]] as const) {
    const off = Math.sin(gait * 2 + ph) * amp;
    ctx.beginPath(); ctx.ellipse(m(lx), m(ly) + off, m(0.035), m(0.06), 0, 0, Math.PI * 2); ctx.fill();
  }
  // 꼬리 (말린 꼬리 — 흔들림)
  const wag = Math.sin(t * (6 + speed * 6)) * 0.5;
  ctx.save(); ctx.translate(0, m(0.24)); ctx.rotate(wag);
  ctx.fillStyle = tok["dog"]; ctx.beginPath(); ctx.ellipse(0, m(0.06), m(0.05), m(0.08), 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = tok["dog-light"]; ctx.beginPath(); ctx.arc(0, m(0.08), m(0.028), 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  // 몸통
  const g = ctx.createRadialGradient(0, 0, m(0.02), 0, 0, m(0.25));
  g.addColorStop(0, tok["dog"]); g.addColorStop(1, tok["dog-dark"]);
  ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(0, m(0.03), m(0.12), m(0.23), 0, 0, Math.PI * 2); ctx.fill();
  // 하네스
  ctx.strokeStyle = tok["sherpy-600"]; ctx.lineWidth = Math.max(1.5, m(0.025));
  ctx.beginPath(); ctx.moveTo(-m(0.115), -m(0.08)); ctx.quadraticCurveTo(0, -m(0.04), m(0.115), -m(0.08)); ctx.stroke();
  // 머리
  ctx.fillStyle = tok["dog"]; ctx.beginPath(); ctx.ellipse(0, -m(0.24), m(0.095), m(0.09), 0, 0, Math.PI * 2); ctx.fill();
  // 귀 (삼각)
  for (const sx of [-1, 1]) {
    ctx.fillStyle = tok["dog-dark"]; ctx.beginPath();
    ctx.moveTo(sx * m(0.03), -m(0.29)); ctx.lineTo(sx * m(0.1), -m(0.33)); ctx.lineTo(sx * m(0.085), -m(0.24)); ctx.closePath(); ctx.fill();
  }
  // 주둥이 (크림색) + 코
  ctx.fillStyle = tok["dog-light"]; ctx.beginPath(); ctx.ellipse(0, -m(0.31), m(0.05), m(0.045), 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = tok["robot-dark"]; ctx.beginPath(); ctx.arc(0, -m(0.345), m(0.014), 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}
