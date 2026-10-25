"use client";

import { use } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import PageHeader from "@/components/ui/PageHeader";
import RouteEditor from "@/components/map/RouteEditor";
import { useMyRoutes, useMyRoutesLoaded, updateMyRoute } from "@/lib/my-routes";
import { useSessionLoaded, useUser } from "@/lib/session";

/** 코스 수정 — 내가 만든 코스만 (PRD F-4) */
export default function EditRoute({ params }: { params: Promise<{ id: string }> }) {
  const id = Number(use(params).id);
  const router = useRouter();
  const user = useUser();
  const sessionLoaded = useSessionLoaded();
  const mine = useMyRoutes();
  const loaded = useMyRoutesLoaded();
  const r = mine.find((x) => x.id === id);

  if (!r) {
    const waiting = !sessionLoaded || (user && !loaded);
    return (
      <div>
        <PageHeader title="코스 수정" back />
        {waiting ? <p className="p-6 text-center text-sm text-muted">코스를 불러오는 중…</p> : (
          <div className="p-6 text-center">
            <p className="text-sm text-muted">{user ? "내가 만든 코스만 수정할 수 있어요." : "로그인하면 내 코스를 수정할 수 있어요."}</p>
            <Link href={user ? "/map" : `/login?next=/routes/${id}/edit`}
                  className="mt-4 inline-block rounded-xl bg-sherpy-600 px-5 py-2.5 text-sm font-semibold text-white">
              {user ? "지도로" : "로그인"}
            </Link>
          </div>
        )}
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="코스 수정" back />
      <RouteEditor
        key={r.id}
        initial={r}
        saveLabel="수정한 내용 저장"
        savedLabel="저장했어요"
        onSave={async (d) => {
          await updateMyRoute(r.id, d);
          setTimeout(() => router.replace(`/routes/${r.id}`), 600);
        }}
      />
    </div>
  );
}
