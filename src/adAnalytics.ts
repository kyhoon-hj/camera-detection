import { analyticsEvent } from './analytics';
import type { AnalyticsParams } from './analyticsCore';

export type AdFormat = 'banner' | 'interstitial' | 'rewarded';
export function adReportingParams(format: AdFormat, testing: boolean, adId: string, videoId?: string): AnalyticsParams {
  return {
    ad_format: format,
    ad_placement: format === 'banner' ? 'bottom_banner' : format === 'interstitial' ? 'menu' : 'video_unlock',
    // Google sample units remain test traffic even if the explicit testing flag is off.
    ad_test: testing || adId.startsWith('ca-app-pub-3940256099942544/') ? 'test' : 'live',
    ...(videoId && /^video-([0-9]|10)$/.test(videoId) ? { video_id: videoId } : {}),
  };
}

export class AdAttemptMetrics {
  private sent = new Set<string>();
  constructor(private params: AnalyticsParams) {}
  request() { this.once('ad_request'); }
  shown() { this.once('ad_shown'); }
  reward() { this.once('ad_reward_earned'); }
  failed(stage: 'initialize' | 'load' | 'show' | 'timeout') { this.once('ad_failed', { failure_stage: stage }); }
  private once(name: 'ad_request' | 'ad_shown' | 'ad_reward_earned' | 'ad_failed', extra: AnalyticsParams = {}) {
    if (this.sent.has(name)) return;
    this.sent.add(name);
    // Diagnostics must not change an ad's reward or dismissal flow.
    try { analyticsEvent(name, { ...this.params, ...extra }); } catch { /* optional analytics */ }
  }
}
