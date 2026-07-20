import { describe, expect, it } from "vitest";
import type { FaceLandmarkerResult, HandLandmarkerResult, PoseLandmarkerResult } from "@mediapipe/tasks-vision";
import { getSignFrameQuality } from "../src/signVision";

function face(visible: boolean) {
  return { faceLandmarks: visible ? [[{ x: 0.5, y: 0.5, z: 0 }]] : [] } as unknown as FaceLandmarkerResult;
}

function pose(visible: boolean) {
  const landmarks = Array.from({ length: 13 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
  return { landmarks: visible ? [landmarks] : [] } as unknown as PoseLandmarkerResult;
}

function hands(...labels: string[]) {
  return { handedness: labels.map((categoryName) => [{ categoryName }]) } as unknown as HandLandmarkerResult;
}

describe("getSignFrameQuality", () => {
  it("accepts synchronized face, upper body and both hands", () => {
    const result = getSignFrameQuality(face(true), pose(true), hands("Left", "Right"));
    expect(result.ready).toBe(true);
    expect(result.guidance).toContain("준비");
  });

  it("asks for both hands before marking input ready", () => {
    const result = getSignFrameQuality(face(true), pose(true), hands("Left"));
    expect(result.ready).toBe(false);
    expect(result.rightHand).toBe(false);
    expect(result.guidance).toContain("양손");
  });

  it("prioritizes missing face guidance", () => {
    const result = getSignFrameQuality(face(false), pose(true), hands("Left", "Right"));
    expect(result.ready).toBe(false);
    expect(result.guidance).toContain("얼굴");
  });
});
