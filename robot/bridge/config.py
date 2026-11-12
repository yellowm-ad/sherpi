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
CH_GEAR       = 2       # 변속 서보 (2단 기어) — 기본은 연결하지 않음
# 변속 서보는 개입하지 않는 설계(2026-11-12): 산책은 저속단만 쓰므로 조종기로 저속단에 둔 뒤
# 변속 서보 선은 PCA9685 에 꽂지 않는다(기어 빠지면 변속 링크를 저속 위치에 케이블타이로 고정).
# 나중에 변속 서보를 CH2 에 연결했다면 robot/.env 에 SHERPY_GEAR_SERVO=on.
GEAR_SERVO    = os.environ.get("SHERPY_GEAR_SERVO", "off") == "on"

PWM_MIN_US    = 1000
PWM_NEUTRAL_US= 1500
PWM_MAX_US    = 2000

# ── 안전 ───────────────────────────────────────
# 서버 명령을 이 시간 이상 못 받으면 스스로 감속·정지한다.
# 원격 정지는 보조 수단이고, 1차 안전장치는 물리 E-stop 버튼이다.
WATCHDOG_SEC  = 3.0

# ── 모터 출력 / 수동 조종 (조이스틱 — 티칭 때 사람이 몬다) ─────
# 기본은 '시험 모드': PCA9685 로 신호를 보내지 않고 보낼 값만 계산해 앱에 보여 준다.
# 배선을 끝내고 바퀴를 바닥에서 띄운 상태에서 robot/.env 에 SHERPY_MOTOR=on 을 넣어야 실제로 나간다.
MOTOR_LIVE       = os.environ.get("SHERPY_MOTOR", "off") == "on"
JOY_PORT         = 8890      # 파이 안에서만 여는 포트 (127.0.0.1) — 밖에서는 터널로만 들어온다
JOY_DEADMAN_SEC  = 0.3       # 이 시간 동안 조종 신호가 없으면 스스로 정지
JOY_MAX_THROTTLE = float(os.environ.get("SHERPY_JOY_MAX", "0.25"))  # 스로틀 상한 (전진 0~1 중). 처음엔 낮게
JOY_STEER_MAX    = 1.0       # 조향 상한 (±1 = 서보 끝까지)
JOY_DEAD_ZONE    = 0.08      # 스틱 가운데 흔들림 무시
JOY_MAX_HZ       = 30        # 이보다 자주 오는 신호는 건너뜀 (0 신호는 항상 처리)

# ── 자율주행 인식 — 실시간 화면 · 전력 절약 ──
LIVE_PORT     = 8891        # 인식 화면 직접 보기 (127.0.0.1, 밖에서는 터널로만)
LIVE_EVERY    = 0.2         # 초 — 직접 보기 사진 간격 (초당 5장)
LIVE_MAX_VIEWERS = 3
# 인식이 CPU 4코어를 다 쓰면 순간 전류가 커져 전원이 약할 때 파이가 재부팅된다(Undervoltage).
# 코어 수·초당 장수를 줄여 전류를 낮춘다. 5V 5A 정품 어댑터면 4 / 10 으로 올려도 된다.
VISION_CORES  = max(1, min(4, int(os.environ.get("SHERPY_VISION_CORES", "2"))))
VISION_FPS    = max(2, min(15, int(os.environ.get("SHERPY_VISION_FPS", "6"))))

# ── 안전 임계값 (SHERPY 7.3 기준, 2026-11-01 갱신) ─────
# ⚠️ 웹 src/lib/robot/types.ts 의 THRESHOLDS · robot/sherpy_core/params.py 와 반드시 같아야 한다.
F_CAUTION = 8.0   # N — L1 주의 표시 (warn/2)
F_WARN    = 16.0  # N — L2 경고: 명령속도 ≤ 0.2 m/s, LED 점멸 + pull_count 집계
F_STOP    = 35.0  # N — L3 정지: HOLD 래치 (자동 복귀 없음)
L_MIN     = 1.2   # m — 릴 최소 인출
L_SOFT    = 2.76  # m — 릴 한계 근접 (0.92 × L_MAX), LED 점멸
L_MAX     = 3.0   # m — 릴 최대 인출 (reelMax)

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
