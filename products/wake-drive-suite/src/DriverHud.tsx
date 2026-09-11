import { t } from "./language";
import { WakeIcon } from "./WakeIcon";
export function DriverHud({ seconds, running, faceVisible }: {
  seconds: number; running: boolean; faceVisible: boolean;
}) {
  const minutes = Math.floor(seconds / 60);
  const timer = `${String(minutes).padStart(2, "0")}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
  return <div className={`driver-hud ${running ? "is-running" : "is-ready"}`} aria-label={t("운전 참고 정보")}>
    <div className="driver-hud-session" title={running ? faceVisible ? t("얼굴 인식 중") : t("얼굴 확인 중") : t("감지 시작 대기")} aria-label={t("측정 시간 {0}분 {1}초", minutes, Math.floor(seconds % 60))}>
      <i className={running && faceVisible ? "active" : ""} aria-hidden="true" /><WakeIcon name="clock" /><span>{t("시간")}</span><strong>{timer}</strong>
    </div>
  </div>;
}
