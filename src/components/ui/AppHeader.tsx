"use client";

import Image from "next/image";
import Link from "next/link";
import { Bot, UserRound } from "lucide-react";
import type { ConnState, TelemetryRow } from "@/hooks/useRobotStream";
import { useUser } from "@/lib/session";

const MODE = { idle: "대기", teach: "티칭", follow: "주행 중", estop: "정지" } as const;

/** 홈 상단 바 — 로고 + 셰르피 연결 상태 알약 + 내 정보 (DESIGN.md Top App Bar) */
export default function AppHeader({ latest, state }: { latest: TelemetryRow | null; state: ConnState }) {
  const user = useUser();
  const dot = state === "online" ? "text-mint" : state === "offline" ? "text-level-3" : "text-level-1";

  return (
    <header className="sticky top-0 z-30 flex items-center justify-between gap-2 bg-bg/90 px-4 py-2.5 backdrop-blur-md">
      <Link href="/home" aria-label="셰르피 홈" className="press shrink-0">
        <Image src="/logo.png" alt="SHERPY — 강아지를 자유롭게" width={703} height={228} priority className="h-9 w-auto" />
      </Link>

      <div className="flex items-center gap-1.5">
        <Link href="/robot" className="press flex h-9 items-center gap-1.5 rounded-full border border-line bg-surface px-3 text-[11px] font-semibold text-body shadow-soft">
          <span className={dot}><span className="live-dot" /></span>
          <span className="flex items-center gap-1 font-bold text-sherpy-600"><Bot size={14} />셰르피 1호</span>
          <span className="text-line">|</span>
          <span className="tabular text-ink">
            {state === "offline" ? "연결 끊김" : latest ? `${MODE[latest.mode]} · L${latest.safetyLevel}` : "연결 중"}
          </span>
        </Link>
        {user ? (
          <Link href="/my" aria-label="내 정보" className="press touch flex items-center justify-center rounded-full text-body">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-sherpy-50 text-lg">🐶</span>
          </Link>
        ) : (
          <Link href="/login?next=/home" aria-label="로그인" className="press touch flex items-center justify-center rounded-full text-body">
            <UserRound size={22} />
          </Link>
        )}
      </div>
    </header>
  );
}
