import { describe, expect, it } from 'vitest';
import { chooseDriverWarning, driverVideoProfiles, koreanDriverLibrary } from '../src/driverWarning';
import { addDownloadedWakeUpVideo, applyDownloadedWakeUpVideo, loadWakeUpLibraryState } from '../src/wakeUpVideos';

describe('Rock Star on the latest language implementation', () => {
  it('keeps the existing Korean ten clips and adds Rock Star alongside the English fairy', () => {
    expect(driverVideoProfiles('ko')).toHaveLength(10);
    expect(driverVideoProfiles('ko').some(video => video.id === 'rock-star')).toBe(false);
    expect(driverVideoProfiles('en').map(video => video.id)).toEqual(['video-6', 'rock-star']);
  });
  it('requires unlock, then restores and plays the explicitly applied Rock Star video', () => {
    const initial = loadWakeUpLibraryState(null);
    expect(chooseDriverWarning('en', 'VIDEO', initial, 'APPLIED')).toBeNull();
    const owned = addDownloadedWakeUpVideo(addDownloadedWakeUpVideo(initial, 'video-6'), 'rock-star');
    const applied = applyDownloadedWakeUpVideo(owned, 'rock-star');
    const restored = loadWakeUpLibraryState(JSON.stringify(applied));
    expect(chooseDriverWarning('en', 'VIDEO', restored, 'APPLIED')?.path).toBe('/media/rock-star.mp4');
    expect(chooseDriverWarning('en', 'VIDEO', restored, 'RANDOM_OWNED', () => 0)?.id).toBe('video-6');
    expect(chooseDriverWarning('en', 'VIDEO', restored, 'RANDOM_OWNED', () => .99)?.id).toBe('rock-star');
    expect(chooseDriverWarning('en', 'POPUP', restored, 'APPLIED')).toBeNull();
  });
  it('does not erase English unlocks when switching back to Korean, and never plays them there', () => {
    const stored = { appliedId: 'rock-star' as const, downloadedIds: ['video-0', 'video-6', 'rock-star'] as ('video-0' | 'video-6' | 'rock-star')[] };
    const before = structuredClone(stored);
    expect(koreanDriverLibrary(stored)).toEqual({appliedId:'video-0',downloadedIds:['video-0']});
    for(const sample of [0,.2,.5,.9,1]) expect(chooseDriverWarning('ko','VIDEO',stored,'RANDOM_OWNED',()=>sample)?.id).toBe('video-0');
    expect(stored).toEqual(before);
    expect(chooseDriverWarning('en','VIDEO',stored,'APPLIED')?.id).toBe('rock-star');
  });
});
