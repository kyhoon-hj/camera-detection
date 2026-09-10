import { describe,it,expect,vi } from 'vitest';
import { cleanPreferences,PreferenceMetrics,type Preferences } from '../src/preferenceAnalytics';
import { VideoMetrics } from '../src/analyticsCore';
const initial:Preferences={applied_video:'video-0',playback_mode:'APPLIED',sound_mode:'on',pip_mode:'on',library_size_band:'one'};
describe('preference analytics',()=>{
  it('permits only explicit finite preferences, rejects personal text',()=>{
    expect(cleanPreferences({...initial,email:'a@b.com',personality:'anxious',applied_video:'video-99',sound_mode:'user-name'})).toEqual({playback_mode:'APPLIED',pip_mode:'on',library_size_band:'one'});
  });
  it('records one current snapshot, no duplicate render events, then only changes',()=>{
    const emit=vi.fn(),props=vi.fn();const metric=new PreferenceMetrics(emit,props);
    metric.update(initial,false);expect(emit).not.toHaveBeenCalled();
    metric.update(initial,true);metric.update({...initial},true);metric.update({...initial,sound_mode:'off'},true);
    expect(emit.mock.calls).toEqual([['preferences_snapshot',initial],['setting_change',{setting_name:'sound_mode',setting_value:'off'}]]);
    expect(props).toHaveBeenCalledTimes(2);
  });
  it('does not reconstruct settings changes made while opted out',()=>{
    const emit=vi.fn();const metric=new PreferenceMetrics(emit,vi.fn());
    metric.update(initial,true);metric.update(initial,false);metric.update({...initial,sound_mode:'off'},true);
    expect(emit.mock.calls.map(([name])=>name)).toEqual(['preferences_snapshot','preferences_snapshot']);
  });
  it('counts watched time and one milestone each, not skipped media time',()=>{
    const emit=vi.fn();const metric=new VideoMetrics(emit);metric.begin('video-0','preview');metric.playing();
    for(let i=0;i<=3;i++) metric.tick(i,10,i*1000,false);
    metric.tick(9,10,3500,false);metric.exit();metric.exit();
    expect(emit.mock.calls.filter(([name])=>name==='video_watch_progress')).toEqual([['video_watch_progress',{video_id:'video-0',context:'preview',milestone:25}]]);
    expect(emit.mock.calls.at(-1)).toEqual(['video_play_exit',{video_id:'video-0',context:'preview',watched_seconds:3,watch_percent:30}]);
  });
  it('excludes pauses, stalls, background gaps and completed-video close',()=>{
    const emit=vi.fn();const metric=new VideoMetrics(emit);metric.begin('video-0','preview');metric.playing();
    metric.tick(0,10,0,false);metric.tick(1,10,1000,false);metric.tick(1,10,2000,true);metric.tick(1,10,3000,false);metric.tick(10,10,12000,false);
    metric.complete(10);metric.exit();
    expect(emit.mock.calls.at(-1)?.[1].watched_seconds).toBe(1);
    expect(emit.mock.calls.some(([name])=>name==='video_play_exit')).toBe(false);
  });
  it('drops a playback attempt when consent is revoked',()=>{
    let enabled=true;const emit=vi.fn();const metric=new VideoMetrics(emit,()=>enabled);
    metric.begin('video-0','preview');metric.playing();enabled=false;metric.tick(1,10,1000,false);enabled=true;metric.complete(10);metric.exit();
    expect(emit.mock.calls.map(([name])=>name)).toEqual(['video_play_start']);
  });
});
