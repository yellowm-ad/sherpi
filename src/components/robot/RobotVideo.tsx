"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { VideoOff, RotateCw } from "lucide-react";

/**
 * WebRTC 플레이어 (PRD F-3)
 *
 * MediaMTX 의 WHEP 엔드포인트(<base>/<path>/whep)에 SDP offer 를 POST 하고
 * answer 를 받아 <video> 에 붙인다. 영상은 서버(Vercel)를 거치지 않는다.
 * 백그라운드로 가면 스트림을 끊어 데이터·배터리를 아낀다.
 * src 가 "<주소>#t=<비밀번호>" 면 시청 비밀번호를 Basic 인증으로 붙인다 (robot/bridge/streamer.py 가 켤 때마다 새로 만듦).
 */
export default function RobotVideo({ base: src, path = "sherpy" }: { base: string; path?: string }) {
  const [base, token] = src.split("#t=");
  const videoRef = useRef<HTMLVideoElement>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const [status, setStatus] = useState<"connecting" | "playing" | "failed">("connecting");

  const stop = () => { pcRef.current?.close(); pcRef.current = null; };

  const start = useCallback(async () => {
    stop();
    setStatus("connecting");
    try {
      const pc = new RTCPeerConnection();
      pcRef.current = pc;
      pc.addTransceiver("video", { direction: "recvonly" });
      pc.ontrack = (e) => {
        if (videoRef.current) videoRef.current.srcObject = e.streams[0];
        setStatus("playing");
      };
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === "failed") setStatus("failed");
      };
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      const res = await fetch(`${base.replace(/\/$/, "")}/${path}/whep`, {
        method: "POST",
        headers: { "Content-Type": "application/sdp", ...(token ? { Authorization: `Basic ${btoa(`viewer:${token}`)}` } : {}) },
        body: offer.sdp,
      });
      if (!res.ok) throw new Error(`WHEP ${res.status}`);
      await pc.setRemoteDescription({ type: "answer", sdp: await res.text() });
    } catch {
      setStatus("failed");
    }
  }, [base, path, token]);

  useEffect(() => {
    start();
    const onVis = () => (document.hidden ? stop() : start());
    document.addEventListener("visibilitychange", onVis);
    return () => { document.removeEventListener("visibilitychange", onVis); stop(); };
  }, [start]);

  return (
    <div className="absolute inset-0">
      <video ref={videoRef} autoPlay playsInline muted className="h-full w-full object-cover" />
      {status !== "playing" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-white">
          {status === "connecting" ? (
            <p className="text-sm opacity-80">영상 연결 중…</p>
          ) : (
            <>
              <VideoOff size={32} className="opacity-70" />
              <p className="font-semibold">영상 연결 실패</p>
              <button onClick={start} className="touch flex items-center gap-1.5 rounded-full bg-white/15 px-4 text-sm">
                <RotateCw size={14} /> 다시 시도
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
