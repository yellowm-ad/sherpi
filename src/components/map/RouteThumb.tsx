/**
 * 코스 모양 썸네일 — 코스 카드 머리. 실제 경유점을 그대로 그린다 (지도 SDK 없이 가볍게).
 * 스티치 안의 풍경 사진 자리를 대신한다: 사진보다 "어떤 모양의 길인지"가 산책 고르기에 더 쓸모 있다.
 */
export default function RouteThumb({ points, className = "" }: { points: [number, number][]; className?: string }) {
  const W = 320, H = 144, PAD = 22;
  const lats = points.map((p) => p[0]), lngs = points.map((p) => p[1]);
  const [minLat, maxLat, minLng, maxLng] = [Math.min(...lats), Math.max(...lats), Math.min(...lngs), Math.max(...lngs)];
  // 위도 1도와 경도 1도의 실제 길이가 다르므로 경도에 cos(위도)를 곱해 모양이 찌그러지지 않게
  const kx = Math.cos(((minLat + maxLat) / 2) * Math.PI / 180);
  const spanX = Math.max((maxLng - minLng) * kx, 1e-6), spanY = Math.max(maxLat - minLat, 1e-6);
  const s = Math.min((W - PAD * 2) / spanX, (H - PAD * 2) / spanY);
  const ox = (W - spanX * s) / 2, oy = (H - spanY * s) / 2;
  const xy = points.map(([lat, lng]) => [ox + (lng - minLng) * kx * s, oy + (maxLat - lat) * s] as const);
  const d = xy.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const [sx, sy] = xy[0] ?? [0, 0];

  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid slice" className={className} aria-hidden>
      <defs>
        <linearGradient id="rt-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--color-sherpy-50)" />
          <stop offset="1" stopColor="var(--color-mint-50)" />
        </linearGradient>
      </defs>
      <rect width={W} height={H} fill="url(#rt-bg)" />
      {/* 지도 느낌의 옅은 길 */}
      <path d={`M-10,${H * 0.75} Q${W * 0.35},${H * 0.45} ${W + 10},${H * 0.6}`} fill="none" stroke="white" strokeWidth="12" strokeLinecap="round" opacity=".9" />
      <path d={`M${W * 0.2},-10 Q${W * 0.3},${H * 0.6} ${W * 0.55},${H + 10}`} fill="none" stroke="white" strokeWidth="8" strokeLinecap="round" opacity=".8" />
      <path d={d} fill="none" stroke="var(--color-sherpy-600)" strokeOpacity=".18" strokeWidth="12" strokeLinecap="round" strokeLinejoin="round" />
      <path d={d} fill="none" stroke="var(--color-sherpy-600)" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={sx} cy={sy} r="6" fill="var(--color-mint)" stroke="white" strokeWidth="2.5" />
    </svg>
  );
}
