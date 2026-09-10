import { getWakeUpVideoProfile, WAKE_UP_VIDEO_PROFILES, type WakeUpLibraryState, type WakeUpVideoProfile } from "./wakeUpVideos";

export type WakeUpPlaybackMode = "APPLIED" | "RANDOM_OWNED";
export const WAKE_UP_PLAYBACK_STORAGE_KEY = "wake-up-playback-mode.v1";

export function loadWakeUpPlaybackMode(value: string | null): WakeUpPlaybackMode {
  return value === "RANDOM_OWNED" ? value : "APPLIED";
}

// 경고가 시작될 때 한 번만 선택한다. 재생 재시도에서는 다시 뽑지 않는다.
export function chooseWakeUpVideo(library: WakeUpLibraryState, mode: WakeUpPlaybackMode, random = Math.random): WakeUpVideoProfile {
  const owned = WAKE_UP_VIDEO_PROFILES.filter(profile => library.downloadedIds.includes(profile.id));
  const applied = owned.find(profile => profile.id === library.appliedId) ?? owned[0] ?? getWakeUpVideoProfile("video-0");
  if (mode === "APPLIED" || owned.length < 2) return applied;
  const sample = random();
  const index = Number.isFinite(sample) ? Math.min(owned.length - 1, Math.max(0, Math.floor(sample * owned.length))) : 0;
  return owned[index];
}
