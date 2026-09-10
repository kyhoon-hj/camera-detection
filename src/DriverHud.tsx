import { useEffect, useState } from "react";
import { watchDriverSpeed, type SpeedReading } from "./driverSpeed";

export function useDriverSpeed(enabled: boolean, visiblePip = false): SpeedReading {
  const [reading, setReading] = useState<SpeedReading>({ kmh: null, label: "GPS 꺼짐" });
  useEffect(() => {
    let stop: (() => void) | undefined;
    const refresh = () => {
      stop?.(); stop = undefined;
      if (!enabled || (document.visibilityState !== "visible" && !visiblePip)) {
        setReading({ kmh: null, label: enabled ? "GPS 일시 정지" : "GPS 꺼짐" }); return;
      }
      if (!navigator.geolocation) { setReading({ kmh: null, label: "GPS 미지원" }); return; }
      stop = watchDriverSpeed(navigator.geolocation, setReading);
    };
    refresh();
    document.addEventListener("visibilitychange", refresh);
    return () => { stop?.(); document.removeEventListener("visibilitychange", refresh); };
  }, [enabled, visiblePip]);
  return reading;
}

export function DriverHud({ speed, seconds, running, faceVisible, enabled }: {
  speed: SpeedReading; seconds: number; running: boolean; faceVisible: boolean; enabled: boolean;
}) {
  const minutes = Math.floor(seconds / 60);
  const timer = `${String(minutes).padStart(2, "0")}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
  return <div className={`driver-hud ${running ? "is-running" : "is-ready"}`} aria-label="운전 참고 정보">
    <div className="driver-hud-speed" title={enabled ? speed.label : "GPS 꺼짐"} aria-label={`현재 속도 ${enabled && speed.kmh !== null ? `${speed.kmh} km/h` : "측정 안 됨"}, ${enabled ? speed.label : "GPS 꺼짐"}`}>
      <span>GPS{!enabled ? " OFF" : ""}</span><strong>{enabled ? speed.kmh ?? "—" : "—"}</strong><small>km/h</small>
    </div>
    <div className="driver-hud-session" title={running ? faceVisible ? "얼굴 인식 중" : "얼굴 확인 중" : "감지 시작 대기"} aria-label={`측정 시간 ${minutes}분 ${Math.floor(seconds % 60)}초`}>
      <i className={running && faceVisible ? "active" : ""} aria-hidden="true" /><span>시간</span><strong>{timer}</strong>
    </div>
  </div>;
}
