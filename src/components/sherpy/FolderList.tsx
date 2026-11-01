import Link from "next/link";
import { ChevronRight, type LucideIcon } from "lucide-react";

/** 첫 화면 아래 "폴더" — 누르면 해당 레이어(실시간 그래프·수치·제어 …)로 들어간다 */
export interface Folder { href: string; icon: LucideIcon; title: string; desc: string; badge?: string; tone?: "default" | "warn" }

export default function FolderList({ title, items }: { title?: string; items: Folder[] }) {
  return (
    <section className="mt-4">
      {title && <h2 className="mb-2 px-1 text-sm font-bold">{title}</h2>}
      <ul className="card divide-y divide-line overflow-hidden">
        {items.map((f) => {
          const Icon = f.icon;
          return (
            <li key={f.href}>
              <Link href={f.href} className="press flex min-h-[60px] items-center gap-3 px-3 py-2.5">
                <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${f.tone === "warn" ? "bg-level-1/15 text-level-1" : "bg-sherpy-50 text-sherpy-600"}`}>
                  <Icon size={19} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5 text-sm font-semibold text-ink">
                    {f.title}
                    {f.badge && <span className="tabular rounded-full bg-sherpy-600 px-1.5 py-px text-[10px] font-bold text-white">{f.badge}</span>}
                  </span>
                  <span className="block truncate text-xs text-muted">{f.desc}</span>
                </span>
                <ChevronRight size={18} className="shrink-0 text-muted" />
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
