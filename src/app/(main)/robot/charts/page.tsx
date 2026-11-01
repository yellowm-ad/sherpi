"use client";

import { useRobot } from "../RobotProvider";
import PageHeader from "@/components/ui/PageHeader";
import LiveChart from "@/components/sherpy/LiveChart";
import { THRESHOLDS } from "@/lib/robot/types";

/** 실시간 그래프 레이어 — RobotProvider 가 모아 둔 최근 기록 (시연 4 Hz · 2분 / 실로봇 1 Hz · 8분) */
export default function RobotCharts() {
  const { history, demo, state } = useRobot();
  const t = history.map((s) => s.t);
  const tEnd = t[t.length - 1] ?? 0;
  const win = demo ? 60 : 180; // 보여 줄 창 [s]
  const from = history.findIndex((s) => s.t >= tEnd - win);
  const H = from > 0 ? history.slice(from) : history;
  const tt = H.map((s) => s.t);
  const col = (k: keyof (typeof H)[number]) => H.map((s) => s[k] as number | null);

  return (
    <div>
      <PageHeader title="실시간 그래프" back right={<span className="tabular pr-2 text-[11px] text-muted">{state === "online" ? "● 수신 중" : "연결 대기"} · 최근 {win}초</span>} />
      <div className="space-y-3 px-4 pt-3 pb-28">
        {H.length < 2 && <p className="card p-4 text-sm text-muted">데이터를 모으는 중이에요. 몇 초만 기다려 주세요.</p>}
        <LiveChart title="① 리드줄 장력" unit="N" t={tt}
          series={[{ key: "raw", label: "측정", color: "var(--color-dog-dark)", values: col("tension") }, { key: "f", label: "필터 F̂", color: "var(--color-sherpy-600)", values: col("filt") }]}
          thresholds={[{ v: THRESHOLDS.F_WARN, label: "L2 경고", color: "var(--color-level-2)" }, { v: THRESHOLDS.F_STOP, label: "L3 정지", color: "var(--color-level-3)" }]}
          note="F̂ = 1차 저역통과(τ 0.2 s). 경고·정지 판단은 F̂ 로 한다." />
        <LiveChart title="② 줄 길이 L 과 강아지 거리 d̂" unit="m" t={tt} yMin={0} yMax={THRESHOLDS.L_MAX + 0.4}
          series={[{ key: "L", label: "릴 L", color: "var(--color-sherpy-400)", values: col("reel") }, { key: "d", label: "거리 d̂", color: "var(--color-mint-700)", values: col("dist") }]}
          thresholds={[{ v: THRESHOLDS.L_MAX, label: "릴 최대", color: "var(--color-level-1)" }]}
          note="줄이 팽팽하면 d̂ ≈ L + F/k. 둘이 크게 벌어지면 줄이 걸렸거나 느슨한 것." />
        <LiveChart title="③ 강아지 방향각 θ̂" unit="° (+ 오른쪽)" t={tt}
          series={[{ key: "th", label: "θ̂", color: "var(--color-dog)", values: col("theta") }]}
          note="카메라 픽셀 → 왜곡 보정 → 장착각 보정 → 칼만 필터." />
        <LiveChart title="속도" unit="m/s" t={tt} yMin={0}
          series={[{ key: "c", label: "지령", color: "var(--color-sherpy-600)", values: col("vCmd") }, { key: "g", label: "GPS 실측", color: "var(--color-accent)", values: col("vGps"), dashed: true }]} />
        <LiveChart title="위치 불확실성 σ" unit="m" t={tt} yMin={0}
          series={[{ key: "s", label: "1σ", color: "var(--color-muted)", values: col("sigma") }]}
          note="카메라가 가려지면 커지고, 다시 보이면 줄어든다." />
        <LiveChart title="안전 단계" unit="L0~L3" t={tt} yMin={0} yMax={3.2}
          series={[{ key: "lv", label: "단계", color: "var(--color-level-2)", values: col("level") }]} />
      </div>
    </div>
  );
}
