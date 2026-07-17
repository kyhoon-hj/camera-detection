import { describe, expect, it } from "vitest";
import { speechRecognitionGuidance } from "../src/microphone";

describe("microphone guidance", () => {
  it("실제 권한 차단만 권한 문제로 안내한다", () => {
    expect(speechRecognitionGuidance("not-allowed").permissionProblem).toBe(true);
    expect(speechRecognitionGuidance("service-not-allowed").permissionProblem).toBe(true);
  });

  it("무음은 권한 오류로 잘못 표시하지 않는다", () => {
    const guidance = speechRecognitionGuidance("no-speech");
    expect(guidance.permissionProblem).toBe(false);
    expect(guidance.message).toContain("음성이 들리지 않았습니다");
    expect(guidance.message).not.toContain("권한");
  });

  it("네트워크와 장치 점유 오류를 구분한다", () => {
    expect(speechRecognitionGuidance("network").message).toContain("인터넷 연결");
    expect(speechRecognitionGuidance("audio-capture").message).toContain("다른 녹음 앱");
  });
});
