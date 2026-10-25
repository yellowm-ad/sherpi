import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "셰르피 — 강아지를 자유롭게",
  description: "반려견 산책 보조 로봇 셰르피와 연동되는 산책지원 플랫폼",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: "#2B66FF",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <head>
        {/* Plus Jakarta Sans — 라틴·숫자 (DESIGN.md). 한글은 아래 Pretendard 가 받는다 */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" />
        {/* Pretendard — 한글 서브셋 포함 동적 로딩 (PRD §12 한글 깨짐 대응) */}
        <link
          rel="stylesheet"
          crossOrigin="anonymous"
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css"
        />
      </head>
      <body className="mx-auto min-h-dvh max-w-[480px] bg-bg text-ink shadow-[0_0_0_1px_var(--color-line)]">
        {children}
      </body>
    </html>
  );
}
