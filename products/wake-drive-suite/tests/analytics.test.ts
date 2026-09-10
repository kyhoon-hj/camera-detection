import { afterEach, describe, expect, it, vi } from 'vitest';
afterEach(()=> { vi.resetModules(); vi.doUnmock('@capacitor/core'); vi.doUnmock('../src/appProfile'); });
describe('native analytics consent gate',()=>{
  it('gates and sanitizes user preferences through the native bridge',async()=>{
    const plugin={getStatus:vi.fn(async()=>({configured:true,enabled:false,decided:false})),setEnabled:vi.fn(async({enabled}:{enabled:boolean})=>({configured:true,enabled,decided:true})),logEvent:vi.fn(async()=>{}),setPreferences:vi.fn(async()=>{})};
    vi.doMock('@capacitor/core',()=>({Capacitor:{getPlatform:()=> 'android'},registerPlugin:()=>plugin}));
    vi.doMock('../src/appProfile',()=>({APP:{variant:'jolbang'}}));
    const a=await import('../src/analytics');await a.analyticsReady;
    a.setAnalyticsPreferences({sound_mode:'on'});expect(plugin.setPreferences).not.toHaveBeenCalled();
    await a.setAnalyticsEnabled(true);a.setAnalyticsPreferences({sound_mode:'off',applied_video:'personal-text'});
    await vi.waitFor(()=>expect(plugin.setPreferences).toHaveBeenCalledWith({properties:{sound_mode:'off'}}));
    await a.setAnalyticsEnabled(false);a.setAnalyticsPreferences({sound_mode:'on'});await Promise.resolve();expect(plugin.setPreferences).toHaveBeenCalledTimes(1);
  });
  it('never replays pre-consent events and stops sending after opt-out',async()=>{
    const plugin={getStatus:vi.fn(async()=>({configured:true,enabled:false,decided:false})),setEnabled:vi.fn(async({enabled}:{enabled:boolean})=>({configured:true,enabled,decided:true})),logEvent:vi.fn(async()=>{})};
    vi.doMock('@capacitor/core',()=>({Capacitor:{getPlatform:()=> 'android'},registerPlugin:()=>plugin}));
    vi.doMock('../src/appProfile',()=>({APP:{variant:'jolbang'}}));
    const a=await import('../src/analytics');await a.analyticsReady;
    a.analyticsEvent('video_select',{video_id:'video-1'});
    await a.setAnalyticsEnabled(true);
    a.analyticsEvent('video_select',{video_id:'video-2',latitude:37});
    await vi.waitFor(()=>expect(plugin.logEvent).toHaveBeenCalledWith({name:'video_select',params:{video_id:'video-2'}}));
    await a.setAnalyticsEnabled(false);a.analyticsEvent('video_select',{video_id:'video-3'});
    await Promise.resolve();
    expect(plugin.logEvent.mock.calls.map(call=>(call as unknown as [{params:{video_id?:string}}])[0].params.video_id)).not.toContain('video-1');
    expect(plugin.logEvent.mock.calls.map(call=>(call as unknown as [{params:{video_id?:string}}])[0].params.video_id)).not.toContain('video-3');
    expect(a.getAnalyticsStatus().enabled).toBe(false);
  });
  it('reports missing Firebase config without attempting collection',async()=>{
    const plugin={getStatus:vi.fn(async()=>({configured:false,enabled:false,decided:false})),setEnabled:vi.fn(),logEvent:vi.fn()};
    vi.doMock('@capacitor/core',()=>({Capacitor:{getPlatform:()=> 'android'},registerPlugin:()=>plugin}));
    vi.doMock('../src/appProfile',()=>({APP:{variant:'jolbang'}}));
    const a=await import('../src/analytics');await a.analyticsReady;await a.setAnalyticsEnabled(true);a.analyticsEvent('app_open');
    expect(plugin.setEnabled).not.toHaveBeenCalled();expect(plugin.logEvent).not.toHaveBeenCalled();
  });
});
