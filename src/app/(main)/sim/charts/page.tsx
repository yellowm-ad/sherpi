"use client";

import { useMemo } from "react";
import { useSim } from "../SimProvider";
import PageHeader from "@/components/ui/PageHeader";
import LiveChart from "@/components/sherpy/LiveChart";
import Transport from "@/components/sherpy/Transport";

const DEG = 180 / Math.PI;

/** 시뮬 실시간 그래프 레이어 — 40초 전체를 그리고 현재 시점까지만 선을 긋는다 */
export default function SimCharts() {
  const { result, time, s } = useSim();
  const F = result.frames;
  const fusion = result.mode === "fusion";
  const c = useMemo(() => {
    const pick = <T,>(f: (x: (typeof F)[number]) => T) => F.map(f);
    return {
      t: pick((f) => f.t),
      tension: pick((f) => f.tension), filtered: pick((f) => f.filtered),
      rv: pick((f) => f.rv), dogV: pick((f) => f.dogV), vCmd: pick((f) => f.vCmd),
      dist: pick((f) => f.dist), reel: pick((f) => f.reel), path: pick((f) => f.ropePath), dEst: pick((f) => f.est?.d ?? null),
      body: pick((f) => f.body), rope: pick((f) => f.rope),
      th: pick((f) => f.theta * DEG), thEst: pick((f) => (f.est ? f.est.theta * DEG : null)), thMeas: pick((f) => (f.est?.thetaMeas != null ? f.est.thetaMeas * DEG : null)),
      err: pick((f) => (f.est ? Math.hypot(f.est.x - f.dog[0], f.est.y - f.dog[1]) * 100 : null)), sig: pick((f) => (f.est ? f.est.sigma * 100 : null)),
      steer: pick((f) => f.steer * DEG), level: pick((f) => f.level),
    };
  }, [F]);

  return (
    <div>
      <PageHeader title="실시간 그래프" back />
      <div className="space-y-3 px-4 pt-3 pb-28">
        <div className="sticky top-14 z-20 -mx-4 bg-bg/90 px-4 py-2 backdrop-blur"><Transport /></div>
        <LiveChart title="리드줄 장력" unit="N" t={c.t} cursor={time} tMax={40}
          series={[{ key: "r", label: "원시", color: "var(--color-dog-dark)", values: c.tension }, { key: "f", label: fusion ? "필터 F̂ (보정 후)" : "필터 F̂", color: "var(--color-sherpy-600)", values: c.filtered }]}
          thresholds={[{ v: s.p.warn, label: "L2", color: "var(--color-level-2)" }, { v: s.p.stop, label: "L3", color: "var(--color-level-3)" }]}
          note="F_t = k(d − L) + 12·max(0, v_r).  F̂ ← F̂ + α(z − F̂),  α = 1 − e^(−dt/τ)" />
        <LiveChart title="이동 속도" unit="m/s" t={c.t} cursor={time} tMax={40} yMin={0}
          series={[{ key: "r", label: "로봇", color: "var(--color-sherpy-600)", values: c.rv }, { key: "c", label: "명령", color: "var(--color-sherpy-400)", values: c.vCmd, dashed: true }, { key: "d", label: "강아지", color: "var(--color-dog)", values: c.dogV }]}
          note={s.mode === "ref" || !s.fusion.smoothAccel ? "7.3 가감속식은 목표 근처에서 ±0.04 m/s 로 떨린다 (뱅뱅 제어)." : "레이트 리미터: v ← v + clamp(v명령 − v, −1.9dt, +0.85dt)"} />
        <LiveChart title="거리와 인출길이" unit="m" t={c.t} cursor={time} tMax={40}
          series={[
            { key: "d", label: "상대거리 d", color: "var(--color-mint-700)", values: c.dist },
            { key: "L", label: "릴 L", color: "var(--color-sherpy-400)", values: c.reel },
            ...(fusion ? [{ key: "p", label: "줄 경로 ℓ", color: "var(--color-level-1)", values: c.path, dashed: true }, { key: "e", label: "추정 d̂", color: "var(--color-sherpy-700)", values: c.dEst, dashed: true }] : []),
          ]}
          note="인출길이 L ≠ 직선거리 d — 줄이 장애물을 감으면 경로 ℓ 이 d 보다 길어진다." />
        <LiveChart title="장애물 이격거리" unit="m" t={c.t} cursor={time} tMax={40}
          series={[{ key: "b", label: "차체", color: "var(--color-sherpy-600)", values: c.body }, { key: "r", label: "리드줄", color: "var(--color-dog-dark)", values: c.rope }]}
          thresholds={[{ v: 0, label: "간섭", color: "var(--color-level-3)" }, { v: s.p.clearance, label: "여유", color: "var(--color-level-1)" }]} />
        <LiveChart title="강아지 방향각 θ" unit="° (+ 오른쪽)" t={c.t} cursor={time} tMax={40}
          series={[{ key: "t", label: "참값", color: "var(--color-ink)", values: c.th }, ...(fusion ? [{ key: "m", label: "카메라 측정", color: "var(--color-dog)", values: c.thMeas }, { key: "e", label: "추정 θ̂", color: "var(--color-sherpy-600)", values: c.thEst, dashed: true }] : [])]}
          note="θ = atan2(Δx, Δy) (로봇 기준). 측정은 왜곡·장착각 보정 후 값." />
        {fusion && (
          <LiveChart title="강아지 위치 추정 오차" unit="cm" t={c.t} cursor={time} tMax={40} yMin={0}
            series={[{ key: "e", label: "실제 오차", color: "var(--color-level-2)", values: c.err }, { key: "s", label: "필터가 말하는 1σ", color: "var(--color-muted)", values: c.sig, dashed: true }]}
            note="좋은 필터는 실제 오차가 1σ 근처에서 움직인다 (너무 작게 자신하면 위험)." />
        )}
        <LiveChart title="조향 명령 δ" unit="°" t={c.t} cursor={time} tMax={40}
          series={[{ key: "s", label: "δ", color: "var(--color-sherpy-600)", values: c.steer }]}
          thresholds={[{ v: s.p.steerMax, label: "+최대", color: "var(--color-muted)" }, { v: -s.p.steerMax, label: "−최대", color: "var(--color-muted)" }]} />
        <LiveChart title="안전 단계" unit="L0~L3" t={c.t} cursor={time} tMax={40} yMin={0} yMax={3.2}
          series={[{ key: "l", label: "단계", color: "var(--color-level-2)", values: c.level }]} />
      </div>
    </div>
  );
}
