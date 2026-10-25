# 디자인 시스템

> **강아지를 자유롭게** — Modern Soft-Tech (2026-10-25 스티치 안 반영)

원본: 저장소 루트의 `DESIGN.md`(스티치 디자인 시스템), `code.html`(스티치 홈 시안), `로고 디자인.png`.
먹메이트(살구 오렌지·진갈색·크림)와 명확히 구분되는 톤입니다.

---

## 컬러 토큰

정의는 `src/app/globals.css` 의 `@theme` 블록.
**색상을 하드코딩하지 말고 토큰을 쓰세요.** 카카오맵처럼 CSS 변수를 못 읽는 곳만 `MAP_COLOR`(`components/map/RouteMap.tsx`)·`CROWD_HEX` 를 씁니다.

| 토큰 | 값 | 용도 |
|---|---|---|
| `--color-sherpy-600` | `#2B66FF` | Primary Cobalt. 버튼, 활성 탭, GPS 경로 |
| `--color-sherpy-700` | `#1E4ED8` | Deep Cobalt. 눌림, 강조 라벨 |
| `--color-sherpy-400` | `#6E8EFF` | 그라데이션 끝, 선택 안 된 코스 선 |
| `--color-sherpy-100` | `#DCE1FF` | 파란 배경 위 보조 글자 |
| `--color-sherpy-50` | `#EFF6FF` | surface-subtle — 지표 카드·팁 |
| `--color-mint` | `#00D287` | Emerald Mint 점·면 (여유·안정·출발점) |
| `--color-mint-700` | `#006D43` | 흰 바탕 위 민트 글자 (원색은 글자 대비 부족) |
| `--color-mint-50` | `#ECFDF5` | 민트 배경 (좋은 신호) |
| `--color-accent` | `#00875A` | 주행 중 / 자동주행 가능 |
| `--color-surface` | `#FFFFFF` | 카드 |
| `--color-bg` | `#F8FAFC` | 페이지 배경 |
| `--color-line` | `#E2E8F0` | 테두리, 구분선 |
| `--color-ink` | `#1A202C` | 제목 (순검정 대신 차콜 네이비) |
| `--color-body` | `#434655` | 본문 |
| `--color-muted` | `#64748B` | 보조 |

### 그림자 · 모양

| 이름 | 쓰는 곳 |
|---|---|
| `shadow-soft` (Level 1) | `.card` 기본 — 목록·비활성 카드 |
| `shadow-lift` (Level 2) | `.card-lift`, 히어로, 검색창 — 지금 봐야 하는 것 |
| `shadow-float` (Level 3) | 바텀시트, 드롭다운, 비상 버튼 |
| 반경 16px | `.card` |
| 반경 24px | `.card-lift`, 히어로, 하단 탭 상단 |
| 알약(full) | 버튼, 칩(`.chip`), 검색창, 상태 배지 |

### 공용 클래스

- `.chip` / `.chip[data-active="true"]` — 필터·장소 칩
- `.metric` — 지표 숫자 (24px / 800 / -0.02em, 고정폭)
- `AppHeader` — 로고 + 셰르피 연결 알약 (홈)
- `RouteThumb` — 코스 카드 머리의 실제 코스 모양 썸네일

### 안전등급 (로봇 대시보드 전용)

| 등급 | 토큰 | 값 | 의미 |
|---|---|---|---|
| L0 | `--color-level-0` | `#00A86B` | 정상 |
| L1 | `--color-level-1` | `#D97706` | 주의 |
| L2 | `--color-level-2` | `#EA580C` | 경고 |
| L3 | `--color-level-3` | `#EF4444` | 정지 |

> **접근성**: 안전등급을 색상만으로 구분하지 마세요.
> `SafetyBadge` 처럼 `L2 · 경고` 식으로 **텍스트를 함께** 씁니다.

---

## 타이포그래피

- 라틴·숫자: **Plus Jakarta Sans** (DESIGN.md), 한글: **Pretendard** — Jakarta 에 한글이 없어서 둘을 겹쳐 쓴다
- 실시간으로 갱신되는 숫자에는 **반드시** `className="tabular"` 를 붙입니다.

```tsx
<p className="tabular text-lg font-semibold">{tension.toFixed(1)} N</p>
```

고정폭 숫자를 쓰지 않으면 값이 바뀔 때마다 폭이 흔들려서 화면이 떨립니다.
장력 게이지처럼 1초에 한 번 갱신되는 곳에서는 특히 눈에 띕니다.

---

## 모바일 전용 규칙

| 규칙 | 구현 |
|---|---|
| 최소 터치 영역 44×44 | `className="touch"` |
| 좌우 여백 16px 고정 | `className="px-4"` |
| 가로 스크롤 금지 | `body { overflow-x: hidden }` (globals.css) |
| 하단 탭에 가리지 않게 | 본문에 `pb-20` |
| 세이프에어리어 | `className="pb-safe"` |
| 최대 폭 | `max-w-[480px]` — 데스크톱에서도 모바일 레이아웃 유지 |

다크모드는 v1 미지원입니다. 다만 색을 전부 토큰으로 정의해뒀으니
나중에 `@media (prefers-color-scheme: dark)` 블록만 추가하면 됩니다.

---

## 컴포넌트

| 컴포넌트 | 파일 | 설명 |
|---|---|---|
| `TensionGauge` | `components/robot/TensionGauge.tsx` | 반원 게이지. 임계선 3개(8/30/40N), 색이 안전등급을 따라감 |
| `LeashBar` | `components/robot/LeashBar.tsx` | 줄 길이 0~5m 바, 구간별 색상 |
| `SafetyBadge` | `components/robot/SafetyBadge.tsx` | L0~L3 배지 + 고장코드 설명 |
| `EstopButton` | `components/robot/EstopButton.tsx` | 플로팅 긴급정지. **1초 길게 누르기** |
| `BottomTabs` | `components/ui/BottomTabs.tsx` | 하단 탭 5개, 중앙(셰르피) 강조 |
| `RouteMap` | *(M4에서 작성)* | 카카오맵 래퍼 — 코스 그리기 / 궤적 표시 공용 |
| `WalkScoreCard` | *(M5에서 작성)* | 홈 상단 날씨·점수 카드 |

---

## 톤 & 문구

- 보호자에게 말하듯, 짧고 담백하게. 과한 감탄사·이모지 남발 금지
- 안전 관련 문구는 **애매하게 쓰지 않습니다**
  - ✅ "원격 정지는 보조 수단입니다. 긴급 상황에서는 로봇 본체의 물리 정지 버튼을 사용하세요."
  - ❌ "안전하게 원격으로 정지할 수 있어요!"
- 명목상 기능에는 `준비 중인 기능입니다` / `시연용 데이터` 를 명시합니다
