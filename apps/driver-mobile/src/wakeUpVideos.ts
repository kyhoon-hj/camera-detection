export const WAKE_UP_VIDEO_PATHS = [
  "/media/drowsy-video-0.mp4",
  "/media/drowsy-video-1.mp4",
  "/media/drowsy-video-2.mp4",
  "/media/drowsy-video-3.mp4",
  "/media/drowsy-video-4.mp4",
  "/media/drowsy-video-5.mp4",
  "/media/drowsy-video-6.mp4",
  "/media/drowsy-video-7.mp4",
  "/media/drowsy-video-8.mp4",
  "/media/drowsy-video-9.mp4",
  "/media/drowsy-video-10.mp4",
] as const;

export type WakeUpVideoId = "video-0" | "video-1" | "video-2" | "video-3" | "video-4" | "video-5" | "video-6" | "video-7" | "video-8" | "video-9" | "video-10";

export interface WakeUpVideoProfile {
  id: WakeUpVideoId;
  name: string;
  path: (typeof WAKE_UP_VIDEO_PATHS)[number];
}

export const WAKE_UP_VIDEO_PROFILES: readonly WakeUpVideoProfile[] = [
  { id: "video-0", name: "일어나요~", path: WAKE_UP_VIDEO_PATHS[0] },
  { id: "video-1", name: "로봇 확성기", path: WAKE_UP_VIDEO_PATHS[1] },
  { id: "video-2", name: "골로~갑니당", path: WAKE_UP_VIDEO_PATHS[2] },
  { id: "video-3", name: "천국과지옥", path: WAKE_UP_VIDEO_PATHS[3] },
  { id: "video-4", name: "저승사자", path: WAKE_UP_VIDEO_PATHS[4] },
  { id: "video-5", name: "너구리 안전요원", path: WAKE_UP_VIDEO_PATHS[5] },
  { id: "video-6", name: "휴게소 안내요정", path: WAKE_UP_VIDEO_PATHS[6] },
  { id: "video-7", name: "졸림공사", path: WAKE_UP_VIDEO_PATHS[7] },
  { id: "video-8", name: "처녀귀신1편", path: WAKE_UP_VIDEO_PATHS[8] },
  { id: "video-9", name: "동무들~", path: WAKE_UP_VIDEO_PATHS[9] },
  { id: "video-10", name: "슈퍼걸", path: WAKE_UP_VIDEO_PATHS[10] },
] as const;

export const WAKE_UP_LIBRARY_STORAGE_KEY = "suha.wake-up-library.v2";
const DEFAULT_WAKE_UP_VIDEO_ID: WakeUpVideoId = "video-0";

export interface WakeUpLibraryState {
  downloadedIds: WakeUpVideoId[];
  appliedId: WakeUpVideoId;
}

export const DEFAULT_WAKE_UP_LIBRARY_STATE: WakeUpLibraryState = {
  downloadedIds: [DEFAULT_WAKE_UP_VIDEO_ID],
  appliedId: DEFAULT_WAKE_UP_VIDEO_ID,
};

export function loadWakeUpLibraryState(storedValue: string | null): WakeUpLibraryState {
  if (!storedValue) return { ...DEFAULT_WAKE_UP_LIBRARY_STATE, downloadedIds: [...DEFAULT_WAKE_UP_LIBRARY_STATE.downloadedIds] };
  try {
    const parsed = JSON.parse(storedValue) as Partial<WakeUpLibraryState>;
    const knownIds = new Set(WAKE_UP_VIDEO_PROFILES.map((profile) => profile.id));
    const downloadedIds = Array.isArray(parsed.downloadedIds)
      ? [...new Set(parsed.downloadedIds.filter((id): id is WakeUpVideoId => typeof id === "string" && knownIds.has(id as WakeUpVideoId)))]
      : [];
    if (!downloadedIds.includes(DEFAULT_WAKE_UP_VIDEO_ID)) downloadedIds.unshift(DEFAULT_WAKE_UP_VIDEO_ID);
    const appliedId = typeof parsed.appliedId === "string"
      && downloadedIds.includes(parsed.appliedId as WakeUpVideoId)
      ? parsed.appliedId as WakeUpVideoId
      : downloadedIds[0];
    return { downloadedIds, appliedId };
  } catch {
    return { ...DEFAULT_WAKE_UP_LIBRARY_STATE, downloadedIds: [...DEFAULT_WAKE_UP_LIBRARY_STATE.downloadedIds] };
  }
}

export function getWakeUpVideoProfile(id: WakeUpVideoId): WakeUpVideoProfile {
  return WAKE_UP_VIDEO_PROFILES.find((profile) => profile.id === id) ?? WAKE_UP_VIDEO_PROFILES[0];
}

export function getAppliedWakeUpVideoPath(state: WakeUpLibraryState): WakeUpVideoProfile["path"] {
  return getWakeUpVideoProfile(state.appliedId).path;
}

export function addDownloadedWakeUpVideo(state: WakeUpLibraryState, id: WakeUpVideoId): WakeUpLibraryState {
  return state.downloadedIds.includes(id)
    ? state
    : { ...state, downloadedIds: [...state.downloadedIds, id] };
}

export function applyDownloadedWakeUpVideo(state: WakeUpLibraryState, id: WakeUpVideoId): WakeUpLibraryState {
  return state.downloadedIds.includes(id) ? { ...state, appliedId: id } : state;
}

export function orderWakeUpVideoProfiles(downloadedIds: readonly WakeUpVideoId[]): WakeUpVideoProfile[] {
  const downloaded = new Set(downloadedIds);
  return [...WAKE_UP_VIDEO_PROFILES].sort((left, right) => Number(downloaded.has(right.id)) - Number(downloaded.has(left.id)));
}

export const WAKE_UP_COUNT_THRESHOLDS = {
  eyeDurationMs: 2_000,
  combinedDurationMs: 1_500,
  headDurationMs: 2_000,
  forceDurationMs: 4_000,
  eventCount: 2,
} as const;

export type WakeUpReason = "EYES" | "HEAD" | "COMBINED";

export interface WakeUpDecisionInput {
  eyeAlertActive: boolean;
  eyeAlertWasActive: boolean;
  headAlertActive: boolean;
  headAlertWasActive: boolean;
  eyeClosureCount: number;
  headDownCount: number;
}

export function getWakeUpCountActivity(input: {
  closedDurationMs: number;
  headDownDurationMs: number;
  combinedDurationMs: number;
}): { eye: boolean; head: boolean } {
  const combinedReady = input.combinedDurationMs >= WAKE_UP_COUNT_THRESHOLDS.combinedDurationMs;
  return {
    eye: combinedReady || input.closedDurationMs >= WAKE_UP_COUNT_THRESHOLDS.eyeDurationMs,
    head: combinedReady || input.headDownDurationMs >= WAKE_UP_COUNT_THRESHOLDS.headDurationMs,
  };
}

export function getForcedWakeUpReason(input: {
  closedDurationMs: number;
  headDownDurationMs: number;
  combinedDurationMs: number;
}): WakeUpReason | null {
  const threshold = WAKE_UP_COUNT_THRESHOLDS.forceDurationMs;
  return input.combinedDurationMs >= threshold
    ? "COMBINED"
    : input.closedDurationMs >= threshold
      ? "EYES"
      : input.headDownDurationMs >= threshold
        ? "HEAD"
        : null;
}

export function getWakeUpDecision(input: WakeUpDecisionInput): {
  eyeClosureCount: number;
  headDownCount: number;
  reason: WakeUpReason | null;
} {
  const newEyeEvent = input.eyeAlertActive && !input.eyeAlertWasActive;
  const newHeadEvent = input.headAlertActive && !input.headAlertWasActive;
  const eyeClosureCount = input.eyeClosureCount + (newEyeEvent ? 1 : 0);
  const headDownCount = input.headDownCount + (newHeadEvent ? 1 : 0);
  const eventThreshold = WAKE_UP_COUNT_THRESHOLDS.eventCount;
  const combinedEvent = newEyeEvent && newHeadEvent;
  return {
    eyeClosureCount,
    headDownCount,
    reason: combinedEvent && (eyeClosureCount >= eventThreshold || headDownCount >= eventThreshold)
      ? "COMBINED"
      : newHeadEvent && headDownCount >= eventThreshold
        ? "HEAD"
        : newEyeEvent && eyeClosureCount >= eventThreshold
          ? "EYES"
          : null,
  };
}
