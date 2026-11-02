# 수학 모델 — 장력 T · 길이 L · 방향각 θ (SHERPY 7.3)

> 기준: 팀 자료 「셰르피 공식.png」(변수 획득) · 「셰르피 공식 2.png」(SHERPY 7.3 변수에서 안전 판단까지) · https://sherpy-simulator.vercel.app
> 코드: 웹 `src/lib/sherpy/` · 로봇 `robot/sherpy_core/` (같은 계산, 골든 테스트로 일치 확인)
> 팀 공유용 정리본(그림·출처 포함): https://claude.ai/artifact/BhhRnDqbvGEdx2iYCT48Z5

---

## 0. 한 사이클 (0.04초 = 25 Hz)

```
센서 원시값 → ① 변수 구하기 → ② 통합(EKF) → ③ 안전 판단 → ④ 명령 → 물리 → 다시 센서
 HX711 count    T = aX + b       강아지 x,y,     L0~L3          v, δ, L̇
 AS5600 12bit   L(φ) 닫힌 해     d̂, θ̂, 1σ
 카메라 u,h px  θ = atan(x_n)+ψ
```

`SherpyCore.step(packet)` 하나가 이 전부다 (`src/lib/sherpy/core/pipeline.ts`, `robot/sherpy_core/pipeline.py`).

---

## 1. 변수 구하기

### ① 장력 T — 로드셀 + HX711 (`core/calib.ts`)

```
기준 힘   F_i = m_i·g
보정식    T = aX + b
최소제곱  a = Σ(X−X̄)(F−F̄) / Σ(X−X̄)²,  b = F̄ − aX̄      ← 평균을 빼고 푼다(중심화)
필터      F̂ ← F̂ + α(T − F̂),  α = 1 − exp(−dt / max(0.025, τ))
```

- HX711 원시값은 수십만~수백만이라 중심화하지 않으면 ΣX² 에서 반올림 오차가 난다 (오프셋 8×10⁶ 에서도 기울기 오차 <10⁻¹² 확인).
- α 는 1차 저역통과의 **정확한 이산화**(오일러 근사 dt/τ 아님). τ 에서 63%, 3τ 에서 95%.
- 필터 두 갈래: 안전 판단용 τ = 0.2 s(7.3), 릴 제어용 τ = 0.05 s.
- 보정 절차: 줄 느슨하게 영점 → 하중 7점(0~4 kg) × 10회 평균 → a, b, R², RMSE 기록.

### ② 릴 인출길이 L — AS5600 (`core/reel.ts`)

공식 1 의 `L ≈ L0 + Σ r_eff,i Δφ_i` 는 근사라 반경이 바뀔 때마다 오차가 쌓인다. 감긴 줄 단면적 보존으로 닫힌 해를 얻는다.

```
π(r² − r0²)·w = (Ltot − L)·t²   ⇒  r(L)² = r0² + c(Ltot − L),  c = t²/(πw)
dL = r dφ 적분                  ⇒  φ − φ0 = (2/c)[r(L0) − r(L)]
역함수                          L = Ltot − (r² − r0²)/c,   r = r(L0) − (c/2)(φ − φ0)
언랩                            Δ = ((raw − prev + 2048) mod 4096) − 2048
```

- 반경 고정 가정이면 1.2 → 3.0 m 에서 **8.6 cm** 틀린다 (r0 25 mm, 줄 3 mm, 폭 30 mm 가정 — 실측 필요).
- 언랩 조건: 한 주기에 반 바퀴 미만 → f_s > 2·v_max/(2π·r_min) ≈ 8.3 Hz. 25 Hz 로 3배 여유.
- 고착 판정: 정상 센서는 ±1 LSB 떨림 → **동일 원시값 25프레임 연속 = 고착**. AS5600 `CONF.HYST = 00(OFF)` 필수. `STATUS` 의 MD/ML/MH 도 함께 확인.
- 보조 판정: "릴에 움직이라 했는데 25프레임 동안 측정이 전혀 안 움직임" (부하가 낮고 한계에 닿지 않았을 때만).

### ③ 방향각 θ — 카메라 (`core/camera.ts`)

```
x_d = (u − c_x)/f_x
x_n + k1·x_n³ = x_d          ← 뉴턴법 6회 (역변환 오차 2×10⁻¹⁶)
θ = atan(x_n) + ψ_cam        (+θ = 오른쪽, 로봇 전방 = +y)
거리(보조) d_cam = f_y·H_dog / h / cos θ_c
```

- 공식 1 의 `θ ≈ atan((u−c_x)/f_x)` 는 k1 = 0, ψ_cam = 0 인 특수해. 광각(Camera Module 3 Wide, 가로 102°)에서 왜곡 무시 시 30° 에서 0.67° 오차.
- 모델 값: 640 px 기준 f_x = 300, k1 = −0.08 → 화각 100.7°. **체커보드 보정(Zhang 2000)으로 f_x·c_x·k1·장착 요 실측 필요.**

---

## 2. 변수 통합 — 확장 칼만 필터 (`core/tracker.ts`)

상태 `s = [x, y, vx, vy]` (오도메트리 좌표의 강아지). 로봇 자세는 바퀴 속도 + 자이로 추측항법.

```
예측   s⁻ = F s,  P⁻ = F P Fᵀ + Q,   Q = σ_a²·[dt⁴/4, dt³/2; dt³/2, dt²]  (σ_a = 1.6 m/s²)
측정   θ      = atan2(x_r, y_r)                      카메라, σ ≈ 0.01 rad
       d      = L + (T_fast − 12·max(0, v_r))/k      줄이 팽팽할 때(T_fast > 1 N), σ ≈ 1 cm
       d ≤ L + 0.03                                  줄이 느슨할 때 — 넘으면 경계로 투영 (제약 KF)
       d_cam  σ = 6%·d + 4 cm                        교차검증
갱신   K = P⁻Hᵀ/S,  P = (I−KH)P⁻(I−KH)ᵀ + KRKᵀ       조셉 형식 (대칭·양정치 유지)
게이트 NIS = ν²/S > 9 이면 버림
```

### L ≠ d 문제의 해법 — 릴 장력 제어

7.3 의 `L목표 = clamp(d새 + 0.04, 1.2, reelMax)` 는 릴이 **참 거리 d 를 안다고 가정**한다. 7.3 정상 산책에서 줄이 팽팽한 프레임은 0% — 로드셀이 늘 0 을 읽어 거리 정보가 없다.

```
장력 제어   L̇ = 0.03·(T_fast − T_ref) + v_r,   T_ref = 2 N   (인출 ≤ 0.65, 회수 ≤ 0.5 m/s, HOLD 중 인출 금지)
```

줄이 늘 2 N 으로 살짝 팽팽 → `d = L + T/k` 가 mm 단위 측정 → 순환 의존이 끊긴다.
2 N 은 보호자가 실제로 유지하는 리드줄 장력 2~4 N(Hunter et al. 2019)과 같은 수준.

### 팀 하드웨어 반영 (2026-11-02) — Flexi 태엽 릴 · 예측 경고

팀 아이디어 보드의 실제 구성(강아지 → Flexi → SBA-50L → HX711, Flexi 스풀 + 자석 + AS5600, PCA9685 → SCX6 조향서보 + ESC)은
7.3 의 "모터 릴(인출 0.65·회수 0.5 m/s 제어)" 가정과 다르다. 그래서 실전 모드에 두 가지를 추가했다 (기본값은 꺼짐 — 7.3·골든 결과 불변).

```
Flexi 릴 (reelMode "flexi", world.passive)
  ℓ ≤ L_cap, 팽팽   T = T_s(ℓ) + c_s·max(0, v_r),   T_s(L) = 1.5 + 0.5·L [N],  c_s = 2 N·s/m
  ℓ > L_cap         T = T_s(L_cap) + k(ℓ − L_cap) + 12·max(0, v_r)      L_cap = 잠김 ? L : reelMax
  ℓ < L (회수 지연)  T = 0,  L ← max(ℓ, L − v_ret·dt),  v_ret = 1.5 m/s
  릴 명령 = 0 (모터 없음).  d_rope = L + max(0, T − T_s(L) − 12·v_r)/k

예측 경고 (predict, safety.ts)
  dT̂/dt, dL/dt = 후진차분 → τ 0.1 s 저역통과
  t_T = (stop − T̂)/(dT̂/dt)   (dT̂/dt > 0.5 N/s, T̂ ≥ warn/2)
  t_L = (reelMax − L)/(dL/dt)  (dL/dt > 0.2 m/s, L ≥ 0.6·reelMax)
  min(t_T, t_L) < 1.0 s → L2 (0.5 s 유지)
```

`npx tsx scripts/compare-modes.ts` (공원·급당김, k = 550 / 150 N/m):

| 구성 | 경고 여유 (L3 − L2) | L3 직전 최대 장력 | 정지 후 최대 |
|---|---|---|---|
| 7.3 기준 | 0.08 s / 0.28 s | 60.1 / 46.5 N | 97.5 / 75.0 N |
| 장력 릴 + 예측 | 2.28 / 1.00 s | 43.2 / 42.5 N | 104.5 / 73.4 N |
| 장력 릴 + 예측 + 방향 L2 | 2.92 / 2.32 s | 55.2 / 35.7 N | 86.4 / 72.6 N |
| Flexi + 예측 + 방향 L2 | 1.28 / 2.40 s | 53.9 / 35.8 N | 86.8 / 72.6 N |

정상 산책 몬테카를로 100회(환경 4 × 시드 25): 예측 경고 켜도 L2·L3 오경보 0.
예측 경고만 켜고 7.3 감속(≤0.2 m/s)을 그대로 두면 강아지가 앞에서 당길 때 정지 후 장력이 더 커진다(Flexi 122 N) → **예측 경고는 방향 고려 L2 와 같이 써야 한다.**

### 줄 걸림 감지 (지도 없이)

줄이 장애물을 감으면 줄 경로 ℓ 이 직선 d 보다 길다 (`world.ts wrappedPath`: ℓ = √(|AO|²−R²) + √(|BO|²−R²) + R·호각).
잔차 `r = d_rope − d_cam` 를 τ 0.3 s 로 평활해 `r > max(0.3 m, 0.12·L)` 이 0.4 s 이어지면 L3.

### 가림

카메라를 못 보면 예측 + 줄 거리로 버틴다. 0.2 s 부터 속도 추정을 exp(−dt/0.8) 로 감쇠(옆으로 떠내려가지 않게). 0.5 s 넘으면 L3.

---

## 3. 안전 판단 (`core/safety.ts`)

| 단계 | 조건 | 동작 |
|---|---|---|
| L0 | 정상 | — |
| L1 | 카메라 일시 가림, F̂ ≥ warn/2(8 N), L ≥ 0.92·reelMax, 위치 1σ > 25 cm | 표시만 |
| L2 | F̂ ≥ 16 N (해제는 14 N 미만 — 히스테리시스) | 명령속도 ≤ 0.2 m/s |
| L3 | F̂ ≥ 35 N · 로드셀 0.2 s 무응답 · 카메라 0.5 s 미검출 · 엔코더 고착 · 차체/줄 간섭 · 경계 이탈 · 줄 걸림 | **HOLD 래치**: 속도 0, 릴 인출 금지, **자동 복귀 없음** (원인 해소 후 사용자 재개) |

보고 우선순위: 센서 → 기하 → 줄 걸림 → 장력. 7.3 은 센서 고장을 한 프레임 즉시 판정했지만, 실기에서는 순간 누락 오경보를 막으려 시간 기준으로 판정한다.

---

## 4. 명령 (`core/pipeline.ts`)

```
v = clamp(dogSpeed + 1.2(d̂ − followDist), 0, robotMax)     L2 → min(v, 0.2), L3 → 0
δ = clamp(1.4·wrap(Pu − ψ̂), ±steerMax),  Pu = atan2(x̂ − x_r, max(0.2, ŷ − y_r))
ψ̇ = (v/0.35)·tan δ                                          운동학 자전거 모델
가감속  v ← v + clamp(v명령 − v, −1.9dt, +0.85dt)           ← 레이트 리미터 (7.3 원본은 뱅뱅 → 떨림)
```

---

## 5. 시뮬레이션으로 찾은 것 (공원·정상 산책·40초)

| # | 발견 | 수치 | 제안 |
|---|---|---|---|
| 1 | L2 경고 구간이 너무 짧다 | k 550: 경고→정지 0.08 s(7.3) / 0.16 s(실전). k 150: 1.08 s | 리드줄 탄성 구간으로 k 낮추기 (PRD §16-x) |
| 2 | 강아지가 당길 때 감속은 역효과 | 방향 고려 L2: L3 16.52 → 17.24 s, 최대 81 → 78 N | 효과 작음 — 1번 먼저 |
| 3 | 7.3 가감속 떨림 | 40초 Σ\|Δv\| 44.7 → 0.66 | 레이트 리미터 |
| 4 | 릴이 거리를 쫓으면 순간 충격 | 원시 장력 최대 16.2 N → 3.9 N(장력 제어) | 장력 제어 릴 |

고장 감지 (공원, 14초 주입):

| 시나리오 | 7.3 | 실전 | 이유 |
|---|---|---|---|
| 정상 | 없음 | 없음 | 몬테카를로 200회 오경보 0 |
| 로드셀 단절 | 14.00 s | 14.20 s | 0.2 s 무응답 |
| 엔코더 고착 | 14.96 s | 14.96 s | 동일값 25프레임 |
| 카메라 실패 | 14.00 s | 14.48 s | 0.5 s 예측 유지 |
| 급당김 | 14.60 s | 15.08 s | 릴 3.0 m 한계 후 장력 정지 |
| 장애물 반대 회피 | 11.56 s 줄 걸림 | 9.76 s 카메라 | 나무 뒤 가림 (7.3 에 가림 모델 없음) |

---

## 6. 검증

```bash
npm run verify:73     # 7.3 원본 번들(scripts/fixtures/sherpy73-reference.mjs)과 224조합 × 1,001프레임 대조 → 오차 0
npm run verify:math   # 단위검증 + 시나리오 표 + 몬테카를로 + 골든 로그 생성 → 파이썬 대조
```

| 항목 | 결과 |
|---|---|
| 7.3 이식 = 원본 | 오차 0 (비트 단위) |
| 파이썬 = TS | 골든 4종 최대 9×10⁻¹², 단계 불일치 0 |
| 릴 닫힌 해 vs 심프슨 적분 | 10⁻⁹ |
| 카메라 역변환 | 2×10⁻¹⁶ rad |
| EKF NEES (정지 표적 200회) | 1.68 (기대 2, 약간 보수적) |
| 정상 산책 추적 | 위치 RMS 1.6 cm · θ 0.60° |

---

## 7. 파일 지도

| 웹 (TS) | 로봇 (Python) | 내용 |
|---|---|---|
| `src/lib/sherpy/params.ts` | `robot/sherpy_core/params.py` | 변수 13개 · 7.3 상수 · 하드웨어 가정값 |
| `src/lib/sherpy/world.ts` | — | 7.3 물리 (기준 모드) + 줄 감김 |
| `src/lib/sherpy/core/*.ts` | `robot/sherpy_core/*.py` | 보정·릴·카메라·EKF·안전·파이프라인 |
| `src/lib/sherpy/simulate.ts` | — | 기준/실전 실행기, 센서 모델 |
| `src/lib/sherpy/live.ts` | — | 시연 가상 로봇용 끝없는 산책 |
| `src/lib/sherpy/geo.ts` | — | 로봇 GPS + 방위 + θ·d → 강아지 위경도 |

**규칙**: `core/` 를 바꾸면 파이썬도 같이 바꾸고 `npm run verify:math` 로 골든 대조를 통과시킨다.

## 8. 출처

- ams, AS5600 Datasheet v1-06 (2018) — 12bit, CONF.HYST, STATUS MD/ML/MH, I²C 1 MHz
- Avia, HX711 Datasheet — 10/80 SPS, DOUT LOW = 준비
- Raspberry Pi, Camera Module hardware — Module 3 Wide 가로 102°
- Z. Zhang, "A flexible new technique for camera calibration," IEEE TPAMI 22(11), 2000
- D. C. Brown, "Decentering distortion of lenses," Photogrammetric Eng. 32(3), 1966
- R. E. Kalman, J. Basic Eng. 82(1):35–45, 1960
- Y. Bar-Shalom, X. R. Li, T. Kirubarajan, Estimation with Applications to Tracking and Navigation, Wiley 2001
- D. Simon, "Kalman filtering with state constraints," IET Control Theory & Appl. 4(8), 2010
- J. Kong et al., "Kinematic and dynamic vehicle models for autonomous driving control design," IEEE IV 2015
- A. Hunter, S. Blake, R. Ferro de Godoy, Vet. Anim. Sci. 8, 2019, doi:10.1016/j.vas.2019.100082 — 리드줄 2~4 N, 목 평균 최대 30.2 N
