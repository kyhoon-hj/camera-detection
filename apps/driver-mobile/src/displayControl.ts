import { Capacitor, registerPlugin } from "@capacitor/core";

interface DisplayControlPlugin {
  getSafeAreaInsets(): Promise<{ left: number; top: number; right: number; bottom: number }>;
  lockCurrentOrientation(): Promise<void>;
  unlockOrientation(): Promise<void>;
}

const DisplayControl = registerPlugin<DisplayControlPlugin>("DisplayControl");

export async function applyNativeSafeAreaInsets(): Promise<void> {
  if (Capacitor.getPlatform() !== "android") return;
  const insets = await DisplayControl.getSafeAreaInsets();
  const root = document.documentElement;
  root.style.setProperty("--native-safe-left", `${Math.max(0, insets.left)}px`);
  root.style.setProperty("--native-safe-top", `${Math.max(0, insets.top)}px`);
  root.style.setProperty("--native-safe-right", `${Math.max(0, insets.right)}px`);
  root.style.setProperty("--native-safe-bottom", `${Math.max(0, insets.bottom)}px`);
}

export async function lockCurrentOrientation(): Promise<void> {
  if (Capacitor.getPlatform() !== "android") return;
  await DisplayControl.lockCurrentOrientation();
}

export async function unlockOrientation(): Promise<void> {
  if (Capacitor.getPlatform() !== "android") return;
  await DisplayControl.unlockOrientation();
}
