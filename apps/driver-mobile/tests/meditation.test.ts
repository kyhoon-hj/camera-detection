import { describe, expect, it } from "vitest";
import { getMeditationGuidance } from "../src/meditation";
import type { MonitorSnapshot } from "../src/monitor";

const snapshot: MonitorSnapshot = {
  status: "AWAKE", trigger: "NONE", message: "정상", faceVisible: true, poseVisible: true,
  eyeAspectRatio: 0.09, baselineEyeAspectRatio: 0.12, eyesClosed: false, closedDurationMs: 0,
  headDown: false, headDownDurationMs: 0, combinedDurationMs: 0, bodyCollapseDurationMs: 0, bodyCollapseCountReady: false, postureStatus: "GOOD",
  postureIssue: "NONE", postureScore: 96, postureConfidence: 0.9,
  postureMessage: "3D 개인 기준 자세가 안정적입니다.", shoulderTiltDegrees: 0, headLeanDegrees: 0,
  forwardHeadPercent: 0, cameraViewAngleDegrees: 0, cameraView: "FRONT", calibrationProgress: 1,
  calibrationRemainingMs: 0, calibrationStable: true,
};

describe("meditation guidance", () => {
  it("눈을 뜨고 있으면 타이머를 멈추고 눈 감기를 안내한다", () => {
    const result = getMeditationGuidance({ seconds: 300, running: true, runState: "RUNNING", error: "", snapshot, breathPhase: "들이쉬기" });
    expect(result.stage).toBe("CLOSE_EYES");
    expect(result.timerActive).toBe(false);
  });
  it("눈을 감은 뒤 호흡 타이머를 진행한다", () => {
    const result = getMeditationGuidance({ seconds: 300, running: true, runState: "RUNNING", error: "", snapshot: { ...snapshot, eyesClosed: true }, breathPhase: "들이쉬기" });
    expect(result.stage).toBe("BREATHING");
    expect(result.timerActive).toBe(true);
  });
  it("명상이 끝났는데 눈이 감겨 있으면 눈 뜨기를 안내한다", () => {
    const result = getMeditationGuidance({ seconds: 0, running: false, runState: "RUNNING", error: "", snapshot: { ...snapshot, eyesClosed: true }, breathPhase: "내쉬기" });
    expect(result.stage).toBe("OPEN_EYES");
  });
  it("자세 경고를 호흡 안내보다 우선한다", () => {
    const result = getMeditationGuidance({ seconds: 240, running: true, runState: "RUNNING", error: "", snapshot: { ...snapshot, eyesClosed: true, postureStatus: "WARNING", postureMessage: "왼쪽 어깨를 조금 내려 주세요." }, breathPhase: "내쉬기" });
    expect(result.message).toBe("왼쪽 어깨를 조금 내려 주세요.");
    expect(result.timerActive).toBe(true);
  });
});
