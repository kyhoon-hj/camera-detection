import { describe, expect, it, vi } from "vitest";
import { DEFAULT_WAKE_UP_LIBRARY_STATE, applyDownloadedWakeUpVideo, loadWakeUpLibraryState } from "../src/wakeUpVideos";
import { unlockWakeUpVideo } from "../src/unlockWakeUpVideo";

describe("영상 광고 잠금 해제", () => {
  it("광고를 닫거나 보상이 없으면 다운로드 및 해제를 하지 않는다", async () => {
    const download = vi.fn();
    expect(await unlockWakeUpVideo(DEFAULT_WAKE_UP_LIBRARY_STATE, "video-1", { reward: async () => false, download })).toBeNull();
    expect(download).not.toHaveBeenCalled();
    expect(DEFAULT_WAKE_UP_LIBRARY_STATE.downloadedIds).not.toContain("video-1");
  });
  it("보상 확인 전에는 다운로드를 시작하지 않는다", async () => {
    let reward!: (value: boolean) => void;
    const download = vi.fn(async () => {});
    const pending = unlockWakeUpVideo(DEFAULT_WAKE_UP_LIBRARY_STATE, "video-2", {
      reward: () => new Promise(resolve => { reward = resolve; }), download,
    });
    expect(download).not.toHaveBeenCalled();
    reward(true);
    const next = await pending;
    expect(download).toHaveBeenCalledOnce();
    expect(next?.downloadedIds).toContain("video-2");
    expect(next?.appliedId).toBe(DEFAULT_WAKE_UP_LIBRARY_STATE.appliedId);
  });
  it("보상 후 다운로드 실패 시에도 잠금을 유지한다", async () => {
    await expect(unlockWakeUpVideo(DEFAULT_WAKE_UP_LIBRARY_STATE, "video-1", {
      reward: async () => true, download: async () => { throw new Error("network"); },
    })).rejects.toThrow("network");
    expect(DEFAULT_WAKE_UP_LIBRARY_STATE.downloadedIds).not.toContain("video-1");
  });
  it("해제 결과는 저장 복원되며 별도 적용 단계에서만 경고 영상이 바뀐다", async () => {
    const next = await unlockWakeUpVideo(DEFAULT_WAKE_UP_LIBRARY_STATE, "video-1", { reward: async () => true, download: async () => {} });
    const restored = loadWakeUpLibraryState(JSON.stringify(next));
    expect(restored.downloadedIds).toContain("video-1");
    expect(restored.appliedId).toBe("video-0");
    expect(applyDownloadedWakeUpVideo(restored, "video-1").appliedId).toBe("video-1");
  });
  it("기본 제공 및 이미 해제한 영상에 광고를 다시 요구하지 않는다", async () => {
    const reward = vi.fn(); const download = vi.fn();
    expect(await unlockWakeUpVideo(DEFAULT_WAKE_UP_LIBRARY_STATE, "video-0", { reward, download })).toBe(DEFAULT_WAKE_UP_LIBRARY_STATE);
    expect(reward).not.toHaveBeenCalled(); expect(download).not.toHaveBeenCalled();
  });
});
