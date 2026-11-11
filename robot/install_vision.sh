#!/usr/bin/env bash
# 자율주행 인식 테스트 설치 — 한 번만. (인터넷 필요, 10~20분, 약 1.5GB)
#
#   cd ~/sherpy && git pull && bash robot/install_vision.sh
#
# 하는 일
#   1) 카메라 프로그램(rpicam-vid) 확인
#   2) venv 에 PyTorch(CPU 전용) + Ultralytics(YOLO) 설치
#      ⚠️ 그냥 pip install 하면 CUDA 판 torch 가 깔려 'Illegal instruction' 으로 죽는 사례가 있어 CPU 판을 먼저 깐다
#   3) YOLO26n(없으면 YOLO11n) 모델을 받아 NCNN 으로 변환 → robot/models/
#      Pi 5 에서 NCNN 이 가장 빠르다 (Ultralytics 공식 벤치마크: 640 입력 기준 약 67ms, 여기선 320 입력이라 더 빠름)
#   4) 에이전트 다시 시작 → 웹 [로봇 관리 → 자율주행 인식 테스트] 에서 사용
set -euo pipefail

ROBOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PY="$ROBOT_DIR/.venv/bin/python"
[ -x "$PY" ] || { echo "❌ $PY 가 없어요. 먼저: cd $ROBOT_DIR && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt"; exit 1; }

echo "▶ 1/4 카메라 프로그램 확인"
command -v rpicam-vid >/dev/null || sudo apt install -y rpicam-apps
[ "$(uname -m)" = "aarch64" ] || { echo "❌ 64비트 OS 가 아니에요 ($(uname -m)). YOLO 는 64비트 라즈베리파이 OS 에서만 돼요."; exit 1; }

echo "▶ 2/4 PyTorch(CPU) + Ultralytics 설치 — 10분 넘게 걸릴 수 있어요"
"$PY" -m pip install -q -U pip
"$PY" -m pip install -q torch torchvision --index-url https://download.pytorch.org/whl/cpu
"$PY" -m pip install -q ultralytics numpy

echo "▶ 3/4 모델 받기 + NCNN 변환 (입력 320)"
mkdir -p "$ROBOT_DIR/models"
cd "$ROBOT_DIR/models"
"$PY" - <<'EOF'
from pathlib import Path
from ultralytics import YOLO
for name in ("yolo26n", "yolo11n"):
    if Path(f"{name}_ncnn_model").exists():
        print(f"   이미 있음: {name}_ncnn_model"); break
    try:
        YOLO(f"{name}.pt").export(format="ncnn", imgsz=320)
        print(f"   ✅ {name}_ncnn_model 만듦"); break
    except Exception as e:
        print(f"   {name} 실패: {e} — 다음 모델로")
else:
    raise SystemExit("❌ 모델을 만들지 못했어요 (인터넷 확인)")
EOF

echo "▶ 4/4 빠른 확인 — 카메라 3초 인식 (영상 송출이 켜져 있으면 카메라가 바빠서 실패해요)"
cd "$ROBOT_DIR"
timeout 25 "$PY" - <<'EOF' || echo "   (카메라 확인은 건너뜀 — 웹에서 다시 시험하세요)"
import time
from bridge.vision import Vision, PiCamera
v = Vision(upload=False)
import bridge.vision as V
V.yield_frame = lambda b, r, p: None
v.start(PiCamera())
time.sleep(12)
r = v.last or {}
print(f"   판단: {r.get('decision')} / 모델: {r.get('model')} / {r.get('fps')} fps / {r.get('inferMs')} ms")
if r.get("note"): print("   참고:", r["note"])
v.stop()
EOF

if systemctl is-enabled sherpy-agent >/dev/null 2>&1; then
  echo "▶ 에이전트 다시 시작"
  sudo systemctl restart sherpy-agent
fi
echo "✅ 끝 — 웹에서 [로봇 관리 → 자율주행 인식 테스트] 를 여세요"
