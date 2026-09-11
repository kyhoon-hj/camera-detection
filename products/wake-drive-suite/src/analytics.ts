// Compatibility boundary for legacy screens. This release never collects or transmits analytics.
import type { AnalyticsEvent, AnalyticsParams } from './analyticsCore';
import type { Preferences } from './preferenceAnalytics';
export interface AnalyticsStatus { configured:boolean; enabled:boolean; decided:boolean; error?:boolean }
const status:AnalyticsStatus=Object.freeze({configured:false,enabled:false,decided:true});
export const getAnalyticsStatus=()=>status;
export const subscribeAnalytics=(_listener:()=>void)=>()=>{};
export const analyticsReady=Promise.resolve();
export async function setAnalyticsEnabled(_enabled:boolean) {}
export function analyticsEvent(_name:AnalyticsEvent,_params:AnalyticsParams={}) {}
export function setAnalyticsPreferences(_properties:Partial<Preferences>) {}
export const driveMetrics={start(_now:number){},sample(_now:number){},stop(){},discard(){}};
