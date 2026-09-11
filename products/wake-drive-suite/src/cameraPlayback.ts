/** Playback progress is independent of the last frame accepted by the detector. */
export class CameraPlaybackWatchdog {
  private observedTime = -1;
  private lastProgress = 0;
  private resumeAttempted = false;

  reset(now: number): void {
    this.observedTime = -1;
    this.lastProgress = now;
    this.resumeAttempted = false;
  }

  observe(now: number, video: { currentTime: number; paused: boolean; ended: boolean } | null, usable: boolean) {
    const time = video?.currentTime ?? -1;
    const progressed = usable && Number.isFinite(time) && time >= 0 && time !== this.observedTime;
    this.observedTime = time;
    if (progressed) {
      this.lastProgress = now;
      this.resumeAttempted = false;
    }
    const stalled = now - this.lastProgress >= 4000;
    const resume = !stalled && !!video?.paused && !video.ended && !this.resumeAttempted;
    if (resume) this.resumeAttempted = true;
    return { stalled, resume };
  }
}
