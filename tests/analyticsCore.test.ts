import { describe, expect, it, vi } from 'vitest';
import { cleanParams, DriveMetrics, VideoMetrics } from '../src/analyticsCore';
describe('usage analytics privacy and aggregation', () => {
  it('drops coordinates, raw text, URLs and non-finite values', () => {
    expect(cleanParams({video_id:'video-2',latitude:37,longitude:127,email:'a@b.com',action:'https://example.com',max_kmh:NaN,measured_seconds:-1})).toEqual({video_id:'video-2'});
  });
  it('counts monitoring separately from valid GPS and excludes suspension gaps', () => {
    const emit=vi.fn(); const drive=new DriveMetrics(emit);
    drive.start(0); drive.start(0);
    drive.sample(1000,null); drive.sample(2000,0); drive.sample(3000,60); drive.sample(9000,100); drive.sample(10000,NaN);
    drive.stop(); drive.stop();
    expect(emit.mock.calls.filter(([event])=>event==='drive_start')).toHaveLength(1);
    expect(emit.mock.calls.filter(([event])=>event==='drive_end')).toHaveLength(1);
    expect(emit.mock.calls.at(-1)?.[1]).toEqual({measured_seconds:4,speed_valid_seconds:2,speed_sum:60,max_kmh:60,speed_0_10_seconds:1,speed_40_80_seconds:1});
  });
  it('reports each minute and remaining tail without double counting progress', () => {
    const emit=vi.fn(); const drive=new DriveMetrics(emit); drive.start(0);
    for(let i=1;i<=65;i++) drive.sample(i*1000,90);
    drive.stop();
    const progress=emit.mock.calls.filter(([event])=>event==='drive_progress');
    expect(progress.map(([,params])=>params.measured_seconds)).toEqual([60,5]);
    expect(emit.mock.calls.at(-1)?.[1].speed_sum).toBe(5850);
  });
  it('consent revocation discards unfinished aggregates', () => {
    const emit=vi.fn();const drive=new DriveMetrics(emit);drive.start(0);drive.sample(1000,50);drive.discard();drive.stop();
    expect(emit.mock.calls.map(([event])=>event)).toEqual(['drive_start']);
  });
  it('counts actual video play once across buffering and permits replay', () => {
    const emit=vi.fn();const video=new VideoMetrics(emit);video.begin('video-0','warning','EYES');
    expect(emit).not.toHaveBeenCalled();video.playing();video.playing();video.complete(10);video.complete(10);video.playing();video.fail();video.fail();
    expect(emit.mock.calls.map(([event])=>event)).toEqual(['video_play_start','video_play_complete','video_play_start','video_play_error']);
  });
});
