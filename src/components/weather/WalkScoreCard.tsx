"use client";

import { useEffect, useState } from "react";
import { Sun, CloudSun, Cloud, CloudRain, Flame, Droplets, Umbrella, Bot, TriangleAlert } from "lucide-react";
import { useTween } from "@/hooks/useTween";
import { calcWalkScore, type WalkScoreResult, type WeatherInput } from "@/lib/weather/walk-score";

/** 시연 장소 — 덕진공원 (전북대 인근) */
export const DEOKJIN = { lat: 35.8486, lng: 127.1229 };

const GRADE_COLOR: Record<WalkScoreResult["grade"], string> = {
  best: "var(--color-level-0)",
  good: "var(--color-sherpy-600)",
  caution: "var(--color-level-1)",
  avoid: "var(--color-level-3)",
};

/** 기상청 키가 없을 때 쓰는 시연용 입력 — 10월 중순 전주 저녁 근사 */
function demoInput(): WeatherInput {
  const hour = new Date(Date.now() + 9 * 3600 * 1000).getUTCHours();
  return { tempC: 17, humidity: 58, windMs: 1.8, popPercent: 10, skyCode: 3, uvIndex: 3, hour };
}

/** S06 홈 상단 — 오늘의 산책적합도 (PRD F-5) */
export default function WalkScoreCard() {
  const [data, setData] = useState<{ raw: WeatherInput; walkScore: WalkScoreResult; demo: boolean } | null>(null);

  useEffect(() => {
    fetch(`/api/weather?lat=${DEOKJIN.lat}&lng=${DEOKJIN.lng}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(String(r.status));
        const j = await r.json();
        setData({ raw: j.raw, walkScore: j.walkScore, demo: false });
      })
      .catch(() => {
        // API 실패해도 앱은 계속 동작 — 시연용 값으로 채우고 표기한다
        const raw = demoInput();
        setData({ raw, walkScore: calcWalkScore(raw), demo: true });
      });
  }, []);

  if (!data) {
    return <section className="skeleton h-56 rounded-3xl" aria-label="날씨 불러오는 중" />;
  }

  const { raw, walkScore: w } = data;
  const color = GRADE_COLOR[w.grade];
  const danger = w.surfaceRisk === "danger";
  const Sky = raw.popPercent >= 60 ? CloudRain : raw.skyCode >= 4 ? Cloud : raw.skyCode >= 3 ? CloudSun : Sun;
  const skyLabel = raw.popPercent >= 60 ? "비 소식" : raw.skyCode >= 4 ? "흐림" : raw.skyCode >= 3 ? "구름 많음" : "맑음";

  return (
    <>
      {danger && (
        <div className="animate-drop mb-3 flex items-start gap-2 rounded-2xl bg-level-3 p-3 text-sm text-white shadow-float">
          <TriangleAlert size={18} className="mt-0.5 shrink-0" />
          <p>지면 추정 {w.surfaceTempC.toFixed(0)}℃ — 발바닥 화상 위험. 해가 진 뒤에 나가세요.</p>
        </div>
      )}

      <section className="animate-fade card p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-[17px] font-semibold"><Sun size={20} className="text-sherpy-600" />오늘의 산책 날씨</h2>
          <span className="text-[11px] font-semibold text-muted">덕진공원 · {data.demo ? "시연값" : "실시간"}</span>
        </div>

        <div className="flex items-center justify-between rounded-2xl border border-line/60 bg-sherpy-50/70 p-3">
          <div className="flex items-center gap-3">
            <Sky size={38} className={Sky === Sun ? "text-level-1" : "text-sherpy-600"} strokeWidth={1.6} />
            <div>
              <p className="flex items-baseline gap-1">
                <span className="metric">{raw.tempC}°</span>
                <span className="text-[13px] font-medium text-body">{skyLabel}</span>
              </p>
              <p className="tabular text-[11px] font-semibold text-muted">
                체감 {w.feelsLikeC.toFixed(0)}° · 바람 {raw.windMs}m/s
              </p>
            </div>
          </div>
          <ScoreRing score={w.score} color={color} label={w.label} />
        </div>

        <div className="mt-2 grid grid-cols-3 gap-1.5 text-center text-[11px] font-semibold text-body">
          <Item icon={<Flame size={13} />} text={`지면 ${w.surfaceTempC.toFixed(0)}° ${w.surfaceRisk === "safe" ? "안전" : w.surfaceRisk === "warn" ? "주의" : "위험"}`} />
          <Item icon={<Droplets size={13} />} text={`습도 ${raw.humidity}%`} />
          <Item icon={<Umbrella size={13} />} text={`강수 ${raw.popPercent}%`} />
        </div>

        <p className="mt-3 flex items-start gap-2.5 rounded-2xl border border-sherpy-600/15 bg-sherpy-600/5 p-2.5 text-[13px] leading-snug">
          <Bot size={18} className="mt-0.5 shrink-0 text-sherpy-600" />
          <span><b className="text-sherpy-600">셰르피 한마디</b> {w.advice}</span>
        </p>
        <p className="mt-2 text-[10px] text-muted">
          {data.demo ? "시연용 날씨 · 기상청 API 키 등록 후 실측값으로 바뀝니다 · " : "기상청 단기예보 · "}
          산책지수는 자체 설계 지표 · 지면온도는 추정치
        </p>
      </section>
    </>
  );
}

/** 산책지수 고리 — 0에서 차오르며 숫자도 함께 올라간다(카운트업) */
function ScoreRing({ score, color, label }: { score: number; color: string; label: string }) {
  const v = useTween(score, 1100, 0);
  return (
    <div className="flex flex-col items-center gap-0.5">
      <div className="animate-pop relative flex h-16 w-16 items-center justify-center">
        <svg viewBox="0 0 36 36" className="absolute inset-0 -rotate-90">
          <circle cx="18" cy="18" r="15.5" fill="none" stroke="var(--color-line)" strokeWidth="3.2" />
          <circle cx="18" cy="18" r="15.5" fill="none" stroke={color} strokeWidth="3.2" strokeLinecap="round"
                  strokeDasharray={`${(v / 100) * 97.4} 97.4`} />
        </svg>
        <div className="text-center leading-none">
          <span className="tabular text-xl font-extrabold">{Math.round(v)}</span>
          <span className="block text-[9px] font-semibold text-muted">산책지수</span>
        </div>
      </div>
      <span className="rounded-full px-2 py-0.5 text-[10px] font-bold" style={{ color, background: `color-mix(in srgb, ${color} 12%, transparent)` }}>{label}</span>
    </div>
  );
}

function Item({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <p className="tabular flex items-center justify-center gap-1 truncate rounded-xl bg-bg py-1.5">
      <span className="text-sherpy-600">{icon}</span>{text}
    </p>
  );
}
