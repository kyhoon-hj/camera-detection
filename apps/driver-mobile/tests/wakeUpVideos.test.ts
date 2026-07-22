import { describe, expect, it } from "vitest";
import { WAKE_UP_VIDEO_PATHS, chooseWakeUpVideo, getWakeUpDecision } from "../src/wakeUpVideos";

describe("wake-up video rotation", () => {
  it("contains no duplicate video paths", () => {
    expect(new Set(WAKE_UP_VIDEO_PATHS).size).toBe(WAKE_UP_VIDEO_PATHS.length);
  });

  it("does not immediately repeat the current video", () => {
    const current = WAKE_UP_VIDEO_PATHS[0];
    expect(chooseWakeUpVideo(current, () => 0)).not.toBe(current);
    expect(chooseWakeUpVideo(current, () => 0.999)).not.toBe(current);
  });

  it("starts a video on the third distinct eye-closure alert", () => {
    const decision = getWakeUpDecision({
      eyeAlertActive: true,
      eyeAlertWasActive: false,
      headAlertActive: false,
      headAlertWasActive: false,
      eyeClosureCount: 2,
    });
    expect(decision).toEqual({ eyeClosureCount: 3, reason: "EYES" });
  });

  it("starts a video immediately for a new head-down alert", () => {
    const decision = getWakeUpDecision({
      eyeAlertActive: false,
      eyeAlertWasActive: false,
      headAlertActive: true,
      headAlertWasActive: false,
      eyeClosureCount: 0,
    });
    expect(decision).toEqual({ eyeClosureCount: 0, reason: "HEAD" });
  });
});
