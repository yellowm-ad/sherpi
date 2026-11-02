"use client";

import { useSim, DEFAULT_SETTINGS } from "../SimProvider";
import PageHeader from "@/components/ui/PageHeader";
import { ENV_LABEL, SCENARIO_LABEL, PARAM_SPECS, DEFAULT_PARAMS, type EnvKey, type ScenarioKey } from "@/lib/sherpy/params";

/** 실험 설정 — 모드·환경·시나리오·변수 13개·실전 모드 옵션. 바꾸면 40초를 다시 계산한다 */
export default function SimSettings() {
  const { s, set, setP } = useSim();
  const groups = [...new Set(PARAM_SPECS.map((x) => x[6]))];
  return (
    <div>
      <PageHeader title="실험 설정" back right={<button onClick={() => set(DEFAULT_SETTINGS)} className="touch px-2 text-xs font-semibold text-sherpy-600">기본값 복원</button>} />
      <div className="space-y-3 px-4 pt-3 pb-28">
        <section className="card p-3">
          <h2 className="text-sm font-bold">계산 모드</h2>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {([["ref", "기준 모드", "7.3 원본 그대로 — 로봇이 참값을 안다고 가정"], ["fusion", "실전 모드", "센서 원시값 → 보정 → 칼만 융합 → 판단 → 명령"]] as const).map(([k, t, d]) => (
              <button key={k} onClick={() => set({ mode: k })} aria-pressed={s.mode === k}
                      className={`press rounded-xl border p-3 text-left ${s.mode === k ? "border-sherpy-600 bg-sherpy-50" : "border-line"}`}>
                <p className="text-sm font-semibold">{t}</p><p className="mt-0.5 text-[11px] leading-snug text-muted">{d}</p>
              </button>
            ))}
          </div>
        </section>

        <section className="card p-3">
          <Chips label="실험 환경" value={s.env} options={ENV_LABEL} onPick={(v) => set({ env: v as EnvKey })} />
          <div className="mt-3"><Chips label="시험 시나리오" value={s.scenario} options={SCENARIO_LABEL} onPick={(v) => set({ scenario: v as ScenarioKey })} /></div>
          <p className="mt-2 text-[11px] text-muted">고장 시나리오는 14초에 주입됩니다. 급당김은 12~22초.</p>
        </section>

        {s.mode === "fusion" && (
          <section className="card p-3">
            <h2 className="text-sm font-bold">실전 모드 옵션</h2>
            <Chips label="릴 제어 방식" value={s.fusion.reelMode}
                   options={{ tension: "장력 제어 (예압 2 N)", flexi: "Flexi 태엽 릴 (팀 하드웨어)", position: "위치 제어 (7.3, d̂+0.04)", naive: "카메라 거리만 (비교용)" }}
                   onPick={(v) => set({ fusion: { ...s.fusion, reelMode: v as typeof s.fusion.reelMode } })} />
            <div className="mt-3"><Chips label="로봇 가감속" value={s.fusion.smoothAccel ? "smooth" : "bang"}
                   options={{ smooth: "레이트 리미터 (떨림 없음)", bang: "7.3 원본 (뱅뱅)" }}
                   onPick={(v) => set({ fusion: { ...s.fusion, smoothAccel: v === "smooth" } })} /></div>
            <div className="mt-3"><Chips label="L2 감속 규칙" value={s.fusion.l2Mode}
                   options={{ slow: "7.3 그대로 (≤0.2 m/s)", directional: "방향 고려 (당기는 중엔 감속 안 함)" }}
                   onPick={(v) => set({ fusion: { ...s.fusion, l2Mode: v as "slow" | "directional" } })} /></div>
            <div className="mt-3"><Chips label="예측 경고 (dT/dt · dL/dt)" value={s.fusion.predict ? "on" : "off"}
                   options={{ off: "끔 (7.3: 지금 장력만 봄)", on: "켬 (정지값·줄 끝 도달 1초 전 L2)" }}
                   onPick={(v) => set({ fusion: { ...s.fusion, predict: v === "on" } })} /></div>
            <label className="mt-3 flex items-center justify-between text-xs text-body">
              잡음 시드 (같은 시드 = 같은 결과)
              <input type="number" min={1} max={9999} value={s.fusion.seed} onChange={(e) => set({ fusion: { ...s.fusion, seed: Math.max(1, Number(e.target.value) || 1) } })}
                     className="tabular touch w-24 rounded-lg border border-line px-2 text-right" />
            </label>
          </section>
        )}

        {groups.map((g) => (
          <section key={g} className="card p-3">
            <h2 className="mb-1 text-sm font-bold">{g}</h2>
            {PARAM_SPECS.filter((x) => x[6] === g).map(([k, label, lo, hi, step, unit]) => (
              <label key={k} className="block py-1.5">
                <span className="flex items-baseline justify-between text-xs text-body">
                  {label}
                  <output className="tabular text-sm font-semibold text-ink">{s.p[k]}<small className="ml-0.5 text-[10px] font-normal text-muted">{unit}</small>
                    {s.p[k] !== DEFAULT_PARAMS[k] && <small className="ml-1 text-[10px] font-normal text-muted">(기본 {DEFAULT_PARAMS[k]})</small>}</output>
                </span>
                <input type="range" min={lo} max={hi} step={step} value={s.p[k]} aria-label={label}
                       onChange={(e) => setP(k, Number(e.target.value))} className="w-full accent-sherpy-600" />
              </label>
            ))}
          </section>
        ))}
        <p className="text-center text-[11px] text-muted">기본값 ≠ 실측 확정값 — 측정·부품 사양·실험으로 타당성을 확인해야 합니다. L2 &lt; L3 은 자동 유지.</p>
      </div>
    </div>
  );
}

function Chips({ label, value, options, onPick }: { label: string; value: string; options: Record<string, string>; onPick: (k: string) => void }) {
  return (
    <div>
      <p className="mb-1.5 text-xs text-muted">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {Object.entries(options).map(([k, l]) => (
          <button key={k} onClick={() => onPick(k)} className="chip touch" data-active={value === k}>{l}</button>
        ))}
      </div>
    </div>
  );
}
