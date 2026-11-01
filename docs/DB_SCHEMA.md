# 데이터 모델 (Neon Postgres + Drizzle)

정의는 `src/db/schema.ts`. 이 문서는 의도를 설명한다.

---

## 테이블 목록

| 테이블 | 용도 |
|---|---|
| `users` | 계정. 아이디 10자 / 비밀번호 16자, 외부 본인인증 없음 (먹메이트와 동일 정책) |
| `dogs` | 반려견 |
| `robots` | 로봇. **API 키는 해시만 저장** |
| `robot_telemetry` | 1Hz 시계열 |
| `robot_commands` | 명령 큐 |
| `routes` / `route_points` / `route_pois` / `route_likes` | 산책 코스 |
| `walks` | 산책 기록 |
| `posts` / `comments` | 커뮤니티 |
| `weather_cache` | 기상 캐시 (30분) |
| `market_items` | **명목상** — 시드 전용 |
| `crowd_mock` | **명목상** — 하드코딩 |

---

## 주의할 점

### robot_telemetry 는 빠르게 커진다

1Hz × 로봇 1대 × 1시간 = 3,600행. 하루 종일 켜두면 86,400행.
**7일 경과분은 주기적으로 삭제**하세요. Neon 무료 플랜 용량이 금방 찹니다.

```sql
DELETE FROM sherpy.robot_telemetry WHERE ts < now() - interval '7 days';
```

Vercel Cron 또는 Neon의 스케줄 기능으로 돌리면 됩니다.

### robot_telemetry 의 속도 컬럼 두 개

| 컬럼 | 뜻 |
|---|---|
| `speed_cmd` | 로봇이 ESC 에 **지령**한 속도 |
| `speed_mps` | 로봇 GPS 로 잰 **실측** 지면속도 (2026-10-25 추가, `heading_deg`·`gps_sats` 와 함께) |

MJX H8P 의 모터 엔코더 신호는 ESC 안에서만 쓰여 밖으로 나오지 않으므로 GPS 가 유일한 실측 속도원이다.
기존 DB 에는 `node scripts/db-init.mjs` 가 `add column if not exists` 로 붙인다.

### robots.api_key_hash — 평문 저장 금지

로봇이 `Authorization: Bearer <key>` 로 인증합니다.
DB에는 bcrypt 해시만 저장하고 `verifyRobotKey()` 로 비교합니다.
시드 스크립트가 해시를 만들어 넣으니, 평문 키는 로봇 쪽 `.env` 에만 둡니다.

### walks.pull_count

장력이 `F_WARN`(16N, SHERPY 7.3 L2 경고)을 넘은 횟수입니다.
**셰르피만 낼 수 있는 데이터**라 서비스 차별점이 됩니다.
주간 리포트("이번 주 당김 32% 감소")로 확장하면 향후계획 근거가 됩니다.

### THRESHOLDS 동기화

`src/lib/robot/types.ts` 의 임계값은 로봇 `walkbot/config.py` 와 **같은 값**이어야 합니다.

| 상수 | 값 |
|---|---|
| `F_CAUTION` | 8.0 N (L1 주의, 표시만) |
| `F_WARN` | 16.0 N (L2 경고, ≤0.2 m/s) |
| `F_STOP` | 35.0 N (L3 HOLD) |
| `L_MIN` | 1.2 m |
| `L_SOFT` | 2.76 m (릴 한계 근접) |
| `L_MAX` | 3.0 m (reelMax) |
| `KF_MIN_QUALITY` | 0.5 |

2026-11-01 SHERPY 7.3 기준 엔진으로 교체 (이전 8/30/40 N · 3/4.5/5 m 폐기).
세 곳이 같아야 한다: `src/lib/robot/types.ts` · `robot/bridge/config.py` · `robot/sherpy_core/params.py`.

### robot_telemetry 강아지 추정 컬럼 (2026-11-01)

`dog_bearing_deg`(θ, + 오른쪽) · `dog_dist_m`(d̂) · `dog_sigma_m`(위치 1σ) · `dog_track`(ok|coast|lost) · `tension_filt_n`(F̂).
`node scripts/db-init.mjs` 가 `add column if not exists` 로 추가한다.

한쪽만 바꾸면 앱 표시와 로봇 동작이 어긋납니다.

---

## 마이그레이션

```powershell
npm run db:generate   # 스키마 변경 → SQL 생성
npm run db:push       # 바로 반영 (개발용)
npm run db:studio     # GUI로 확인
```

개발 중에는 `db:push` 로 충분합니다. 배포 후에는 `db:generate` 로
마이그레이션 파일을 만들어 커밋하세요.
