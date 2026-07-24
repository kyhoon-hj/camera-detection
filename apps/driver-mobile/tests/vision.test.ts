import { describe, expect, it } from "vitest";
import {
  calculatePostureOverlayAngles,
  isRecoverableVisionError,
  isUsableVideoFrame,
  normalizedXToMirroredCanvas,
  stabilizeOverlayFrame,
  visionErrorMessage,
  type VideoFrameState,
} from "../src/vision";
import type { Landmark } from "../src/monitor";

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

describe("posture overlay angles", () => {
  it("reports zero for a level head and shoulders", () => {
    const face = landmarks(478);
    const pose = landmarks(33);
    face[10] = point(0.5, 0.2);
    face[152] = point(0.5, 0.5);
    pose[11] = point(0.35, 0.62);
    pose[12] = point(0.65, 0.62);
    pose[23] = point(0.42, 0.92);
    pose[24] = point(0.58, 0.92);

    expect(calculatePostureOverlayAngles(face, pose, 640, 480)).toEqual({
      headTiltDegrees: 0,
      shoulderTiltDegrees: 0,
      torsoTiltDegrees: 0,
    });
  });

  it("measures head and shoulder tilt in display pixels", () => {
    const face = landmarks(478);
    const pose = landmarks(33);
    face[10] = point(0.5, 0.2);
    face[152] = point(0.55, 0.5);
    pose[11] = point(0.35, 0.6);
    pose[12] = point(0.65, 0.65);
    pose[23] = point(0.42, 0.92);
    pose[24] = point(0.58, 0.92);

    const angles = calculatePostureOverlayAngles(face, pose, 640, 480);
    expect(angles.headTiltDegrees).toBeCloseTo(12.5, 1);
    expect(angles.shoulderTiltDegrees).toBeCloseTo(7.1, 1);
    expect(angles.torsoTiltDegrees).toBeCloseTo(0, 1);
  });

  it("measures the neck-to-waist torso axis independently from the shoulder line", () => {
    const pose = landmarks(33);
    pose[11] = point(0.45, 0.6);
    pose[12] = point(0.75, 0.6);
    pose[23] = point(0.42, 0.92);
    pose[24] = point(0.58, 0.92);

    const angles = calculatePostureOverlayAngles(null, pose, 640, 480);
    expect(angles.shoulderTiltDegrees).toBe(0);
    expect(angles.torsoTiltDegrees).toBeGreaterThan(20);
  });
});

describe("mirrored camera overlay coordinates", () => {
  it("maps live and calibrated normalized positions through the same mirrored X axis", () => {
    expect(normalizedXToMirroredCanvas(0.2, 1000)).toBe(800);
    expect(normalizedXToMirroredCanvas(0.8, 1000)).toBeCloseTo(200);
    expect(normalizedXToMirroredCanvas(0.5, 1000)).toBe(500);
  });
});

describe("camera overlay stabilization", () => {
  it("holds tiny landmark jitter while allowing deliberate movement through gradually", () => {
    const previous = { timestampMs: 0, face: null, pose: [point(0.5, 0.5)] };
    const jittered = stabilizeOverlayFrame(
      { timestampMs: 80, face: null, pose: [point(0.502, 0.501)] },
      previous,
    );
    expect(jittered.pose?.[0]).toMatchObject({ x: 0.5, y: 0.5 });

    const moved = stabilizeOverlayFrame(
      { timestampMs: 160, face: null, pose: [point(0.6, 0.5)] },
      jittered,
    );
    expect(moved.pose?.[0].x).toBeGreaterThan(0.5);
    expect(moved.pose?.[0].x).toBeLessThan(0.6);
  });
});

function point(x: number, y: number): Landmark {
  return { x, y, z: 0 };
}

function landmarks(length: number): Landmark[] {
  return Array.from({ length }, () => point(0, 0));
}
