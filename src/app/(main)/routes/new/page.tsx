"use client";

import { use, useMemo } from "react";
import { useRouter } from "next/navigation";
import PageHeader from "@/components/ui/PageHeader";
import RouteEditor from "@/components/map/RouteEditor";
import type { Place } from "@/components/map/PlaceSearch";
import { saveMyRoute } from "@/lib/my-routes";
import { useLoginGate } from "@/components/ui/LoginGate";

/** S09 코스 만들기 (DIY) — 지도를 탭해서 경유점을 찍는다 (PRD F-4). ?lat&lng&name 이면 그곳에서 시작 */
export default function NewRoute({ searchParams }: { searchParams: Promise<{ lat?: string; lng?: string; name?: string }> }) {
  const sp = use(searchParams);
  const router = useRouter();
  const { user, guard, gate } = useLoginGate();

  const start = useMemo<Place | null>(() => {
    const lat = Number(sp.lat), lng = Number(sp.lng);
    return Number.isFinite(lat) && Number.isFinite(lng) && sp.lat && sp.lng
      ? { name: sp.name || "검색한 곳", address: "", lat, lng, kind: "place" }
      : null;
  }, [sp.lat, sp.lng, sp.name]);

  return (
    <div>
      <PageHeader title="코스 만들기" back />
      <RouteEditor
        start={start}
        draftKey="sherpy.routeDraft"
        saveLabel={user ? "내 코스에 저장" : "로그인하고 저장"}
        savedLabel="내 코스에 저장했어요"
        needLogin={(run) => guard("코스를 저장하려면", run)}
        onSave={async (d) => {
          if (!user) return;
          const r = await saveMyRoute(user, d);
          setTimeout(() => router.push(`/routes/${r.id}`), 700);
        }}
      />
      {gate}
    </div>
  );
}
