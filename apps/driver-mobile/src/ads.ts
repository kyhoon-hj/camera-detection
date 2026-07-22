import { Capacitor } from "@capacitor/core";
import {
  AdMob,
  type AdOptions,
  BannerAdPosition,
  BannerAdSize,
  type RewardAdOptions,
  type BannerAdOptions,
} from "@capacitor-community/admob";

const TEST_ANDROID_BANNER_ID = "ca-app-pub-3940256099942544/6300978111";
const TEST_ANDROID_INTERSTITIAL_ID = "ca-app-pub-3940256099942544/1033173712";
const TEST_IOS_BANNER_ID = "ca-app-pub-3940256099942544/2934735716";
const TEST_IOS_INTERSTITIAL_ID = "ca-app-pub-3940256099942544/4411468910";
const TEST_ANDROID_REWARDED_ID = "ca-app-pub-3940256099942544/5224354917";
const TEST_IOS_REWARDED_ID = "ca-app-pub-3940256099942544/1712485313";

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
      isTesting: true,
    };
    await AdMob.showBanner(options);
  } catch (cause) {
    console.warn("Failed to show AdMob banner", cause);
  }
}

export async function showMenuInterstitialAd(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    await initializeAdMob();
    const options: AdOptions = {
      adId: getInterstitialAdId(),
      isTesting: true,
    };
    await AdMob.prepareInterstitial(options);
    await AdMob.showInterstitial();
  } catch (cause) {
    console.warn("Failed to show AdMob interstitial", cause);
  }
}

export async function showRewardedDownloadAd(): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return true;
  try {
    await initializeAdMob();
    const options: RewardAdOptions = {
      adId: getRewardedAdId(),
      isTesting: true,
    };
    await AdMob.prepareRewardVideoAd(options);
    await AdMob.showRewardVideoAd();
    return true;
  } catch (cause) {
    console.warn("Failed to show rewarded download ad", cause);
    return false;
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
