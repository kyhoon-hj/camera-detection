import type { AnalyticsEvent, AnalyticsParams } from './analyticsCore';
export const PREFERENCE_VALUES = {
  applied_video: Array.from({length:11},(_,i)=>`video-${i}`),
  playback_mode: ['APPLIED','RANDOM_OWNED'],
  sound_mode: ['on','off'],
  pip_mode: ['on','off','unsupported'],
  library_size_band: ['one','two_to_five','six_plus'],
} as const;
export type Preferences = Record<keyof typeof PREFERENCE_VALUES,string>;
export function cleanPreferences(input: Record<string,unknown>): Partial<Preferences> {
  return Object.fromEntries(Object.entries(input).filter(([key,value]) =>
    Object.hasOwn(PREFERENCE_VALUES,key) && typeof value === 'string' &&
    (PREFERENCE_VALUES[key as keyof Preferences] as readonly string[]).includes(value)));
}
/** A current settings snapshot, never an inferred personality or a pre-consent behavior history. */
export class PreferenceMetrics {
  private previous: Partial<Preferences> | null = null;
  constructor(private emit:(name:AnalyticsEvent,params:AnalyticsParams)=>void,private setProperties:(props:Partial<Preferences>)=>void) {}
  update(input:Preferences,enabled:boolean) {
    if (!enabled) { this.previous=null; return; }
    const current=cleanPreferences(input);
    const changes=Object.entries(current).filter(([key,value])=>this.previous?.[key as keyof Preferences]!==value);
    if (!changes.length) return;
    this.setProperties(current);
    if (!this.previous) this.emit('preferences_snapshot',current as AnalyticsParams);
    else for(const [key,value] of changes) this.emit('setting_change',{setting_name:key,setting_value:value});
    this.previous=current;
  }
}
