"use client";

import { useRouter } from "next/navigation";
import { ChevronLeft } from "lucide-react";

export default function PageHeader({
  title, back, right,
}: { title: string; back?: boolean; right?: React.ReactNode }) {
  const router = useRouter();
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-1 bg-bg/90 px-2 shadow-[0_1px_0_var(--color-line)] backdrop-blur-md">
      {back ? (
        <button onClick={() => router.back()} aria-label="뒤로" className="touch flex items-center justify-center">
          <ChevronLeft size={24} />
        </button>
      ) : (
        <span className="w-2" />
      )}
      <h1 className="flex-1 truncate text-lg font-bold tracking-tight">{title}</h1>
      {right}
    </header>
  );
}
