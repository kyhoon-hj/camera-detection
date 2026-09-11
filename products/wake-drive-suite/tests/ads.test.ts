import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const sdk = vi.hoisted(() => ({
  initialize: vi.fn(), requestConsentInfo: vi.fn(), showConsentForm: vi.fn(),
  showBanner: vi.fn(), removeBanner: vi.fn(), addListener: vi.fn(),
  prepareRewardVideoAd: vi.fn(), showRewardVideoAd: vi.fn(),
  prepareInterstitial: vi.fn(), showInterstitial: vi.fn(),
}));
const platform = vi.hoisted(() => ({ native: true }));
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => platform.native, getPlatform: () => 'android' } }));
vi.mock('@capacitor-community/admob', () => ({
  AdMob: sdk, AdmobConsentStatus: { REQUIRED: 'REQUIRED' },
  BannerAdPosition: { BOTTOM_CENTER: 'BOTTOM_CENTER' }, BannerAdSize: { ADAPTIVE_BANNER: 'ADAPTIVE_BANNER' },
  BannerAdPluginEvents: { SizeChanged: 'SizeChanged' }, InterstitialAdPluginEvents: { Dismissed: 'Dismissed', FailedToShow: 'FailedToShow' },
}));

beforeEach(() => {
  vi.resetModules(); vi.resetAllMocks(); platform.native = true;
  vi.stubEnv('VITE_ADMOB_ANDROID_BANNER_ID', 'configured-banner');
  vi.stubEnv('VITE_ADMOB_ANDROID_REWARDED_ID', 'configured-reward');
  vi.stubEnv('VITE_ADMOB_ANDROID_INTERSTITIAL_ID', 'configured-interstitial');
  vi.stubEnv('VITE_ADMOB_SKIP_CONSENT_FOR_TESTING', 'false');
  vi.stubGlobal('document', { documentElement: { style: { setProperty: vi.fn() } } });
  sdk.requestConsentInfo.mockResolvedValue({ canRequestAds: true });
  sdk.prepareInterstitial.mockResolvedValue(undefined);
  sdk.addListener.mockResolvedValue({ remove: vi.fn() });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('AdMob integration', () => {
  it('waits for dismissal before navigation and limits repeated interstitials', async () => {
    const remove = vi.fn();
    const events: Record<string, () => void> = {};
    sdk.addListener.mockImplementation(async (event, listener) => { events[event] = listener; return { remove }; });
    let shown!: () => void;
    const displayed = new Promise<void>(resolve => { shown = resolve; });
    sdk.showInterstitial.mockImplementation(async () => { shown(); });
    const ads = await import('../src/ads');
    let finished = false;
    const pending = ads.showMenuInterstitialAd().then(() => { finished = true; });
    await displayed;
    expect(finished).toBe(false);
    events.Dismissed(); await pending;
    expect(remove).toHaveBeenCalledTimes(2);
    await ads.showMenuInterstitialAd();
    expect(sdk.showInterstitial).toHaveBeenCalledOnce();
  });
  it('continues after a slow interstitial load without showing a late ad', async () => {
    vi.useFakeTimers();
    let finish!: () => void;
    sdk.prepareInterstitial.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
    const ads = await import('../src/ads');
    const pending = ads.showMenuInterstitialAd();
    await vi.advanceTimersByTimeAsync(5001);
    await pending;
    finish(); await Promise.resolve();
    expect(sdk.showInterstitial).not.toHaveBeenCalled();
  });
  it('does not request ads without consent eligibility', async () => {
    sdk.requestConsentInfo.mockResolvedValue({ canRequestAds: false });
    const ads = await import('../src/ads');
    await ads.showBottomBannerAd();
    expect(sdk.showBanner).not.toHaveBeenCalled();
  });
  it('can explicitly bypass consent only for a test-ad build', async () => {
    vi.stubEnv('VITE_ADMOB_SKIP_CONSENT_FOR_TESTING', 'true');
    const ads = await import('../src/ads');
    await ads.showBottomBannerAd();
    expect(sdk.requestConsentInfo).not.toHaveBeenCalled();
    expect(sdk.showBanner).toHaveBeenCalledWith(expect.objectContaining({ adId: 'configured-banner', isTesting: true }));
  });
  it('waits for required consent and uses the configured unit', async () => {
    sdk.requestConsentInfo.mockResolvedValue({ status: 'REQUIRED', isConsentFormAvailable: true, canRequestAds: false });
    sdk.showConsentForm.mockResolvedValue({ canRequestAds: true });
    await (await import('../src/ads')).showBottomBannerAd();
    expect(sdk.showConsentForm).toHaveBeenCalledOnce();
    expect(sdk.showBanner).toHaveBeenCalledWith(expect.objectContaining({ adId: 'configured-banner', isTesting: true }));
  });
  it('cancels a pending banner when leaving home during initialization', async () => {
    let finish!: () => void;
    sdk.initialize.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
    const ads = await import('../src/ads');
    const showing = ads.showBottomBannerAd();
    await ads.removeBottomBannerAd();
    finish(); await showing;
    expect(sdk.showBanner).not.toHaveBeenCalled();
  });
  it('fails closed when the consent service is unavailable', async () => {
    sdk.requestConsentInfo.mockRejectedValue(new Error('offline'));
    await (await import('../src/ads')).showBottomBannerAd();
    expect(sdk.showBanner).not.toHaveBeenCalled();
  });
  it('does not fabricate rewards on web or on SDK failure', async () => {
    const ads = await import('../src/ads');
    platform.native = false;
    expect(await ads.showRewardedDownloadAd()).toBe(false);
    expect(sdk.initialize).not.toHaveBeenCalled();
    platform.native = true;
    sdk.showRewardVideoAd.mockRejectedValue(new Error('dismissed'));
    expect(await ads.showRewardedDownloadAd()).toBe(false);
  });
  it('accepts only a positive reward reported by the SDK', async () => {
    const ads = await import('../src/ads');
    sdk.showRewardVideoAd.mockResolvedValueOnce({ amount: 0 }).mockResolvedValueOnce({ amount: 1 });
    expect(await ads.showRewardedDownloadAd()).toBe(false);
    expect(await ads.showRewardedDownloadAd()).toBe(true);
  });
});
