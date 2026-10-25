# 로봇 측 설치 — 라즈베리파이 5

확정 BOM(총 1,217,649원, 2026-10-25) 기준입니다. **Pi 4 기준 안내와 다른 곳이 많으니 이 문서를 따르세요.**

| 구성 | 품목 |
|---|---|
| 제어 | **Raspberry Pi 5 8GB** + micro SD 64GB (Bookworm 64bit) + Pi 5 전용 타워팬 V2 |
| 카메라 | **Camera Module 3 Wide** (화각 120°) |
| 위치·속도 | GPS (NEO-6M 등, UART) — 개인 구비 |
| 네트워크 | Pi 5 내장 WiFi → 스마트폰 핫스팟 |
| 구동부 | MJX H8P 1/8 (브러시리스, 80A FOC ESC, 35kg 서보, 2단 기어) |
| 전원 | CNHL 3S 5300mAh 140C **×4** (1개 약 30분 → 약 2시간) + SKYRC S65 / AC-TL80 12V→5V 5A |
| PWM | **SunFounder PCA9685** ×2 (1개 사용, 1개 예비) |
| 장력 | CAS SBA-50L 로드셀 + SparkFun HX711 |
| 줄 길이 | Grove AS5600 + 네오디뮴 N35 6.0×2.5mm + Grove↔점퍼 변환케이블 |
| 본체 표시 | **TM1637 4자리 7세그 ×2** (RED 장력 / BLUE 줄 길이) |
| 리드줄 | RELUNE 릴룬 트윈 리드줄 |

---

## ⚠️ 먼저 확인할 것

| # | 항목 | 왜 | 상태 |
|---|---|---|---|
| 1 | **CSI 케이블 22핀↔15핀 (300mm 이상)** | Pi 5 카메라 포트는 22핀 mini. 카메라 동봉 케이블(15핀 Standard)은 **물리적으로 안 꽂힘** → 영상·경로 기억 주행 전부 불가 | 🔴 추가 구매 |
| 2 | **E-stop 물리버튼** (KEPB22ERS-11 등) | 안전설계 L3 의 **1차 수단**. 앱 원격 정지는 네트워크를 타는 보조 수단 | 🔴 추가 구매 |
| 3 | 22AWG 실리콘 전선 · 5A 퓨즈 · 1000µF 커패시터 | Pi 5 GPIO 급전 (§1-2) | 🟠 추가 구매 |
| 4 | AC-TL80 입력 전압 하한 | 3S 방전 종지 9.9V 에서 5V 유지되는지 **미확인** | ❓ 실측 |
| 5 | RELUNE 트윈 드럼 구조 | 드럼이 2개면 AS5600 을 어느 축에 붙일지 달라짐 | ❓ 분해 확인 |

**하드웨어가 막혀도 앱 개발은 `npm run mock:robot` 으로 계속할 수 있습니다.**

---

## 1. 배선

### 1-1. 핀 배정 (충돌 없음)

> **I2C 를 켜면 GPIO 2/3 이 커널 드라이버에 잠깁니다("GPIO busy").**
> HX711·TM1637·E-stop 은 반드시 2/3 을 피하세요. 확인: `gpioinfo | grep -v unused`

| 장치 | 핀 (BCM) | 비고 |
|---|---|---|
| I2C | GPIO 2 (SDA), GPIO 3 (SCL) | PCA9685 0x40, AS5600 0x36 |
| HX711 | DT = GPIO 5, SCK = GPIO 6 | |
| TM1637 #1 (RED, 장력) | CLK = GPIO 20, DIO = GPIO 21 | |
| TM1637 #2 (BLUE, 줄 길이) | CLK = GPIO 19, DIO = GPIO 26 | |
| GPS UART | GPIO 14 (TXD), GPIO 15 (RXD) | `/dev/ttyAMA0` |
| E-stop | GPIO 17 | 내부 풀업, 눌리면 LOW |

상수는 전부 `robot/bridge/config.py` 에 있습니다.

```
3S LiPo ─ XT60 ─┬─→ [80A FOC ESC] ─→ 모터
                │        └─ BEC 6V ─┬─→ 조향 서보 (PCA9685 CH0)
                │                    └─→ 변속 서보 (PCA9685 CH2)
                └─→ [AC-TL80 5V 5A] ─ 22AWG ─ 5A 퓨즈 ─┬─ 1000µF ─→ Pi 5 핀2(5V) / 핀6(GND)

Pi 5
 ├─ I2C ──┬─→ [PCA9685 0x40] ─┬─ CH0 조향 / CH1 ESC 스로틀 / CH2 변속
 │        └─→ [AS5600 0x36]  (Grove → 변환케이블)
 ├─ GPIO 5/6 ─→ [HX711] ─→ [SBA-50L]
 ├─ GPIO 20/21, 19/26 ─→ [TM1637 RED], [TM1637 BLUE]
 ├─ GPIO 14/15 ─→ [GPS]
 ├─ GPIO 17 ─→ [E-stop 버튼] ─ GND
 └─ CAM/DISP0 (22핀) ─ 22↔15핀 케이블 ─→ [Camera Module 3 Wide]
```

### 1-2. Pi 5 전원 — GPIO 5V 급전

Pi 5 는 5V 최대 5A(25W). GPIO 5V 핀 급전은 USB-C PD 협상을 **우회**하므로 아래를 지킵니다.

| 항목 | 요구 |
|---|---|
| 입력 허용 | 4.75 ~ 5.25V. **4.63V 아래면 브라운아웃** |
| 출력 설정 | 전선 강하를 감안해 **5.15V 근처** |
| 전선 | **22AWG 이상 실리콘 연선**. 점퍼선(28AWG) 금지 |
| 보호 | 5V 라인 **5A 퓨즈**, 5V–GND **1000µF** 전해 커패시터 |
| 핀 | 5V = 물리 2/4번, GND = 6/9번. **3.3V(1번)에 주입 절대 금지** |
| USB | PD 협상이 없어 USB 포트 전류가 **600mA 로 제한**됨 → USB 장치는 전원 허브로 |

```bash
dmesg | grep -i voltage   # "Under-voltage detected!" 가 뜨면 전원 부족
vcgencmd get_throttled    # 0x0 이어야 정상
```

> **AC-TL80 입력 하한 미확인.** 3S 는 12.6V(만충) → 9.9V(종지). 배터리를 방전시키며
> `vcgencmd get_throttled` 를 지켜보고, 후반에 브라운아웃이 뜨면 저전압 컷오프를 10.5V 근처로 올리세요.

> **ESC 전류가 최대 80A까지 튑니다.** 같은 배터리에서 파이 전원을 뽑으면 순간 전압강하로
> 리부팅될 수 있습니다. 커패시터로 부족하면 파이 전원을 별도 계통으로 분리하세요.

---

## 2. OS 설정 (Pi 5)

### 2-1. GPIO — `RPi.GPIO` 는 Pi 5에서 동작하지 않음

Pi 5 는 GPIO 를 **RP1 사우스브리지**가 담당합니다. `RPi.GPIO` 는 `RuntimeError` 로 죽습니다.
`rpi-lgpio` 는 같은 API 의 드롭인 대체품이라 `import RPi.GPIO as GPIO` 코드를 고칠 필요가 없습니다.
**같은 환경에 둘을 함께 설치하면 안 됩니다.**

```bash
sudo apt remove -y python3-rpi.gpio
```

### 2-2. I2C

```bash
sudo raspi-config     # Interface Options → I2C → Enable
sudo reboot
i2cdetect -y 1        # 36, 40 이 보여야 정상
```

PCA9685 두 장은 기본 주소가 **둘 다 0x40** 입니다. 쓰는 채널이 3개뿐이라 **1장만 연결**하고 1장은 예비로 둡니다.
두 장을 동시에 쓰려면 두 번째 보드 A0 점퍼를 납땜해 0x41 로 바꾸고 `I2C_ADDRESS_2` 를 쓰세요.

| 주소 | 장치 |
|---|---|
| 0x36 | AS5600 (릴 회전각) |
| 0x40 | PCA9685 (조향·스로틀·변속) |
| (0x41) | PCA9685 예비 — 쓸 경우만 |

### 2-3. GPS UART — Pi 4 와 다름

| 항목 | Pi 4 (예전 안내) | **Pi 5** |
|---|---|---|
| 장치 경로 | `/dev/serial0` | **`/dev/ttyAMA0`** |
| config.txt | `enable_uart=1` + `dtoverlay=disable-bt` | **`dtparam=uart0=on`** |
| 블루투스 | 꺼야 함 | **끌 필요 없음** (별도 UART) |
| 보드레이트 불안정 | mini-UART 문제 | **없음** (RP1 PL011) |

> **Pi 5 에서 `/dev/serial0` 은 3핀 디버그 커넥터입니다.** 이걸로 열면 측위가 영영 안 잡힙니다.

```bash
sudo nano /boot/firmware/config.txt      # 맨 아래에: dtparam=uart0=on
sudo raspi-config                        # 3 Interface Options → I6 Serial Port
                                         #   login shell over serial? → No
                                         #   serial port hardware enabled? → Yes
sudo reboot

sudo apt install -y minicom
minicom -b 9600 -o -D /dev/ttyAMA0       # $GPGGA… $GPRMC… 가 흐르면 성공
```

USB 동글(VK-172 등)이면 `SHERPY_GPS_PORT=/dev/ttyACM0`.

### 2-4. 카메라

Pi 5 포트 이름은 CAM0/CAM1 이 아니라 **CAM/DISP0, CAM/DISP1** — 아무 데나 꽂아도 됩니다.
**22핀↔15핀 케이블이 있어야** 꽂힙니다.

```bash
sudo apt install -y python3-picamera2
rpicam-hello --list-cameras     # imx708_wide 가 보여야 함
```

> **Wide(120°) 는 주변부 왜곡이 큽니다.** ORB 매칭이 흔들리면 `cv2.undistort()` 로 보정하거나
> 매칭 영역을 중앙 70% 로 제한하세요. 티칭 1회 후 매칭 신뢰도 분포를 보고 결정합니다.

---

## 3. 소프트웨어 설치

```bash
cd ~
git clone https://github.com/yellowm-ad/sherpi.git sherpy
cd sherpy/robot

# picamera2 를 apt 로 깔았으므로 시스템 패키지가 보이게 만든다
python3 -m venv --system-site-packages .venv
source .venv/bin/activate
pip install -r requirements.txt
```

### 환경변수 (`robot/.env`)

```bash
SHERPY_SERVER_URL=https://sherpy.vercel.app
SHERPY_ROBOT_ID=1
SHERPY_API_KEY=여기에-서버에서-발급받은-키
SHERPY_GPS_PORT=/dev/ttyAMA0
SHERPY_GPS_ENABLED=1
```

> API 키는 서버 DB에 **해시로만** 저장됩니다. 평문은 이 파일에만 둡니다.

### 모듈 단독 점검

```bash
python3 -m bridge.gps            # 측위·속도·위성 수 (실외에서, 콜드 스타트 수십 초)
python3 -m bridge.display        # 7세그 두 개에 장력·줄 길이 흉내값
```

---

## 4. 브리지 모듈

| 파일 | 역할 |
|---|---|
| `bridge/config.py` | 서버·핀·임계값 상수 (임계값은 앱 `THRESHOLDS` 와 동일하게) |
| `bridge/telemetry.py` | 1Hz 상태 업링크 (끊기면 30개까지 버퍼) |
| `bridge/commands.py` | 1Hz 명령 폴링 + 3초 워치독 |
| `bridge/gps.py` | NMEA 파싱 → 위치·**실측 속도**·방위·위성 수 |
| `bridge/display.py` | TM1637 ×2 — RED 장력(N 정수, 30N↑ 점멸) / BLUE 줄 길이(cm 정수, 4.5m↑ 점멸) |
| `bridge/estop.py` | E-stop 물리버튼 → 즉시 `hal.estop()` |
| `hal_pca9685.py` | 조향·스로틀·변속 PWM |

### walkbot 에서 바꿔야 할 것

| 파일 | 변경 |
|---|---|
| `walkbot/hal.py` | `RealHAL` → `robot/hal_pca9685.py` 의 `PCA9685HAL` 로 교체 |
| `walkbot/config.py` | PCA9685 채널 상수, `THRESHOLDS` 를 앱·`bridge/config.py` 와 동일하게 |
| `walkbot/main.py` | 브리지·GPS·표시·E-stop 기동 (아래 예시) |

### main.py 연결 예시

```python
from bridge import TelemetryUplink, CommandDownlink
from bridge import config as C
from bridge.estop import EstopButton
from bridge.display import StatusDisplay
from bridge.gps import GpsReader, telemetry_fields
from hal_pca9685 import PCA9685HAL

hal = PCA9685HAL()
hal.set_gear(low=True)        # 산책 속도는 저속단

def emergency():
    """1차 안전장치 — 네트워크와 무관하게 즉시 정지"""
    hal.estop()
    state.mode = "estop"

estop_btn = EstopButton(on_press=emergency)

gps = GpsReader(C.GPS_PORT, C.GPS_BAUD)
if C.GPS_ENABLED:
    gps.start()

def snapshot():
    """현재 상태를 dict로 — 1Hz로 호출된다"""
    return {
        "mode": state.mode,
        "safety_level": monitor.level,
        "faults": monitor.active_faults(),
        "tension_n": leash.tension_n,
        "leash_len_m": leash.length_m,
        "speed_cmd": driver.speed,
        "steer_cmd": driver.steer,
        "route_id": route.id,
        "kf_index": follower.index,
        "kf_total": len(route.keyframes),
        "match_quality": follower.quality,
        "battery_v": None,           # ADC 미장착 — 앱이 경과시간으로 교체 안내
        **telemetry_fields(gps.snapshot()),   # lat/lng/gps_src="robot"/speed_mps/heading_deg/gps_sats
    }

display = StatusDisplay()
display.start(snapshot)

def on_command(cmd_type, payload):
    if cmd_type == "ESTOP":          emergency()
    elif cmd_type == "START_TEACH":  state.mode = "teach"
    elif cmd_type == "STOP_TEACH":   route.save(); state.mode = "idle"
    elif cmd_type == "START_FOLLOW": state.mode = "follow"
    elif cmd_type == "PAUSE":        state.mode = "idle"
    elif cmd_type == "RESUME":
        if not estop_btn.pressed:    # 물리 버튼이 눌려 있으면 원격으로 풀 수 없다
            state.mode = "follow"
    elif cmd_type == "SET_ROUTE":    route.load(int(payload["route_id"]))
    elif cmd_type == "SET_SPEED_LIMIT":
        # 앱은 {"limit": 1.2} (m/s) 를 보낸다
        driver.speed_limit = float(payload.get("limit", driver.speed_limit))

def on_watchdog():
    """서버 응답이 3초 이상 없으면 스스로 감속·정지"""
    hal.estop()

uplink = TelemetryUplink(); uplink.start(snapshot)
downlink = CommandDownlink(); downlink.start(on_command, on_watchdog)
```

> **GPS 속도로 폐루프 제어가 가능해졌습니다.** MJX H8P 의 모터 엔코더 신호는 ESC 안에서만 쓰여
> 밖으로 나오지 않으므로 GPS 가 유일한 실측 속도원입니다. 다만 저속(<0.5m/s)에서는 노이즈가 커서
> 이동평균 등으로 거른 뒤 써야 합니다.

---

## 5. 영상 (MediaMTX + Cloudflare Tunnel)

```bash
wget https://github.com/bluenviron/mediamtx/releases/latest/download/mediamtx_linux_arm64v8.tar.gz
tar -xzf mediamtx_linux_arm64v8.tar.gz
cp ~/sherpy/robot/mediamtx.yml ./mediamtx.yml
./mediamtx
```

```bash
# 공유기 포트포워딩 없이 고정 HTTPS 주소를 얻는다
cloudflared tunnel --url http://localhost:8889
```

출력된 주소를 앱 환경변수 `NEXT_PUBLIC_ROBOT_STREAM_BASE` 에 넣습니다.

> **⚠️ Pi 5 는 하드웨어 H.264 인코더가 없습니다**(Pi 4 에는 있었음). 소프트웨어 인코딩이라
> ORB 매칭과 CPU 를 나눠 씁니다. Pi 5 는 CPU 여유가 커서 감당할 가능성이 높지만 **실측 전**입니다.
> M3 에서 10분 동시 부하 후 `vcgencmd measure_temp`·경로추종 루프 주기를 확인하고,
> 느리면 영상 해상도·프레임을 낮추세요.

---

## 6. 서비스 등록 (자동 시작)

```ini
# /etc/systemd/system/sherpy-bridge.service
[Unit]
Description=Sherpy robot bridge
After=network-online.target

[Service]
User=pi
WorkingDirectory=/home/pi/sherpy/robot
EnvironmentFile=/home/pi/sherpy/robot/.env
ExecStart=/home/pi/sherpy/robot/.venv/bin/python -m walkbot.main
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now sherpy-bridge
journalctl -u sherpy-bridge -f
```

---

## 7. 점검 순서

1. `vcgencmd get_throttled` → `0x0` (전원 정상)
2. `i2cdetect -y 1` → `36`, `40` 확인
3. `gpioinfo | grep -v unused` → GPIO 5/6/17/19/20/21/26 이 비어 있는지
4. 바퀴를 들고 `PCA9685HAL().drive(0, 0.2)` → 모터가 천천히 도는지
5. 로드셀에 손으로 힘을 줘서 `tension_n` 과 **RED 7세그**가 변하는지
6. 릴을 당겨 `leash_len_m` 과 **BLUE 7세그**가 변하는지
7. 실외에서 `python3 -m bridge.gps` → 위성 4개 이상, 걸으면 속도가 오르는지
8. 서버 대시보드에 값이 2초 내로 올라오고 **실측 속도(GPS)** 칸이 채워지는지
9. **E-stop 버튼 → 즉시 정지**, 버튼을 누른 채로 앱 [정지 해제]가 안 먹는지
10. 앱에서 ESTOP → 2초 내 정지하는지 (보조 수단)
11. **와이파이를 끊어서 3초 뒤 로봇이 스스로 멈추는지** ← 워치독 검증

---

## 8. 알려진 한계

- **아커만 조향이라 제자리 회전 불가** — 멈춘 채로 횡방향 오차를 못 고칩니다.
- **접지력 한계** — 차체 약 9kg 기준 견인 여유 약 54N. **10kg 이상 개는 밸러스트 없이 불가**합니다.
- **배터리 전압을 못 잽니다** — ADC 미장착. 앱이 주행 25분째에 교체를 권합니다.
