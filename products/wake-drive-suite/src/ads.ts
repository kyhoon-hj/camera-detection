import { Capacitor, type PluginListenerHandle } from '@capacitor/core';
import { AdMob, AdmobConsentStatus, BannerAdPosition, BannerAdSize, BannerAdPluginEvents, InterstitialAdPluginEvents } from '@capacitor-community/admob';

const native = () => Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
const testing = () => import.meta.env.DEV || import.meta.env.VITE_ADMOB_TESTING !== 'false';
const skipConsentForTesting = () => testing() && import.meta.env.VITE_ADMOB_SKIP_CONSENT_FOR_TESTING === 'true';
const ids = {
  banner: import.meta.env.VITE_ADMOB_ANDROID_BANNER_ID,
  interstitial: import.meta.env.VITE_ADMOB_ANDROID_INTERSTITIAL_ID,
  rewarded: import.meta.env.VITE_ADMOB_ANDROID_REWARDED_ID,
};
let initialization: Promise<boolean> | undefined;
let bannerRevision = 0;
let bannerWanted = false;
let bannerQueue = Promise.resolve();
let fullscreenBusy = false;
let lastInterstitial = 0;

async function initialize(): Promise<boolean> {
  if (!native()) return false;
  initialization ??= (async () => {
    await AdMob.initialize();
    if (skipConsentForTesting()) return true;
    let consent = await AdMob.requestConsentInfo();
    if (consent.isConsentFormAvailable && consent.status === AdmobConsentStatus.REQUIRED) consent = await AdMob.showConsentForm();
    return consent.canRequestAds;
  })();
  try {
    const allowed = await initialization;
    if (!allowed) initialization = undefined;
    return allowed;
  } catch {
    initialization = undefined;
    return false;
  }
}

export async function showAdPrivacyOptions(): Promise<void> {
  if (!native()) return;
  const restoreBanner = bannerWanted;
  await removeBottomBannerAd();
  const revision = bannerRevision;
  try { await AdMob.showPrivacyOptionsForm(); }
  catch { /* The SDK may not require a privacy form in this region. */ }
  initialization = undefined;
  if (restoreBanner && revision === bannerRevision) await showBottomBannerAd();
}

let bannerSizeListener: Promise<PluginListenerHandle> | undefined;
export async function showBottomBannerAd(): Promise<void> {
  if (!native() || !ids.banner) return;
  bannerWanted = true;
  const revision = ++bannerRevision;
  if (!await initialize() || revision !== bannerRevision) return;
  bannerQueue = bannerQueue.then(async () => {
    if (revision !== bannerRevision) return;
    bannerSizeListener ??= AdMob.addListener(BannerAdPluginEvents.SizeChanged, size => {
      document.documentElement.style.setProperty('--admob-banner-height', bannerWanted ? `${size.height}px` : '0px');
    });
    await bannerSizeListener;
    await AdMob.showBanner({ adId: ids.banner, isTesting: testing(), adSize: BannerAdSize.ADAPTIVE_BANNER, position: BannerAdPosition.BOTTOM_CENTER });
  }).catch(() => { document.documentElement.style.setProperty('--admob-banner-height', '0px'); });
  await bannerQueue;
}

export async function removeBottomBannerAd(): Promise<void> {
  bannerWanted = false;
  ++bannerRevision;
  if (!native()) return;
  bannerQueue = bannerQueue.then(async () => {
    await AdMob.removeBanner();
  }).catch(() => undefined).finally(() => document.documentElement.style.setProperty('--admob-banner-height', '0px'));
  await bannerQueue;
}

export async function showMenuInterstitialAd(): Promise<void> {
  if (!native() || !ids.interstitial || fullscreenBusy || Date.now() - lastInterstitial < 180_000) return;
  fullscreenBusy = true;
  const listeners: PluginListenerHandle[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    if (!await initialize()) return;
    await removeBottomBannerAd();
    // A failed or slow load must not prevent starting detection.
    const loaded = await Promise.race([
      AdMob.prepareInterstitial({ adId: ids.interstitial, isTesting: testing() }).then(() => true),
      new Promise<false>(resolve => { timer = setTimeout(() => resolve(false), 5000); }),
    ]);
    if (!loaded) return;
    let finish!: () => void;
    const dismissed = new Promise<void>(resolve => { finish = resolve; });
    listeners.push(await AdMob.addListener(InterstitialAdPluginEvents.Dismissed, finish));
    listeners.push(await AdMob.addListener(InterstitialAdPluginEvents.FailedToShow, finish));
    await AdMob.showInterstitial();
    lastInterstitial = Date.now();
    await dismissed;
  } catch { /* Ad failures never block app navigation. */ }
  finally {
    if (timer) clearTimeout(timer);
    await Promise.allSettled(listeners.map(listener => listener.remove()));
    fullscreenBusy = false;
  }
}

export async function showRewardedDownloadAd(_id?: string): Promise<boolean> {
  if (!native() || !ids.rewarded || fullscreenBusy) return false;
  fullscreenBusy = true;
  try {
    if (!await initialize()) return false;
    await AdMob.prepareRewardVideoAd({ adId: ids.rewarded, isTesting: testing() });
    const reward = await AdMob.showRewardVideoAd();
    return Number.isFinite(reward?.amount) && reward.amount > 0;
  } catch { return false; }
  finally { fullscreenBusy = false; }
}
