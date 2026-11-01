# 개발 환경 설치 (Windows 기준)

C드라이브에 그대로 풀어서 쓰면 됩니다.

---

## 1. 위치

```
C:\dev\sherpy\
```

> **경로에 한글·공백을 넣지 마세요.** `C:\Users\홍길동\바탕 화면\...` 같은 경로는
> npm 스크립트와 Python 가상환경에서 간헐적으로 깨집니다.
> OneDrive로 동기화되는 폴더(`C:\Users\<이름>\OneDrive\...`)도 피하세요 —
> `node_modules` 가 수십만 개 파일이라 동기화가 멈춥니다.

---

## 2. 필요한 것

| 도구 | 버전 | 비고 |
|---|---|---|
| Node.js | 20 LTS 이상 | https://nodejs.org |
| Git | 최신 | https://git-scm.com |
| Neon 계정 | 무료 | https://console.neon.tech |
| 안티그래비티 | — | 먹메이트에서 쓰던 IDE |

확인:

```powershell
node -v    # v20.x 이상
npm -v
git --version
```

---

## 3. 설치

```powershell
cd C:\dev\sherpy
npm install
```

---

## 4. 환경변수

`.env.example` 을 복사해서 `.env.local` 을 만듭니다.

```powershell
copy .env.example .env.local
notepad .env.local
```

### 4-1. DATABASE_URL (필수)

1. https://console.neon.tech 에서 프로젝트 생성 (region은 **Singapore** 권장 — 한국에서 가장 가까움)
2. Connection string 복사 → `DATABASE_URL` 에 붙여넣기

### 4-2. SESSION_SECRET (필수)

아무 긴 랜덤 문자열이면 됩니다.

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 4-3. NEXT_PUBLIC_KAKAO_MAP_KEY (M4부터 필요)

1. https://developers.kakao.com → 내 애플리케이션 → 추가
2. 앱 이름 `셰르피`
3. 플랫폼 → Web → 사이트 도메인에 `http://localhost:3000` 과 배포 주소 등록
4. 앱 키 → **JavaScript 키** 복사

> 먹메이트 때 네이버에서 카카오로 바꿨던 그 API입니다. 같은 계정 재사용 가능.

### 4-4. DATA_GO_KR_SERVICE_KEY (M5부터 필요)

1. https://www.data.go.kr 회원가입
2. [기상청_단기예보 조회서비스](https://www.data.go.kr/data/15084084/openapi.do) 활용신청
3. 에어코리아 대기오염정보도 같은 방식으로 신청
4. 마이페이지 → 인증키에서 **일반 인증키(Decoding)** 복사

> **승인에 1~3일 걸립니다.** M5 시작 전에 미리 신청해두세요.
> 자동승인인 경우도 있지만 보장되지 않습니다.

---

## 5. DB 스키마 반영

```powershell
npm run db:push     # Neon에 테이블 생성
npm run seed        # 개발 계정 + 로봇 1대 + 더미 데이터
```

시드가 끝나면 로그인 계정이 생깁니다: `dev` / `dev1234`

테이블을 눈으로 보고 싶으면:

```powershell
npm run db:studio
```

---

## 6. 실행

터미널 **두 개**를 띄웁니다.

```powershell
# 터미널 1 — 웹 서버
npm run dev
```

```powershell
# 터미널 2 — 모의 로봇 (실제 로봇 없이 대시보드를 움직이게 함)
npm run mock:robot
```

→ http://localhost:3000/robot

DB 가 없으면(`/api/health` db:false) 브라우저 안의 **시연 가상 로봇**이 SHERPY 7.3 물리 + 처리 파이프라인으로 움직입니다 (모의 로봇 없이도 됨).
시뮬레이션 랩: http://localhost:3000/sim

수학 모델 검증 (로봇 코드 바꾼 뒤 필수):

```powershell
npm run verify:73      # 7.3 원본과 이식본 비트 단위 대조
npm run verify:math    # 단위검증 + 시나리오 + 몬테카를로 + 파이썬 골든 대조
```

모의 로봇이 이런 시나리오를 재현합니다:

```
0~5초    대기
5~35초   티칭 (키프레임 쌓임)
35초~    자동주행
20초마다 개가 강하게 당김 → L2 경고 (16 N↑, SHERPY 7.3)
```

---

## 7. 배포 (Vercel)

```powershell
npm i -g vercel
vercel login
vercel link
vercel env add DATABASE_URL production
vercel env add SESSION_SECRET production
vercel env add DATA_GO_KR_SERVICE_KEY production
vercel env add NEXT_PUBLIC_KAKAO_MAP_KEY production
vercel --prod
```

> 카카오 개발자센터의 **사이트 도메인에 배포 주소를 추가**하는 걸 잊지 마세요.
> 안 하면 지도가 빈 화면으로 뜹니다. 먹메이트에서 한 번 겪었던 문제입니다.

---

## 8. 자주 막히는 지점

| 증상 | 원인 / 해결 |
|---|---|
| `DATABASE_URL 이 설정되지 않았습니다` | `.env.local` 파일명 확인. `.env.local.txt` 로 저장되는 경우가 많음 |
| 지도가 빈 화면 | 카카오 사이트 도메인 미등록 |
| `/api/weather` 503 | `DATA_GO_KR_SERVICE_KEY` 미설정. **앱은 계속 동작하는 게 정상** |
| 모의 로봇 401 | `.env.local` 의 `MOCK_ROBOT_API_KEY` 와 시드할 때 쓴 키가 달라짐 → `npm run seed` 다시 |
| 대시보드가 안 움직임 | 터미널 2에서 `npm run mock:robot` 이 돌고 있는지 확인 |
| 한글이 깨짐 | 폰트 서브셋 문제. 먹메이트에서 겪었던 이슈 — Pretendard를 로컬 폰트로 포함할 것 |
| `node_modules` 설치가 느림/멈춤 | OneDrive 동기화 폴더에서 빼세요 |
