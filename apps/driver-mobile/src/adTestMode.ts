export const ADS_DISABLED_FOR_TESTING_STORAGE_KEY = "suha.ads-disabled-for-testing.v1";

export function parseAdsDisabledForTesting(value: string | null): boolean {
  return value === "true";
}

export function loadAdsDisabledForTesting(): boolean {
  try {
    if (typeof window === "undefined") return false;
    return parseAdsDisabledForTesting(window.localStorage.getItem(ADS_DISABLED_FOR_TESTING_STORAGE_KEY));
  } catch {
    return false;
  }
}

export function saveAdsDisabledForTesting(disabled: boolean): void {
  try {
    if (typeof window === "undefined") return;
    if (disabled) window.localStorage.setItem(ADS_DISABLED_FOR_TESTING_STORAGE_KEY, "true");
    else window.localStorage.removeItem(ADS_DISABLED_FOR_TESTING_STORAGE_KEY);
  } catch {
    // Storage can be unavailable in restricted embedded browsers. Keep the in-memory setting active.
  }
}
