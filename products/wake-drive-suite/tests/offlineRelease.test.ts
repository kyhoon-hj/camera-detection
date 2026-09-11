import { describe, expect, it, vi } from 'vitest';
import { loadLocalLibrary } from '../src/localLibrary';
import { chooseDriverWarning, driverVideoProfiles } from '../src/driverWarning';
import { applyDownloadedWakeUpVideo, WAKE_UP_VIDEO_PROFILES } from '../src/wakeUpVideos';
import * as analytics from '../src/analytics';

describe('offline release behavior',()=>{
  it('migrates a previously locked library without changing the applied video',()=>{
    const library=loadLocalLibrary(JSON.stringify({downloadedIds:['video-0','video-3'],appliedId:'video-3'}));
    expect(library.appliedId).toBe('video-3');
    expect(library.downloadedIds).toEqual(WAKE_UP_VIDEO_PROFILES.map(v=>v.id));
    const rock=applyDownloadedWakeUpVideo(library,'rock-star');
    expect(chooseDriverWarning('en','VIDEO',rock,'APPLIED')?.id).toBe('rock-star');
    expect(driverVideoProfiles('ko')).toHaveLength(10);
    expect(driverVideoProfiles('en')).toHaveLength(2);
    expect(chooseDriverWarning('ko','VIDEO',rock,'APPLIED')?.id).not.toBe('rock-star');
  });
  it('makes all bundled videos available even with missing or corrupt old preferences',()=>{
    for(const stored of [null,'{broken']) expect(loadLocalLibrary(stored).downloadedIds).toHaveLength(12);
  });
  it('cannot re-enable analytics or make network requests through old consent controls',async()=>{
    const fetchSpy=vi.spyOn(globalThis,'fetch').mockRejectedValue(new Error('Network forbidden'));
    try {
      await analytics.setAnalyticsEnabled(true);
      analytics.analyticsEvent('app_open');
      analytics.setAnalyticsPreferences({sound_mode:'on'});
      expect(analytics.getAnalyticsStatus()).toEqual({configured:false,enabled:false,decided:true});
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {fetchSpy.mockRestore();}
  });
});
