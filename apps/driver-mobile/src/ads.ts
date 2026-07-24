import { Capacitor, type PluginListenerHandle } from "@capacitor/core";
import {
  AdMob,
  type AdOptions,
  BannerAdPosition,
  BannerAdSize,
  InterstitialAdPluginEvents,
  RewardAdPluginEvents,
  type RewardAdOptions,
  type BannerAdOptions,
  type AdMobRewardItem,
} from "@capacitor-community/admob";
import { lockCurrentOrientation, unlockOrientation } from "./displayControl";

const TEST_ANDROID_BANNER_ID = "ca-app-pub-3940256099942544/6300978111";
const TEST_ANDROID_INTERSTITIAL_ID = "ca-app-pub-3940256099942544/1033173712";
const TEST_IOS_BANNER_ID = "ca-app-pub-3940256099942544/2934735716";
const TEST_IOS_INTERSTITIAL_ID = "ca-app-pub-3940256099942544/4411468910";
const TEST_ANDROID_REWARDED_ID = "ca-app-pub-3940256099942544/5224354917";
const TEST_IOS_REWARDED_ID = "ca-app-pub-3940256099942544/1712485313";
const REWARDED_DOWNLOAD_TIMEOUT_MS = 120_000;
const INTERSTITIAL_DISMISS_TIMEOUT_MS = 120_000;
const ORIENTATION_SETTLE_MS = 220;

let initialized = false;

export async function showBottomBannerAd(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    await initializeAdMob();
    const options: BannerAdOptions = {
      adId: getBannerAdId(),
      adSize: BannerAdSize.ADAPTIVE_BANNER,
      position: BannerAdPosition.BOTTOM_CENTER,
      margin: 0,
      isTesting: isAdMobTesting(),
    };
    await AdMob.showBanner(options);
  } catch (cause) {
    console.warn("Failed to show AdMob banner", cause);
  }
}

export async function showMenuInterstitialAd(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  const listeners: PluginListenerHandle[] = [];
  let finishDismissal: (() => void) | null = null;
  let orientationLocked = false;
  try {
    await initializeAdMob();
    const dismissed = new Promise<void>((resolve) => {
      finishDismissal = resolve;
    });
    const finish = () => {
      const resolve = finishDismissal;
      finishDismissal = null;
      resolve?.();
    };
    const [dismissedHandle, failedHandle] = await Promise.all([
      AdMob.addListener(InterstitialAdPluginEvents.Dismissed, finish),
      AdMob.addListener(InterstitialAdPluginEvents.FailedToShow, finish),
    ]);
    listeners.push(dismissedHandle, failedHandle);
    const options: AdOptions = {
      adId: getInterstitialAdId(),
      isTesting: isAdMobTesting(),
      immersiveMode: true,
    };
    await AdMob.prepareInterstitial(options);
    await lockCurrentOrientation();
    orientationLocked = true;
    await delay(ORIENTATION_SETTLE_MS);
    await AdMob.showInterstitial();
    await Promise.race([dismissed, delay(INTERSTITIAL_DISMISS_TIMEOUT_MS)]);
  } catch (cause) {
    console.warn("Failed to show AdMob interstitial", cause);
  } finally {
    finishDismissal = null;
    await Promise.allSettled(listeners.map((listener) => listener.remove()));
    if (orientationLocked) await unlockOrientation().catch(() => undefined);
  }
}

export async function showRewardedDownloadAd(): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return true;

  const listeners: PluginListenerHandle[] = [];
  let rewardEarned = false;
  let finishOutcome: ((value: boolean) => void) | null = null;
  const finish = (value: boolean) => {
    if (!finishOutcome) return;
    const resolve = finishOutcome;
    finishOutcome = null;
    resolve(value);
  };

  try {
    await initializeAdMob();

    const outcome = new Promise<boolean>((resolve) => {
      finishOutcome = resolve;
      window.setTimeout(() => finish(false), REWARDED_DOWNLOAD_TIMEOUT_MS);
    });

    const [rewardedHandle, dismissedHandle, failedHandle] = await Promise.all([
      AdMob.addListener(RewardAdPluginEvents.Rewarded, (reward: AdMobRewardItem) => {
        rewardEarned = hasReward(reward);
        if (rewardEarned) finish(true);
      }),
      AdMob.addListener(RewardAdPluginEvents.Dismissed, () => finish(rewardEarned)),
      AdMob.addListener(RewardAdPluginEvents.FailedToShow, () => finish(false)),
    ]);
    listeners.push(rewardedHandle, dismissedHandle, failedHandle);

    const options: RewardAdOptions = {
      adId: getRewardedAdId(),
      isTesting: isAdMobTesting(),
    };
    await AdMob.prepareRewardVideoAd(options);

    const showResult = AdMob.showRewardVideoAd()
      .then((reward) => {
        rewardEarned = hasReward(reward);
        finish(rewardEarned);
        return rewardEarned;
      })
      .catch(() => {
        finish(false);
        return false;
      });

    return await Promise.race([showResult, outcome]);
  } catch (cause) {
    console.warn("Failed to show rewarded download ad", cause);
    return false;
  } finally {
    finishOutcome = null;
    await Promise.allSettled(listeners.map((listener) => listener.remove()));
  }
}

export async function removeBottomBannerAd(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    await AdMob.removeBanner();
  } catch (cause) {
    console.warn("Failed to remove AdMob banner", cause);
  }
}

async function initializeAdMob(): Promise<void> {
  if (initialized) return;
  await AdMob.initialize();
  initialized = true;
}

function getBannerAdId(): string {
  if (Capacitor.getPlatform() === "ios") {
    return import.meta.env.VITE_ADMOB_IOS_BANNER_ID || TEST_IOS_BANNER_ID;
  }
  return import.meta.env.VITE_ADMOB_ANDROID_BANNER_ID || TEST_ANDROID_BANNER_ID;
}

function getInterstitialAdId(): string {
  if (Capacitor.getPlatform() === "ios") {
    return import.meta.env.VITE_ADMOB_IOS_INTERSTITIAL_ID || TEST_IOS_INTERSTITIAL_ID;
  }
  return import.meta.env.VITE_ADMOB_ANDROID_INTERSTITIAL_ID || TEST_ANDROID_INTERSTITIAL_ID;
}

function getRewardedAdId(): string {
  if (Capacitor.getPlatform() === "ios") {
    return import.meta.env.VITE_ADMOB_IOS_REWARDED_ID || TEST_IOS_REWARDED_ID;
  }
  return import.meta.env.VITE_ADMOB_ANDROID_REWARDED_ID || TEST_ANDROID_REWARDED_ID;
}

function isAdMobTesting(): boolean {
  return import.meta.env.VITE_ADMOB_TESTING !== "false";
}

function hasReward(reward: AdMobRewardItem | null | undefined): boolean {
  return reward !== null && reward !== undefined && Number.isFinite(reward.amount) && reward.amount > 0;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}
