"""브리지 설정 — 로봇에서 .env 또는 환경변수로 주입한다. (라즈베리파이 5 기준)"""
import os

SERVER_URL = os.environ.get("SHERPY_SERVER_URL", "https://sherpy.vercel.app")
ROBOT_ID   = int(os.environ.get("SHERPY_ROBOT_ID", "1"))
API_KEY    = os.environ.get("SHERPY_API_KEY", "")

TELEMETRY_HZ   = 1.0    # 상태 업링크 주기
COMMAND_HZ     = 1.0    # 명령 폴링 주기
HTTP_TIMEOUT   = 3.0    # 초
BUFFER_MAX     = 30     # 네트워크 끊김 시 로컬 버퍼 최대 개수

# ── 핀 배정 한눈에 (BCM 번호) ──────────────────
# ⚠️ I2C 를 켜면 GPIO 2/3 이 커널 드라이버에 점유된다("GPIO busy").
#    HX711·TM1637·E-stop 은 반드시 2/3 을 피한다. 점유 확인: gpioinfo | grep -v unused
#
#   I2C SDA/SCL      GPIO 2 / 3    PCA9685 0x40, AS5600 0x36
#   HX711 DT/SCK     GPIO 5 / 6
#   TM1637 #1 (RED)  GPIO 20 / 21  견인 장력
#   TM1637 #2 (BLUE) GPIO 19 / 26  줄 길이
#   GPS UART TX/RX   GPIO 14 / 15  /dev/ttyAMA0
#   E-stop           GPIO 17       풀업, 눌리면 LOW

# ── PCA9685 (I2C) ──────────────────────────────
# 확정 BOM: SunFounder PCA9685 ×2. 쓰는 채널은 3개뿐이라 1개면 충분하고 1개는 예비.
# 두 보드의 기본 주소가 둘 다 0x40 이라, 동시에 쓰려면 두 번째 보드의 A0 점퍼를
# 납땜해 0x41 로 바꾼 뒤 I2C_ADDRESS_2 를 쓴다.
I2C_ADDRESS   = 0x40
I2C_ADDRESS_2 = 0x41    # 예비 보드 — 쓸 때만
PWM_FREQ_HZ   = 50      # RC 표준
CH_STEER      = 0       # 조향 서보 (35kg)
CH_THROTTLE   = 1       # ESC 스로틀
CH_GEAR       = 2       # 변속 서보 (2단 기어)

PWM_MIN_US    = 1000
PWM_NEUTRAL_US= 1500
PWM_MAX_US    = 2000

# ── 안전 ───────────────────────────────────────
# 서버 명령을 이 시간 이상 못 받으면 스스로 감속·정지한다.
# 원격 정지는 보조 수단이고, 1차 안전장치는 물리 E-stop 버튼이다.
WATCHDOG_SEC  = 3.0

# ── 안전 임계값 ────────────────────────────────
# ⚠️ 이 값들은 walkbot/config.py 및 웹의 src/lib/robot/types.ts 의 THRESHOLDS 와
#    반드시 같아야 한다. 한쪽만 바꾸면 LED·앱 표시와 로봇 동작이 어긋난다.
F_SOFT  = 8.0     # N — 감속 시작
F_HARD  = 30.0    # N — 강한 견인, LED 점멸 + pull_count 집계
F_ESTOP = 40.0    # N — 비상정지
L_SOFT  = 3.0     # m
L_HARD  = 4.5     # m — LED 점멸
L_MAX   = 5.0     # m

# ── E-stop 물리버튼 (1차 안전장치) ─────────────
ESTOP_PIN        = 17    # 풀업, 눌리면 LOW
ESTOP_ACTIVE_LOW = True

# ── GPS (⚠️ 라즈베리파이 5) ────────────────────
# Pi 5에서 /dev/serial0 은 3핀 디버그 커넥터를 가리킨다.
# GPIO 14/15 의 UART0 는 /dev/ttyAMA0 이다. (Pi 4와 다름)
# /boot/firmware/config.txt 에 dtparam=uart0=on 필요. USB 동글이면 /dev/ttyACM0.
GPS_PORT    = os.environ.get("SHERPY_GPS_PORT", "/dev/ttyAMA0")
GPS_BAUD    = int(os.environ.get("SHERPY_GPS_BAUD", "9600"))
GPS_ENABLED = os.environ.get("SHERPY_GPS_ENABLED", "1") == "1"

# ── 로드셀 HX711 ───────────────────────────────
HX711_DT  = 5
HX711_SCK = 6

# ── TM1637 7세그먼트 LED ×2 ────────────────────
TM1637_1_CLK = 20   # LED_1 (RED)  — 견인 장력 (N, 정수)
TM1637_1_DIO = 21
TM1637_2_CLK = 19   # LED_2 (BLUE) — 줄 길이 (cm, 정수)
TM1637_2_DIO = 26
