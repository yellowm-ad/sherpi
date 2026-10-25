"""
GPS 리더 — NMEA 문장을 파싱해 위치·속도를 돌려준다.

[왜 GPS를 다는가]
PRD 초안에서는 비용을 아끼려고 보호자 스마트폰의 GPS를 로봇 위치로 쓰기로 했다
(gps_src="phone"). GPS 모듈을 달면 두 가지가 좋아진다.

  ① 로봇이 자기 위치를 스스로 보고한다. 보호자가 멀어져도 정확하다.
  ② ★ 지면 대비 속도(ground speed)를 직접 잰다.
     PRD §8-1에 "속도 피드백이 없어 속도 제어가 개루프가 된다"고 적어둔 문제가
     이걸로 풀린다. MJX H8P의 자기엔코더 신호는 ESC 내부에서만 쓰여
     외부로 나오지 않기 때문에, GPS 속도가 유일한 실측 속도원이다.

[연결 방식 — ⚠️ 라즈베리파이 5 기준]
  UART 모듈(NEO-6M 등) : /dev/ttyAMA0, 9600 baud  ← 기본값
  USB 동글(VK-172 등)  : /dev/ttyACM0, 9600 baud

⚠️ Pi 5에서는 /dev/serial0 을 쓰면 안 된다.
   Pi 4까지는 serial0 이 GPIO 14/15 를 가리켰지만, Pi 5에서는 3핀 디버그 커넥터를 가리킨다.
   GPIO 14/15 의 UART0 는 /dev/ttyAMA0 이다.

   /boot/firmware/config.txt 에 아래 한 줄을 넣고 재부팅한다.
       dtparam=uart0=on
   그리고 raspi-config 에서 시리얼 로그인 셸은 No, 하드웨어는 Yes 로 둔다.
   Pi 5는 블루투스가 별도 UART를 쓰므로 dtoverlay=disable-bt 가 필요 없다.
   mini-UART 보드레이트 불안정 문제도 없다 (RP1의 PL011).

설치: pip install pyserial pynmea2
"""
import threading
import time
from dataclasses import dataclass

import pynmea2
import serial


@dataclass
class GpsFix:
    lat: float | None = None
    lng: float | None = None
    speed_mps: float | None = None   # 지면 대비 속도
    heading_deg: float | None = None
    satellites: int = 0
    hdop: float | None = None
    fix_quality: int = 0             # 0 = 측위 실패
    updated_at: float = 0.0

    @property
    def valid(self) -> bool:
        """측위가 유효한가. 30초 넘게 갱신이 없으면 무효로 본다."""
        return (
            self.fix_quality > 0
            and self.lat is not None
            and (time.time() - self.updated_at) < 30.0
        )


class GpsReader:
    """백그라운드 스레드로 NMEA를 계속 읽어 최신 측위를 보관한다."""

    def __init__(self, port: str = "/dev/ttyAMA0", baud: int = 9600) -> None:
        self.port = port
        self.baud = baud
        self.fix = GpsFix()
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self._lock = threading.Lock()

    def start(self) -> None:
        self._thread = threading.Thread(target=self._loop, daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        if self._thread:
            self._thread.join(timeout=2)

    def snapshot(self) -> GpsFix:
        with self._lock:
            return GpsFix(**self.fix.__dict__)

    def _loop(self) -> None:
        while not self._stop.is_set():
            try:
                with serial.Serial(self.port, self.baud, timeout=2) as ser:
                    print(f"[gps] {self.port} @ {self.baud} 연결됨")
                    while not self._stop.is_set():
                        raw = ser.readline().decode("ascii", errors="replace").strip()
                        if raw.startswith("$"):
                            self._parse(raw)
            except serial.SerialException as e:
                # 모듈을 뽑았다 꽂아도 알아서 재연결되게 둔다
                print(f"[gps] 포트 열기 실패: {e} — 5초 뒤 재시도")
                time.sleep(5)
            except Exception as e:
                print(f"[gps] {e}")
                time.sleep(1)

    def _parse(self, raw: str) -> None:
        try:
            msg = pynmea2.parse(raw)
        except pynmea2.ParseError:
            return

        with self._lock:
            t = msg.sentence_type

            if t == "GGA":
                q = int(msg.gps_qual or 0)
                self.fix.fix_quality = q
                if q > 0:
                    self.fix.lat = msg.latitude
                    self.fix.lng = msg.longitude
                    self.fix.satellites = int(msg.num_sats or 0)
                    self.fix.hdop = float(msg.horizontal_dil) if msg.horizontal_dil else None
                    self.fix.updated_at = time.time()

            elif t == "RMC" and msg.status == "A":
                self.fix.lat = msg.latitude
                self.fix.lng = msg.longitude
                if msg.spd_over_grnd is not None:
                    # NMEA는 knot 단위 → m/s (1 knot = 0.514444 m/s)
                    self.fix.speed_mps = float(msg.spd_over_grnd) * 0.514444
                if msg.true_course is not None:
                    self.fix.heading_deg = float(msg.true_course)
                self.fix.updated_at = time.time()

            elif t == "VTG":
                if msg.spd_over_grnd_kmph is not None:
                    self.fix.speed_mps = float(msg.spd_over_grnd_kmph) / 3.6


def telemetry_fields(fix: GpsFix) -> dict:
    """snapshot() 에 합칠 텔레메트리 필드. 측위가 무효면 빈 dict — 기존 값(휴대폰 GPS 등)을 덮지 않는다.

        state = {..., **telemetry_fields(gps.snapshot())}
    """
    if not fix.valid:
        return {"gps_sats": fix.satellites}
    return {
        "lat": fix.lat,
        "lng": fix.lng,
        "gps_src": "robot",
        "speed_mps": fix.speed_mps,
        "heading_deg": fix.heading_deg,
        "gps_sats": fix.satellites,
    }


# ── 단독 실행 테스트 ────────────────────────────
# python3 -m bridge.gps            (UART)
# python3 -m bridge.gps /dev/ttyACM0   (USB 동글)
if __name__ == "__main__":
    import sys

    port = sys.argv[1] if len(sys.argv) > 1 else "/dev/ttyAMA0"
    g = GpsReader(port)
    g.start()
    print("측위를 기다리는 중… (실외에서, 콜드 스타트는 수십 초 걸릴 수 있음)")
    try:
        while True:
            f = g.snapshot()
            if f.valid:
                print(
                    f"✓ {f.lat:.6f}, {f.lng:.6f}  "
                    f"속도 {f.speed_mps or 0:.2f} m/s  "
                    f"위성 {f.satellites}  HDOP {f.hdop}"
                )
            else:
                print(f"… 측위 대기 (위성 {f.satellites}, quality {f.fix_quality})")
            time.sleep(1)
    except KeyboardInterrupt:
        g.stop()
