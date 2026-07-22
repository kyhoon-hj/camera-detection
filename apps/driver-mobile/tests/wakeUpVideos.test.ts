import { describe, expect, it } from "vitest";
import { WAKE_UP_VIDEO_PATHS, WAKE_UP_VIDEO_PROFILES, getForcedWakeUpReason, getWakeUpCountActivity, getWakeUpDecision } from "../src/wakeUpVideos";

describe("wake-up video rules", () => {
  it("contains no duplicate video paths", () => {
    expect(new Set(WAKE_UP_VIDEO_PATHS).size).toBe(WAKE_UP_VIDEO_PATHS.length);
  });

  it("maps every library profile to one supplied video", () => {
    expect(WAKE_UP_VIDEO_PROFILES.map((profile) => profile.path)).toEqual(WAKE_UP_VIDEO_PATHS);
  });

  it("경고 이후 눈 감김 2초 또는 동시 감지 1.5초부터 카운트한다", () => {
    expect(getWakeUpCountActivity({ closedDurationMs: 1_999, headDownDurationMs: 0, combinedDurationMs: 0 }).eye).toBe(false);
    expect(getWakeUpCountActivity({ closedDurationMs: 2_000, headDownDurationMs: 0, combinedDurationMs: 0 }).eye).toBe(true);
    expect(getWakeUpCountActivity({ closedDurationMs: 0, headDownDurationMs: 0, combinedDurationMs: 1_499 })).toEqual({ eye: false, head: false });
    expect(getWakeUpCountActivity({ closedDurationMs: 0, headDownDurationMs: 0, combinedDurationMs: 1_500 })).toEqual({ eye: true, head: true });
  });

  it("고개 숙임 2초부터 카운트한다", () => {
    expect(getWakeUpCountActivity({ closedDurationMs: 0, headDownDurationMs: 1_999, combinedDurationMs: 0 }).head).toBe(false);
    expect(getWakeUpCountActivity({ closedDurationMs: 0, headDownDurationMs: 2_000, combinedDurationMs: 0 }).head).toBe(true);
  });

  it("횟수와 관계없이 위험 상태가 4초 지속되면 영상을 시작한다", () => {
    const safe = { closedDurationMs: 3_999, headDownDurationMs: 0, combinedDurationMs: 0 };
    expect(getForcedWakeUpReason(safe)).toBeNull();
    expect(getForcedWakeUpReason({ ...safe, closedDurationMs: 4_000 })).toBe("EYES");
    expect(getForcedWakeUpReason({ ...safe, headDownDurationMs: 4_000 })).toBe("HEAD");
    expect(getForcedWakeUpReason({ ...safe, closedDurationMs: 4_000, headDownDurationMs: 4_000, combinedDurationMs: 4_000 })).toBe("COMBINED");
  });

  it("두 번째 눈 감김 카운트에서 영상을 시작한다", () => {
    const decision = getWakeUpDecision({
      eyeAlertActive: true,
      eyeAlertWasActive: false,
      headAlertActive: false,
      headAlertWasActive: false,
      eyeClosureCount: 1,
      headDownCount: 0,
    });
    expect(decision).toEqual({ eyeClosureCount: 2, headDownCount: 0, reason: "EYES" });
  });

  it("두 번째 고개 숙임 카운트에서 영상을 시작한다", () => {
    const decision = getWakeUpDecision({
      eyeAlertActive: false,
      eyeAlertWasActive: false,
      headAlertActive: true,
      headAlertWasActive: false,
      eyeClosureCount: 0,
      headDownCount: 1,
    });
    expect(decision).toEqual({ eyeClosureCount: 0, headDownCount: 2, reason: "HEAD" });
  });

  it("두 번째 동시 감지는 눈과 고개를 함께 카운트하고 동시 감지 영상을 시작한다", () => {
    const decision = getWakeUpDecision({
      eyeAlertActive: true,
      eyeAlertWasActive: false,
      headAlertActive: true,
      headAlertWasActive: false,
      eyeClosureCount: 1,
      headDownCount: 1,
    });
    expect(decision).toEqual({ eyeClosureCount: 2, headDownCount: 2, reason: "COMBINED" });
  });

  it("uses the same thresholds again after each video resets the counters", () => {
    for (let cycle = 0; cycle < 2; cycle += 1) {
      let eyeClosureCount = 0;
      let headDownCount = 0;
      for (let event = 1; event <= 2; event += 1) {
        const decision = getWakeUpDecision({
          eyeAlertActive: true,
          eyeAlertWasActive: false,
          headAlertActive: false,
          headAlertWasActive: false,
          eyeClosureCount,
          headDownCount,
        });
        eyeClosureCount = decision.eyeClosureCount;
        headDownCount = decision.headDownCount;
        expect(decision.reason).toBe(event === 2 ? "EYES" : null);
      }
      eyeClosureCount = 0;
      headDownCount = 0;
    }
  });
});
