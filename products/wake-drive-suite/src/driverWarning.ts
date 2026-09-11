import type { AppLanguage } from './language';
import { chooseWakeUpVideo, type WakeUpPlaybackMode } from './wakeUpPlayback';
import { WAKE_UP_VIDEO_PROFILES, type WakeUpLibraryState, type WakeUpVideoId, type WakeUpVideoProfile } from './wakeUpVideos';

export type EnglishWarningMode = 'POPUP' | 'VIDEO';
export const ENGLISH_WARNING_STORAGE_KEY = 'english-warning-mode.v1';
// Owner-designated English clips. Keep them out of Korean catalog and playback.
export const VERIFIED_ENGLISH_VIDEO_IDS: readonly WakeUpVideoId[] = ['video-6', 'rock-star'];
export const loadEnglishWarningMode = (saved: string | null): EnglishWarningMode => saved === 'POPUP' ? 'POPUP' : 'VIDEO';
export const isEnglishVideo = (id: WakeUpVideoId) => VERIFIED_ENGLISH_VIDEO_IDS.includes(id);
export const englishVideoProfiles = () => WAKE_UP_VIDEO_PROFILES.filter(video => isEnglishVideo(video.id));
export const isDriverVideoAllowed = (language: AppLanguage, id: WakeUpVideoId) => language === 'en' ? isEnglishVideo(id) : !isEnglishVideo(id);
export const driverVideoProfiles = (language: AppLanguage) => WAKE_UP_VIDEO_PROFILES.filter(video => isDriverVideoAllowed(language, video.id));

// Filter a view of the library without deleting English unlocks or the saved selection.
export function koreanDriverLibrary(library: WakeUpLibraryState): WakeUpLibraryState {
  const downloadedIds = library.downloadedIds.filter(id => isDriverVideoAllowed('ko', id));
  if (!downloadedIds.length) downloadedIds.push('video-0');
  return { downloadedIds, appliedId: downloadedIds.includes(library.appliedId) ? library.appliedId : downloadedIds[0] };
}
export function chooseDriverWarning(language: AppLanguage, englishMode: EnglishWarningMode, library: WakeUpLibraryState, playbackMode: WakeUpPlaybackMode, random = Math.random): WakeUpVideoProfile | null {
  if (language === 'ko') return chooseWakeUpVideo(koreanDriverLibrary(library), playbackMode, random);
  if (englishMode !== 'VIDEO') return null;
  const eligible = englishVideoProfiles().filter(video => library.downloadedIds.includes(video.id));
  if (!eligible.length) return null;
  if (playbackMode === 'APPLIED') return eligible.find(video => video.id === library.appliedId) ?? eligible[0];
  const sample = random();
  return eligible[Number.isFinite(sample) ? Math.min(eligible.length - 1, Math.max(0, Math.floor(sample * eligible.length))) : 0];
}
