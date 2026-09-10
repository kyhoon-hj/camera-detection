import { Capacitor, registerPlugin } from '@capacitor/core';
import { APP } from './appProfile';
import { cleanParams, DriveMetrics, type AnalyticsEvent, type AnalyticsParams } from './analyticsCore';
import { cleanPreferences, type Preferences } from './preferenceAnalytics';
export interface AnalyticsStatus { configured: boolean; enabled: boolean; decided: boolean; error?: boolean }
const native = APP.variant === 'jolbang' && Capacitor.getPlatform() === 'android';
const plugin = registerPlugin<{
  getStatus(): Promise<AnalyticsStatus>;
  setEnabled(options: {enabled: boolean}): Promise<AnalyticsStatus>;
  logEvent(options: {name: string; params: AnalyticsParams}): Promise<void>;
  setPreferences(options: {properties: Partial<Preferences>}): Promise<void>;
}>('DriverAnalytics');
let status: AnalyticsStatus = {configured:false,enabled:false,decided:false};
const listeners = new Set<() => void>();
let queue = Promise.resolve();
let appOpened = false;
let consentEpoch = 0;
function publish(next: AnalyticsStatus) {
  if(status.enabled !== next.enabled) consentEpoch++;
  status = next; listeners.forEach(listener => listener());
  if (status.enabled && !appOpened) { appOpened = true; analyticsEvent('app_open'); }
}
export const getAnalyticsStatus = () => status;
export const subscribeAnalytics = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const analyticsReady = native ? plugin.getStatus().then(publish).catch(() => publish({...status,error:true})) : Promise.resolve();
export async function setAnalyticsEnabled(enabled: boolean) {
  await analyticsReady;
  if (!native || !status.configured) return;
  // Gate immediately; queued events also recheck consent. Never replay pre-consent activity.
  if (!enabled) { publish({...status,enabled:false}); driveMetrics.discard(); }
  const result = queue.then(() => plugin.setEnabled({enabled}));
  queue = result.then(publish).catch(() => publish({...status,enabled:false,error:true}));
  await queue;
}
export function analyticsEvent(name: AnalyticsEvent, params: AnalyticsParams = {}) {
  if (!native || !status.configured || !status.enabled) return;
  const sanitized = cleanParams(params);
  const epoch=consentEpoch;
  queue = queue.then(async () => {
    if (status.enabled && epoch===consentEpoch) await plugin.logEvent({name,params:sanitized});
  }).catch(() => { /* Analytics must never interrupt camera, playback or reward processing. */ });
}
export function setAnalyticsPreferences(properties:Partial<Preferences>) {
  if(!native || !status.configured || !status.enabled) return;
  const sanitized=cleanPreferences(properties);const epoch=consentEpoch;
  queue=queue.then(async()=>{if(status.enabled && epoch===consentEpoch) await plugin.setPreferences({properties:sanitized});}).catch(()=>{});
}
export const driveMetrics = new DriveMetrics(analyticsEvent);
