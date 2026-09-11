import { useSyncExternalStore } from 'react';
import { APP } from './appProfile';
import { appStorage } from './appStorage';
import { english } from './english';

export type AppLanguage = 'ko' | 'en';
export const LANGUAGE_STORAGE_KEY = 'language.v1';
export function resolveLanguage(saved: string | null, deviceLanguage: string): AppLanguage {
  if (saved === 'ko' || saved === 'en') return saved;
  return /^ko(?:[-_]|$)/i.test(deviceLanguage) ? 'ko' : 'en';
}
let language: AppLanguage = APP.variant === 'jolbang'
  ? resolveLanguage(appStorage.getItem(LANGUAGE_STORAGE_KEY), globalThis.navigator?.language ?? 'en') : 'ko';
const listeners = new Set<() => void>();
export const getLanguage = () => language;
export function setLanguage(value: AppLanguage, persist = true): void {
  if (persist) appStorage.setItem(LANGUAGE_STORAGE_KEY, value);
  language = value;
  if (typeof document !== 'undefined') document.documentElement.lang = value;
  listeners.forEach(listener => listener());
}
export function useLanguage(): AppLanguage {
  return useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener); }; }, getLanguage);
}

// Also accepts raw detector/error messages. Detection logic retains its original strings.
const patterns = Object.entries(english).filter(([key]) => /\{\d+\}/.test(key)).map(([key, value]) => ({
  expression: new RegExp('^' + key.split(/\{\d+\}/).map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('(.*?)') + '$'), value,
}));
export function t(key: string, ...values: (string | number)[]): string {
  let template = key;
  let args = values;
  if (language === 'ko' && !/[가-힣]/.test(key)) template = Object.entries(english).find(([, value]) => value === key)?.[0] ?? key;
  if (language === 'en') {
    template = english[key] ?? key;
    if (template === key && !values.length && /[가-힣]/.test(key)) {
      for (const pattern of patterns) {
        const match = pattern.expression.exec(key);
        if (match) { template = pattern.value; args = match.slice(1); break; }
      }
    }
  }
  return template.replace(/\{(\d+)\}/g, (placeholder, index: string) => {
    const value = args[Number(index)];
    return value === undefined ? placeholder : typeof value === 'string' && value !== key ? t(value) : String(value);
  });
}
