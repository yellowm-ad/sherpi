"""
로봇 상태 점검 — 웹 [로봇 관리] 화면에 보여줄 연결·전원·부품 상태를 모은다.

모두 '읽기만' 하는 고정 명령이고, 각각 짧은 시간 제한이 있어 하나가 막혀도 전체가 멈추지 않는다.
없는 장치·프로그램은 None(모름)으로 둔다.
"""
import os
import shutil
import socket
import subprocess
import time
from pathlib import Path

from . import config as C


def _run(argv: list[str], timeout: float = 3.0) -> str | None:
    if not shutil.which(argv[0]):
        return None
    try:
        r = subprocess.run(argv, capture_output=True, text=True, timeout=timeout)
        return r.stdout if r.returncode == 0 else None
    except (subprocess.TimeoutExpired, OSError):
        return None


def wifi() -> dict:
    """연결된 와이파이 이름·신호 세기(0~100)"""
    out = _run(["nmcli", "-t", "-f", "ACTIVE,SSID,SIGNAL", "dev", "wifi"])
    if out:
        for line in out.splitlines():
            parts = line.rsplit(":", 1)        # SSID 에 ':' 가 있을 수 있어 뒤에서 자른다
            if len(parts) == 2 and parts[0].startswith("yes:"):
                ssid = parts[0][4:].replace("\\:", ":")
                return {"ssid": ssid[:64], "signal": int(parts[1]) if parts[1].isdigit() else None}
    return {"ssid": None, "signal": None}


def local_ip() -> str | None:
    """같은 와이파이/핫스팟에서 SSH 할 때 쓰는 내부 주소 (실제 전송 없음)"""
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("1.1.1.1", 80))
            return s.getsockname()[0]
    except OSError:
        return None


def power() -> dict:
    """vcgencmd get_throttled: bit0 지금 저전압, bit16 부팅 후 저전압 있었음, bit2/18 온도 제한"""
    out = _run(["vcgencmd", "get_throttled"])
    if not out or "=" not in out:
        return {"undervoltNow": None, "undervoltSinceBoot": None, "throttled": None}
    v = int(out.strip().split("=")[1], 16)
    return {"undervoltNow": bool(v & 0x1), "undervoltSinceBoot": bool(v & 0x10000), "throttled": bool(v & 0x4)}


def cpu_temp() -> float | None:
    try:
        return round(int(Path("/sys/class/thermal/thermal_zone0/temp").read_text()) / 1000, 1)
    except (OSError, ValueError):
        return None


def uptime_s() -> int | None:
    try:
        return int(float(Path("/proc/uptime").read_text().split()[0]))
    except (OSError, ValueError, IndexError):
        return None


def i2c_devices() -> dict:
    """PCA9685(모터 드라이버, 0x40) · AS5600(엔코더, 0x36) 응답 여부"""
    try:
        from smbus2 import SMBus  # type: ignore
    except ImportError:
        return {"motorDriver": None, "encoder": None}
    found = {}
    try:
        with SMBus(1) as bus:
            for name, addr in (("motorDriver", C.I2C_ADDRESS), ("encoder", 0x36)):
                try:
                    bus.read_byte(addr)
                    found[name] = True
                except OSError:
                    found[name] = False
    except (OSError, FileNotFoundError):
        return {"motorDriver": None, "encoder": None}
    return found


def camera_present(streaming: bool) -> bool | None:
    """카메라 연결 여부. 송출 중이면 카메라를 쓰는 중이라 확인 생략(=있음)."""
    if streaming:
        return True
    out = _run(["rpicam-hello", "--list-cameras"], timeout=8)
    if out is None:
        return None
    return "Available cameras" in out and "No cameras" not in out


def collect(streaming: bool, full: bool, server_ms: float | None) -> dict:
    """full=True 면 카메라·I2C 까지 (몇 초 걸림). 평소 10초 보고는 가벼운 것만."""
    h = {
        "wifi": wifi(),
        "ip": local_ip(),
        "serverMs": None if server_ms is None else round(server_ms),
        "power": power(),
        "cpuTemp": cpu_temp(),
        "uptime": uptime_s(),
        "stream": streaming,
        "gpsPort": os.path.exists(C.GPS_PORT),
        "agentAt": int(time.time()),
    }
    if full:
        h["devices"] = {**i2c_devices(), "camera": camera_present(streaming)}
        h["checkedAt"] = int(time.time())
    return h
