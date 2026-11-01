import RobotProvider from "./RobotProvider";

/** /robot 하위 레이어 공용 — 텔레메트리 스트림·기록을 한 번만 열고 공유한다 */
export default function RobotLayout({ children }: { children: React.ReactNode }) {
  return <RobotProvider>{children}</RobotProvider>;
}
