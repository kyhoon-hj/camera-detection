import { describe, expect, it } from "vitest";
import {
  DEFAULT_WAKE_UP_LIBRARY_STATE,
  WAKE_UP_VIDEO_PROFILES,
  addDownloadedWakeUpVideo,
  applyDownloadedWakeUpVideo,
  getAppliedWakeUpVideoPath,
  loadWakeUpLibraryState,
  orderWakeUpVideoProfiles,
} from "../src/wakeUpVideos";

describe("wake-up video library", () => {
  it("starts with the bundled default video downloaded and applied", () => {
    expect(loadWakeUpLibraryState(null)).toEqual(DEFAULT_WAKE_UP_LIBRARY_STATE);
  });

  it("keeps downloaded videos at the left side of the catalog", () => {
    const ordered = orderWakeUpVideoProfiles(["video-3", "video-0"]);
    expect(ordered.slice(0, 2).map((profile) => profile.id)).toEqual(["video-0", "video-3"]);
  });

  it("does not apply a video before it is downloaded", () => {
    expect(applyDownloadedWakeUpVideo(DEFAULT_WAKE_UP_LIBRARY_STATE, "video-1").appliedId).toBe("video-0");
  });

  it("downloads and then applies the selected video", () => {
    const downloaded = addDownloadedWakeUpVideo(DEFAULT_WAKE_UP_LIBRARY_STATE, "video-1");
    expect(downloaded.downloadedIds).toContain("video-1");
    const applied = applyDownloadedWakeUpVideo(downloaded, "video-1");
    expect(applied.appliedId).toBe("video-1");
    expect(getAppliedWakeUpVideoPath(applied)).toBe("/media/drowsy-video-1.mp4");
  });

  it("can apply every one of the 11 bundled videos", () => {
    const downloaded = WAKE_UP_VIDEO_PROFILES.reduce(
      (state, profile) => addDownloadedWakeUpVideo(state, profile.id),
      DEFAULT_WAKE_UP_LIBRARY_STATE,
    );
    expect(WAKE_UP_VIDEO_PROFILES).toHaveLength(11);
    for (const profile of WAKE_UP_VIDEO_PROFILES) {
      expect(getAppliedWakeUpVideoPath(applyDownloadedWakeUpVideo(downloaded, profile.id))).toBe(profile.path);
    }
  });

  it("repairs invalid persisted state", () => {
    const state = loadWakeUpLibraryState(JSON.stringify({ downloadedIds: ["unknown"], appliedId: "unknown" }));
    expect(state).toEqual(DEFAULT_WAKE_UP_LIBRARY_STATE);
  });
});
