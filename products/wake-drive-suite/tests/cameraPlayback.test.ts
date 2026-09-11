import { describe, expect, it } from 'vitest';
import { CameraPlaybackWatchdog } from '../src/cameraPlayback';

const frame = (currentTime: number, paused = false) => ({ currentTime, paused, ended: false });
describe('camera playback watchdog', () => {
  it('detects a pause between analyzed frames without treating the final timestamp as perpetual progress', () => {
    const watchdog = new CameraPlaybackWatchdog();
    watchdog.reset(100);
    watchdog.observe(200, frame(1), true);
    expect(watchdog.observe(250, frame(1.03, true), false)).toEqual({ stalled: false, resume: true });
    expect(watchdog.observe(300, frame(1.03, true), false).resume).toBe(false);
    expect(watchdog.observe(4200, frame(1.03, true), false).stalled).toBe(true);
  });
  it('detects a frozen feed even when playback is not paused', () => {
    const watchdog = new CameraPlaybackWatchdog();
    watchdog.reset(0);
    watchdog.observe(100, frame(1), true);
    expect(watchdog.observe(4100, frame(1), true).stalled).toBe(true);
  });
  it('does not count changing timestamps with unusable frames as healthy playback', () => {
    const watchdog = new CameraPlaybackWatchdog();
    watchdog.reset(0);
    watchdog.observe(2000, frame(1), false);
    expect(watchdog.observe(4000, frame(2), false).stalled).toBe(true);
  });
  it('keeps progressing playback alive and permits recovery after a later pause', () => {
    const watchdog = new CameraPlaybackWatchdog();
    watchdog.reset(0);
    expect(watchdog.observe(100, frame(1, true), false).resume).toBe(true);
    expect(watchdog.observe(200, frame(2), true).stalled).toBe(false);
    expect(watchdog.observe(300, frame(2, true), false).resume).toBe(true);
    for (let time = 1; time <= 10; time++) expect(watchdog.observe(time * 1000, frame(time + 2), true).stalled).toBe(false);
  });
  it('resets the deadline after an intentional warning video and never resumes an ended or absent video', () => {
    const watchdog = new CameraPlaybackWatchdog();
    watchdog.reset(10000);
    expect(watchdog.observe(10001, frame(1), true).stalled).toBe(false);
    expect(watchdog.observe(10002, { ...frame(1, true), ended: true }, false).resume).toBe(false);
    expect(watchdog.observe(14001, null, false)).toEqual({ stalled: true, resume: false });
  });
});
