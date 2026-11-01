/**
 * 지도 좌표 변환 — 로봇 GPS + 방위 + 로봇 기준 강아지 상대위치 → 강아지 위경도
 *
 * 국소 접평면(ENU) 근사: 수백 m 범위에서 오차 mm 수준.
 *   WGS84 장반경 a = 6378137 m, 이심률² e² = 6.69437999014e-3
 *   자오선 곡률반경 M = a(1−e²)/(1−e² sin²φ)^{3/2},  묘유선 곡률반경 N = a/√(1−e² sin²φ)
 *   북쪽 = Δφ·M,  동쪽 = Δλ·N·cosφ   (φ, λ 는 라디안)
 * 로봇 방위 H(0 = 북, 시계방향) 일 때 로봇 좌표(+x 오른쪽, +y 전방) → 동·북:
 *   동 = y_r·sinH + x_r·cosH,   북 = y_r·cosH − x_r·sinH
 */
const A = 6378137;
const E2 = 6.69437999014e-3;
const RAD = Math.PI / 180;

export interface LatLng { lat: number; lng: number }

function radii(lat: number) {
  const s = Math.sin(lat * RAD);
  const w = 1 - E2 * s * s;
  return { M: (A * (1 - E2)) / Math.pow(w, 1.5), N: A / Math.sqrt(w) };
}

export function toLatLng(o: LatLng, east: number, north: number): LatLng {
  const { M, N } = radii(o.lat);
  return { lat: o.lat + north / M / RAD, lng: o.lng + east / (N * Math.cos(o.lat * RAD)) / RAD };
}

export function toLocal(o: LatLng, lat: number, lng: number) {
  const { M, N } = radii(o.lat);
  return { north: (lat - o.lat) * RAD * M, east: (lng - o.lng) * RAD * N * Math.cos(o.lat * RAD) };
}

/** 로봇 기준 상대위치 (x_r 오른쪽, y_r 전방) → 동·북 [m] */
export function relToEN(headingDeg: number, xr: number, yr: number) {
  const h = headingDeg * RAD;
  return { east: yr * Math.sin(h) + xr * Math.cos(h), north: yr * Math.cos(h) - xr * Math.sin(h) };
}

export function dogLatLng(robot: LatLng, headingDeg: number, rel: { xr: number; yr: number }): LatLng {
  const en = relToEN(headingDeg, rel.xr, rel.yr);
  return toLatLng(robot, en.east, en.north);
}

/**
 * 강아지 위치 반경 [m] (지도 원으로 표시) — 추정 1σ 와 GPS 오차를 합성.
 * GPS 수평오차 ≈ HDOP × UERE(약 5 m)지만 위성 수만 받으므로 위성 수로 거칠게 근사한다.
 */
export function dogRadius(sigmaEst: number, sats: number | null) {
  const gps = sats == null || sats <= 0 ? 10 : sats >= 9 ? 2.5 : sats >= 6 ? 4 : 7;
  return Math.hypot(sigmaEst, gps);
}

/** 시뮬레이터 지역좌표(x 오른쪽, y 전방)를 덕진공원 위에 얹는 기준점 */
// 덕진공원 기본 산책로(코스 12) 첫 구간 시작점 — 남서쪽으로 약 270 m 곧은 길 (40초 실험은 25 m 안팎)
export const SIM_ANCHOR = { lat: 35.849728, lng: 127.124172, headingDeg: 213.5 } as const;

export function simToLatLng(x: number, y: number): LatLng {
  const en = relToEN(SIM_ANCHOR.headingDeg, x, y);
  return toLatLng(SIM_ANCHOR, en.east, en.north);
}
