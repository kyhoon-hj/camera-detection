// Offline release: no advertising SDK, requests, or fabricated rewards.
export async function showBottomBannerAd(): Promise<void> {}
export async function removeBottomBannerAd(): Promise<void> {}
export async function showMenuInterstitialAd(): Promise<void> {}
export async function showRewardedDownloadAd(_id?: string): Promise<boolean> { return false; }
