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

### 로봇마다 키 따로 발급 (양산 대비)

로봇 1대 = 시리얼 1개 = 키 1개. 키를 여러 로봇이 공유하지 않습니다. 앱은 로봇 번호를 고정하지 않고
**로그인한 보호자 계정에 등록된 로봇**(`robots.owner_id`)을 찾아 연결합니다. 등록된 로봇이 없으면 가상 셰르피 시연.

```bash
# 노트북 (sherpy 루트, .env.local 의 DATABASE_URL 사용)
node scripts/robot-key.mjs                         # 목록
node scripts/robot-key.mjs register qa8225 "셰르피 1호" # 새 로봇 → robot/provision/<시리얼>.env
node scripts/robot-key.mjs rotate 1                # 분실·유출 시 재발급 (이전 키 즉시 무효)

# 키 파일을 해당 로봇으로 복사
scp robot/provision/<시리얼>.env pi@<파이IP>:~/sherpy/robot/.env
```

`robot/provision/` 은 `.gitignore` 대상입니다. 페어링 코드(앱에서 보호자가 직접 로봇 등록)는 추후 과제.

### 부품 없이 웹 연동 점검

```bash
python3 connect_test.py   # 테스트 값 1 Hz 업링크 + 앱 명령 수신·ack (모터·센서 사용 안 함)
```

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
| `bridge/display.py` | TM1637 ×2 — RED 장력(N 정수, 16N↑ 점멸, 35N↑ 전체 점멸) / BLUE 줄 길이(cm 정수, 2.76m↑ 점멸) |
| `sherpy_core/` | 🆕 25 Hz 처리 파이프라인 — 장력 보정·릴 길이·카메라 θ → EKF 강아지 위치 → L0~L3 → v·δ·릴 명령 ([MATH_MODEL.md](MATH_MODEL.md)) |
| `bridge/estop.py` | E-stop 물리버튼 → 즉시 `hal.estop()` |
| `hal_pca9685.py` | 조향·스로틀·변속 PWM |

### walkbot 에서 바꿔야 할 것

| 파일 | 변경 |
|---|---|
| `walkbot/hal.py` | `RealHAL` → `robot/hal_pca9685.py` 의 `PCA9685HAL` 로 교체 |
| `walkbot/config.py` | PCA9685 채널 상수, `THRESHOLDS` 를 앱·`bridge/config.py`·`sherpy_core/params.py` 와 동일하게 (7.3: 16/35 N, 릴 1.2~3.0 m) |
| `walkbot/leash.py` · `safety.py` | 장력·릴·안전 판단을 `sherpy_core.SherpyCore.step()` 호출로 교체 (아래 예시) |
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
        # 강아지 추정 (sherpy_core) — 최근 CoreOutput 에서
        "dog_bearing_deg": math.degrees(core_out["est"]["theta"]),
        "dog_dist_m": core_out["est"]["d"],
        "dog_sigma_m": core_out["est"]["sigma"],
        "dog_track": core_out["track"],
        "tension_filt_n": core_out["That"],
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

### sherpy_core — 25 Hz 처리 루프 (2026-11-01)

웹 시뮬레이터 실전 모드와 **같은 계산**이다 (골든 테스트 일치). 센서 원시값을 그대로 넣는다.

```python
import math, time
from sherpy_core import SherpyCore, CoreConfig, SimParams, HwParams

fit = {"a": 1.2e-3, "b": -0.35}           # HX711 보정 결과 (하중 7점 최소제곱 — fit_linear)
core = SherpyCore(CoreConfig(SimParams(), HwParams(), fit, reelMode="tension", L0=leash_initial_m))
t0 = time.monotonic()
while True:
    out = core.step({
        "t": time.monotonic() - t0,
        "loadRaw": hx711.read_if_ready(),            # 준비 안 됐으면 None
        "encRaw": as5600.raw_angle(),                 # 0~4095, 실패 시 None (CONF.HYST=00)
        "cam": detector.latest(),                     # {"u": px, "h": px} 또는 None
        "odo": {"v": wheel_speed(), "yawRate": gyro_z()},
        "geom": None,                                 # 장애물 인식이 생기면 이격거리 dict
    })
    driver.set(out["cmd"]["v"], out["cmd"]["steer"])
    reel.set_speed(out["cmd"]["reelRate"])            # m/s (+ 인출)
    if out["hold"]: hal.brake()
    core_out = out
    time.sleep(max(0, 0.04 - (time.monotonic() - t0) % 0.04))
```

검증: `cd robot && python -m sherpy_core.verify_golden` (먼저 웹 저장소에서 `npm run verify:math` 로 골든 로그 생성)

---

## 5. 영상 (MediaMTX + Cloudflare Tunnel)

```bash
# 한 번만 설치
mkdir -p ~/mediamtx && cd ~/mediamtx
wget https://github.com/bluenviron/mediamtx/releases/download/v1.21.3/mediamtx_v1.21.3_linux_arm64.tar.gz
tar -xzf mediamtx_v1.21.3_linux_arm64.tar.gz
cd ~ && wget https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64.deb
sudo dpkg -i cloudflared-linux-arm64.deb

# 송출 (MediaMTX + 임시 터널 + 서버에 주소 등록까지 한 번에)
cd ~/sherpy/robot && source .venv/bin/activate && python3 stream.py
```

영상 주소는 **로봇마다** 서버(`robots.stream_url`)에 저장됩니다. `stream.py` 가 터널 주소를 받아
`PUT /api/robots/:id/stream-url` 로 올리고, 앱은 `/api/me` 로 15초마다 받아 갑니다.
`NEXT_PUBLIC_ROBOT_STREAM_BASE` 는 로봇이 주소를 안 올렸을 때의 예비값일 뿐입니다.

> **영상 데이터는 터널이 아니라 브라우저↔파이 직접(WebRTC)** 입니다. 같은 와이파이·핫스팟에서는 바로 되고,
> 다른 망(LTE)에서 보려면 TURN 서버가 필요합니다.

> **⚠️ Pi 5 는 하드웨어 H.264 인코더가 없습니다**(Pi 4 에는 있었음). 소프트웨어 인코딩이라
> ORB 매칭과 CPU 를 나눠 씁니다. Pi 5 는 CPU 여유가 커서 감당할 가능성이 높지만 **실측 전**입니다.
> M3 에서 10분 동시 부하 후 `vcgencmd measure_temp`·경로추종 루프 주기를 확인하고,
> 느리면 영상 해상도·프레임을 낮추세요.

---

## 6. 서비스 등록 (자동 시작)

### 지금 쓰는 것 — 에이전트 (2026-11-09, 웹 버튼으로 관리)

```bash
cd ~/sherpy && git pull
bash ~/sherpy/robot/install_agent.sh      # 한 번만. 이후로는 전원만 켜면 웹에 연결
journalctl -u sherpy-agent -f             # 로그
```

`robot/agent.py` 가 부팅 때 저절로 실행돼 웹 **로봇 → 로봇 관리** 화면의 버튼을 처리한다.

| 버튼 | 명령 | 로봇이 하는 일 |
|---|---|---|
| 카메라 켜기 / 끄기 | `CAMERA_ON` / `CAMERA_OFF` | `bridge/streamer.py` — MediaMTX + 임시 터널, 켤 때마다 새 시청 비밀번호 |
| 지금 점검 | `SYS_CHECK` | `bridge/system.py` — 와이파이·신호·서버 응답·저전압·온도·PCA9685·AS5600·카메라 |
| 다시 시작 / 안전하게 끄기 | `REBOOT` / `POWER_OFF` | `confirm: true` 일 때만, 주행 중이면 거부, 3초 뒤 `sudo -n systemctl reboot·poweroff` |

보안 원칙
- 파이는 들어오는 연결을 받지 않는다 — 파이가 서버로 나가서 명령을 가져온다(포트 개방·포트포워딩 없음).
- 명령은 로봇 주인 세션만 넣을 수 있고(서버), 로봇은 자기 키로만 가져간다. 키 파일 `robot/.env` 는 600 권한.
- 웹에서 온 값을 셸 명령으로 실행하지 않는다. 정해진 명령 이름만 처리하고 나머지는 무시.
- sudo 는 `systemctl reboot`·`systemctl poweroff` 두 개만 비밀번호 없이 허용 (`/etc/sudoers.d/sherpy-agent`, visudo 검사 통과 시에만 설치).
- 영상은 시청 비밀번호(Basic 인증)가 있어야 열린다. 비밀번호는 서버를 거쳐 로봇 주인에게만 전달.
- 로봇이 꺼져 있던 동안 쌓인 명령은 15초 지나면 버린다(ESTOP 제외) — 다시 켰을 때 예전 버튼이 뒤늦게 실행되지 않게.
- 명령은 로봇당 1분 30개까지(ESTOP 제외).

⚠️ 에이전트가 도는 동안 `stream.py`·`connect_test.py` 를 따로 켜지 말 것 (카메라·명령 폴링이 겹침).
모터 제어 프로그램이 생기면 에이전트에 합친다 (명령 폴링은 한 프로세스만).

### 나중 — 주행 프로그램 (예정)

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
