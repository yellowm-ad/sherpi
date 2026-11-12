"""
자율주행 인식 테스트 — 카메라 → 객체 인식(YOLO) + 바닥 검사 → 판단(avoid.py) → 웹에 결과·사진.

    (웹)    로봇 관리 → 자율주행 인식 테스트 → [인식 시작]     ← agent.py 가 이 모듈을 켠다
    (노트북) python robot/bridge/vision.py --webcam             ← 파이 없이 노트북 카메라로 판단 로직 시험 (창으로 보기)
    (파이)  python3 robot/bridge/vision.py --show-none          ← 파이 터미널에서 결과만 출력

카메라는 한 프로그램만 쓸 수 있다. 인식 테스트 중에는 영상 송출(MediaMTX)을 끄고 여기서 카메라를 쓴다.
대신 박스를 그린 사진을 0.5초마다 서버로 올리므로 LTE 핸드폰에서도 볼 수 있다.

[보안] 카메라 명령은 고정된 프로그램·인자만 쓴다. 웹에서 온 값은 Params.update 가 이름·범위를 걸러서만 반영한다.
[안전] 모터를 움직이지 않는다. 판단 결과를 보여 주기만 한다.
"""
from __future__ import annotations

import base64
import json
import os
import subprocess
import sys
import threading
import time
from pathlib import Path

import numpy as np

try:
    import cv2
except ImportError:  # install_vision.sh 전
    cv2 = None

if __package__ in (None, ""):  # 파일로 직접 실행할 때
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
    from bridge.avoid import Avoider, Det, Params, corridor_half, COLS, GO, SLOW, WAIT, STOP  # noqa: E402
    from bridge import config as C  # noqa: E402
    from bridge.live_view import LiveView  # noqa: E402
else:
    from .avoid import Avoider, Det, Params, corridor_half, COLS, GO, SLOW, WAIT, STOP
    from . import config as C
    from .live_view import LiveView

ROBOT_DIR = Path(__file__).resolve().parent.parent
MODELS = ROBOT_DIR / "models"
LOG_DIR = ROBOT_DIR / "vision_log"
LOG_MAX = 300           # 저장 표본 최대 개수 (오래된 것부터 지움)
CAM_W, CAM_H, CAM_FPS = 640, 360, C.VISION_FPS   # 인식이 따라갈 수 있는 만큼만 찍는다 (밀린 옛 사진 방지)
UPLOAD_EVERY = 0.5      # 초 — 웹 사진 갱신 주기 (서버 경유)
UPLOAD_EVERY_LIVE = 3.0 # 초 — 폰이 직접 보고 있을 땐 서버로는 가끔만 (전력·데이터 절약)
MARK_KINDS = {"missed": "놓침", "false_stop": "괜히 멈춤", "good": "잘함"}

# 화면 뒤집힘 — mediamtx.yml 의 rpiCameraHFlip/VFlip 과 같게 (.env 에 SHERPY_CAM_HFLIP=1)
HFLIP = os.environ.get("SHERPY_CAM_HFLIP") == "1"
VFLIP = os.environ.get("SHERPY_CAM_VFLIP") == "1"
# 센서 모드 고정 — 작은 출력(640x360)을 달라고 하면 libcamera 가 1536x864 모드를 고르는데,
# 이 모드는 센서 가운데 3072x1728 만 잘라 써서 화각이 약 2/3 로 좁아진다.
# 2304x1296 모드는 센서 전체(4608x2592)를 2x2 묶어 읽어 Wide 렌즈 화각을 전부 쓴다. mediamtx.yml 의 rpiCameraMode 와 같게.
CAM_MODE = os.environ.get("SHERPY_CAM_MODE", "2304:1296:10:P")


# ── 카메라 ─────────────────────────────────────
class PiCamera:
    """rpicam-vid 의 날 영상(YUV420)을 파이프로 받는다 — picamera2·venv 충돌 없이 어디서나 동작."""

    def __init__(self) -> None:
        argv = ["rpicam-vid", "-t", "0", "-n", "--codec", "yuv420",
                "--width", str(CAM_W), "--height", str(CAM_H), "--framerate", str(CAM_FPS), "-o", "-"]
        if CAM_MODE:
            argv += ["--mode", CAM_MODE]
        if HFLIP:
            argv.append("--hflip")
        if VFLIP:
            argv.append("--vflip")
        self.proc = subprocess.Popen(argv, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, bufsize=0)
        self.size = CAM_W * CAM_H * 3 // 2

    def read(self) -> np.ndarray | None:
        buf = bytearray()
        while len(buf) < self.size:
            chunk = self.proc.stdout.read(self.size - len(buf))
            if not chunk:
                return None
            buf += chunk
        yuv = np.frombuffer(bytes(buf), np.uint8).reshape(CAM_H * 3 // 2, CAM_W)
        return cv2.cvtColor(yuv, cv2.COLOR_YUV2BGR_I420)

    def close(self) -> None:
        if self.proc.poll() is None:
            self.proc.terminate()
            try:
                self.proc.wait(timeout=3)
            except subprocess.TimeoutExpired:
                self.proc.kill()


class WebCam:
    """노트북 시험용"""

    def __init__(self, index: int = 0) -> None:
        self.cap = cv2.VideoCapture(index)

    def read(self) -> np.ndarray | None:
        ok, f = self.cap.read()
        return cv2.resize(f, (CAM_W, CAM_H)) if ok else None

    def close(self) -> None:
        self.cap.release()


# ── 객체 인식 ───────────────────────────────────
class Detector:
    """Ultralytics YOLO (NCNN 으로 변환한 nano 모델 — Pi 5 에서 가장 빠름). 없으면 바닥 검사만."""

    def __init__(self) -> None:
        self.model = None
        self.name: str | None = None
        self.error: str | None = None
        self.fixed_imgsz: int | None = None
        try:
            from ultralytics import YOLO  # 무거움 — 필요할 때만
        except Exception:
            self.error = "인식 모델 프로그램이 없어요 (bash robot/install_vision.sh) — 바닥 검사만 해요"
            return
        cands = [MODELS / "yolo26n_ncnn_model", MODELS / "yolo11n_ncnn_model", MODELS / "yolo26n.pt", MODELS / "yolo11n.pt"]
        path = next((c for c in cands if c.exists()), None)
        if path is None:
            self.error = "인식 모델 파일이 없어요 (bash robot/install_vision.sh) — 바닥 검사만 해요"
            return
        try:
            self.model = YOLO(str(path), task="detect")
            self.name = path.name
            # NCNN 은 변환할 때 정한 입력 크기(install_vision.sh: 320)로 고정
            self.fixed_imgsz = 320 if path.name.endswith("_ncnn_model") else None
        except Exception as e:
            self.error = f"모델을 못 열었어요: {str(e)[:120]}"

    def __call__(self, bgr: np.ndarray, p: Params) -> list[Det]:
        if self.model is None:
            return []
        h, w = bgr.shape[:2]
        r = self.model.predict(bgr, imgsz=self.fixed_imgsz or p.imgsz, conf=max(0.1, p.conf - 0.1), verbose=False)[0]
        names = r.names
        out = []
        for (x1, y1, x2, y2), c, k in zip(r.boxes.xyxy.tolist(), r.boxes.conf.tolist(), r.boxes.cls.tolist()):
            out.append(Det(names[int(k)], float(c), x1 / w, y1 / h, x2 / w, y2 / h))
        return out


# ── 화면에 그리기 ───────────────────────────────
COLOR = {"center": (60, 60, 255), "left": (0, 200, 255), "right": (0, 200, 255), None: (160, 160, 160)}
DECISION_COLOR = {GO: (135, 210, 0), SLOW: (0, 200, 255), WAIT: (0, 140, 255), STOP: (60, 60, 255)}


def draw(bgr: np.ndarray, res: dict, p: Params) -> np.ndarray:
    img = bgr.copy()
    h, w = img.shape[:2]
    # 통로 (사다리꼴) — 울토르의 충돌 영역처럼 '로봇이 지나갈 바닥'
    hy = int(h * p.horizon)
    pts = []
    for n, y in ((0.0, hy), (1.0, h - 1)):
        hw = corridor_half(n, p.corridor)
        pts.append((int((0.5 - hw) * w), y))
        pts.append((int((0.5 + hw) * w), y))
    poly = np.array([pts[0], pts[1], pts[3], pts[2]], np.int32)
    over = img.copy()
    col = DECISION_COLOR.get(res["decision"], (255, 160, 0))
    cv2.fillPoly(over, [poly], col)
    img = cv2.addWeighted(over, 0.18, img, 0.82, 0)
    cv2.polylines(img, [poly], True, col, 2)
    cv2.line(img, (0, hy), (w, hy), (200, 200, 200), 1)
    # 바닥이 이어지는 높이 (띠마다)
    for i, f in enumerate(res.get("free") or []):
        x0, x1 = int(w * i / COLS), int(w * (i + 1) / COLS)
        y = int(hy + (h - hy) * (1 - f))  # f=1 지평선까지 바닥, f=0 바로 앞에서 끊김
        cv2.line(img, (x0 + 2, y), (x1 - 2, y), (255, 255, 0), 2)
    # 박스
    for o in res["objects"]:
        x1, y1, x2, y2 = (int(v * s) for v, s in zip(o["box"], (w, h, w, h)))
        c = (135, 210, 0) if o.get("ours") else COLOR.get(o["zone"], (160, 160, 160))  # 우리 강아지 = 초록
        cv2.rectangle(img, (x1, y1), (x2, y2), c, 2)
        cv2.putText(img, f'{"OURS " if o.get("ours") else ""}{o["cls"]} {o["conf"]:.2f}', (x1 + 2, max(12, y1 - 4)),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.45, c, 1, cv2.LINE_AA)
    # 길 방향 화살표
    hd = res.get("heading") or 0.0
    cx, cy = w // 2, h - 12
    cv2.arrowedLine(img, (cx, cy), (int(cx + hd * w * 0.25), cy - 40), (255, 255, 255), 2, tipLength=0.3)
    return img


def to_jpeg_b64(img: np.ndarray, width: int = 480, q: int = 60) -> str:
    h, w = img.shape[:2]
    small = cv2.resize(img, (width, int(h * width / w)))
    ok, buf = cv2.imencode(".jpg", small, [cv2.IMWRITE_JPEG_QUALITY, q])
    return base64.b64encode(buf.tobytes()).decode() if ok else ""


# ── 실행기 ─────────────────────────────────────
class Vision:
    """agent.py 가 켜고 끈다. 결과는 0.5초마다 PUT /api/robots/:id/vision"""

    def __init__(self, upload: bool = True) -> None:
        self.avoider = Avoider()
        self.upload = upload
        # 줄 센서 값 {"theta": rad, "L": m} 을 돌려주는 함수 — 릴·AS5600 배선 전엔 None (화면만으로 우리 강아지 고름)
        self.leash_fn = None
        self.live = LiveView()       # 폰 직접 보기 (터널) — agent 가 인식을 켤 때 같이 켠다
        self.error: str | None = None
        self.last: dict | None = None
        self._frame: np.ndarray | None = None
        self._thread: threading.Thread | None = None
        self._stop = threading.Event()
        self._lock = threading.Lock()

    @property
    def running(self) -> bool:
        return bool(self._thread and self._thread.is_alive())

    @property
    def params(self) -> Params:
        return self.avoider.p

    def ready(self) -> str | None:
        if cv2 is None:
            return "OpenCV 가 없어요 (bash robot/install_vision.sh)"
        if subprocess.run(["which", "rpicam-vid"], capture_output=True).returncode != 0:
            return "rpicam-vid 가 없어요 (sudo apt install -y rpicam-apps)"
        return None

    def start(self, camera=None) -> bool:
        if self.running:
            return True
        self.error = None if camera is not None else self.ready()
        if self.error:
            return False
        self._stop.clear()
        self._thread = threading.Thread(target=self._run, args=(camera,), daemon=True)
        self._thread.start()
        return True

    def stop(self) -> None:
        self.live.stop()
        self._stop.set()
        if self._thread:
            self._thread.join(timeout=8)
        self._thread = None
        if self.upload:
            self._put(None, None)

    def set_params(self, d: dict) -> None:
        with self._lock:
            self.avoider.p.update(d)

    def mark(self, kind: str) -> str | None:
        """'놓침/괜히 멈춤/잘함' 표본 저장 — 나중에 값 조정·재학습 자료. 저장한 파일 이름 반환."""
        if kind not in MARK_KINDS or self._frame is None or self.last is None:
            return None
        LOG_DIR.mkdir(exist_ok=True)
        name = time.strftime("%Y%m%d-%H%M%S") + f"_{kind}"
        cv2.imwrite(str(LOG_DIR / f"{name}.jpg"), self._frame, [cv2.IMWRITE_JPEG_QUALITY, 85])
        (LOG_DIR / f"{name}.json").write_text(json.dumps(
            {"kind": kind, "result": self.last, "params": self.avoider.p.to_dict()}, ensure_ascii=False), encoding="utf-8")
        files = sorted(LOG_DIR.glob("*.jpg"))
        for old in files[:-LOG_MAX]:
            old.unlink(missing_ok=True)
            old.with_suffix(".json").unlink(missing_ok=True)
        return name

    @staticmethod
    def marks() -> dict:
        out = {k: 0 for k in MARK_KINDS}
        if LOG_DIR.exists():
            for f in LOG_DIR.glob("*.json"):
                k = f.stem.split("_", 1)[-1]
                if k in out:
                    out[k] += 1
        return out

    def _put(self, result: dict | None, frame: str | None) -> None:
        import requests
        try:
            requests.put(f"{C.SERVER_URL}/api/robots/{C.ROBOT_ID}/vision",
                         json={"result": result, "frame": frame},
                         headers={"Authorization": f"Bearer {C.API_KEY}"}, timeout=C.HTTP_TIMEOUT)
        except Exception as e:
            print(f"[vision] 올리기 실패: {e}", flush=True)

    @staticmethod
    def _limit_cpu() -> None:
        """인식 스레드(와 여기서 생기는 계산 스레드)를 뒤쪽 코어 몇 개로만 — 순간 전류를 낮춰 재부팅 방지.
        리눅스에서 sched_setaffinity(0) 은 '지금 스레드'에만 걸리고, 이후 만드는 스레드가 물려받는다."""
        try:
            n = os.cpu_count() or 4
            k = min(n, C.VISION_CORES)
            os.sched_setaffinity(0, set(range(n - k, n)))
        except (AttributeError, OSError):
            pass  # 윈도우·맥 (노트북 시험)
        try:
            cv2.setNumThreads(1)
        except Exception:  # noqa: BLE001
            pass
        os.environ.setdefault("OMP_NUM_THREADS", str(C.VISION_CORES))

    def _run(self, camera) -> None:
        self._limit_cpu()
        det = Detector()
        cam = camera or PiCamera()
        last_up, last_live, frames, t0, infer_ms = 0.0, 0.0, 0, time.monotonic(), 0.0
        fps = 0.0
        try:
            while not self._stop.is_set():
                bgr = cam.read()
                if bgr is None:
                    self.error = "카메라 영상을 못 받았어요 (영상 송출이 켜져 있거나 케이블 확인)"
                    break
                ti = time.monotonic()
                with self._lock:
                    p = self.avoider.p
                    dets = det(bgr, p)
                    small = cv2.resize(bgr, (160, 90))
                    leash = self.leash_fn() if self.leash_fn else None
                    res = self.avoider.step(dets, small, leash=leash)
                infer_ms = (time.monotonic() - ti) * 1000
                frames += 1
                if time.monotonic() - t0 >= 2:
                    fps, frames, t0 = frames / (time.monotonic() - t0), 0, time.monotonic()
                res.update({"fps": round(fps, 1), "inferMs": round(infer_ms), "model": det.name,
                            "note": det.error, "params": p.to_dict(), "marks": self.marks(), "at": int(time.time())})
                self._frame, self.last = bgr, res
                watching = self.live.viewers > 0
                t_now = time.monotonic()
                jpg = None
                if watching and t_now - last_live >= C.LIVE_EVERY:
                    last_live = t_now
                    jpg = to_jpeg_b64(draw(bgr, res, p))
                    self.live.publish(res, jpg)
                if self.upload and t_now - last_up >= (UPLOAD_EVERY_LIVE if watching else UPLOAD_EVERY):
                    last_up = t_now
                    jpg = jpg or to_jpeg_b64(draw(bgr, res, p))
                    threading.Thread(target=self._put, args=(res, jpg), daemon=True).start()
                if not self.upload:
                    yield_frame(bgr, res, p)
        except Exception as e:
            self.error = f"인식 중 오류: {str(e)[:150]}"
        finally:
            cam.close()
            if not self._stop.is_set():   # 오류로 멈췄으면 직접 보기도 닫는다
                self.live.stop()


def yield_frame(bgr, res, p) -> None:
    """노트북 시험 — 창으로 보여 준다 (q 로 종료)"""
    if os.environ.get("SHERPY_VISION_SHOW") == "none":
        print(f'{res["decision"]:<12} {res["reason"]}  fps={res["fps"]}', flush=True)
        return
    cv2.imshow("sherpy vision (q 종료)", draw(bgr, res, p))
    if cv2.waitKey(1) & 0xFF == ord("q"):
        raise KeyboardInterrupt


if __name__ == "__main__":
    if cv2 is None:
        sys.exit("OpenCV 가 없어요: pip install opencv-python-headless")
    if "--show-none" in sys.argv:
        os.environ["SHERPY_VISION_SHOW"] = "none"
    v = Vision(upload=False)
    v.start(WebCam(0) if "--webcam" in sys.argv else PiCamera())
    try:
        while v.running:
            time.sleep(0.5)
    except KeyboardInterrupt:
        v.stop()
    if v.error:
        print(v.error)
