import { describe, expect, it } from "vitest";
import { chooseWakeUpVideo, loadWakeUpPlaybackMode } from "../src/wakeUpPlayback";
import { DEFAULT_WAKE_UP_LIBRARY_STATE, type WakeUpLibraryState } from "../src/wakeUpVideos";

const library: WakeUpLibraryState = { downloadedIds: ["video-0", "video-3", "video-7"], appliedId: "video-3" };

describe("경고 영상 재생 방식", () => {
  it("기존 설치와 잘못된 설정은 현재 적용 영상만 재생한다", () => {
    expect(loadWakeUpPlaybackMode(null)).toBe("APPLIED");
    expect(loadWakeUpPlaybackMode("broken")).toBe("APPLIED");
    expect(loadWakeUpPlaybackMode("RANDOM_OWNED")).toBe("RANDOM_OWNED");
  });
  it("단일 모드는 난수를 사용하지 않고 현재 적용 영상을 고른다", () => {
    expect(chooseWakeUpVideo(library, "APPLIED", () => { throw new Error("must not draw"); }).id).toBe("video-3");
  });
  it("랜덤은 잠금 해제된 영상만 포함하고 현재 적용 상태를 변경하지 않는다", () => {
    const before = JSON.stringify(library);
    const selected = Array.from({ length: 30 }, (_, i) => chooseWakeUpVideo(library, "RANDOM_OWNED", () => i / 30).id);
    expect([...new Set(selected)]).toEqual(["video-0", "video-3", "video-7"]);
    expect(JSON.stringify(library)).toBe(before);
  });
  it("1편 보유 시 해당 영상으로 정상 재생한다", () => {
    expect(chooseWakeUpVideo(DEFAULT_WAKE_UP_LIBRARY_STATE, "RANDOM_OWNED").id).toBe("video-0");
  });
  it("잠긴 영상으로 손상된 적용 값은 보유 영상으로 대체한다", () => {
    expect(chooseWakeUpVideo({ downloadedIds: ["video-3"], appliedId: "video-8" }, "APPLIED").id).toBe("video-3");
  });
  it("랜덤은 새 경고마다 한 번만 선택한다", () => {
    let calls = 0;
    const random = () => calls++ === 0 ? 0 : .99;
    const first = chooseWakeUpVideo(library, "RANDOM_OWNED", random);
    const second = chooseWakeUpVideo(library, "RANDOM_OWNED", random);
    expect([first.id, second.id, calls]).toEqual(["video-0", "video-7", 2]);
  });
});
