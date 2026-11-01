import PageHeader from "@/components/ui/PageHeader";

export const metadata = { title: "수학 모델 · 셰르피" };

/**
 * 수학 모델 · 검증 — 장력 T, 길이 L, 방향각 θ 를 구하고 → 통합하고 → 판단해 → 명령하는 과정.
 * 수치는 scripts/verify-73.ts · scripts/verify-math.ts 실행 결과 (2026-11-01).
 */
const F = ({ children }: { children: React.ReactNode }) => (
  <code className="my-1 block overflow-x-auto rounded-lg bg-sherpy-50 px-3 py-2 font-mono text-[12px] leading-relaxed whitespace-pre text-sherpy-900">{children}</code>
);

function Sec({ n, title, children }: { n: string; title: string; children: React.ReactNode }) {
  return (
    <section className="card p-4">
      <h2 className="flex items-baseline gap-2 text-base font-bold"><span className="text-sherpy-600">{n}</span>{title}</h2>
      <div className="mt-2 space-y-2 text-[13px] leading-relaxed text-body">{children}</div>
    </section>
  );
}
function Hard({ q, a }: { q: string; a: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-level-1/30 bg-level-1/5 p-3">
      <p className="text-xs font-bold text-level-1">어려운 점 · {q}</p>
      <div className="mt-1 text-[12px] text-body">{a}</div>
    </div>
  );
}

export default function ModelPage() {
  return (
    <div>
      <PageHeader title="수학 모델 · 검증" back />
      <div className="space-y-3 px-4 pt-3 pb-28">
        <section className="card-lift p-4">
          <p className="text-xs font-semibold text-sherpy-600">0.04초(25 Hz)마다 한 바퀴</p>
          <p className="mt-1 text-lg font-bold leading-snug">센서 원시값 → ① 변수 구하기 → ② 통합 → ③ 안전 판단 → ④ 명령</p>
          <p className="mt-2 text-xs text-muted">웹 시뮬레이터(실전 모드)와 로봇(robot/sherpy_core)이 같은 계산을 한다. 파이썬 이식본은 TS 와 최대 9×10⁻¹² 차이로 일치.</p>
        </section>

        <Sec n="①-T" title="장력 — 로드셀 + HX711">
          <F>{`기준 힘  F_i = m_i·g
보정식   T = aX + b
최소제곱 min Σ[F_i − (aX_i + b)]²
  a = Σ(X−X̄)(F−F̄) / Σ(X−X̄)²,  b = F̄ − aX̄
필터     F̂ ← F̂ + α(z − F̂),  α = 1 − e^(−dt/τ)`}</F>
          <Hard q="영점 변화·장착 방향·반복 오차" a={<>평균을 빼고(중심화) 푼다 — HX711 원시값이 수백만이어도 정밀(검증: 오프셋 8×10⁶ 에서 a 오차 &lt;10⁻¹²). 하중 7점 × 10회 평균, R²·잔차·기울기 표준오차로 보정 품질을 수치로 남긴다. α 는 오일러 근사(dt/τ)가 아니라 정확한 이산화.</>} />
        </Sec>

        <Sec n="①-L" title="릴 인출길이 — AS5600">
          <F>{`단면적 보존  π(r² − r0²)·w = (Ltot − L)·t²
  ⇒ r(L)² = r0² + c(Ltot − L),  c = t²/(πw)
dL = r dφ 를 적분 (닫힌 해)
  φ − φ0 = (2/c)[r(L0) − r(L)]
  L = Ltot − (r² − r0²)/c,  r = r(L0) − (c/2)(φ − φ0)
언랩  Δ = ((raw − prev + 2048) mod 4096) − 2048`}</F>
          <Hard q="겹감김으로 반경 변화 · 회전 누적 · 미끄럼" a={<>Σ r_i·Δφ_i 근사 대신 닫힌 해 → 적분 오차 0 (심프슨 수치적분과 10⁻⁹ 일치). 반경 고정으로 계산하면 1.2→3.0 m 에서 <b>8.6 cm</b> 틀린다. 언랩은 한 주기에 반 바퀴 미만이어야 해서 f_s &gt; 2·v/(2πr) ≈ 8.3 Hz (25 Hz 로 3배 여유). 고착은 &ldquo;12bit 값이 25프레임 연속 똑같음&rdquo;으로 잡는다 — 정상 센서는 ±1 LSB 떨림이 있으므로 (HYST=0 설정 필수).</>} />
        </Sec>

        <Sec n="①-θ" title="방향각 — 카메라">
          <F>{`x_d = (u − c_x)/f_x
x_n + k1·x_n³ = x_d   (뉴턴법 3~4회)
θ = atan(x_n) + ψ_cam
거리(보조) d ≈ f_y·H / (h·cos θ_c)`}</F>
          <Hard q="가림·검출 흔들림·렌즈 왜곡·좌표 정렬" a={<>공식 1 의 θ ≈ atan((u−c_x)/f_x) 는 k1 = 0, ψ_cam = 0 인 특수해. 광각(화각 ≈100°)에서 왜곡을 무시하면 30° 에서 0.67° 틀린다 (역변환 오차 2×10⁻¹⁶ 로 검증). 가림·누락은 칼만 필터 예측으로 0.5초까지 버티고, 넘으면 L3.</>} />
        </Sec>

        <Sec n="②" title="통합 — 확장 칼만 필터">
          <F>{`상태 s = [x, y, vx, vy]   (강아지, 오도메트리 좌표)
예측 s⁻ = F s,  P⁻ = F P Fᵀ + Q(σ_a)
측정 θ = atan2(x_r, y_r)            (카메라)
     d = L + (T − 12·v_r⁺)/k        (줄 팽팽할 때)
     d ≤ L                          (느슨할 때 — 투영 제약)
     d_cam                          (σ 6%, 교차검증)
갱신 K = P⁻Hᵀ/(HP⁻Hᵀ + R),  NIS > 9 이면 버림`}</F>
          <Hard q="인출길이 L ≠ 강아지 직선거리 d" a={<>7.3 은 릴이 <b>참 거리 d</b> 를 안다고 가정(L목표 = d + 0.04)해서 줄이 거의 늘 느슨 — 실제론 d 를 모른다. 해법: 릴을 <b>장력 제어</b>(예압 2 N)로 바꿔 줄을 항상 살짝 팽팽하게 → d = L + T/k 가 mm 단위 측정이 된다. 줄이 장애물에 걸리면 줄 경로가 길어져 &ldquo;줄 거리 − 카메라 거리&rdquo; 잔차가 커진다 → 걸림 감지.</>} />
        </Sec>

        <Sec n="③" title="안전 판단 (페일세이프)">
          <ul className="space-y-1 text-[12px]">
            <li><b className="text-level-0">L0</b> 정상 추종</li>
            <li><b className="text-level-1">L1</b> 주의 — 표시만 (카메라 일시 가림, F̂ ≥ warn/2, 릴 한계 근접)</li>
            <li><b className="text-level-2">L2</b> F̂ ≥ 16 N → 명령속도 ≤ 0.2 m/s (해제는 14 N 아래 — 히스테리시스)</li>
            <li><b className="text-level-3">L3</b> HOLD 래치 — F̂ ≥ 35 N, 로드셀 0.2 s 무응답, 카메라 0.5 s 미검출, 엔코더 고착, 차체·줄 간섭, 경계 이탈, 줄 걸림. <b>자동 복귀 없음</b></li>
          </ul>
        </Sec>

        <Sec n="④" title="명령">
          <F>{`v = clamp(dogSpeed + 1.2(d̂ − followDist), 0, robotMax)
δ = clamp(1.4·θ̂, ±steerMax),   ψ̇ = (v/0.35)·tan δ
릴 L̇ = 0.03(T − 2) + v_r   (인출 ≤ 0.65, 회수 ≤ 0.5 m/s)`}</F>
        </Sec>

        <section className="card p-4">
          <h2 className="text-base font-bold">시뮬레이션으로 찾은 것</h2>
          <ol className="mt-2 list-decimal space-y-2 pl-4 text-[12px] leading-relaxed text-body">
            <li><b>경고 구간이 너무 짧다.</b> 줄 강성 550 N/m 에서 16 N → 35 N 통과 시간 0.08초(7.3) — 필터 τ 0.2초보다 짧아 L2 감속이 쓸모없다. 통과 시간 ≈ (stop − warn)/(k·Δv) 라 k 에 반비례: k 150 N/m(탄성 구간)면 실전 모드 경고 시간 1.08초.</li>
            <li><b>강아지가 당길 때 감속은 역효과.</b> 로봇이 느려지면 거리가 벌어져 장력이 더 오른다. &ldquo;방향 고려 L2&rdquo;(v_r &gt; 0 이면 감속 안 함) 옵션으로 비교 가능 — 기본값은 팀 결정 전까지 7.3 그대로.</li>
            <li><b>속도 떨림.</b> 7.3 가감속식은 목표 근처에서 25 Hz 로 ±0.04 m/s 왕복(40초 Σ|Δv| 44.7). 레이트 리미터로 0.66 (67배 부드러움).</li>
            <li><b>줄 충격.</b> 카메라 거리만으로 릴을 돌리면 원시 장력 16 N 급 순간 충격이 반복된다. 장력 제어 + 융합이면 최대 3.9 N.</li>
          </ol>
        </section>

        <section className="card overflow-hidden">
          <h2 className="border-b border-line bg-sherpy-50/60 px-4 py-2 text-base font-bold">검증</h2>
          <table className="w-full text-[12px]">
            <tbody className="divide-y divide-line">
              {[
                ["7.3 이식 = 원본 번들", "224 조합 × 1,001 프레임, 오차 0 (비트 단위)"],
                ["파이썬 = TS", "골든 로그 4종, 최대 9×10⁻¹²"],
                ["릴 닫힌 해", "수치적분과 10⁻⁹ 일치"],
                ["카메라 역변환", "−45~45°, 2×10⁻¹⁶ rad"],
                ["EKF 일관성 (NEES)", "평균 1.68 (기대 2, 약간 보수적)"],
                ["정상 산책 추적 오차", "위치 RMS 1.6 cm · θ 0.60°"],
                ["오경보 (몬테카를로)", "정상 산책 200회 중 L3 0회"],
                ["고장 감지", "로드셀 +0.20 s · 엔코더 0.96 s · 카메라 +0.48 s"],
              ].map(([a, b]) => <tr key={a}><td className="px-4 py-2 font-semibold">{a}</td><td className="tabular px-4 py-2 text-right text-body">{b}</td></tr>)}
            </tbody>
          </table>
          <p className="px-4 py-2 text-[11px] text-muted">npm run verify:73 · npm run verify:math 로 다시 확인할 수 있다. 기본값 ≠ 실측 확정값 — 부품·실험으로 확인 필요.</p>
        </section>
      </div>
    </div>
  );
}
