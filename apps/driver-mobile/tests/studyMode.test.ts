import { describe, expect, it } from "vitest";
import type { Landmark, MonitorSnapshot, VisionFrame } from "../src/monitor";
import {
  DEFAULT_STUDY_SETTINGS,
  STUDY_EVENT_CODES,
  StudySessionTracker,
  appendStudyRecord,
  createStudyRecord,
  loadStudyRecords,
  loadStudySettings,
  normalizeStudySettings,
  type StudySessionRecord,
} from "../src/studyMode";

describe("study mode settings and event contract", () => {
  it("uses the document defaults and safely normalizes saved values", () => {
    expect(loadStudySettings(null)).toEqual(DEFAULT_STUDY_SETTINGS);
    expect(normalizeStudySettings({ focusMinutes: 2, breakMinutes: 99, warningMode: "STRONG" })).toMatchObject({
      focusMinutes: 5,
      breakMinutes: 60,
      warningMode: "STRONG",
      voiceMode: "MINIMAL",
    });
    expect(loadStudySettings("not-json")).toEqual(DEFAULT_STUDY_SETTINGS);
  });

  it("keeps custom time input separate from preset button selection", () => {
    expect(normalizeStudySettings({ exerciseIntervalMinutes: 37, breakMinutes: 8 })).toMatchObject({
      exerciseIntervalInputMode: "CUSTOM",
      breakDurationInputMode: "CUSTOM",
    });
    expect(normalizeStudySettings({ exerciseIntervalMinutes: 45, breakMinutes: 10 })).toMatchObject({
      exerciseIntervalInputMode: "PRESET",
      breakDurationInputMode: "PRESET",
    });
    expect(normalizeStudySettings({
      exerciseIntervalMinutes: 45,
      exerciseIntervalInputMode: "CUSTOM",
      breakMinutes: 10,
      breakDurationInputMode: "CUSTOM",
    })).toMatchObject({
      exerciseIntervalInputMode: "CUSTOM",
      breakDurationInputMode: "CUSTOM",
    });
  });

  it("keeps configured videos while the global video display is off", () => {
    expect(normalizeStudySettings({
      videoEnabled: false,
      warningVideo: "SELECTED",
      breakVideo: "DEFAULT",
      exerciseVideo: "RANDOM",
      returnVideo: "SELECTED",
    })).toMatchObject({
      videoEnabled: false,
      warningVideo: "SELECTED",
      breakVideo: "DEFAULT",
      exerciseVideo: "RANDOM",
      returnVideo: "SELECTED",
    });
  });

  it("exposes every event code required by the study-mode specification", () => {
    expect(STUDY_EVENT_CODES).toHaveLength(36);
    expect(STUDY_EVENT_CODES).toContain("STUDY_SESSION_STARTED");
    expect(STUDY_EVENT_CODES).toContain("DESK_SLEEP_DETECTED");
    expect(STUDY_EVENT_CODES).toContain("STUDY_AUTO_PAUSED_BY_ABSENCE");
    expect(STUDY_EVENT_CODES).toContain("STUDY_CAMERA_QUALITY_LOW");
  });
});

describe("StudySessionTracker", () => {
  it("records normal blinks without raising a warning", () => {
    const tracker = new StudySessionTracker(DEFAULT_STUDY_SETTINGS, 0);
    tracker.process(frame(), monitor(), 0);
    tracker.process(frame(), monitor({ eyesClosed: true, closedDurationMs: 100 }), 100);
    const snapshot = tracker.process(frame(), monitor({ eyesClosed: false }), 450);
    expect(snapshot.counts.blinks).toBe(1);
    expect(snapshot.counts.longEyeClosures).toBe(0);
    expect(snapshot.events.some((event) => event.code === "BLINK_DETECTED")).toBe(true);
  });

  it("ignores eye-closure signals while the user is looking down at a book", () => {
    const tracker = new StudySessionTracker(DEFAULT_STUDY_SETTINGS, 0);
    tracker.process(frame(), monitor(), 0);
    tracker.process(frame(), monitor({
      eyesClosed: true,
      closedDurationMs: 3_100,
      headDown: true,
      headDownDurationMs: 3_100,
    }), 3_100);
    const snapshot = tracker.process(frame(), monitor({
      eyesClosed: true,
      closedDurationMs: 8_000,
      headDown: true,
      headDownDurationMs: 8_000,
      postureStatus: "WARNING",
      postureIssue: "SLOUCHING",
    }), 8_000);

    expect(snapshot.status).toBe("FOCUS");
    expect(snapshot.counts.blinks).toBe(0);
    expect(snapshot.counts.longEyeClosures).toBe(0);
    expect(snapshot.counts.headDrops).toBe(0);
    expect(snapshot.counts.deskSleeps).toBe(0);
    expect(snapshot.counts.postureWarnings).toBe(0);
    expect(snapshot.pendingAlert).toBeNull();
    expect(snapshot.events.some((event) => event.code === "LONG_EYE_CLOSURE_DETECTED")).toBe(false);
    expect(snapshot.events.some((event) => event.code === "DESK_SLEEP_DETECTED")).toBe(false);
  });

  it("resets immediately when eyes reopen and warns on the second 4-second closure within one minute", () => {
    const tracker = new StudySessionTracker(DEFAULT_STUDY_SETTINGS, 0);
    tracker.process(frame(), monitor({ eyesClosed: true, closedDurationMs: 0 }), 0);
    let snapshot = tracker.process(frame(), monitor({ eyesClosed: true, closedDurationMs: 3_900 }), 3_900);
    expect(snapshot.counts.longEyeClosures).toBe(0);
    expect(snapshot.pendingAlert).toBeNull();
    snapshot = tracker.process(frame(), monitor({ eyesClosed: true, closedDurationMs: 4_000 }), 4_000);
    expect(snapshot.counts.longEyeClosures).toBe(1);
    expect(snapshot.pendingAlert).toBeNull();
    snapshot = tracker.process(frame(), monitor({ eyesClosed: false, closedDurationMs: 9_000 }), 4_080);
    expect(snapshot.status).toBe("FOCUS");
    tracker.process(frame(), monitor({ eyesClosed: true, closedDurationMs: 0 }), 5_000);
    snapshot = tracker.process(frame(), monitor({ eyesClosed: true, closedDurationMs: 4_000 }), 9_000);
    expect(snapshot.pendingAlert?.level).toBe(1);
    expect(snapshot.pendingAlert?.reason).toBe("LONG_EYE_CLOSURE");
    expect(snapshot.counts.longEyeClosures).toBe(2);
    expect(snapshot.counts.warningLevel1).toBe(1);
  });

  it("does not combine 4-second closures more than one minute apart", () => {
    const tracker = new StudySessionTracker(DEFAULT_STUDY_SETTINGS, 0);
    tracker.process(frame(), monitor({ eyesClosed: true }), 0);
    tracker.process(frame(), monitor({ eyesClosed: true, closedDurationMs: 4_000 }), 4_000);
    tracker.process(frame(), monitor({ eyesClosed: false }), 4_100);
    tracker.process(frame(), monitor({ eyesClosed: true }), 65_100);
    const snapshot = tracker.process(frame(), monitor({ eyesClosed: true, closedDurationMs: 4_000 }), 69_100);
    expect(snapshot.counts.longEyeClosures).toBe(2);
    expect(snapshot.pendingAlert).toBeNull();
  });

  it("records a sustained mouth opening as a yawn reference event", () => {
    const tracker = new StudySessionTracker(DEFAULT_STUDY_SETTINGS, 0);
    tracker.process(frame(yawnFace()), monitor(), 0);
    const snapshot = tracker.process(frame(yawnFace()), monitor(), 1_300);
    expect(snapshot.counts.yawns).toBe(1);
    expect(snapshot.events.some((event) => event.code === "YAWN_DETECTED" && event.detail === "참고 지표")).toBe(true);
  });

  it("marks absence at 10 seconds, auto-pauses at 30 seconds, and waits after return", () => {
    const tracker = new StudySessionTracker(DEFAULT_STUDY_SETTINGS, 0);
    tracker.process(frame(null), monitor({ faceVisible: false, poseVisible: false }), 0);
    let snapshot = tracker.process(frame(null), monitor({ faceVisible: false, poseVisible: false }), 10_000);
    expect(snapshot.status).toBe("AWAY");
    expect(snapshot.counts.userLeft).toBe(1);
    snapshot = tracker.process(frame(null), monitor({ faceVisible: false, poseVisible: false }), 30_000);
    expect(snapshot.events.some((event) => event.code === "STUDY_AUTO_PAUSED_BY_ABSENCE")).toBe(true);
    snapshot = tracker.process(frame(), monitor(), 31_000);
    expect(snapshot.status).toBe("RETURN_WAITING");
    expect(tracker.resumeFromReturn(32_000).status).toBe("FOCUS");
  });

  it("suspends absence checks in immersive focus and restarts them after closing", () => {
    const tracker = new StudySessionTracker(DEFAULT_STUDY_SETTINGS, 0);
    const missingFrame = frame(null);
    const missingMonitor = monitor({ faceVisible: false, poseVisible: false });

    tracker.process(missingFrame, missingMonitor, 0);
    let snapshot = tracker.process(missingFrame, missingMonitor, 20_000, { skipAbsence: true });
    expect(snapshot.status).toBe("FOCUS");
    expect(snapshot.counts.userLeft).toBe(0);

    tracker.resetAbsenceDetection();
    snapshot = tracker.process(missingFrame, missingMonitor, 20_100);
    expect(snapshot.status).toBe("FOCUS");
    snapshot = tracker.process(missingFrame, missingMonitor, 30_100);
    expect(snapshot.status).toBe("AWAY");
    expect(snapshot.counts.userLeft).toBe(1);
  });

  it("starts an automatic break and never resumes without the user", () => {
    const tracker = new StudySessionTracker(normalizeStudySettings({ focusMinutes: 5, breakMinutes: 5 }), 0);
    for (let now = 5_000; now <= 300_000; now += 5_000) tracker.tick(now);
    expect(tracker.getSnapshot().status).toBe("BREAK");
    for (let now = 305_000; now <= 605_000; now += 5_000) tracker.tick(now);
    expect(tracker.getSnapshot()).toMatchObject({ status: "BREAK", breakCompleted: true, breakRemainingMs: 0 });
    expect(tracker.endBreak(606_000).status).toBe("PAUSED");
  });

  it("limits an exercise reminder to two five-minute snoozes", () => {
    const tracker = new StudySessionTracker(normalizeStudySettings({ focusMinutes: null, exerciseIntervalMinutes: 10 }), 0);
    for (let now = 5_000; now <= 600_000; now += 5_000) tracker.tick(now);
    expect(tracker.getSnapshot().exerciseReminderDue).toBe(true);
    tracker.snoozeExercise(600_000);
    tracker.showExerciseReminder(601_000);
    tracker.snoozeExercise(601_000);
    tracker.showExerciseReminder(602_000);
    const snapshot = tracker.snoozeExercise(602_000);
    expect(snapshot.exerciseSnoozeCount).toBe(2);
    expect(snapshot.exerciseReminderDue).toBe(true);
    expect(snapshot.events.filter((event) => event.code === "STUDY_EXERCISE_SNOOZED")).toHaveLength(2);
  });

  it("does not treat looking down alone as a calibrated desk collapse", () => {
    const tracker = new StudySessionTracker(DEFAULT_STUDY_SETTINGS, 0);
    const snapshot = tracker.process(frame(), monitor({
      headDown: true,
      headDownDurationMs: 5_100,
    }), 5_100);
    expect(snapshot.counts.deskSleeps).toBe(0);
    expect(snapshot.pendingAlert).toBeNull();
    expect(snapshot.events.some((event) => event.code === "DESK_SLEEP_DETECTED")).toBe(false);
  });
});

describe("study records", () => {
  it("stores rates, recent-three comparison, timelines, and no camera media", () => {
    const tracker = new StudySessionTracker(DEFAULT_STUDY_SETTINGS, 1_000);
    for (let now = 6_000; now <= 61_000; now += 5_000) tracker.tick(now);
    const base = createStudyRecord(tracker.getSnapshot(), DEFAULT_STUDY_SETTINGS, [], 61_000);
    const previous = [0.75, 0.8, 0.85].map((focusRate, index) => ({
      ...base,
      id: `previous-${index}`,
      focusRate,
      rates: { ...base.rates, longEyeClosuresPerHour: 4 + index },
    })) satisfies StudySessionRecord[];
    const record = tracker.finish(previous, 62_000);
    expect(record.comparison.sampleSize).toBe(3);
    expect(record.rates.longEyeClosuresPerHour).toBeGreaterThanOrEqual(0);
    expect(record.settings.warningMode).toBe("QUIET");
    expect(record.events.some((event) => event.code === "STUDY_SESSION_ENDED")).toBe(true);
    expect(JSON.stringify(record)).not.toMatch(/cameraVideo|faceImage|facePhoto|rawFrame/i);
    const stored = appendStudyRecord(previous, record);
    expect(loadStudyRecords(JSON.stringify(stored))[0].id).toBe(record.id);
  });
});

function frame(face: Landmark[] | null = neutralFace()): VisionFrame {
  return { timestampMs: 0, face, pose: face ? neutralPose() : null };
}

function monitor(overrides: Partial<MonitorSnapshot> = {}): MonitorSnapshot {
  return {
    status: "NORMAL",
    trigger: "NONE",
    message: "집중 중",
    faceVisible: true,
    poseVisible: true,
    eyeAspectRatio: 0.25,
    baselineEyeAspectRatio: 0.25,
    eyesClosed: false,
    closedDurationMs: 0,
    headDown: false,
    headDownDurationMs: 0,
    baselineDeviated: false,
    baselineGuide: null,
    combinedDurationMs: 0,
    bodyCollapseDurationMs: 0,
    bodyCollapseCountReady: false,
    postureStatus: "GOOD",
    postureIssue: "NONE",
    postureScore: 100,
    postureConfidence: 0.95,
    postureMessage: "자세 안정",
    shoulderTiltDegrees: 0,
    headLeanDegrees: 0,
    torsoLeanDegrees: 0,
    forwardHeadPercent: 0,
    cameraViewAngleDegrees: 0,
    cameraView: "FRONT",
    calibrationProgress: 1,
    calibrationRemainingMs: 0,
    calibrationStable: true,
    ...overrides,
  };
}

function neutralFace(): Landmark[] {
  const points = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
  points[13] = { x: 0.5, y: 0.49, z: 0 };
  points[14] = { x: 0.5, y: 0.51, z: 0 };
  points[78] = { x: 0.4, y: 0.5, z: 0 };
  points[308] = { x: 0.6, y: 0.5, z: 0 };
  points[234] = { x: 0.35, y: 0.5, z: 0 };
  points[454] = { x: 0.65, y: 0.5, z: 0 };
  return points;
}

function yawnFace(): Landmark[] {
  const points = neutralFace();
  points[13] = { x: 0.5, y: 0.44, z: 0 };
  points[14] = { x: 0.5, y: 0.56, z: 0 };
  return points;
}

function neutralPose(): Landmark[] {
  return Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 1 }));
}
