import { afterEach, describe, expect, it, vi } from 'vitest';
import { getLanguage, resolveLanguage, setLanguage, t } from '../src/language';
import { english } from '../src/english';
import { chooseDriverWarning, driverVideoProfiles, englishVideoProfiles, koreanDriverLibrary, loadEnglishWarningMode } from '../src/driverWarning';
import { DEFAULT_WAKE_UP_LIBRARY_STATE, WAKE_UP_VIDEO_PROFILES } from '../src/wakeUpVideos';
import { repeatWarningTone } from '../src/DriverWarningPopup';

afterEach(() => { setLanguage('ko', false); vi.unstubAllGlobals(); vi.useRealTimers(); });
describe('Wake Drive language and warning policy', () => {
  it('uses Korean only for a Korean primary device language', () => {
    for (const device of ['ko', 'ko-KR', 'KO_kr']) expect(resolveLanguage(null, device)).toBe('ko');
    for (const device of ['en-US', 'ja-JP', 'zh-CN', 'fr-FR', '', 'kok-IN']) expect(resolveLanguage(null, device)).toBe('en');
  });
  it('keeps the manual choice regardless of the device language', () => {
    expect(resolveLanguage('ko', 'en-US')).toBe('ko');
    expect(resolveLanguage('en', 'ko-KR')).toBe('en');
    expect(resolveLanguage('invalid', 'ja-JP')).toBe('en');
  });
  it('persists the override in Wake Drive storage and does not lose it on a write failure', () => {
    const values = new Map<string,string>();
    vi.stubGlobal('window', {localStorage:{getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>values.set(key,value)}});
    setLanguage('en');
    expect(values.get('jolbang:language.v1')).toBe('en');
    vi.stubGlobal('window', {localStorage:{setItem:()=>{throw new Error('quota');}}});
    expect(()=>setLanguage('ko')).toThrow();
    expect(getLanguage()).toBe('en');
  });
  it('translates dynamic detector messages and preserves interpolation', () => {
    setLanguage('en',false);
    expect(t('고개 숙임이 2초 이상 감지됐습니다.')).toBe('Head lowering detected for over 2 seconds.');
    expect(t('측정 시간 {0}분 {1}초',3,12)).toBe('Session time 3 min 12 sec');
    expect(t('지속 2.5초')).toBe('Duration 2.5s');
    setLanguage('ko',false);
    expect(t('측정 시간 {0}분 {1}초',3,12)).toBe('측정 시간 3분 12초');
  });
  it('has an English translation with the same placeholders for every catalog entry', () => {
    for (const [key,value] of Object.entries(english)) {
      expect(value).not.toMatch(/[가-힣]/);
      expect(value.match(/\{\d+\}/g)?.sort()??[]).toEqual(key.match(/\{\d+\}/g)?.sort()??[]);
    }
  });
  it('defaults to video but respects an explicit popup preference', () => {
    expect(loadEnglishWarningMode(null)).toBe('VIDEO');
    expect(loadEnglishWarningMode('invalid')).toBe('VIDEO');
    expect(loadEnglishWarningMode('POPUP')).toBe('POPUP');
  });
  it('respects explicit popup mode even when all videos are owned', () => {
    const library={appliedId:'video-0' as const,downloadedIds:WAKE_UP_VIDEO_PROFILES.map(v=>v.id)};
    for (const mode of ['APPLIED','RANDOM_OWNED'] as const) expect(chooseDriverWarning('en','POPUP',library,mode)).toBeNull();
  });
  it('selects only the English catalog regardless of Korean applied/random settings', () => {
    expect(englishVideoProfiles().map(video => video.id)).toEqual(['video-6', 'rock-star']);
    const library={appliedId:'video-0' as const,downloadedIds:WAKE_UP_VIDEO_PROFILES.map(v=>v.id)};
    for (const sample of [0,0.5,1,NaN]) {
      const video=chooseDriverWarning('en','VIDEO',library,'RANDOM_OWNED',()=>sample);
      expect(['video-6', 'rock-star']).toContain(video?.id);
    }
    expect(chooseDriverWarning('en','VIDEO',library,'APPLIED')?.id).toBe('video-6');
  });
  it('keeps Rest stop fairy locked until the existing reward flow unlocks it', () => {
    const library=structuredClone(DEFAULT_WAKE_UP_LIBRARY_STATE);
    expect(chooseDriverWarning('en','VIDEO',library,'APPLIED')).toBeNull();
    expect(library).toEqual(DEFAULT_WAKE_UP_LIBRARY_STATE);
    library.downloadedIds.push('video-6');
    expect(chooseDriverWarning('en','VIDEO',library,'APPLIED')?.id).toBe('video-6');
    expect(library.appliedId).toBe('video-0');
  });
  it('keeps the existing Korean video flow and ownership unchanged', () => {
    const library=structuredClone(DEFAULT_WAKE_UP_LIBRARY_STATE);
    expect(chooseDriverWarning('ko','POPUP',library,'APPLIED')?.id).toBe('video-0');
    expect(library).toEqual(DEFAULT_WAKE_UP_LIBRARY_STATE);
  });
  it('excludes the fairy from the Korean catalog and every random slot, keeping it in English', () => {
    const koreanIds = driverVideoProfiles('ko').map(video => video.id);
    expect(koreanIds).toHaveLength(10);
    expect(koreanIds).not.toContain('video-6');
    expect(driverVideoProfiles('en').map(video => video.id)).toEqual(['video-6', 'rock-star']);
    const library = { appliedId: 'video-6' as const, downloadedIds: WAKE_UP_VIDEO_PROFILES.map(video => video.id) };
    for (const sample of [0, .1, .2, .3, .4, .5, .6, .7, .8, .9, 1, NaN]) {
      expect(['video-6', 'rock-star']).not.toContain(chooseDriverWarning('ko', 'VIDEO', library, 'RANDOM_OWNED', () => sample)?.id);
    }
  });
  it('recovers a saved fairy selection in Korean without losing the English unlock', () => {
    const library = { appliedId: 'video-6' as const, downloadedIds: ['video-0', 'video-3', 'video-6'] as const };
    const saved = { ...library, downloadedIds: [...library.downloadedIds] };
    const before = structuredClone(saved);
    expect(koreanDriverLibrary(saved)).toEqual({ appliedId: 'video-0', downloadedIds: ['video-0', 'video-3'] });
    expect(chooseDriverWarning('ko', 'VIDEO', saved, 'APPLIED')?.id).toBe('video-0');
    expect(chooseDriverWarning('en', 'VIDEO', saved, 'APPLIED')?.id).toBe('video-6');
    expect(saved).toEqual(before);
    expect(chooseDriverWarning('ko', 'VIDEO', {appliedId:'video-6',downloadedIds:['video-6']}, 'APPLIED')?.id).toBe('video-0');
    expect(chooseDriverWarning('ko', 'VIDEO', {...saved,appliedId:'video-3'}, 'APPLIED')?.id).toBe('video-3');
  });
  it('repeats warning tones and stops them when dismissed or unmounted', () => {
    vi.useFakeTimers();
    const pulse=vi.fn();
    const stop=repeatWarningTone(pulse);
    expect(pulse).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(5000);
    expect(pulse).toHaveBeenCalledTimes(3);
    stop();
    vi.advanceTimersByTime(10000);
    expect(pulse).toHaveBeenCalledTimes(3);
  });
});
