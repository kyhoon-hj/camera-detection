import type { MonitorSnapshot } from "./monitor";

export type MeditationStage =
  | "READY"
  | "CAMERA_LOADING"
  | "CALIBRATING"
  | "POSITIONING"
  | "CLOSE_EYES"
  | "BREATHING"
  | "OPEN_EYES"
  | "COMPLETE"
  | "PAUSED"
  | "ERROR";

export interface MeditationGuidance {
  stage: MeditationStage;
  title: string;
  message: string;
  voiceCue: string | null;
  timerActive: boolean;
}

interface MeditationGuidanceInput {
  seconds: number;
  running: boolean;
  runState: "READY" | "LOADING" | "RUNNING" | "ERROR";
  error: string;
  snapshot: MonitorSnapshot;
  breathPhase: "들이쉬기" | "내쉬기";
}

export function getMeditationGuidance(input: MeditationGuidanceInput): MeditationGuidance {
  const { seconds, running, runState, error, snapshot, breathPhase } = input;
  if (runState === "ERROR") return { stage: "ERROR", title: "카메라를 확인해 주세요", message: error, voiceCue: null, timerActive: false };
  if (runState === "LOADING") return { stage: "CAMERA_LOADING", title: "카메라 준비 중", message: "얼굴과 양쪽 어깨가 보이도록 휴대폰을 고정해 주세요.", voiceCue: null, timerActive: false };
  if (runState !== "RUNNING") return { stage: "READY", title: "편안하게 앉아주세요", message: "명상 시작을 누르면 자세와 눈 상태를 기기 안에서 확인합니다.", voiceCue: null, timerActive: false };
  if (snapshot.status === "CALIBRATING") return { stage: "CALIBRATING", title: "눈을 뜨고 기준 측정 중", message: "정면을 바라보고 편안한 자세를 5초 동안 유지해 주세요.", voiceCue: "눈을 뜨고 정면을 바라보며 편안한 자세를 유지해 주세요.", timerActive: false };
  if (!snapshot.faceVisible || !snapshot.poseVisible || snapshot.postureStatus === "NO_POSE") return { stage: "POSITIONING", title: "화면 안에 앉아주세요", message: "얼굴과 양쪽 어깨가 모두 보이도록 카메라 각도를 맞춰 주세요.", voiceCue: "얼굴과 양쪽 어깨가 보이도록 자세를 맞춰 주세요.", timerActive: false };
  if (seconds === 0) {
    if (snapshot.eyesClosed) return { stage: "OPEN_EYES", title: "천천히 눈을 떠주세요", message: "마지막 호흡을 내쉬고 준비가 되면 천천히 눈을 떠주세요.", voiceCue: "명상이 끝났습니다. 마지막 호흡을 내쉬고 천천히 눈을 떠주세요.", timerActive: false };
    return { stage: "COMPLETE", title: "호흡 명상 완료", message: "편안한 자세로 돌아왔습니다. 지금의 호흡을 잠시 느껴보세요.", voiceCue: "호흡 명상을 마쳤습니다.", timerActive: false };
  }
  if (!running) return { stage: "PAUSED", title: "잠시 멈췄어요", message: "준비가 되면 계속하기를 눌러 호흡을 이어가세요.", voiceCue: null, timerActive: false };
  if (!snapshot.eyesClosed) return { stage: "CLOSE_EYES", title: "눈을 감아주세요", message: "눈 감김이 확인되면 호흡 타이머가 자동으로 시작됩니다.", voiceCue: "편안하게 눈을 감아주세요.", timerActive: false };
  if (snapshot.postureStatus === "WARNING") return { stage: "BREATHING", title: "자세를 천천히 바로잡아요", message: snapshot.postureMessage, voiceCue: snapshot.postureMessage, timerActive: true };
  return { stage: "BREATHING", title: breathPhase, message: breathPhase === "들이쉬기" ? "코로 천천히 숨을 들이쉬세요." : "힘을 빼고 길게 숨을 내쉬세요.", voiceCue: breathPhase, timerActive: true };
}
