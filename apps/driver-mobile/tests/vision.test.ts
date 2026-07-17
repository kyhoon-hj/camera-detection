import { describe, expect, it } from "vitest";
import {
  isRecoverableVisionError,
  isUsableVideoFrame,
  visionErrorMessage,
  type VideoFrameState,
} from "../src/vision";

const validFrame: VideoFrameState = {
  readyState: 2,
  videoWidth: 1280,
  videoHeight: 720,
  paused: false,
  ended: false,
};

describe("카메라 프레임 보호", () => {
  it("영상 크기가 확정된 재생 프레임만 분석한다", () => {
    expect(isUsableVideoFrame(validFrame)).toBe(true);
    expect(isUsableVideoFrame({ ...validFrame, videoWidth: 0 })).toBe(false);
    expect(isUsableVideoFrame({ ...validFrame, videoHeight: Number.NaN })).toBe(false);
    expect(isUsableVideoFrame({ ...validFrame, paused: true })).toBe(false);
  });

  it("MediaPipe ROI 오류를 자동 복구 대상으로 분류한다", () => {
    const error = new Error("INVALID_ARGUMENT: ROI contains NaN values; CalculatorGraph::Run() failed");
    expect(isRecoverableVisionError(error)).toBe(true);
    expect(isRecoverableVisionError(new Error("permission denied"))).toBe(false);
  });

  it("내부 스택 대신 사용자용 오류 안내를 제공한다", () => {
    const message = visionErrorMessage(new Error("ROI contains NaN values; third_party/mediapipe/calculator.cc"));
    expect(message).toContain("세로로 고정");
    expect(message).not.toContain("third_party");
  });
});
