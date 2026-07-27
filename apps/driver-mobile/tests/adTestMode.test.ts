import { describe, expect, it, vi } from "vitest";
import { parseAdsDisabledForTesting } from "../src/adTestMode";

const adMob = vi.hoisted(() => ({
  initialize: vi.fn(),
  showBanner: vi.fn(),
  prepareInterstitial: vi.fn(),
  showInterstitial: vi.fn(),
  prepareRewardVideoAd: vi.fn(),
  showRewardVideoAd: vi.fn(),
  removeBanner: vi.fn(),
  addListener: vi.fn(),
}));

vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => true, getPlatform: () => "android" },
  registerPlugin: () => ({}),
}));

vi.mock("@capacitor-community/admob", () => ({
  AdMob: adMob,
  BannerAdPosition: { BOTTOM_CENTER: "BOTTOM_CENTER" },
  BannerAdSize: { ADAPTIVE_BANNER: "ADAPTIVE_BANNER" },
  InterstitialAdPluginEvents: { Dismissed: "dismissed", FailedToShow: "failed" },
  RewardAdPluginEvents: { Rewarded: "rewarded", Dismissed: "dismissed", FailedToShow: "failed" },
}));

vi.mock("../src/adTestMode", async (importOriginal) => ({
  ...await importOriginal<typeof import("../src/adTestMode")>(),
  loadAdsDisabledForTesting: () => true,
}));

import { showBottomBannerAd, showMenuInterstitialAd, showRewardedDownloadAd } from "../src/ads";

describe("advertising test switch", () => {
  it("enables only for the persisted true value", () => {
    expect(parseAdsDisabledForTesting("true")).toBe(true);
    expect(parseAdsDisabledForTesting("false")).toBe(false);
    expect(parseAdsDisabledForTesting(null)).toBe(false);
  });

  it("blocks banner and interstitial ads and grants rewarded test access", async () => {
    await showBottomBannerAd();
    await showMenuInterstitialAd();
    await expect(showRewardedDownloadAd()).resolves.toBe(true);

    expect(adMob.showBanner).not.toHaveBeenCalled();
    expect(adMob.prepareInterstitial).not.toHaveBeenCalled();
    expect(adMob.showInterstitial).not.toHaveBeenCalled();
    expect(adMob.prepareRewardVideoAd).not.toHaveBeenCalled();
    expect(adMob.showRewardVideoAd).not.toHaveBeenCalled();
    expect(adMob.removeBanner).toHaveBeenCalledOnce();
  });
});
