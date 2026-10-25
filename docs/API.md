# API 명세

모든 응답은 JSON. 오류는 `{ "error": "...", "detail"?: ... }`.

---

## 인증 / 사용자

| Method | Path | 설명 | 상태 |
|---|---|---|---|
| POST | `/api/auth/signup` | 회원가입 | M1 |
| POST | `/api/auth/login` | 로그인 (세션 쿠키) | M1 |
| POST | `/api/auth/logout` | 로그아웃 | M1 |
| GET | `/api/me` | 내 정보 | M1 |

---

## 반려견 / 로봇

| Method | Path | 설명 | 상태 |
|---|---|---|---|
| GET/POST | `/api/dogs` | 목록 / 등록 | M1 |
| PATCH/DELETE | `/api/dogs/[id]` | 수정 / 삭제 | M1 |
| POST | `/api/robots/pair` | 페어링 코드로 로봇 등록 | M1 |
| GET | `/api/robots/[id]` | 로봇 정보 + 최신 상태 | M1 |

---

## 로봇 연동 ★ (구현 완료)

| Method | Path | 호출 주체 | 인증 |
|---|---|---|---|
| POST | `/api/robots/[id]/telemetry` | **로봇** | `Bearer <robot_api_key>` |
| GET | `/api/robots/[id]/stream` | 앱 (SSE) | 세션 |
| POST | `/api/robots/[id]/commands` | 앱 | 세션 |
| GET | `/api/robots/[id]/commands` | 앱 | 세션 |
| GET | `/api/robots/[id]/commands/pending` | **로봇** | `Bearer <robot_api_key>` |
| POST | `/api/robots/[id]/commands/[cid]/ack` | **로봇** | `Bearer <robot_api_key>` |

### POST /api/robots/:id/telemetry

단건 또는 배열(버퍼 플러시)을 받는다.

```json
{
  "ts": "2026-10-19T12:34:56.000Z",
  "mode": "follow",
  "safety_level": 1,
  "faults": [],
  "tension_n": 12.3,
  "leash_len_m": 2.45,
  "speed_cmd": 0.42,
  "steer_cmd": -0.15,
  "lat": 35.8487, "lng": 127.1229, "gps_src": "robot",
  "speed_mps": 0.39, "heading_deg": 84.4, "gps_sats": 8,
  "route_id": 12,
  "kf_index": 34, "kf_total": 120,
  "match_quality": 0.78,
  "battery_v": null
}
```

- `speed_cmd` 는 **지령** 속도, `speed_mps` 는 로봇 GPS로 잰 **실측** 지면속도. 대시보드는 둘을 나란히 보여준다.
- `gps_src` 가 `"robot"` 이면 로봇 GPS(NEO-6M, `/dev/ttyAMA0`), `"phone"` 이면 보호자 휴대폰 위치. 측위가 안 잡히면 로봇은 위치 필드를 비우고 `gps_sats` 만 보낸다.
- `battery_v` 는 전압 ADC 가 없어 `null`. 앱은 주행 시작부터 경과시간으로 25분에 교체를 권한다.

응답: `{ "ok": true, "accepted": 1 }`

| 코드 | 의미 |
|---|---|
| 401 | API 키 불일치 |
| 422 | 스키마 검증 실패 (`index`, `detail` 포함) |

### GET /api/robots/:id/stream (SSE)

```
retry: 2000

id: 1042
event: telemetry
data: {"id":1042,"robotId":1,"ts":"...","mode":"follow",...}

: keepalive
```

- 1초마다 신규 행을 밀어준다 (한 번에 최대 20행)
- 함수 실행시간 제한으로 끊기면 `EventSource` 가 자동 재연결
- `Last-Event-ID` 헤더로 유실 구간을 이어받는다

### POST /api/robots/:id/commands

```json
{ "type": "ESTOP", "payload": {} }
```

| type | payload |
|---|---|
| `ESTOP` | — |
| `START_TEACH` / `STOP_TEACH` | — |
| `START_FOLLOW` | — |
| `PAUSE` / `RESUME` | — |
| `SET_ROUTE` | `{ "routeId": 12 }` |
| `SET_SPEED_LIMIT` | `{ "mps": 1.0 }` (0.5~1.5) |

### GET /api/robots/:id/commands/pending

로봇 전용. 응답과 동시에 `pending → sent` 로 바뀌고 `sent_at` 이 기록된다.
**ESTOP은 큐 순서를 무시하고 맨 앞으로 정렬된다.**
10초 넘게 ack가 없는 `sent` 는 `expired` 로 바뀐다.

---

## 코스 / 산책

| Method | Path | 설명 | 상태 |
|---|---|---|---|
| GET | `/api/routes?bbox=&sort=` | 영역 내 코스 검색 | M4 |
| POST | `/api/routes` | 코스 생성 | M4 |
| GET | `/api/routes/[id]` | 코스 상세 | M4 |
| POST | `/api/routes/[id]/like` | 좋아요 | M4 |
| POST | `/api/routes/[id]/send-to-robot` | 코스를 로봇에 전송 | M4 |
| POST | `/api/walks/start` | 산책 시작 | M6 |
| POST | `/api/walks/[id]/end` | 산책 종료 + 리포트 집계 | M6 |
| GET | `/api/walks?dog_id=` | 기록 목록 | M6 |

---

## 외부 정보 (프록시 + 캐시)

| Method | Path | 설명 | 상태 |
|---|---|---|---|
| GET | `/api/weather?lat=&lng=` | 기상청 프록시 + Walk Score | **구현 완료** |
| GET | `/api/crowd` | **명목상** — mock 반환 | **구현 완료** |

### GET /api/weather

위경도를 기상청 격자(nx, ny)로 변환해 초단기실황을 조회하고
산책적합도를 계산해 돌려준다. 30분 캐시.

```json
{
  "grid": { "nx": 63, "ny": 89 },
  "base": { "baseDate": "20261019", "baseTime": "1200" },
  "raw": { "tempC": 18, "humidity": 55, "windMs": 2.1, "hour": 12, ... },
  "walkScore": {
    "score": 82,
    "grade": "best",
    "label": "산책하기 좋아요",
    "surfaceTempC": 31.0,
    "surfaceRisk": "safe",
    "feelsLikeC": 18,
    "reasons": [],
    "advice": "조건이 좋습니다. 셰르피와 긴 코스도 괜찮아요."
  }
}
```

**키가 없으면 503 + 안내 메시지**를 반환한다. 앱은 계속 동작해야 한다.

### GET /api/crowd

⚠️ 명목상 기능. 응답에 `"mock": true` 와 안내 문구가 포함된다.
지도 범례에 "시연용 데이터"를 반드시 표시할 것.
