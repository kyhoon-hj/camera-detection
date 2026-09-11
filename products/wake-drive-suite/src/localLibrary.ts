import { loadWakeUpLibraryState, WAKE_UP_VIDEO_PROFILES, type WakeUpLibraryState } from './wakeUpVideos';
/** Bundled videos are all available; retain the user's previous applied selection. */
export function loadLocalLibrary(stored:string|null):WakeUpLibraryState {
  return {...loadWakeUpLibraryState(stored),downloadedIds:WAKE_UP_VIDEO_PROFILES.map(v=>v.id)};
}
