import Image from "next/image";
import Link from "next/link";
import { ChevronRight, PawPrint } from "lucide-react";
import WaveBackground from "@/components/ui/WaveBackground";

/** S01 스플래시 — 로고 + 슬로건, 잔잔한 물결 배경 (셰르피 처음 화면.png) */
export default function SplashPage() {
  return (
    <main className="relative flex min-h-dvh flex-col items-center justify-between overflow-hidden bg-sherpy-50 px-4 pt-[20dvh] pb-safe">
      <WaveBackground />

      <div className="stagger relative mx-auto w-full max-w-[480px] text-center">
        <Image
          src="/logo.png"
          alt="SHERPY — 강아지를 자유롭게"
          width={703}
          height={228}
          priority
          className="mx-auto h-auto w-[78%] max-w-[340px]"
        />
        <h1 style={{ "--i": 1 } as React.CSSProperties} className="mt-10 text-5xl font-bold tracking-tight text-ink">셰르피</h1>
        <p style={{ "--i": 2 } as React.CSSProperties} className="mt-3 text-xl font-medium text-body">강아지를 자유롭게</p>
        <p style={{ "--i": 3 } as React.CSSProperties} className="mt-8 text-[15px] leading-relaxed text-muted">
          로봇이 줄을 잡고, 보호자는 지켜보기만.<br />반려견 산책 보조 로봇 셰르피와 함께하세요.
        </p>
        <div style={{ "--i": 4 } as React.CSSProperties} className="mx-auto mt-10 flex max-w-xs items-center gap-5 text-sherpy-400">
          <span className="h-px flex-1 bg-gradient-to-r from-transparent to-sherpy-400/50" />
          <PawPrint size={30} fill="currentColor" strokeWidth={1.5} className="opacity-80" />
          <span className="h-px flex-1 bg-gradient-to-l from-transparent to-sherpy-400/50" />
        </div>
      </div>

      <div className="stagger relative mb-10 flex w-full max-w-sm flex-col gap-3">
        <Link
          href="/home"
          style={{ "--i": 5 } as React.CSSProperties}
          className="press touch flex items-center justify-center gap-2 rounded-full bg-gradient-to-b from-sherpy-400 to-sherpy-700 py-4 text-lg font-semibold text-white shadow-lift ring-1 ring-white/60"
        >
          바로 시작하기 <ChevronRight size={20} />
        </Link>
        <p style={{ "--i": 6 } as React.CSSProperties} className="mt-2 text-center text-sm text-body">
          로그인 없이 둘러볼 수 있어요 ·{" "}
          <Link href="/login?next=/home" className="font-semibold text-ink underline underline-offset-4">로그인</Link>
        </p>
      </div>
    </main>
  );
}
