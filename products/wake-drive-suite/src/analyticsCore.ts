export type AnalyticsParams = Record<string, string | number>;
export const EVENT_NAMES = ['app_open','screen_view','ui_click','video_select','video_apply','reward_unlock_start','reward_ad_result','video_unlocked','video_unlock_error','video_play_start','video_play_complete','video_play_error','drive_start','drive_progress','drive_end','drive_warning','preferences_snapshot','setting_change','video_impression','library_filter','video_play_exit','video_watch_progress','detection_start_result','ad_request','ad_shown','ad_failed','ad_reward_earned'] as const;
export type AnalyticsEvent = typeof EVENT_NAMES[number];
export const PARAM_NAMES = ['screen_name','screen_class','action','video_id','context','reason','outcome','playback_seconds','measured_seconds','speed_valid_seconds','speed_sum','max_kmh','speed_0_10_seconds','speed_10_40_seconds','speed_40_80_seconds','speed_80_plus_seconds','applied_video','playback_mode','sound_mode','pip_mode','library_size_band','setting_name','setting_value','filter','ownership','watched_seconds','watch_percent','milestone','startup_seconds','failure_stage','ad_format','ad_placement','ad_test'] as const;
export function cleanParams(params: AnalyticsParams): AnalyticsParams {
  return Object.fromEntries(Object.entries(params).filter(([key,value]) =>
    (PARAM_NAMES as readonly string[]).includes(key) &&
    (typeof value === 'number' ? Number.isFinite(value) && value >= 0 : /^[A-Za-z0-9_-]{1,80}$/.test(value))));
}
type Emit = (event: AnalyticsEvent, params: AnalyticsParams) => void;
/** Only sampled monitoring time counts. Suspension gaps are excluded, never assumed to be driving. */
export class DriveMetrics {
  private last: number | null = null;
  private intervalSeconds = 0;
  private totals: AnalyticsParams = {};
  private window: AnalyticsParams = {};
  constructor(private emit: Emit) {}
  start(now: number) {
    if (this.last !== null) return;
    this.last = now; this.intervalSeconds = 0; this.totals = {}; this.window = {};
    this.emit('drive_start', {});
  }
  sample(now: number, kmh: number | null) {
    if (this.last === null) return;
    const seconds = (now - this.last) / 1000; this.last = now;
    if (seconds <= 0 || seconds > 5) return;
    const valid = kmh !== null && Number.isFinite(kmh) && kmh >= 0 && kmh <= 300;
    for (const target of [this.totals, this.window]) {
      target.measured_seconds = Number(target.measured_seconds ?? 0) + seconds;
      if (valid) {
        target.speed_valid_seconds = Number(target.speed_valid_seconds ?? 0) + seconds;
        target.speed_sum = Number(target.speed_sum ?? 0) + kmh * seconds;
        target.max_kmh = Math.max(Number(target.max_kmh ?? 0), kmh);
        const bucket = kmh < 10 ? 'speed_0_10_seconds' : kmh < 40 ? 'speed_10_40_seconds' : kmh < 80 ? 'speed_40_80_seconds' : 'speed_80_plus_seconds';
        target[bucket] = Number(target[bucket] ?? 0) + seconds;
      }
    }
    this.intervalSeconds += seconds;
    if (this.intervalSeconds >= 60) {
      this.emit('drive_progress', this.round(this.window)); this.window = {}; this.intervalSeconds = 0;
    }
  }
  stop() {
    if (this.last === null) return;
    // The final window makes progress totals resilient to sessions without a clean end.
    if (this.intervalSeconds > 0) this.emit('drive_progress', this.round(this.window));
    this.emit('drive_end', this.round(this.totals)); this.discard();
  }
  discard() { this.last = null; this.totals = {}; this.window = {}; this.intervalSeconds = 0; }
  private round(params: AnalyticsParams): AnalyticsParams {
    return Object.fromEntries(Object.entries(params).map(([key,value]) => [key, Math.round(Number(value) * 10) / 10]));
  }
}

/** Buffering may fire playing again; only one start/completion per playback attempt. */
export class VideoMetrics {
  private params: AnalyticsParams | null = null;
  private started = false;
  private watched = 0;
  private duration = 0;
  private lastTime: number | null = null;
  private lastAt = 0;
  private milestones = new Set<number>();
  constructor(private emit: Emit, private enabled:()=>boolean = ()=>true) {}
  begin(videoId: string, context: 'warning' | 'preview', reason?: string) {
    this.clear();
    if (!this.enabled()) return;
    this.params = {video_id: videoId, context, ...(reason ? {reason} : {})}; this.started = false;
  }
  playing() { if (!this.enabled()) {this.clear();return;} if (this.params && !this.started) { this.started = true; this.watched=0;this.lastTime=null;this.milestones.clear();this.emit('video_play_start',this.params); } }
  tick(time:number,duration:number,now:number,paused:boolean) {
    if (!this.enabled()) {this.clear();return;}
    if (!this.started || !this.params) return;
    this.duration=Number.isFinite(duration) && duration>0 ? duration : 0;
    const elapsed=(now-this.lastAt)/1000;
    const advanced=this.lastTime === null ? 0 : time-this.lastTime;
    // Ignore seeks, background gaps, stalls and paused time.
    if (!paused && this.lastTime!==null && elapsed>0 && elapsed<=2 && advanced>0 && advanced<=elapsed*2+0.3) this.watched+=Math.min(elapsed,advanced);
    this.lastTime=time;this.lastAt=now;
    const percent=this.watchParams().watch_percent as number;
    for(const milestone of [25,50,75]) if(percent>=milestone && !this.milestones.has(milestone)) {
      this.milestones.add(milestone);this.emit('video_watch_progress',{...this.params,milestone});
    }
  }
  private watchParams():AnalyticsParams { return {watched_seconds:Math.round(this.watched*10)/10,watch_percent:this.duration>0 ? Math.min(100,Math.floor(this.watched/this.duration*100)) : 0}; }
  complete(seconds: number) { if (this.enabled() && this.params && this.started) this.emit('video_play_complete',{...this.params,playback_seconds: seconds,...this.watchParams()}); this.started = false; }
  exit() { if (this.enabled() && this.params && this.started) this.emit('video_play_exit',{...this.params,...this.watchParams()});this.clear(); }
  fail() { if (this.enabled() && this.params) this.emit('video_play_error',{...this.params,...this.watchParams()}); this.clear(); }
  clear() { this.params = null; this.started = false;this.watched=0;this.duration=0;this.lastTime=null;this.milestones.clear(); }
}
