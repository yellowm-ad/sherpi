"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronRight, Bot, Footprints, Route, Store, LogOut, ShieldAlert, LogIn } from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import { useDog } from "@/lib/dog";
import { useWalks } from "@/lib/my-walks";
import { useUser, logout } from "@/lib/session";
import { useMyRoutes } from "@/lib/my-routes";

/** S16 마이페이지 — 게스트면 로그인 권유, 로그인하면 프로필·내 코스 */
export default function MyPage() {
  const user = useUser();
  const mine = useMyRoutes();
  const dog = useDog();
  const walks = useWalks();
  const router = useRouter();

  return (
    <div>
      <PageHeader title="마이" />
      <div className="px-4 pt-4 pb-6">
        {user ? (
          <section className="card flex items-center gap-4 p-4">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-sherpy-100 text-4xl">🐶</div>
            <div className="min-w-0 flex-1">
              <p className="text-lg font-bold">{dog.name}</p>
              <p className="text-sm text-muted">{[dog.breed, dog.weightKg ? `${dog.weightKg}kg` : "", dog.age].filter(Boolean).join(" · ")}</p>
              <p className="mt-0.5 text-xs text-muted">보호자 {user.nickname} (@{user.username})</p>
            </div>
            <Link href="/onboarding/dog?next=/my" className="press shrink-0 rounded-full border border-line px-3 py-1.5 text-xs font-semibold text-body">수정</Link>
          </section>
        ) : (
          <section className="rounded-3xl bg-gradient-to-br from-sherpy-600 to-sherpy-700 p-5 text-white">
            <p className="text-lg font-bold">로그인하고 내 코스를 저장하세요</p>
            <p className="mt-1 text-sm text-sherpy-100">직접 그린 산책 코스와 산책 기록을 계정에 보관하고 언제든 꺼내 쓸 수 있어요.</p>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <Link href="/login?next=/my" className="touch flex items-center justify-center gap-1.5 rounded-xl bg-white py-3 text-sm font-semibold text-sherpy-700"><LogIn size={16} />로그인</Link>
              <Link href="/signup?next=/my" className="touch flex items-center justify-center rounded-xl border border-white/40 py-3 text-sm font-semibold">회원가입</Link>
            </div>
          </section>
        )}

        <section className="card mt-3 flex items-center gap-3 p-4">
          <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-sherpy-600 text-white"><Bot size={22} /></span>
          <div className="flex-1">
            <p className="font-semibold">셰르피 #SHP-0001</p>
            <p className="text-xs text-muted">시연용 로봇 · 펌웨어 0.1.0</p>
          </div>
          <Link href="/robot" className="text-sm text-sherpy-600">대시보드</Link>
        </section>

        {user && (
          <section className="card mt-3 p-4">
            <div className="flex items-center justify-between">
              <p className="font-semibold">내 코스 <span className="text-sherpy-600">{mine.length}</span></p>
              <Link href="/routes/new" className="text-xs text-sherpy-600">+ 새 코스</Link>
            </div>
            {mine.length === 0 ? (
              <p className="mt-2 text-sm text-muted">아직 저장한 코스가 없어요. 지도에서 코스를 그려 저장해 보세요.</p>
            ) : (
              <ul className="mt-2 divide-y divide-line">
                {mine.map((r) => (
                  <li key={r.id}>
                    <Link href={`/routes/${r.id}`} className="flex items-center justify-between py-2.5 text-sm">
                      <span className="truncate">{r.name}</span>
                      <span className="flex items-center gap-1 text-xs text-muted">{r.isPublic ? "공개" : "비공개"}<ChevronRight size={14} /></span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        <ul className="card mt-3 divide-y divide-line">
          <Row href="/walks" icon={<Footprints size={18} />} label="산책 기록" sub={`${walks.length}회`} />
          <Row href="/map" icon={<Route size={18} />} label="코스 지도" />
          <Row href="/market" icon={<Store size={18} />} label="마켓" sub="준비 중" />
          {user && (
            <li>
              <button onClick={() => { logout(); router.replace("/home"); }} className="touch flex w-full items-center gap-3 px-4 py-3.5 text-sm">
                <span className="text-sherpy-600"><LogOut size={18} /></span>
                <span className="flex-1 text-left">로그아웃</span>
              </button>
            </li>
          )}
        </ul>

        <section className="mt-3 flex gap-2 rounded-2xl bg-level-1/10 p-4 text-xs leading-relaxed text-body">
          <ShieldAlert size={16} className="mt-0.5 shrink-0 text-level-1" />
          <p>
            원격 정지는 보조 수단입니다. 앱의 명령은 네트워크를 거쳐 약 1초 지연되거나 끊길 수 있어요.
            긴급 상황에서는 로봇 본체의 모터 전원 스위치를 끄세요. 로봇은 서버 명령을 3초 이상 받지 못하면 스스로 멈춥니다.
          </p>
        </section>

        <p className="mt-6 text-center text-[11px] text-muted">셰르피 v0.1 · 전북대학교 캡스톤디자인 · 팀 프리가이즈</p>
      </div>
    </div>
  );
}

function Row({ href, icon, label, sub }: { href: string; icon: React.ReactNode; label: string; sub?: string }) {
  return (
    <li>
      <Link href={href} className="touch flex items-center gap-3 px-4 py-3.5 text-sm">
        <span className="text-sherpy-600">{icon}</span>
        <span className="flex-1">{label}</span>
        {sub && <span className="text-xs text-muted">{sub}</span>}
        <ChevronRight size={16} className="text-muted" />
      </Link>
    </li>
  );
}
