"use client";

import { useRobot } from "../RobotProvider";
import PageHeader from "@/components/ui/PageHeader";
import { FAULT_LABEL, SAFETY_LABEL } from "@/lib/robot/types";

/** 실시간 수치 레이어 — 텔레메트리 전체를 의미별로 묶어 보여 준다 */
export default function RobotNumbers() {
  const { latest, state, dogGeo, demo } = useRobot();
  const L = latest;
  const th = L?.dogBearingDeg, d = L?.dogDistM;
  const xr = th != null && d != null ? d * Math.sin((th * Math.PI) / 180) : null;
  const yr = th != null && d != null ? d * Math.cos((th * Math.PI) / 180) : null;
  const f = (v: number | null | undefined, n = 2) => (v == null ? "—" : v.toFixed(n));

  const groups: { title: string; hint?: string; rows: [string, string, string?][] }[] = [
    { title: "① 장력 T", hint: "로드셀 → HX711 → T = aX + b → 저역통과", rows: [
      ["측정 장력", f(L?.tensionN), "N"], ["필터 장력 F̂ (안전 판단)", f(L?.tensionFiltN), "N"],
    ] },
    { title: "② 릴 인출길이 L", hint: "AS5600 회전각 → 겹감김 반경 모델", rows: [["L", f(L?.leashLenM, 3), "m"]] },
    { title: "③ 방향각 θ", hint: "카메라 픽셀 → 왜곡·장착각 보정", rows: [
      ["θ̂ (+ 오른쪽)", f(th, 1), "°"], ["추적 상태", L?.dogTrack === "ok" ? "추적 중" : L?.dogTrack === "coast" ? "가림 · 예측" : L?.dogTrack === "lost" ? "실패" : "—"],
    ] },
    { title: "통합 — 강아지 위치 (로봇 기준)", hint: "칼만 필터: θ·L·T·카메라 거리 결합", rows: [
      ["거리 d̂", f(d, 3), "m"], ["오른쪽 x̂", f(xr, 3), "m"], ["전방 ŷ", f(yr, 3), "m"], ["위치 1σ", L?.dogSigmaM != null ? (L.dogSigmaM * 100).toFixed(1) : "—", "cm"],
    ] },
    { title: "지도 위치 (GPS)", rows: [
      ["로봇", L?.lat != null ? `${L.lat.toFixed(6)}, ${L.lng!.toFixed(6)}` : "—"],
      ["강아지 (추정)", dogGeo ? `${dogGeo.lat.toFixed(6)}, ${dogGeo.lng.toFixed(6)}` : "—"],
      ["강아지 위치 반경", dogGeo ? dogGeo.radius.toFixed(1) : "—", "m"],
      ["진행 방위", f(L?.headingDeg, 0), "°"], ["위성 수", L?.gpsSats != null ? String(L.gpsSats) : "—", "개"],
    ] },
    { title: "명령", rows: [
      ["속도 지령", f(L?.speedCmd), "m/s"], ["GPS 실측 속도", f(L?.speedMps), "m/s"], ["조향 (−1 좌 ~ +1 우)", f(L?.steerCmd)],
    ] },
    { title: "안전 · 시스템", rows: [
      ["안전 단계", L ? `L${L.safetyLevel} ${SAFETY_LABEL[L.safetyLevel]}` : "—"], ["모드", L?.mode ?? "—"],
      ["고장 코드", L?.faults.length ? L.faults.map((c) => `${c} ${FAULT_LABEL[c] ?? ""}`).join(", ") : "없음"],
      ["경로 매칭 신뢰도", f(L?.matchQuality)], ["키프레임", L?.kfTotal ? `${L.kfIndex} / ${L.kfTotal}` : "—"],
      ["배터리", L?.batteryV != null ? L.batteryV.toFixed(1) : "—", "V"], ["연결", { connecting: "연결 중", online: "온라인", stale: "지연", offline: "끊김" }[state] + (demo ? " (시연)" : "")],
      ["마지막 수신", L ? new Date(L.ts).toLocaleTimeString("ko-KR") : "—"],
    ] },
  ];

  return (
    <div>
      <PageHeader title="실시간 수치" back />
      <div className="space-y-3 px-4 pt-3 pb-28">
        {groups.map((g) => (
          <section key={g.title} className="card overflow-hidden">
            <div className="border-b border-line bg-sherpy-50/60 px-3 py-2">
              <h2 className="text-sm font-bold">{g.title}</h2>
              {g.hint && <p className="text-[11px] text-muted">{g.hint}</p>}
            </div>
            <dl className="divide-y divide-line">
              {g.rows.map(([k, v, u]) => (
                <div key={k} className="flex items-baseline justify-between gap-3 px-3 py-2">
                  <dt className="text-xs text-body">{k}</dt>
                  <dd className="tabular text-right text-sm font-semibold text-ink">{v}{u && <small className="ml-0.5 text-[11px] font-normal text-muted">{u}</small>}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </div>
  );
}
