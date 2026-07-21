import { Capacitor } from "@capacitor/core";

export const REMOVE_ADS_PRODUCT_ID = "com.hjsolution.suha.driver.remove_ads";

export type PurchaseResult = {
  success: boolean;
  message: string;
};

export async function purchaseRemoveAds(): Promise<PurchaseResult> {
  if (!Capacitor.isNativePlatform()) {
    return {
      success: false,
      message: "설치형 Android 앱에서만 Google Play 결제를 진행할 수 있습니다.",
    };
  }
  return {
    success: false,
    message: "Google Play 상품과 결제 플러그인을 연결하면 이 버튼에서 결제가 시작됩니다.",
  };
}

export async function restoreRemoveAdsPurchase(): Promise<PurchaseResult> {
  if (!Capacitor.isNativePlatform()) {
    return {
      success: false,
      message: "설치형 Android 앱에서만 구매 복원을 확인할 수 있습니다.",
    };
  }
  return {
    success: false,
    message: "구매 복원은 Google Play Billing 연결 후 활성화됩니다.",
  };
}
