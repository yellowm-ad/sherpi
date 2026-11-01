import SimProvider from "./SimProvider";

export const metadata = { title: "시뮬레이션 랩 · 셰르피" };

/** /sim 하위 레이어 공용 — 실험 설정·계산 결과·재생 시간을 공유한다 (폴더를 옮겨도 재생이 이어진다) */
export default function SimLayout({ children }: { children: React.ReactNode }) {
  return <SimProvider>{children}</SimProvider>;
}
