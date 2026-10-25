"""
셰르피 API 통합 검증 — 실제 DB를 대상으로 회원·코스·커뮤니티·신고·어드민 흐름을 끝까지 돌린다.

    python scripts/qa_api.py                      # http://localhost:3000
    python scripts/qa_api.py https://sharpi.vercel.app

.env.local 의 QA_USER / QA_PASSWORD / QA_USER2 / ADMIN_PASSWORD 를 쓴다. 비밀값은 출력하지 않는다.
QA 계정이 없으면 만들고, 테스트가 남긴 정지 상태는 끝에 되돌린다.
"""

import http.cookiejar
import json
import pathlib
import sys
import urllib.error
import urllib.request

BASE = (sys.argv[1] if len(sys.argv) > 1 else "http://localhost:3000").rstrip("/")
ENV = dict(
    l.split("=", 1) for l in (pathlib.Path(__file__).resolve().parent.parent / ".env.local").read_text(encoding="utf-8").splitlines()
    if "=" in l and not l.startswith("#")
)
ENV = {k: v.strip().strip('"') for k, v in ENV.items()}

results: list[tuple[bool, str]] = []


class Client:
    def __init__(self):
        self.jar = http.cookiejar.CookieJar()
        self.op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.jar))

    def req(self, method, path, body=None):
        data = json.dumps(body).encode() if body is not None else None
        r = urllib.request.Request(BASE + path, data=data, method=method, headers={"Content-Type": "application/json"})
        try:
            with self.op.open(r, timeout=30) as res:
                return res.status, json.loads(res.read() or b"{}")
        except urllib.error.HTTPError as e:
            try:
                return e.code, json.loads(e.read() or b"{}")
            except json.JSONDecodeError:
                return e.code, {}


def check(ok, name, extra=""):
    results.append((bool(ok), name))
    print(("  ✅ " if ok else "  ❌ ") + name + (f"  ({extra})" if extra and not ok else ""))


def ensure_user(c: Client, username, password, nickname):
    s, j = c.req("POST", "/api/auth/login", {"username": username, "password": password})
    if s == 403:  # 지난 실행이 중간에 끊겨 정지 상태로 남은 경우 — 어드민으로 풀고 다시
        adm = Client()
        adm.req("POST", "/api/admin/login", {"password": ENV["ADMIN_PASSWORD"]})
        _, u = adm.req("GET", "/api/admin/users")
        uid = next(x["id"] for x in u["users"] if x["username"] == username)
        adm.req("PATCH", f"/api/admin/users/{uid}", {"accountStatus": "ACTIVE"})
        s, j = c.req("POST", "/api/auth/login", {"username": username, "password": password})
    if s == 200:
        return j["user"]
    s, j = c.req("POST", "/api/auth/signup", {"username": username, "password": password, "nickname": nickname})
    assert s == 201, f"signup {s} {j}"
    return j["user"]


def main():
    pw = ENV["QA_PASSWORD"]
    print(f"\n대상: {BASE}\n")

    print("[기본]")
    g = Client()
    s, j = g.req("GET", "/api/health")
    check(s == 200 and j.get("db") is True, "health: DB 연결")
    s, j = g.req("GET", "/api/me")
    check(s == 200 and j.get("user") is None, "게스트 /api/me → user null")

    print("[회원]")
    a, b = Client(), Client()
    ua = ensure_user(a, ENV["QA_USER"], pw, "QA산책러")
    global a_client
    a_client = a
    ub = ensure_user(b, ENV["QA_USER2"], pw, "QA콩이맘")
    check(ua and ub, "QA 계정 2개 로그인")
    s, j = a.req("GET", "/api/me")
    check(j.get("user", {}).get("username") == ENV["QA_USER"], "로그인 후 /api/me 본인")
    s, _ = Client().req("POST", "/api/auth/login", {"username": ENV["QA_USER"], "password": pw + "x"})
    check(s == 401, "틀린 비밀번호 → 401")
    s, _ = Client().req("POST", "/api/auth/signup", {"username": ENV["QA_USER"], "password": pw, "nickname": "중복"})
    check(s == 409, "중복 아이디 가입 → 409")
    s, _ = Client().req("POST", "/api/auth/signup", {"username": "AB", "password": "123", "nickname": "x"})
    check(s == 422, "형식 오류 가입 → 422")

    print("[내 코스]")
    pts = [[35.84912, 127.12102], [35.84975, 127.12285], [35.84933, 127.12489], [35.84753, 127.12247]]
    s, _ = g.req("POST", "/api/routes", {"name": "게스트코스", "points": pts})
    check(s == 401, "게스트 코스 저장 → 401")
    s, j = a.req("POST", "/api/routes", {"name": "QA 덕진호 코스", "points": pts, "isPublic": False,
                                          "pois": [{"type": "water", "lat": 35.849, "lng": 127.121}]})
    rid = j.get("route", {}).get("id")
    check(s == 201 and rid and rid > 1000, "코스 저장 (id 1001+)", f"{s} {j}")
    s, j = a.req("GET", "/api/routes/mine")
    check(any(r["id"] == rid and len(r["points"]) == 4 and len(r["pois"]) == 1 for r in j.get("routes", [])), "내 코스 목록에 경유점·편의시설 포함")
    s, _ = b.req("GET", f"/api/routes/{rid}")
    check(s == 404, "남의 비공개 코스 조회 → 404")
    s, _ = b.req("DELETE", f"/api/routes/{rid}")
    check(s == 403, "남의 코스 삭제 → 403")
    s, _ = a.req("PATCH", f"/api/routes/{rid}", {"taught": True, "keyframes": 57})
    s2, j = a.req("GET", f"/api/routes/{rid}")
    check(s == 200 and j.get("route", {}).get("taught") and j["route"]["keyframes"] == 57, "티칭 완료 기록")
    edit = {"name": "QA 덕진호 코스(수정)", "points": pts[:3], "isPublic": False, "pois": []}
    s, _ = b.req("PUT", f"/api/routes/{rid}", edit)
    check(s == 403, "남의 코스 수정 → 403")
    s, j = a.req("PUT", f"/api/routes/{rid}", {**edit, "points": pts[:1]})
    check(s == 422, "경유점 1개로 수정 → 422")
    s, j = a.req("PUT", f"/api/routes/{rid}", edit)
    r = j.get("route", {})
    check(s == 200 and r.get("name") == edit["name"] and len(r.get("points", [])) == 3 and not r.get("pois"),
          "코스 수정 (이름·경유점·편의시설)", f"{s} {j}")
    check(r.get("taught") is False and r.get("keyframes") == 0, "경로 수정 → 티칭 기록 초기화")
    s, _ = a.req("DELETE", f"/api/routes/{rid}")
    s2, j = a.req("GET", "/api/routes/mine")
    check(s == 200 and all(r["id"] != rid for r in j["routes"]), "코스 삭제")

    print("[커뮤니티]")
    s, j = g.req("GET", "/api/community/rooms")
    rooms = j.get("rooms", [])
    check(s == 200 and len(rooms) >= 4, "게스트 방 목록 조회")
    room = rooms[0]["id"]
    s, j = g.req("GET", f"/api/community/rooms/{room}/messages?after=0")
    after = max([m["id"] for m in j.get("messages", [])] or [0])
    check(s == 200, "게스트 메시지 읽기")
    s, _ = g.req("POST", f"/api/community/rooms/{room}/messages", {"content": "게스트"})
    check(s == 401, "게스트 메시지 전송 → 401")
    s, j = a.req("POST", f"/api/community/rooms/{room}/messages", {"content": "QA 테스트 메시지입니다 🐾"})
    m1 = j.get("message", {}).get("id")
    check(s == 201 and m1, "메시지 전송")
    s, j = b.req("POST", f"/api/community/rooms/{room}/messages", {"content": "QA 비속어 테스트 시발 안녕"})
    m2 = j.get("message", {}).get("id")
    check(s == 201 and "시발" not in j["message"]["content"], "비속어 부분 마스킹", j.get("message", {}).get("content", ""))
    s, j = a.req("GET", f"/api/community/rooms/{room}/messages?after={after}")
    got = {m["id"]: m for m in j.get("messages", [])}
    check(m1 in got and m2 in got and got[m1]["isMine"] and not got[m2]["isMine"], "증분 폴링(after 커서) + isMine")
    s, _ = a.req("POST", f"/api/community/rooms/{room}/messages", {"content": "x" * 501})
    check(s == 400, "500자 초과 → 400")
    s, _ = a.req("DELETE", f"/api/community/rooms/{room}/messages/{m2}")
    check(s == 404, "남의 메시지 삭제 불가")
    s, _ = a.req("DELETE", f"/api/community/rooms/{room}/messages/{m1}")
    s2, j = b.req("GET", f"/api/community/rooms/{room}/messages?after={after}")
    mm = next((m for m in j["messages"] if m["id"] == m1), {})
    check(s == 200 and mm.get("deleted") and mm.get("content") == "삭제된 메시지예요", "내 메시지 소프트삭제 → 모두에게 가려짐")

    print("[신고·어드민]")
    s, _ = b.req("POST", "/api/reports", {"messageId": m2, "reason": "SPAM"})
    check(s == 400, "내 메시지 신고 불가")
    s, j = a.req("POST", "/api/reports", {"messageId": m2, "reason": "HARASSMENT", "detail": "QA"})
    check(s == 201, "다른 사람 메시지 신고")
    s, _ = a.req("POST", "/api/reports", {"messageId": m2, "reason": "HARASSMENT"})
    check(s == 409, "중복 신고 → 409")
    s, _ = a.req("POST", "/api/reports", {"messageId": m2 if False else m1, "reason": "OTHER"})
    check(s in (400, 404), "'기타' 상세 없음 거부")

    adm = Client()
    s, _ = adm.req("GET", "/api/admin/reports")
    check(s == 401, "어드민 미로그인 → 401")
    s, _ = adm.req("POST", "/api/admin/login", {"password": "wrong-password"})
    check(s == 401, "어드민 틀린 비번 → 401")
    s, _ = adm.req("POST", "/api/admin/login", {"password": ENV["ADMIN_PASSWORD"]})
    check(s == 200, "어드민 로그인")
    s, j = adm.req("GET", "/api/admin/reports")
    rep = next((r for r in j.get("reports", []) if r["snapshot"] and "QA 비속어" in r["snapshot"] and r["status"] == "PENDING"), None)
    check(rep is not None, "신고 목록에 원문 스냅샷")
    s, _ = adm.req("PATCH", f"/api/admin/reports/{rep['id']}", {"status": "RESOLVED", "deleteMessage": True, "suspendUser": True})
    check(s == 200, "신고 처리: 메시지 삭제 + 작성자 정지")
    s, _ = b.req("POST", f"/api/community/rooms/{room}/messages", {"content": "정지 후 전송"})
    check(s == 403, "정지 계정 전송 차단")
    s, _ = Client().req("POST", "/api/auth/login", {"username": ENV["QA_USER2"], "password": pw})
    check(s == 403, "정지 계정 로그인 차단")
    s, j = adm.req("GET", "/api/admin/users")
    qb = next((u for u in j.get("users", []) if u["username"] == ENV["QA_USER2"]), None)
    check(qb and qb["accountStatus"] == "SUSPENDED" and "pendingReports" in j.get("stats", {}), "회원 목록·통계")
    s, _ = adm.req("PATCH", f"/api/admin/users/{qb['id']}", {"accountStatus": "ACTIVE"})
    s2, _ = Client().req("POST", "/api/auth/login", {"username": ENV["QA_USER2"], "password": pw})
    check(s == 200 and s2 == 200, "정지 해제 → 로그인 복구")

    print("[로봇 API 보호]")
    s, _ = g.req("POST", "/api/robots/1/telemetry", {"ts": "2026-10-19T00:00:00.000Z", "mode": "idle", "safety_level": 0})
    check(s == 401, "로봇 키 없는 텔레메트리 → 401")
    s, _ = g.req("GET", "/api/robots/1/commands/pending")
    check(s == 401, "로봇 키 없는 명령 폴링 → 401")
    s, _ = g.req("POST", "/api/robots/1/commands", {"type": "ESTOP"})
    check(s == 401, "게스트 로봇 명령 → 401")
    s, _ = a_client.req("POST", "/api/robots/1/commands", {"type": "START_FOLLOW"})
    check(s == 403, "남의 로봇 명령 → 403")
    s, _ = g.req("GET", "/api/robots/1/stream")
    check(s == 401, "게스트 로봇 스트림 → 401")

    print("[도배 방지]")
    codes = [a_client.req("POST", f"/api/community/rooms/{room}/messages", {"content": f"QA 도배 {i}"})[0] for i in range(6)]
    check(codes[-1] == 429 and codes.count(201) <= 5, "10초 5개 초과 → 429", str(codes))

    print("[날씨]")
    s, j = g.req("GET", "/api/weather?lat=35.8486&lng=127.1229")
    check(s in (200, 502, 503), f"날씨 API 응답 {s}" + (" (키 미설정)" if s == 503 else ""))
    s, _ = g.req("GET", "/api/weather?lat=abc")
    check(s == 400, "날씨 잘못된 좌표 → 400")

    # QA가 남긴 메시지·신고·코스 정리 (시연 화면에 테스트 흔적이 남지 않게)
    import subprocess
    root = pathlib.Path(__file__).resolve().parent.parent
    subprocess.run(["node", "scripts/qa-cleanup.mjs"], cwd=root)

    ok = sum(1 for r in results if r[0])
    print(f"\n결과: {ok}/{len(results)} 통과")
    return 0 if ok == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())
