"use client";

import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { useRobot } from "../RobotProvider";
import RobotVideo from "@/components/robot/RobotVideo";
import PovCamera from "@/components/sherpy/PovCamera";
import SafetyBadge from "@/components/robot/SafetyBadge";
import EstopButton from "@/components/robot/EstopButton";

/**
 * S11 — 셰르피 카메라 (PRD F-3)
 *
 * 영상은 서버(Vercel)를 거치지 않고 로봇 ↔ 브라우저 P2P(WebRTC)로 흐른다.
 * 경로: Pi 카메라 → MediaMTX → Cloudflare Tunnel → 브라우저
 *
 * ⚠️ 전제: 라즈베리파이 카메라 모듈이 아직 BOM에 없다 (PRD §2-3).
 * 영상 주소가 없으면 시연용 화면으로 HUD 구성을 보여준다.
 */
export default function CameraPage() {
  const { robotId, streamUrl, latest, state } = useRobot();
  const base = streamUrl;
  const th = latest?.dogBearingDeg != null ? (latest.dogBearingDeg * Math.PI) / 180 : null;
  const d = latest?.dogDistM ?? null;
  const track = latest?.dogTrack ?? undefined;

  return (
    <div className="fixed inset-0 z-[45] mx-auto max-w-[480px] bg-black text-white">
      {base ? (
        <>
          <RobotVideo base={base} />
          {/* 실제 영상 위에 검출 박스·방향선 — 텔레메트리 θ̂·d̂ 를 카메라 모델로 역투영 */}
          <PovCamera scenery={false} theta={null} d={null} thetaEst={th} dEst={d} track={track} />
        </>
      ) : (
        <PovCamera theta={th} d={d} thetaEst={th} dEst={d} track={track} speed={latest?.speedCmd ?? 0} steer={latest?.steerCmd ?? 0} />
      )}

      {/* HUD 오버레이 */}
      <div className="absolute inset-x-0 top-0 bg-gradient-to-b from-black/70 to-transparent p-3 pb-10">
        <div className="flex items-center gap-2">
          <Link href="/robot" aria-label="대시보드로" className="touch flex items-center justify-center rounded-full bg-white/10">
            <ChevronLeft />
          </Link>
          <div className="flex-1">
            <p className="text-sm font-semibold">셰르피 1인칭</p>
            <p className="text-[11px] opacity-70">
              <span className="mr-1 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-level-3" />
              {base ? "LIVE · 목표 지연 0.5초" : "시연용 화면 · 카메라 모듈 연결 전"}
            </p>
          </div>
          <SafetyBadge level={latest?.safetyLevel ?? 0} compact />
        </div>
      </div>

      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-4 pt-12 pb-safe">
        <div className="mb-3 grid grid-cols-4 gap-1.5 pr-24 text-center">
          <Hud label="장력" value={(latest?.tensionFiltN ?? latest?.tensionN)?.toFixed(1) ?? "—"} unit="N" />
          <Hud label="줄" value={latest?.leashLenM?.toFixed(2) ?? "—"} unit="m" />
          <Hud label="거리" value={d?.toFixed(2) ?? "—"} unit="m" />
          <Hud label="θ" value={latest?.dogBearingDeg != null ? latest.dogBearingDeg.toFixed(1) : "—"} unit="°" />
        </div>
        <p className="text-[10px] opacity-60">원격 정지는 보조 수단입니다. 긴급 시 로봇 본체 정지 버튼을 쓰세요.</p>
      </div>

      {/* 영상 화면에서도 ESTOP 항상 노출 (PRD F-3 수용기준) */}
      <div className="[&>div]:bottom-8">
        <EstopButton robotId={robotId} disabled={state === "offline"} />
      </div>
    </div>
  );
}

function Hud({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <div className="rounded-xl bg-white/10 px-2 py-1.5 backdrop-blur">
      <p className="text-[10px] opacity-70">{label}</p>
      <p className="tabular text-base font-bold">{value}<span className="ml-0.5 text-[10px] font-normal opacity-70">{unit}</span></p>
    </div>
  );
}
