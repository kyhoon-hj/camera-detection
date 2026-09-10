import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { EVENT_NAMES, PARAM_NAMES } from '../src/analyticsCore';
const mocks = vi.hoisted(() => ({ log:vi.fn(), handlers:new Map<string, (...args:any[])=>void>(), native:true }));
vi.mock('../src/analytics', () => ({ analyticsEvent:mocks.log }));
vi.mock('../src/displayControl', () => ({ lockCurrentOrientation:vi.fn(async()=>{}), unlockOrientation:vi.fn(async()=>{}) }));
vi.mock('@capacitor/core', () => ({ Capacitor:{ isNativePlatform:()=>mocks.native, getPlatform:()=>mocks.native?'android':'web' } }));
vi.mock('@capacitor-community/admob', async importOriginal => {
  const original = await importOriginal<typeof import('@capacitor-community/admob')>();
  return { ...original, AdMob:{
    initialize:vi.fn(async()=>{}),
    addListener:vi.fn(async(name:string, handler:(...args:any[])=>void)=>{
      mocks.handlers.set(name, handler);
      return { remove:vi.fn(async()=>{ if(mocks.handlers.get(name)===handler) mocks.handlers.delete(name); }) };
    }),
    showBanner:vi.fn(async()=>{}), removeBanner:vi.fn(async()=>{}),
    prepareRewardVideoAd:vi.fn(async()=>{}), showRewardVideoAd:vi.fn(),
    prepareInterstitial:vi.fn(async()=>{}), showInterstitial:vi.fn(),
  }};
});
import { AdMob, BannerAdPluginEvents, RewardAdPluginEvents, InterstitialAdPluginEvents } from '@capacitor-community/admob';
beforeEach(()=>{ vi.resetModules(); vi.clearAllMocks(); mocks.handlers.clear(); mocks.native=true; vi.stubGlobal('window',globalThis); });
afterEach(()=>{ vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const events = (name:string) => mocks.log.mock.calls.filter(([event])=>event===name);

describe('AdMob 실제 콜백과 분석 카운트',()=>{
  it('배너 로드/표시 요청은 노출로 세지 않고 SDK 노출과 갱신만 각각 센다',async()=>{
    const ads = await import('../src/ads');
    await ads.showBottomBannerAd(); await ads.showBottomBannerAd();
    expect(events('ad_shown')).toHaveLength(0);
    expect(vi.mocked(AdMob.addListener).mock.calls.filter(([name])=>String(name)===BannerAdPluginEvents.AdImpression)).toHaveLength(1);
    mocks.handlers.get(BannerAdPluginEvents.AdImpression)?.();
    mocks.handlers.get(BannerAdPluginEvents.AdImpression)?.();
    expect(events('ad_shown')).toHaveLength(2);
    expect(events('ad_shown')[0][1]).toMatchObject({ad_format:'banner',ad_test:'test'});
  });
  it('보상 이벤트와 Promise가 모두 도착해도 표시/보상은 1회이고 영상 ID를 보존한다',async()=>{
    vi.mocked(AdMob.showRewardVideoAd).mockImplementationOnce(async()=>{
      mocks.handlers.get(RewardAdPluginEvents.Showed)?.();
      mocks.handlers.get(RewardAdPluginEvents.Showed)?.();
      mocks.handlers.get(RewardAdPluginEvents.Rewarded)?.({amount:1,type:'coin'});
      return {amount:1,type:'coin'};
    });
    const ads = await import('../src/ads');
    expect(await ads.showRewardedDownloadAd('video-4')).toBe(true);
    expect(events('ad_shown')).toHaveLength(1);
    expect(events('ad_reward_earned')).toHaveLength(1);
    expect(events('ad_reward_earned')[0][1]).toMatchObject({video_id:'video-4',ad_format:'rewarded'});
    expect(mocks.handlers.size).toBe(0);
  });
  it('광고를 보고 보상 없이 닫으면 표시만 집계하고 보상은 주지 않는다',async()=>{
    vi.mocked(AdMob.showRewardVideoAd).mockImplementationOnce(()=>{
      mocks.handlers.get(RewardAdPluginEvents.Showed)?.();
      mocks.handlers.get(RewardAdPluginEvents.Dismissed)?.();
      return new Promise(()=>{});
    });
    const ads = await import('../src/ads');
    expect(await ads.showRewardedDownloadAd('video-2')).toBe(false);
    expect(events('ad_shown')).toHaveLength(1);
    expect(events('ad_reward_earned')).toHaveLength(0);
    expect(events('ad_failed')).toHaveLength(0);
  });
  it('표시 실패 콜백과 거부 Promise를 중복 오류/노출로 세지 않는다',async()=>{
    vi.mocked(AdMob.showRewardVideoAd).mockImplementationOnce(async()=>{
      mocks.handlers.get(RewardAdPluginEvents.FailedToShow)?.();
      throw new Error('test failure');
    });
    const ads = await import('../src/ads');
    expect(await ads.showRewardedDownloadAd('video-2')).toBe(false);
    expect(events('ad_failed')).toHaveLength(1);
    expect(events('ad_shown')).toHaveLength(0);
    expect(events('ad_reward_earned')).toHaveLength(0);
  });
  it('전면 광고도 Showed에서만 표시를 기록한다',async()=>{
    vi.useFakeTimers();
    vi.mocked(AdMob.showInterstitial).mockImplementationOnce(async()=>{
      mocks.handlers.get(InterstitialAdPluginEvents.Showed)?.();
      mocks.handlers.get(InterstitialAdPluginEvents.Dismissed)?.();
    });
    const ads = await import('../src/ads');
    const pending=ads.showMenuInterstitialAd();
    await vi.runAllTimersAsync(); await pending;
    expect(events('ad_request')).toHaveLength(1);
    expect(events('ad_shown')).toHaveLength(1);
    expect(events('ad_shown')[0][1]).toMatchObject({ad_format:'interstitial'});
  });
  it('웹 미리보기 보상 처리는 광고 시청 데이터로 전송하지 않는다',async()=>{
    mocks.native=false;
    const ads=await import('../src/ads');
    await ads.showBottomBannerAd();await ads.showMenuInterstitialAd();
    expect(await ads.showRewardedDownloadAd('video-1')).toBe(true);
    expect(mocks.log).not.toHaveBeenCalled();
  });
  it('샘플 광고 ID는 운영 플래그여도 test이고 임의 영상 ID는 제외한다',async()=>{
    const {adReportingParams}=await import('../src/adAnalytics');
    expect(adReportingParams('rewarded',false,'ca-app-pub-3940256099942544/5224354917','private-text')).toEqual({ad_format:'rewarded',ad_placement:'video_unlock',ad_test:'test'});
    expect(adReportingParams('banner',false,'production-unit').ad_test).toBe('live');
  });
  it('광고 이벤트가 TS/Java 허용 목록에서 누락되지 않는다',()=>{
    const native=readFileSync('native/jolbang/android/app/src/main/java/com/hjsolution/suha/driver/DriverAnalyticsPlugin.java','utf8');
    for(const name of EVENT_NAMES) expect(native).toContain('"'+name+'"');
    for(const name of PARAM_NAMES) expect(native).toContain('"'+name+'"');
  });
});
