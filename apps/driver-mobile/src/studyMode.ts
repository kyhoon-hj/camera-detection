import type { Landmark, MonitorSnapshot, VisionFrame } from "./monitor";

export const STUDY_SETTINGS_STORAGE_KEY = "suha.study-settings.v1";
export const STUDY_RECORDS_STORAGE_KEY = "suha.study-records.v1";

export const STUDY_EVENT_CODES = [
  "STUDY_SESSION_STARTED",
  "STUDY_SESSION_PAUSED",
  "STUDY_SESSION_RESUMED",
  "STUDY_SESSION_ENDED",
  "STUDY_FOCUS_STARTED",
  "STUDY_FOCUS_ENDED",
  "STUDY_ATTENTION_WARNING",
  "BLINK_DETECTED",
  "LONG_EYE_CLOSURE_DETECTED",
  "YAWN_DETECTED",
  "HEAD_DROP_DETECTED",
  "DESK_SLEEP_DETECTED",
  "POSTURE_WARNING",
  "FACE_TOO_CLOSE",
  "STUDY_DROWSY_LEVEL_1",
  "STUDY_DROWSY_LEVEL_2",
  "STUDY_DROWSY_LEVEL_3",
  "STUDY_BREAK_STARTED",
  "STUDY_BREAK_ENDED",
  "STUDY_BREAK_COMPLETED",
  "STUDY_BREAK_SKIPPED",
  "STUDY_EXERCISE_REMINDER",
  "STUDY_EXERCISE_STARTED",
  "STUDY_EXERCISE_ENDED",
  "STUDY_EXERCISE_SNOOZED",
  "STUDY_EXERCISE_SKIPPED",
  "STUDY_USER_LEFT",
  "STUDY_AUTO_PAUSED_BY_ABSENCE",
  "STUDY_RETURN_REMINDER",
  "STUDY_USER_RETURNED",
  "STUDY_TTS_PLAYED",
  "STUDY_SOUND_PLAYED",
  "STUDY_VIDEO_PLAYED",
  "STUDY_CAMERA_QUALITY_LOW",
  "STUDY_FACE_NOT_DETECTED",
  "STUDY_EYE_NOT_DETECTED",
] as const;

export type StudyEventCode = typeof STUDY_EVENT_CODES[number];
export type StudyStatus = "READY" | "CALIBRATING" | "FOCUS" | "ATTENTION" | "DROWSY" | "BREAK" | "EXERCISE" | "PAUSED" | "AWAY" | "RETURN_WAITING" | "COMPLETED";
export type StudyWarningMode = "QUIET" | "NORMAL" | "STRONG";
export type StudyVoiceMode = "OFF" | "MINIMAL" | "NORMAL" | "ACTIVE";
export type StudyContentMode = "NONE" | "DEFAULT" | "SELECTED" | "RANDOM";
export type StudyTimelineState = "FOCUS" | "ATTENTION" | "DROWSY" | "BREAK" | "EXERCISE" | "AWAY" | "PAUSED";
export type StudyTimeInputMode = "PRESET" | "CUSTOM";

export interface StudySettings {
  dailyGoalMinutes: number;
  focusMinutes: number | null;
  breakEnabled: boolean;
  breakMinutes: number;
  breakDurationInputMode: StudyTimeInputMode;
  exerciseEnabled: boolean;
  exerciseIntervalMinutes: number;
  exerciseIntervalInputMode: StudyTimeInputMode;
  exerciseMinutes: number;
  warningMode: StudyWarningMode;
  voiceMode: StudyVoiceMode;
  voiceEnabled: boolean;
  voiceDrowsinessEnabled: boolean;
  voiceBreakStartEnabled: boolean;
  voiceBreakEnabled: boolean;
  voiceReturnEnabled: boolean;
  videoEnabled: boolean;
  soundEnabled: boolean;
  vibrationEnabled: boolean;
  returnReminderEnabled: boolean;
  returnReminderMinutes: number;
  previewEnabled: boolean;
  warningVideo: StudyContentMode;
  breakVideo: StudyContentMode;
  exerciseVideo: StudyContentMode;
  returnVideo: StudyContentMode;
}

export const DEFAULT_STUDY_SETTINGS: StudySettings = {
  dailyGoalMinutes: 120,
  focusMinutes: 45,
  breakEnabled: true,
  breakMinutes: 10,
  breakDurationInputMode: "PRESET",
  exerciseEnabled: true,
  exerciseIntervalMinutes: 45,
  exerciseIntervalInputMode: "PRESET",
  exerciseMinutes: 3,
  warningMode: "QUIET",
  voiceMode: "MINIMAL",
  voiceEnabled: true,
  voiceDrowsinessEnabled: true,
  voiceBreakStartEnabled: true,
  voiceBreakEnabled: true,
  voiceReturnEnabled: true,
  videoEnabled: true,
  soundEnabled: false,
  vibrationEnabled: true,
  returnReminderEnabled: true,
  returnReminderMinutes: 5,
  previewEnabled: false,
  warningVideo: "NONE",
  breakVideo: "DEFAULT",
  exerciseVideo: "DEFAULT",
  returnVideo: "NONE",
};

export interface StudyEvent {
  code: StudyEventCode;
  at: number;
  elapsedMs: number;
  value?: number;
  detail?: string;
}

export interface StudyTimelinePoint {
  at: number;
  elapsedMs: number;
  state: StudyTimelineState;
  detail?: string;
}

export interface StudyCounts {
  blinks: number;
  longEyeClosures: number;
  yawns: number;
  headDrops: number;
  deskSleeps: number;
  postureWarnings: number;
  faceTooClose: number;
  userLeft: number;
  warningLevel1: number;
  warningLevel2: number;
  warningLevel3: number;
  breaks: number;
  exercises: number;
  ttsPlayed: number;
  soundPlayed: number;
  videoPlayed: number;
}

export interface StudyQuality {
  grade: "GOOD" | "REFERENCE";
  faceVisibleRate: number;
  eyeVisibleRate: number;
  poseVisibleRate: number;
}

export interface StudyPendingAlert {
  level: 1 | 2 | 3;
  reason: "LONG_EYE_CLOSURE" | "DESK_SLEEP" | "REPEATED_DROWSY";
  message: string;
  eventAt: number;
}

export interface StudyLiveSnapshot {
  id: string;
  status: StudyStatus;
  startedAt: number;
  updatedAt: number;
  actualStudyMs: number;
  focusMs: number;
  attentionMs: number;
  drowsyMs: number;
  breakMs: number;
  exerciseMs: number;
  awayMs: number;
  pausedMs: number;
  currentContinuousFocusMs: number;
  longestContinuousFocusMs: number;
  nextBreakInMs: number | null;
  nextExerciseInMs: number | null;
  breakRemainingMs: number;
  exerciseRemainingMs: number;
  awayDurationMs: number;
  returnReminderDue: boolean;
  exerciseReminderDue: boolean;
  exerciseSnoozeCount: number;
  breakCompleted: boolean;
  exerciseCompleted: boolean;
  counts: StudyCounts;
  maxEyeClosureMs: number;
  quality: StudyQuality;
  pendingAlert: StudyPendingAlert | null;
  events: StudyEvent[];
  timeline: StudyTimelinePoint[];
}

export interface StudyRates {
  longEyeClosuresPerHour: number;
  yawnsPerHour: number;
  headDropsPerHour: number;
  postureWarningsPerHour: number;
}

export interface StudyComparison {
  sampleSize: number;
  focusRateAverage: number | null;
  focusRateChangePercent: number | null;
  longEyeClosuresPerHourAverage: number | null;
  longEyeClosureRateChangePercent: number | null;
  label: "BETTER" | "SIMILAR" | "LOWER" | "NO_DATA";
}

export interface StudySessionRecord {
  id: string;
  startedAt: number;
  endedAt: number;
  totalSessionMs: number;
  actualStudyMs: number;
  focusMs: number;
  attentionMs: number;
  drowsyMs: number;
  breakMs: number;
  exerciseMs: number;
  awayMs: number;
  pausedMs: number;
  longestContinuousFocusMs: number;
  focusRate: number;
  counts: StudyCounts;
  rates: StudyRates;
  maxEyeClosureMs: number;
  quality: StudyQuality;
  settings: StudySettings;
  events: StudyEvent[];
  timeline: StudyTimelinePoint[];
  comparison: StudyComparison;
  insights: string[];
}

const ACTIVE_STATES = new Set<StudyStatus>(["FOCUS", "ATTENTION", "DROWSY"]);
const LONG_EYE_CLOSURE_MIN_MS = 4_000;
const EYE_WARNING_MIN_MS = 4_000;
const EYE_WARNING_WINDOW_MS = 60_000;
const DESK_SLEEP_WARNING_MIN_MS = 5_000;

export function normalizeStudySettings(value: Partial<StudySettings> | null | undefined): StudySettings {
  const input = value ?? {};
  const sharedDuration = clampNumber(input.breakMinutes ?? input.exerciseMinutes, 1, 60, DEFAULT_STUDY_SETTINGS.breakMinutes);
  const sharedInterval = clampNumber(input.exerciseIntervalMinutes ?? input.focusMinutes, 5, 180, DEFAULT_STUDY_SETTINGS.exerciseIntervalMinutes);
  const breakDurationInputMode = enumValue(
    input.breakDurationInputMode,
    ["PRESET", "CUSTOM"] as const,
    [5, 10, 15].includes(sharedDuration) ? "PRESET" : "CUSTOM",
  );
  const exerciseIntervalInputMode = enumValue(
    input.exerciseIntervalInputMode,
    ["PRESET", "CUSTOM"] as const,
    [30, 45, 60].includes(sharedInterval) ? "PRESET" : "CUSTOM",
  );
  return {
    dailyGoalMinutes: clampNumber(input.dailyGoalMinutes, 10, 1440, DEFAULT_STUDY_SETTINGS.dailyGoalMinutes),
    focusMinutes: clampNumber(input.focusMinutes, 5, 720, DEFAULT_STUDY_SETTINGS.focusMinutes!),
    breakEnabled: true,
    breakMinutes: sharedDuration,
    breakDurationInputMode,
    exerciseEnabled: true,
    exerciseIntervalMinutes: sharedInterval,
    exerciseIntervalInputMode,
    exerciseMinutes: sharedDuration,
    warningMode: enumValue(input.warningMode, ["QUIET", "NORMAL", "STRONG"] as const, DEFAULT_STUDY_SETTINGS.warningMode),
    voiceMode: enumValue(input.voiceMode, ["OFF", "MINIMAL", "NORMAL", "ACTIVE"] as const, DEFAULT_STUDY_SETTINGS.voiceMode),
    voiceEnabled: bool(input.voiceEnabled, input.voiceMode !== "OFF"),
    voiceDrowsinessEnabled: bool(input.voiceDrowsinessEnabled, DEFAULT_STUDY_SETTINGS.voiceDrowsinessEnabled),
    voiceBreakStartEnabled: bool(input.voiceBreakStartEnabled, DEFAULT_STUDY_SETTINGS.voiceBreakStartEnabled),
    voiceBreakEnabled: bool(input.voiceBreakEnabled, DEFAULT_STUDY_SETTINGS.voiceBreakEnabled),
    voiceReturnEnabled: bool(input.voiceReturnEnabled, DEFAULT_STUDY_SETTINGS.voiceReturnEnabled),
    videoEnabled: bool(input.videoEnabled, DEFAULT_STUDY_SETTINGS.videoEnabled),
    soundEnabled: bool(input.soundEnabled, DEFAULT_STUDY_SETTINGS.soundEnabled),
    vibrationEnabled: bool(input.vibrationEnabled, DEFAULT_STUDY_SETTINGS.vibrationEnabled),
    returnReminderEnabled: bool(input.returnReminderEnabled, DEFAULT_STUDY_SETTINGS.returnReminderEnabled),
    returnReminderMinutes: clampNumber(input.returnReminderMinutes, 1, 60, DEFAULT_STUDY_SETTINGS.returnReminderMinutes),
    previewEnabled: bool(input.previewEnabled, DEFAULT_STUDY_SETTINGS.previewEnabled),
    warningVideo: enumValue(input.warningVideo, ["NONE", "DEFAULT", "SELECTED", "RANDOM"] as const, DEFAULT_STUDY_SETTINGS.warningVideo),
    breakVideo: enumValue(input.breakVideo, ["NONE", "DEFAULT", "SELECTED", "RANDOM"] as const, DEFAULT_STUDY_SETTINGS.breakVideo),
    exerciseVideo: enumValue(input.exerciseVideo, ["NONE", "DEFAULT", "SELECTED", "RANDOM"] as const, DEFAULT_STUDY_SETTINGS.exerciseVideo),
    returnVideo: enumValue(input.returnVideo, ["NONE", "DEFAULT", "SELECTED", "RANDOM"] as const, DEFAULT_STUDY_SETTINGS.returnVideo),
  };
}

export function loadStudySettings(raw: string | null): StudySettings {
  if (!raw) return DEFAULT_STUDY_SETTINGS;
  try {
    return normalizeStudySettings(JSON.parse(raw) as Partial<StudySettings>);
  } catch {
    return DEFAULT_STUDY_SETTINGS;
  }
}

export function loadStudyRecords(raw: string | null): StudySessionRecord[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isStudyRecord).slice(0, 100);
  } catch {
    return [];
  }
}

export function appendStudyRecord(records: StudySessionRecord[], record: StudySessionRecord): StudySessionRecord[] {
  return [record, ...records.filter((item) => item.id !== record.id)].slice(0, 100);
}

export class StudySessionTracker {
  readonly settings: StudySettings;
  private snapshot: StudyLiveSnapshot;
  private lastTickAt: number;
  private focusCycleMs = 0;
  private exerciseCycleMs = 0;
  private breakEndsAt = 0;
  private exerciseEndsAt = 0;
  private absenceSince: number | null = null;
  private absenceNotified = false;
  private autoPausedByAbsence = false;
  private returnReminderSent = false;
  private wasEyesClosed = false;
  private eyeClosedSince: number | null = null;
  private closureEventRaised = false;
  private closureWarningLevel = 0;
  private recentDrowsyEvents: number[] = [];
  private yawnStartedAt: number | null = null;
  private lastYawnAt = -Infinity;
  private deskSleepActive = false;
  private lastDeskSleepAt = -Infinity;
  private postureWarningActive = false;
  private lastPostureWarningAt = -Infinity;
  private closeStartedAt: number | null = null;
  private lastFaceTooCloseAt = -Infinity;
  private baselineFaceWidths: number[] = [];
  private baselineFaceWidth: number | null = null;
  private qualityFrames = 0;
  private faceFrames = 0;
  private eyeFrames = 0;
  private poseFrames = 0;
  private qualityWarningRaised = false;
  private lastTimelineAt = -Infinity;

  constructor(settings: StudySettings, now = Date.now()) {
    this.settings = normalizeStudySettings(settings);
    this.lastTickAt = now;
    this.snapshot = {
      id: createSessionId(now),
      status: "FOCUS",
      startedAt: now,
      updatedAt: now,
      actualStudyMs: 0,
      focusMs: 0,
      attentionMs: 0,
      drowsyMs: 0,
      breakMs: 0,
      exerciseMs: 0,
      awayMs: 0,
      pausedMs: 0,
      currentContinuousFocusMs: 0,
      longestContinuousFocusMs: 0,
      nextBreakInMs: this.settings.focusMinutes === null ? null : this.settings.focusMinutes * 60_000,
      nextExerciseInMs: this.settings.exerciseEnabled ? this.settings.exerciseIntervalMinutes * 60_000 : null,
      breakRemainingMs: 0,
      exerciseRemainingMs: 0,
      awayDurationMs: 0,
      returnReminderDue: false,
      exerciseReminderDue: false,
      exerciseSnoozeCount: 0,
      breakCompleted: false,
      exerciseCompleted: false,
      counts: emptyCounts(),
      maxEyeClosureMs: 0,
      quality: { grade: "GOOD", faceVisibleRate: 1, eyeVisibleRate: 1, poseVisibleRate: 1 },
      pendingAlert: null,
      events: [],
      timeline: [],
    };
    this.addEvent("STUDY_SESSION_STARTED", now);
    this.addEvent("STUDY_FOCUS_STARTED", now);
    this.addTimeline(now, "FOCUS", "열공 시작");
  }

  getSnapshot(): StudyLiveSnapshot {
    return {
      ...this.snapshot,
      counts: { ...this.snapshot.counts },
      quality: { ...this.snapshot.quality },
      pendingAlert: this.snapshot.pendingAlert ? { ...this.snapshot.pendingAlert } : null,
      events: [...this.snapshot.events],
      timeline: [...this.snapshot.timeline],
    };
  }

  updateSettings(next: Partial<StudySettings>): void {
    Object.assign(this.settings, normalizeStudySettings({ ...this.settings, ...next }));
    this.updateSchedules();
  }

  tick(now = Date.now()): StudyLiveSnapshot {
    const delta = Math.max(0, Math.min(now - this.lastTickAt, 5_000));
    this.lastTickAt = now;
    this.snapshot.updatedAt = now;
    this.accumulate(delta);
    this.updateTimedStates(now);
    this.updateSchedules();
    this.maybeAddTimeline(now);
    return this.getSnapshot();
  }

  process(
    frame: VisionFrame,
    monitor: MonitorSnapshot,
    now = Date.now(),
    options: { skipAbsence?: boolean } = {},
  ): StudyLiveSnapshot {
    this.tick(now);
    this.updateQuality(frame, monitor, now);
    if (!ACTIVE_STATES.has(this.snapshot.status) && this.snapshot.status !== "AWAY" && this.snapshot.status !== "RETURN_WAITING") {
      return this.getSnapshot();
    }
    if (this.snapshot.status === "RETURN_WAITING") return this.getSnapshot();
    const userVisible = monitor.faceVisible
      || (monitor.poseVisible && monitor.trigger === "NONE" && monitor.calibrationStable);
    if (options.skipAbsence) {
      this.resetAbsenceDetection();
      if (!userVisible) return this.getSnapshot();
    } else {
      this.processAbsence(userVisible, now);
    }
    if (!userVisible || this.autoPausedByAbsence || !ACTIVE_STATES.has(this.snapshot.status)) return this.getSnapshot();
    const eyeClosedDurationMs = this.processEyes(monitor, now);
    this.processYawn(frame.face, now);
    this.processDeskSleep(monitor, now);
    this.processPosture(monitor, now);
    this.processFaceDistance(frame.face, now);
    this.applyLiveStatus(monitor, eyeClosedDurationMs, now);
    return this.getSnapshot();
  }

  pause(now = Date.now()): StudyLiveSnapshot {
    this.tick(now);
    if (ACTIVE_STATES.has(this.snapshot.status)) this.addEvent("STUDY_FOCUS_ENDED", now);
    this.setStatus("PAUSED", now, "일시 정지");
    this.addEvent("STUDY_SESSION_PAUSED", now);
    return this.getSnapshot();
  }

  resume(now = Date.now()): StudyLiveSnapshot {
    this.tick(now);
    this.absenceSince = null;
    this.absenceNotified = false;
    this.autoPausedByAbsence = false;
    this.returnReminderSent = false;
    this.snapshot.returnReminderDue = false;
    this.setStatus("FOCUS", now, "열공 재개");
    this.addEvent("STUDY_SESSION_RESUMED", now);
    this.addEvent("STUDY_FOCUS_STARTED", now);
    return this.getSnapshot();
  }

  startBreak(now = Date.now(), minutes = this.settings.breakMinutes): StudyLiveSnapshot {
    this.tick(now);
    this.beginBreak(now, minutes);
    return this.getSnapshot();
  }

  private beginBreak(now: number, minutes: number): void {
    if (ACTIVE_STATES.has(this.snapshot.status)) this.addEvent("STUDY_FOCUS_ENDED", now);
    this.breakEndsAt = now + Math.max(1, minutes) * 60_000;
    this.snapshot.breakCompleted = false;
    this.snapshot.breakRemainingMs = this.breakEndsAt - now;
    this.snapshot.counts.breaks += 1;
    this.focusCycleMs = 0;
    this.exerciseCycleMs = 0;
    this.snapshot.exerciseReminderDue = false;
    this.snapshot.exerciseSnoozeCount = 0;
    this.setStatus("BREAK", now, "휴식 시작");
    this.addEvent("STUDY_BREAK_STARTED", now, minutes);
  }

  endBreak(now = Date.now()): StudyLiveSnapshot {
    this.tick(now);
    const completed = this.snapshot.breakCompleted || this.snapshot.breakRemainingMs <= 0;
    this.addEvent(completed ? "STUDY_BREAK_ENDED" : "STUDY_BREAK_SKIPPED", now);
    this.breakEndsAt = 0;
    this.snapshot.breakRemainingMs = 0;
    this.snapshot.exerciseReminderDue = false;
    this.snapshot.exerciseSnoozeCount = 0;
    this.setStatus("PAUSED", now, "휴식 종료 · 다시 시작 대기");
    return this.getSnapshot();
  }

  showExerciseReminder(now = Date.now()): StudyLiveSnapshot {
    if (this.snapshot.exerciseReminderDue) return this.getSnapshot();
    this.snapshot.exerciseReminderDue = true;
    this.addEvent("STUDY_EXERCISE_REMINDER", now);
    return this.getSnapshot();
  }

  snoozeExercise(now = Date.now()): StudyLiveSnapshot {
    if (!this.snapshot.exerciseReminderDue) return this.getSnapshot();
    if (this.snapshot.exerciseSnoozeCount >= 2) return this.getSnapshot();
    this.snapshot.exerciseSnoozeCount += 1;
    this.snapshot.exerciseReminderDue = false;
    this.exerciseCycleMs = Math.max(0, this.settings.exerciseIntervalMinutes * 60_000 - 5 * 60_000);
    this.addEvent("STUDY_EXERCISE_SNOOZED", now, this.snapshot.exerciseSnoozeCount);
    return this.getSnapshot();
  }

  skipExercise(now = Date.now()): StudyLiveSnapshot {
    this.snapshot.exerciseReminderDue = false;
    this.snapshot.exerciseSnoozeCount = 0;
    this.exerciseCycleMs = 0;
    this.addEvent("STUDY_EXERCISE_SKIPPED", now);
    return this.getSnapshot();
  }

  startExercise(now = Date.now(), minutes = this.settings.exerciseMinutes): StudyLiveSnapshot {
    this.tick(now);
    if (ACTIVE_STATES.has(this.snapshot.status)) this.addEvent("STUDY_FOCUS_ENDED", now);
    this.exerciseEndsAt = now + Math.max(1, minutes) * 60_000;
    this.snapshot.exerciseRemainingMs = this.exerciseEndsAt - now;
    this.snapshot.exerciseCompleted = false;
    this.snapshot.exerciseReminderDue = false;
    this.snapshot.exerciseSnoozeCount = 0;
    this.snapshot.counts.exercises += 1;
    this.exerciseCycleMs = 0;
    this.setStatus("EXERCISE", now, "운동 시작");
    this.addEvent("STUDY_EXERCISE_STARTED", now, minutes);
    return this.getSnapshot();
  }

  endExercise(now = Date.now()): StudyLiveSnapshot {
    this.tick(now);
    this.exerciseEndsAt = 0;
    this.snapshot.exerciseRemainingMs = 0;
    this.addEvent("STUDY_EXERCISE_ENDED", now);
    this.setStatus("PAUSED", now, "운동 종료 · 다시 시작 대기");
    return this.getSnapshot();
  }

  resumeFromReturn(now = Date.now()): StudyLiveSnapshot {
    return this.resume(now);
  }

  extendAway(now = Date.now(), minutes = 5): StudyLiveSnapshot {
    this.snapshot.status = "AWAY";
    this.snapshot.returnReminderDue = false;
    this.returnReminderSent = false;
    this.absenceSince = now - Math.max(0, this.snapshot.awayDurationMs);
    this.settings.returnReminderMinutes = Math.max(1, minutes);
    this.addTimeline(now, "AWAY", `${minutes}분 더 쉬기`);
    return this.getSnapshot();
  }

  acknowledgeAlert(): StudyLiveSnapshot {
    this.snapshot.pendingAlert = null;
    return this.getSnapshot();
  }

  resetAbsenceDetection(): StudyLiveSnapshot {
    if (this.snapshot.status === "AWAY" && !this.autoPausedByAbsence) {
      this.setStatus("FOCUS", this.snapshot.updatedAt);
    }
    this.absenceSince = null;
    this.absenceNotified = false;
    this.autoPausedByAbsence = false;
    this.returnReminderSent = false;
    this.snapshot.awayDurationMs = 0;
    this.snapshot.returnReminderDue = false;
    return this.getSnapshot();
  }

  resetTransientDetection(now = Date.now()): StudyLiveSnapshot {
    this.wasEyesClosed = false;
    this.eyeClosedSince = null;
    this.closureEventRaised = false;
    this.closureWarningLevel = 0;
    this.yawnStartedAt = null;
    this.deskSleepActive = false;
    this.postureWarningActive = false;
    this.closeStartedAt = null;
    if (this.snapshot.status === "DROWSY" || this.snapshot.status === "ATTENTION") {
      this.setStatus("FOCUS", now);
    }
    return this.getSnapshot();
  }

  recordTts(now = Date.now(), detail?: string): void {
    this.snapshot.counts.ttsPlayed += 1;
    this.addEvent("STUDY_TTS_PLAYED", now, undefined, detail);
  }

  recordSound(now = Date.now(), detail?: string): void {
    this.snapshot.counts.soundPlayed += 1;
    this.addEvent("STUDY_SOUND_PLAYED", now, undefined, detail);
  }

  recordVideo(now = Date.now(), detail?: string): void {
    this.snapshot.counts.videoPlayed += 1;
    this.addEvent("STUDY_VIDEO_PLAYED", now, undefined, detail);
  }

  finish(records: StudySessionRecord[], now = Date.now()): StudySessionRecord {
    this.tick(now);
    if (ACTIVE_STATES.has(this.snapshot.status)) this.addEvent("STUDY_FOCUS_ENDED", now);
    this.addEvent("STUDY_SESSION_ENDED", now);
    this.setStatus("COMPLETED", now, "열공 종료");
    return createStudyRecord(this.getSnapshot(), this.settings, records, now);
  }

  private accumulate(delta: number): void {
    if (delta <= 0) return;
    switch (this.snapshot.status) {
      case "FOCUS":
        this.snapshot.actualStudyMs += delta;
        this.snapshot.focusMs += delta;
        this.snapshot.currentContinuousFocusMs += delta;
        this.snapshot.longestContinuousFocusMs = Math.max(this.snapshot.longestContinuousFocusMs, this.snapshot.currentContinuousFocusMs);
        this.focusCycleMs += delta;
        this.exerciseCycleMs += delta;
        break;
      case "ATTENTION":
        this.snapshot.actualStudyMs += delta;
        this.snapshot.attentionMs += delta;
        this.snapshot.currentContinuousFocusMs = 0;
        this.focusCycleMs += delta;
        this.exerciseCycleMs += delta;
        break;
      case "DROWSY":
        this.snapshot.actualStudyMs += delta;
        this.snapshot.drowsyMs += delta;
        this.snapshot.currentContinuousFocusMs = 0;
        this.focusCycleMs += delta;
        this.exerciseCycleMs += delta;
        break;
      case "BREAK": this.snapshot.breakMs += delta; break;
      case "EXERCISE": this.snapshot.exerciseMs += delta; break;
      case "AWAY":
        this.snapshot.awayMs += delta;
        if (!this.autoPausedByAbsence) {
          this.snapshot.actualStudyMs += delta;
          this.snapshot.attentionMs += delta;
          this.focusCycleMs += delta;
          this.exerciseCycleMs += delta;
        }
        break;
      case "RETURN_WAITING": this.snapshot.awayMs += delta; break;
      case "PAUSED": this.snapshot.pausedMs += delta; break;
      default: break;
    }
  }

  private updateTimedStates(now: number): void {
    if (this.snapshot.status === "BREAK" && this.breakEndsAt > 0) {
      this.snapshot.breakRemainingMs = Math.max(0, this.breakEndsAt - now);
      if (this.snapshot.breakRemainingMs === 0 && !this.snapshot.breakCompleted) {
        this.snapshot.breakCompleted = true;
        this.addEvent("STUDY_BREAK_COMPLETED", now);
      }
    }
    if (this.snapshot.status === "EXERCISE" && this.exerciseEndsAt > 0) {
      this.snapshot.exerciseRemainingMs = Math.max(0, this.exerciseEndsAt - now);
      if (this.snapshot.exerciseRemainingMs === 0) this.snapshot.exerciseCompleted = true;
    }
    if (this.absenceSince !== null) {
      this.snapshot.awayDurationMs = Math.max(0, now - this.absenceSince);
      if (this.settings.returnReminderEnabled
        && this.snapshot.awayDurationMs >= this.settings.returnReminderMinutes * 60_000
        && !this.returnReminderSent) {
        this.returnReminderSent = true;
        this.snapshot.returnReminderDue = true;
        this.addEvent("STUDY_RETURN_REMINDER", now);
      }
    }
    if (ACTIVE_STATES.has(this.snapshot.status)) {
      if (this.settings.breakEnabled && this.exerciseCycleMs >= this.settings.exerciseIntervalMinutes * 60_000) {
        this.beginBreak(now, this.settings.breakMinutes);
        this.showExerciseReminder(now);
        return;
      }
    }
  }

  private updateSchedules(): void {
    this.snapshot.nextBreakInMs = this.settings.breakEnabled
      ? Math.max(0, this.settings.exerciseIntervalMinutes * 60_000 - this.exerciseCycleMs)
      : null;
    this.snapshot.nextExerciseInMs = this.settings.exerciseEnabled
      ? Math.max(0, this.settings.exerciseIntervalMinutes * 60_000 - this.exerciseCycleMs)
      : null;
  }

  private processAbsence(faceVisible: boolean, now: number): void {
    if (!faceVisible) {
      if (this.absenceSince === null) {
        this.absenceSince = now;
        this.addEvent("STUDY_FACE_NOT_DETECTED", now);
      }
      const duration = now - this.absenceSince;
      this.snapshot.awayDurationMs = duration;
      if (duration >= 10_000 && !this.absenceNotified) {
        this.absenceNotified = true;
        this.snapshot.counts.userLeft += 1;
        this.addEvent("STUDY_USER_LEFT", now);
        this.setStatus("AWAY", now, "자리 이탈");
      }
      if (duration >= 30_000 && !this.autoPausedByAbsence) {
        this.autoPausedByAbsence = true;
        this.addEvent("STUDY_AUTO_PAUSED_BY_ABSENCE", now);
        this.addEvent("STUDY_SESSION_PAUSED", now, undefined, "자리 이탈");
        this.setStatus("AWAY", now, "자리 이탈로 자동 일시 정지");
      }
      return;
    }
    if (this.absenceSince !== null && this.absenceNotified) {
      this.snapshot.awayDurationMs = now - this.absenceSince;
      this.addEvent("STUDY_USER_RETURNED", now, this.snapshot.awayDurationMs);
      this.setStatus("RETURN_WAITING", now, "자리 복귀 · 시작 대기");
      return;
    }
    this.absenceSince = null;
    this.snapshot.awayDurationMs = 0;
  }

  private processEyes(monitor: MonitorSnapshot, now: number): number {
    const eyesObservable = monitor.faceVisible
      && monitor.eyeAspectRatio !== null
      && !monitor.headDown;
    if (!eyesObservable) {
      this.eyeClosedSince = null;
      this.wasEyesClosed = false;
      this.closureEventRaised = false;
      this.closureWarningLevel = 0;
      return 0;
    }
    const eyesClosed = monitor.eyesClosed;
    let detectedDuration = 0;
    if (eyesClosed) {
      if (!this.wasEyesClosed) {
        this.eyeClosedSince = now;
        this.closureEventRaised = false;
        this.closureWarningLevel = 0;
      }
      const duration = Math.max(monitor.closedDurationMs, this.eyeClosedSince === null ? 0 : now - this.eyeClosedSince);
      detectedDuration = duration;
      this.snapshot.maxEyeClosureMs = Math.max(this.snapshot.maxEyeClosureMs, duration);
      if (duration >= LONG_EYE_CLOSURE_MIN_MS && !this.closureEventRaised) {
        this.closureEventRaised = true;
        this.snapshot.counts.longEyeClosures += 1;
        this.addEvent("LONG_EYE_CLOSURE_DETECTED", now, duration);
        this.addEvent("STUDY_ATTENTION_WARNING", now, duration);
        this.recentDrowsyEvents.push(now);
        this.recentDrowsyEvents = this.recentDrowsyEvents.filter((item) => now - item <= EYE_WARNING_WINDOW_MS);
        const recentWarningCount = this.recentDrowsyEvents.length;
        if (recentWarningCount >= 2) {
          this.raiseDrowsyLevel(1, now, "LONG_EYE_CLOSURE");
        }
      }
    } else if (this.wasEyesClosed) {
      const duration = this.eyeClosedSince === null ? 0 : now - this.eyeClosedSince;
      if (duration > 40 && duration < LONG_EYE_CLOSURE_MIN_MS) {
        this.snapshot.counts.blinks += 1;
        this.addEvent("BLINK_DETECTED", now, duration);
      }
      this.eyeClosedSince = null;
      this.closureEventRaised = false;
      this.closureWarningLevel = 0;
    }
    this.wasEyesClosed = eyesClosed;
    return detectedDuration;
  }

  private processYawn(face: Landmark[] | null, now: number): void {
    const ratio = mouthOpenRatio(face);
    if (ratio !== null && ratio >= 0.22) {
      this.yawnStartedAt ??= now;
      if (now - this.yawnStartedAt >= 700 && now - this.lastYawnAt >= 5_000) {
        this.lastYawnAt = now;
        this.snapshot.counts.yawns += 1;
        this.addEvent("YAWN_DETECTED", now, ratio, "참고 지표");
      }
    } else {
      this.yawnStartedAt = null;
    }
  }

  private processDeskSleep(monitor: MonitorSnapshot, now: number): void {
    const calibratedCollapse = monitor.bodyCollapseCountReady
      && monitor.postureStatus === "WARNING"
      && monitor.postureIssue === "SLOUCHING";
    const collapseDurationMs = monitor.bodyCollapseDurationMs;
    const active = calibratedCollapse && collapseDurationMs > DESK_SLEEP_WARNING_MIN_MS;
    if (active && !this.deskSleepActive && now - this.lastDeskSleepAt >= 30_000) {
      this.lastDeskSleepAt = now;
      this.snapshot.counts.deskSleeps += 1;
      this.addEvent("DESK_SLEEP_DETECTED", now, collapseDurationMs);
      this.raiseDrowsyLevel(3, now, "DESK_SLEEP");
    }
    this.deskSleepActive = active;
  }

  private processPosture(monitor: MonitorSnapshot, now: number): void {
    const active = !monitor.headDown && monitor.postureStatus === "WARNING";
    if (active && !this.postureWarningActive && now - this.lastPostureWarningAt >= 30_000) {
      this.lastPostureWarningAt = now;
      this.snapshot.counts.postureWarnings += 1;
      this.addEvent("POSTURE_WARNING", now, undefined, monitor.postureIssue);
    }
    this.postureWarningActive = active;
  }

  private processFaceDistance(face: Landmark[] | null, now: number): void {
    const width = faceWidth(face);
    if (width === null) {
      this.closeStartedAt = null;
      return;
    }
    if (this.baselineFaceWidth === null) {
      this.baselineFaceWidths.push(width);
      if (this.baselineFaceWidths.length >= 20) this.baselineFaceWidth = median(this.baselineFaceWidths);
      return;
    }
    const tooClose = width >= Math.max(0.55, this.baselineFaceWidth * 1.45);
    if (tooClose) {
      this.closeStartedAt ??= now;
      if (now - this.closeStartedAt >= 3_000 && now - this.lastFaceTooCloseAt >= 30_000) {
        this.lastFaceTooCloseAt = now;
        this.snapshot.counts.faceTooClose += 1;
        this.addEvent("FACE_TOO_CLOSE", now, width / this.baselineFaceWidth);
      }
    } else {
      this.closeStartedAt = null;
    }
  }

  private applyLiveStatus(monitor: MonitorSnapshot, eyeClosedDurationMs: number, now: number): void {
    if (!ACTIVE_STATES.has(this.snapshot.status)) return;
    const eyesObservable = monitor.faceVisible
      && monitor.eyeAspectRatio !== null
      && !monitor.headDown;
    const closedDurationMs = eyesObservable && monitor.eyesClosed
      ? Math.max(monitor.closedDurationMs, eyeClosedDurationMs)
      : 0;
    const next: StudyStatus = closedDurationMs >= EYE_WARNING_MIN_MS
      ? "DROWSY"
      : closedDurationMs >= LONG_EYE_CLOSURE_MIN_MS || (!monitor.headDown && monitor.postureStatus === "WARNING")
        ? "ATTENTION"
        : "FOCUS";
    if (next !== this.snapshot.status) this.setStatus(next, now);
  }

  private updateQuality(frame: VisionFrame, monitor: MonitorSnapshot, now: number): void {
    this.qualityFrames += 1;
    if (monitor.faceVisible) this.faceFrames += 1;
    if (frame.face !== null && frame.face.length > 387) this.eyeFrames += 1;
    if (monitor.poseVisible) this.poseFrames += 1;
    const faceRate = this.faceFrames / this.qualityFrames;
    const eyeRate = this.eyeFrames / this.qualityFrames;
    const poseRate = this.poseFrames / this.qualityFrames;
    this.snapshot.quality = {
      grade: this.qualityFrames >= 100 && (faceRate < 0.75 || eyeRate < 0.75) ? "REFERENCE" : "GOOD",
      faceVisibleRate: faceRate,
      eyeVisibleRate: eyeRate,
      poseVisibleRate: poseRate,
    };
    if (this.qualityFrames >= 100 && eyeRate < 0.75 && !this.qualityWarningRaised) {
      this.qualityWarningRaised = true;
      this.addEvent("STUDY_EYE_NOT_DETECTED", now, eyeRate);
      this.addEvent("STUDY_CAMERA_QUALITY_LOW", now, eyeRate);
    }
  }

  private raiseDrowsyLevel(
    level: 1 | 2 | 3,
    now: number,
    reason: StudyPendingAlert["reason"] = "REPEATED_DROWSY",
  ): void {
    if (level <= this.closureWarningLevel && this.snapshot.pendingAlert?.level === level) return;
    this.closureWarningLevel = Math.max(this.closureWarningLevel, level);
    const code = level === 1 ? "STUDY_DROWSY_LEVEL_1" : level === 2 ? "STUDY_DROWSY_LEVEL_2" : "STUDY_DROWSY_LEVEL_3";
    this.snapshot.counts[level === 1 ? "warningLevel1" : level === 2 ? "warningLevel2" : "warningLevel3"] += 1;
    this.addEvent(code, now);
    this.snapshot.pendingAlert = {
      level,
      reason,
      eventAt: now,
      message: level === 1
        ? "잠깐 눈을 쉬고 자세를 바로잡아 주세요."
        : level === 2
          ? "졸음 신호가 반복되고 있습니다. 잠시 몸을 움직여 주세요."
          : "현재 집중력이 많이 떨어졌습니다. 잠깐 쉬었다 다시 시작하세요.",
    };
  }

  private maybeAddTimeline(now: number): void {
    if (now - this.lastTimelineAt < 1_000) return;
    this.lastTimelineAt = now;
    this.addTimeline(now, toTimelineState(this.snapshot.status));
  }

  private setStatus(status: StudyStatus, now: number, detail?: string): void {
    if (this.snapshot.status === status && !detail) return;
    this.snapshot.status = status;
    this.addTimeline(now, toTimelineState(status), detail);
  }

  private addEvent(code: StudyEventCode, at: number, value?: number, detail?: string): void {
    this.snapshot.events.push({ code, at, elapsedMs: Math.max(0, at - this.snapshot.startedAt), value, detail });
    if (this.snapshot.events.length > 2_000) this.snapshot.events.shift();
  }

  private addTimeline(at: number, state: StudyTimelineState, detail?: string): void {
    const last = this.snapshot.timeline.at(-1);
    if (last && last.state === state && !detail && at - last.at < 5_000) return;
    this.snapshot.timeline.push({ at, elapsedMs: Math.max(0, at - this.snapshot.startedAt), state, detail });
    if (this.snapshot.timeline.length > 7_200) this.snapshot.timeline.shift();
  }
}

export function createStudyRecord(
  snapshot: StudyLiveSnapshot,
  settings: StudySettings,
  previousRecords: StudySessionRecord[],
  endedAt = Date.now(),
): StudySessionRecord {
  const actualHours = Math.max(snapshot.actualStudyMs / 3_600_000, 1 / 3_600);
  const focusRate = snapshot.actualStudyMs > 0 ? snapshot.focusMs / snapshot.actualStudyMs : 0;
  const rates: StudyRates = {
    longEyeClosuresPerHour: snapshot.counts.longEyeClosures / actualHours,
    yawnsPerHour: snapshot.counts.yawns / actualHours,
    headDropsPerHour: snapshot.counts.headDrops / actualHours,
    postureWarningsPerHour: snapshot.counts.postureWarnings / actualHours,
  };
  const comparison = compareWithRecent(focusRate, rates, previousRecords.slice(0, 3));
  const record: StudySessionRecord = {
    id: snapshot.id,
    startedAt: snapshot.startedAt,
    endedAt,
    totalSessionMs: Math.max(0, endedAt - snapshot.startedAt),
    actualStudyMs: snapshot.actualStudyMs,
    focusMs: snapshot.focusMs,
    attentionMs: snapshot.attentionMs,
    drowsyMs: snapshot.drowsyMs,
    breakMs: snapshot.breakMs,
    exerciseMs: snapshot.exerciseMs,
    awayMs: snapshot.awayMs,
    pausedMs: snapshot.pausedMs,
    longestContinuousFocusMs: snapshot.longestContinuousFocusMs,
    focusRate,
    counts: { ...snapshot.counts },
    rates,
    maxEyeClosureMs: snapshot.maxEyeClosureMs,
    quality: { ...snapshot.quality },
    settings: normalizeStudySettings(settings),
    events: [...snapshot.events],
    timeline: [...snapshot.timeline],
    comparison,
    insights: [],
  };
  record.insights = buildStudyInsights(record);
  return record;
}

export function compareWithRecent(focusRate: number, rates: StudyRates, records: StudySessionRecord[]): StudyComparison {
  if (records.length === 0) {
    return {
      sampleSize: 0,
      focusRateAverage: null,
      focusRateChangePercent: null,
      longEyeClosuresPerHourAverage: null,
      longEyeClosureRateChangePercent: null,
      label: "NO_DATA",
    };
  }
  const focusAverage = average(records.map((item) => item.focusRate));
  const closureAverage = average(records.map((item) => item.rates.longEyeClosuresPerHour));
  const focusChange = percentChange(focusRate, focusAverage);
  const closureChange = percentChange(rates.longEyeClosuresPerHour, closureAverage);
  return {
    sampleSize: records.length,
    focusRateAverage: focusAverage,
    focusRateChangePercent: focusChange,
    longEyeClosuresPerHourAverage: closureAverage,
    longEyeClosureRateChangePercent: closureChange,
    label: Math.abs(focusChange) < 5 ? "SIMILAR" : focusChange > 0 ? "BETTER" : "LOWER",
  };
}

export function buildStudyInsights(record: StudySessionRecord): string[] {
  const items: string[] = [];
  if (record.comparison.sampleSize > 0 && record.comparison.focusRateChangePercent !== null) {
    const change = record.comparison.focusRateChangePercent;
    if (Math.abs(change) < 5) items.push("이번 집중 유지율은 이전 3회 평균과 비슷합니다.");
    else if (change > 0) items.push(`이번에는 이전 ${record.comparison.sampleSize}회 평균보다 집중 유지율이 ${Math.round(change)}% 좋아졌습니다.`);
    else items.push("이번에는 주의·졸음 구간이 평소보다 길었습니다. 다음에는 조금 이른 휴식을 권합니다.");
  }
  const lateDrowsy = record.events.find((event) => event.code === "LONG_EYE_CLOSURE_DETECTED" && event.elapsedMs >= 30 * 60_000);
  if (lateDrowsy) items.push("공부 시작 30분 이후 졸음 신호가 확인되었습니다. 다음에는 30분 전후에 짧게 움직여보세요.");
  if (record.counts.ttsPlayed >= 7) items.push("이번 세션에서 음성 안내가 자주 재생되었습니다. 다음에는 음성 안내를 최소로 낮춰도 좋습니다.");
  if (record.quality.grade === "REFERENCE") items.push("카메라 인식이 불안정한 구간이 있어 일부 횟수는 참고용으로 확인해 주세요.");
  if (items.length === 0) items.push("이번 기록을 저장했습니다. 다음 열공 기록부터 최근 3회 평균과 함께 비교합니다.");
  return items.slice(0, 3);
}

export function studyStatusLabel(status: StudyStatus): string {
  const labels: Record<StudyStatus, string> = {
    READY: "준비",
    CALIBRATING: "기준 측정 중",
    FOCUS: "집중 중",
    ATTENTION: "주의",
    DROWSY: "졸음 감지",
    BREAK: "휴식 중",
    EXERCISE: "운동 중",
    PAUSED: "일시 정지",
    AWAY: "자리 이탈",
    RETURN_WAITING: "복귀 확인",
    COMPLETED: "완료",
  };
  return labels[status];
}

function mouthOpenRatio(face: Landmark[] | null): number | null {
  if (!face || face.length <= 308) return null;
  const vertical = distance(face[13], face[14]);
  const width = distance(face[78], face[308]);
  return width > 1e-5 ? vertical / width : null;
}

function faceWidth(face: Landmark[] | null): number | null {
  if (!face || face.length <= 454) return null;
  return distance(face[234], face[454]);
}

function distance(a: Landmark, b: Landmark): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function createSessionId(now: number): string {
  return `study-${now.toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

function emptyCounts(): StudyCounts {
  return {
    blinks: 0,
    longEyeClosures: 0,
    yawns: 0,
    headDrops: 0,
    deskSleeps: 0,
    postureWarnings: 0,
    faceTooClose: 0,
    userLeft: 0,
    warningLevel1: 0,
    warningLevel2: 0,
    warningLevel3: 0,
    breaks: 0,
    exercises: 0,
    ttsPlayed: 0,
    soundPlayed: 0,
    videoPlayed: 0,
  };
}

function toTimelineState(status: StudyStatus): StudyTimelineState {
  if (status === "BREAK") return "BREAK";
  if (status === "EXERCISE") return "EXERCISE";
  if (status === "AWAY" || status === "RETURN_WAITING") return "AWAY";
  if (status === "PAUSED" || status === "READY" || status === "CALIBRATING" || status === "COMPLETED") return "PAUSED";
  return status;
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const number = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return Math.min(max, Math.max(min, Math.round(number)));
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function enumValue<T extends string>(value: unknown, values: readonly T[], fallback: T): T {
  return typeof value === "string" && values.includes(value as T) ? value as T : fallback;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1);
}

function percentChange(current: number, baseline: number): number {
  if (Math.abs(baseline) < 1e-9) return current === 0 ? 0 : 100;
  return ((current - baseline) / Math.abs(baseline)) * 100;
}

function isStudyRecord(value: unknown): value is StudySessionRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<StudySessionRecord>;
  return typeof record.id === "string"
    && typeof record.startedAt === "number"
    && typeof record.endedAt === "number"
    && typeof record.actualStudyMs === "number"
    && typeof record.focusRate === "number"
    && !!record.counts
    && !!record.settings
    && Array.isArray(record.events)
    && Array.isArray(record.timeline);
}
