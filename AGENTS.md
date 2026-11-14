# AI 에이전트 작업 규칙

안티그래비티(Antigravity) 등에서 이 저장소를 작업할 때 지켜야 할 규칙.
먹메이트에서 쓰던 방식을 그대로 가져왔습니다.

---

## 0. 시작 전

1. **[docs/PRD.md](docs/PRD.md)를 먼저 읽는다.** 기능 번호(F-1~F-9)와 화면 번호(S01~S16)가
   코드 주석에 그대로 쓰여 있다.
2. 작업할 마일스톤(M0~M8)을 확인한다. PRD §13에 순서가 있다.
3. 하나의 커밋은 하나의 화면 또는 하나의 API 라우트로 끝낸다.

---

## 1. 절대 하지 말 것

- `.env.local` 을 커밋하지 않는다. `.env.example` 만 갱신한다.
- API 키를 클라이언트 번들에 넣지 않는다.
  외부 API(기상청·에어코리아)는 **반드시 `/api/*` 라우트로 프록시**한다.
  `NEXT_PUBLIC_` 접두사는 카카오맵 JS 키와 영상 주소에만 쓴다.
- **안전 관련 코드를 임의로 바꾸지 않는다.**
  `src/lib/robot/types.ts` 의 `THRESHOLDS` 는 로봇의 `walkbot/config.py`·`robot/bridge/config.py`·
  `robot/sherpy_core/params.py` 와 같은 값이어야 한다 (SHERPY 7.3: 경고 16 N · 정지 35 N · 릴 1.2~3.0 m). 한쪽만 바꾸면 앱 표시와 로봇 동작이 어긋난다.
- 원격 정지를 **1차 안전장치로 설명하는 문구를 쓰지 않는다.** 보조 수단이다.
  1차 안전장치는 **본체 ESC 전원 스위치**(모터 전원 차단)다. GPIO17 E-stop 버튼은 선택 사항 (2026-11-14 결정).
- 마켓·인구밀집도에 실제 API를 붙이지 않는다. **명목상 기능**으로 확정됐다 (PRD §3-2).

---

## 2. 코드 규칙

- 경로 별칭은 `@/*` → `src/*`
- 서버 컴포넌트가 기본. `"use client"` 는 상태·이벤트가 필요할 때만.
- DB 접근은 `@/db` 의 `db` 인스턴스만 쓴다. 라우트에서 `neon()` 을 직접 부르지 않는다.
- 입력 검증은 **zod**. `src/lib/robot/types.ts` 의 스키마를 재사용한다.
- 숫자를 실시간으로 갱신해 보여주는 곳에는 반드시 `className="tabular"` 를 붙인다.
  (고정폭 숫자 — 값이 바뀔 때 레이아웃이 흔들리지 않게)
- 색상은 하드코딩하지 않는다. `globals.css` 의 토큰(`--color-sherpy-600` 등)을 쓴다.

---

## 3. 모바일 전용 규칙

- 최소 터치 영역 44×44 → `className="touch"`
- 좌우 여백 16px(`px-4`) 고정, **가로 스크롤 금지**
- 하단 탭이 가리지 않게 본문에 `pb-20`
- 세이프에어리어는 `pb-safe`
- 최대 폭 480px (`max-w-[480px]`) — 데스크톱에서도 모바일 레이아웃 유지
- **레이어 분리**: 첫 화면은 보호자 눈높이로 핵심만(지도·탑뷰·카메라·위험 요약), 그래프·수치·제어는 폴더(하위 경로)로 나눈다.
  한 화면에 그래프를 몰지 않는다. 하위 화면이 공유할 상태는 `layout.tsx` 의 Provider 에 둔다 (`RobotProvider`, `SimProvider`).
- 보호자용 문구는 쉬운 말이 먼저, 기호(F̂, θ̂)는 작게 보조로. 시뮬레이션·수학 모델은 "개발·검증(팀용)" 묶음에 둔다.

---

## 4. 로봇 연동을 건드릴 때

실제 로봇 없이 개발하려면:

```bash
npm run dev          # 터미널 1
npm run mock:robot   # 터미널 2
```

모의 로봇이 1Hz로 텔레메트리를 쏘고 명령을 ack한다.
**실로봇이 없다고 해서 M2 작업을 멈추지 말 것.** PRD §13에 명시된 리스크 회피책이다.

API를 바꾸면 세 곳을 같이 고쳐야 한다:

| 바꾸는 곳 | 같이 고쳐야 할 곳 |
|---|---|
| `src/lib/robot/types.ts` 스키마 | `scripts/mock-robot.ts`, `robot/bridge/telemetry.py` |
| 명령 타입 추가 | `scripts/mock-robot.ts` 핸들러, `robot/bridge/commands.py` |
| `THRESHOLDS` | 로봇 `walkbot/config.py`, `robot/bridge/config.py`, `robot/sherpy_core/params.py` |
| `src/lib/sherpy/core/*` (수학 파이프라인) | `robot/sherpy_core/*.py` — 바꾼 뒤 `npm run verify:math` 통과 필수 |
| `src/lib/sherpy/world.ts` (7.3 물리) | `npm run verify:73` 으로 원본과 오차 0 확인 |

---

## 5. 커밋

```
feat(robot): 장력 게이지 임계선 표시
fix(weather): 격자 변환에서 경도 보정 누락
docs(prd): 릴 구조 확인사항 추가
chore(db): 텔레메트리 인덱스 추가
```

작업 단위로 깃허브에 push해 중간 저장한다.

---

## 6. 막혔을 때

- 외부 API 키가 없어 막히면 → 해당 라우트가 **503과 안내 메시지**를 반환하게 두고 넘어간다.
  앱 전체가 죽으면 안 된다.
- 스펙이 PRD에 없으면 → 임의로 정하지 말고 `docs/PRD.md` 에 **"확인 필요"** 로 적어 남긴다.
