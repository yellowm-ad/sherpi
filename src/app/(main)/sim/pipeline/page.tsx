"use client";

import { useSim } from "../SimProvider";
import PageHeader from "@/components/ui/PageHeader";
import Transport from "@/components/sherpy/Transport";
import { DEFAULT_HW, K } from "@/lib/sherpy/params";
import { reelRadius } from "@/lib/sherpy/core/reel";
import { SAFETY_COLOR } from "@/lib/robot/types";

const DEG = 180 / Math.PI;

/**
 * 변수 3개 처리 과정 — 현재 프레임에서 실제로 계산된 값을 공식과 함께 보여 준다.
 *   ① 구하기(T, L, θ) → ② 통합(EKF) → ③ 안전 판단 → ④ 명령
 */
export default function SimPipeline() {
  const { frame: f, result, s, set } = useSim();
  const e = f.est;
  const fit = result.calib;
  const hw = DEFAULT_HW;
  const geom = { r0: hw.reelCore, t: hw.ropeThick, w: hw.drumWidth, Ltot: hw.ropeTotal };
  const n = (v: number | null | undefined, k = 2) => (v == null ? "—" : v.toFixed(k));

  if (result.mode !== "fusion" || !e) {
    return (
      <div>
        <PageHeader title="변수 3개 처리 과정" back />
        <div className="px-4 pt-6 text-center">
          <p className="text-sm text-body">이 화면은 <b>실전 모드</b>에서 계산 과정을 보여 줘요.<br />기준 모드(7.3)는 로봇이 참값을 안다고 가정해서 센서 처리 단계가 없어요.</p>
          <button onClick={() => set({ mode: "fusion" })} className="press touch mt-4 rounded-xl bg-sherpy-600 px-5 text-sm font-semibold text-white">실전 모드로 바꾸기</button>
        </div>
      </div>
    );
  }
  const xd = e.camPx ? (e.camPx.u - hw.camW / 2) / hw.camFx : null;

  return (
    <div>
      <PageHeader title="변수 3개 처리 과정" back />
      <div className="space-y-3 px-4 pt-3 pb-28">
        <div className="sticky top-14 z-20 -mx-4 bg-bg/90 px-4 py-2 backdrop-blur"><Transport /></div>

        <Stage n="①" title="변수 구하기" sub="센서 원시값 → 보정·환산 → 물리량">
          <Var name="장력 T" unit="N" steps={[
            ["로드셀 → HX711 원시값 X", e.loadRaw != null ? `${Math.round(e.loadRaw).toLocaleString()} count` : "신호 없음"],
            ["T = aX + b", fit ? `a = ${fit.a.toExponential(3)}, b = ${fit.b.toFixed(3)} (R² ${fit.r2.toFixed(5)})` : "—"],
            ["보정 장력 T", `${n(e.T)} N  (참값 ${n(f.tension)})`],
            [`F̂ ← F̂ + α(T − F̂), τ ${s.p.tau}s`, `${n(f.filtered)} N`],
          ]} />
          <Var name="릴 인출길이 L" unit="m" steps={[
            ["AS5600 12bit 원시값", e.encRaw != null ? `${e.encRaw} / 4096` : "—"],
            ["언랩 누적 φ (Δ ∈ (−2048, 2048])", "누적 회전각"],
            ["겹감김 반경 r(L) = √(r0² + c(Ltot − L))", `${n(reelRadius(geom, e.L) * 1000, 2)} mm`],
            ["L = Ltot − (r² − r0²)/c", `${n(e.L, 3)} m  (참값 ${n(f.reel, 3)})`],
          ]} />
          <Var name="방향각 θ" unit="rad" steps={[
            ["검출 중심 u", e.camPx ? `${n(e.camPx.u, 1)} px` : e.track === "lost" ? "추적 실패" : "이번 프레임 미검출"],
            ["x_d = (u − c_x)/f_x", xd != null ? n(xd, 4) : "—"],
            ["왜곡 보정 x_n + k1·x_n³ = x_d (뉴턴법)", "→ x_n"],
            ["θ = atan(x_n) + ψ_cam", e.thetaMeas != null ? `${n(e.thetaMeas * DEG, 2)}°  (참값 ${n(f.theta * DEG, 2)}°)` : "—"],
          ]} />
        </Stage>

        <Stage n="②" title="변수 통합 (확장 칼만 필터)" sub="예측(등속) → 측정마다 베이즈 갱신">
          <Var name="쓰인 측정" steps={[
            ["θ (카메라 방향)", e.thetaMeas != null ? "사용" : "없음 → 예측만"],
            ["줄 거리 d = L + (T − 12·v_r⁺)/k", e.dRope != null ? `${n(e.dRope, 3)} m (줄 팽팽)` : "줄 느슨 → 제약 d ≤ L 만"],
            ["카메라 거리 (박스 크기)", e.dCam != null ? `${n(e.dCam, 2)} m (σ 6%)` : "없음"],
            ["줄 걸림 잔차 (줄 거리 − 카메라 거리)", `${n(e.snag, 3)} m`],
          ]} />
          <div className="mt-2 grid grid-cols-3 gap-2 text-center">
            <Out label="d̂" v={n(e.d, 3)} u="m" /><Out label="θ̂" v={n(e.theta * DEG, 2)} u="°" /><Out label="1σ" v={n(e.sigma * 100, 1)} u="cm" />
          </div>
          <p className="mt-2 text-[11px] text-muted">실제 오차 {(Math.hypot(e.x - f.dog[0], e.y - f.dog[1]) * 100).toFixed(1)} cm · 추적 {({ ok: "정상", coast: "가림 예측", lost: "실패" })[e.track]}</p>
        </Stage>

        <Stage n="③" title="안전 판단" sub="L0 정상 · L1 주의 · L2 경고(≤0.2 m/s) · L3 HOLD(자동 복귀 없음)">
          <div className="flex items-center gap-2">
            <span className="rounded-full px-3 py-1 text-sm font-bold text-white" style={{ background: SAFETY_COLOR[f.level] }}>L{f.level}</span>
            <span className="text-sm text-body">{f.mode === "HOLD" ? result.events.find((x) => x.level === 3)?.reason : f.level === 2 ? "장력 경고" : e.notes[0] ?? "정상 추종"}</span>
          </div>
          <ul className="mt-2 space-y-0.5 text-[11px] text-muted">
            <li>F̂ {n(f.filtered)} N ≥ 경고 {s.p.warn} / 정지 {s.p.stop}</li>
            <li>로드셀 {e.loadRaw != null ? "정상" : "샘플 없음"} · 카메라 {e.track} · 엔코더 고착 판정 {K.ENCODER_STUCK_FRAMES}프레임</li>
            <li>차체 이격 {n(f.body)} m · 줄 이격 {n(f.rope)} m (여유 {s.p.clearance} m)</li>
          </ul>
        </Stage>

        <Stage n="④" title="명령" sub="다음 프레임의 로봇·릴 입력">
          <div className="grid grid-cols-3 gap-2 text-center">
            <Out label="속도 v" v={n(f.vCmd)} u="m/s" /><Out label="조향 δ" v={n(f.steer * DEG, 1)} u="°" /><Out label="릴 L" v={n(f.reel, 2)} u="m" />
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-muted">
            v = clamp(dogSpeed + 1.2(d̂ − followDist), 0, robotMax) · δ = clamp(1.4·θ̂, ±{s.p.steerMax}°) ·
            릴 {s.fusion.reelMode === "tension" ? "L̇ = 0.03(T − 2 N) + v_r" : "L목표 = d̂ + 0.04"} (인출 ≤ 0.65, 회수 ≤ 0.5 m/s)
          </p>
        </Stage>
        <p className="text-center text-[11px] text-muted">이 계산은 robot/sherpy_core (파이썬)과 같은 코드 — 차이 10⁻¹¹ 이하로 검증됨</p>
      </div>
    </div>
  );
}

function Stage({ n, title, sub, children }: { n: string; title: string; sub: string; children: React.ReactNode }) {
  return (
    <section className="card p-3">
      <div className="mb-2 flex items-baseline gap-2"><span className="text-lg font-black text-sherpy-600">{n}</span><h2 className="text-sm font-bold">{title}</h2></div>
      <p className="-mt-1 mb-2 text-[11px] text-muted">{sub}</p>
      {children}
    </section>
  );
}
function Var({ name, unit, steps }: { name: string; unit?: string; steps: [string, string][] }) {
  return (
    <div className="mt-2 rounded-xl bg-sherpy-50/60 p-2.5">
      <p className="text-xs font-bold text-sherpy-700">{name}{unit && <span className="font-normal text-muted"> [{unit}]</span>}</p>
      <ol className="mt-1 space-y-1">
        {steps.map(([k, v], i) => (
          <li key={i} className="flex gap-2 text-[11px]">
            <span className="text-muted">→</span>
            <span className="flex-1 text-body">{k}</span>
            <span className="tabular text-right font-semibold text-ink">{v}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
function Out({ label, v, u }: { label: string; v: string; u: string }) {
  return <div className="rounded-xl border border-line py-2"><p className="text-[10px] text-muted">{label}</p><p className="tabular text-base font-bold">{v}<small className="text-[10px] font-normal text-muted">{u}</small></p></div>;
}
