#!/usr/bin/env bash
# 셰르피 에이전트 설치 — 한 번만 실행하면 이후로는 "전원만 켜면" 웹에 연결된다.
#
#   bash ~/sherpy/robot/install_agent.sh
#
# 하는 일
#   1) systemd 서비스 sherpy-agent 등록 (부팅 시 자동 실행, 죽으면 5초 뒤 다시 실행)
#   2) 웹의 [다시 시작]/[안전하게 끄기] 버튼용 sudo 권한 — 'systemctl reboot · poweroff' 두 가지만 허용
#   3) 상태 점검용 smbus2 · 수동 조종용 websockets 설치 (venv)
# 되돌리기:  sudo systemctl disable --now sherpy-agent && sudo rm /etc/systemd/system/sherpy-agent.service /etc/sudoers.d/sherpy-agent
set -euo pipefail

ROBOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
USER_NAME="$(id -un)"
PY="$ROBOT_DIR/.venv/bin/python"

[ -f "$ROBOT_DIR/.env" ] || { echo "❌ $ROBOT_DIR/.env 가 없어요 (로봇 키 파일)"; exit 1; }
[ -x "$PY" ] || { echo "❌ $PY 가 없어요. 먼저: cd $ROBOT_DIR && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt"; exit 1; }
chmod 600 "$ROBOT_DIR/.env"   # 키 파일은 나만 읽기

echo "▶ smbus2 · websockets 설치 (I2C 부품 확인 · 수동 조종)"
"$PY" -m pip install -q smbus2 "websockets>=13"

if pgrep -f "stream.py|connect_test.py" >/dev/null; then
  echo "⚠️ stream.py 또는 connect_test.py 가 실행 중이에요. Ctrl+C 로 끈 뒤 다시 실행하세요."; exit 1
fi

echo "▶ systemd 서비스 등록"
sudo tee /etc/systemd/system/sherpy-agent.service >/dev/null <<EOF
[Unit]
Description=Sherpy robot agent (web buttons: camera, check, power, joystick)
After=network-online.target
Wants=network-online.target

[Service]
User=$USER_NAME
WorkingDirectory=$ROBOT_DIR
ExecStart=$PY -u $ROBOT_DIR/agent.py
Restart=always
RestartSec=5
Environment=PYTHONUNBUFFERED=1

[Install]
WantedBy=multi-user.target
EOF

echo "▶ 끄기·재시작 권한 (두 명령만)"
TMP="$(mktemp)"
echo "$USER_NAME ALL=(root) NOPASSWD: /usr/bin/systemctl reboot, /usr/bin/systemctl poweroff" > "$TMP"
# 문법 검사를 통과할 때만 설치 (sudoers 가 깨지면 sudo 를 못 쓰게 되므로)
if sudo visudo -cf "$TMP" >/dev/null; then
  sudo install -m 440 -o root -g root "$TMP" /etc/sudoers.d/sherpy-agent
else
  echo "❌ sudoers 문법 오류 — 권한 설치를 건너뜀 (끄기 버튼만 안 됨)"
fi
rm -f "$TMP"

sudo systemctl daemon-reload
sudo systemctl enable --now sherpy-agent
sleep 3
systemctl --no-pager --lines=8 status sherpy-agent || true
echo
echo "✅ 설치 끝. 이제 파이 전원만 켜면 1~2분 안에 웹 [로봇 관리]에 연결돼요."
echo "   로그 보기:  journalctl -u sherpy-agent -f"
