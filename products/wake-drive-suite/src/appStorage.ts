import { APP, type AppVariant } from "./appProfile";
type StorageBackend = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export function scopedStorage(variant: AppVariant, backend: () => StorageBackend) {
  const keyFor = (key: string) => `${variant}:${key}`;
  return {
    getItem(key: string): string | null { try { return backend().getItem(keyFor(key)); } catch { return null; } },
    setItem(key: string, value: string): void { backend().setItem(keyFor(key), value); },
    removeItem(key: string): void { backend().removeItem(keyFor(key)); },
  };
}
export const appStorage = scopedStorage(APP.variant, () => window.localStorage);
export const appSessionStorage = scopedStorage(APP.variant, () => window.sessionStorage);
export const cacheName = (name: string) => `${APP.variant}:${name}`;
