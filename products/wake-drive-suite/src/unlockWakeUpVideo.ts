import { addDownloadedWakeUpVideo, type WakeUpLibraryState, type WakeUpVideoId } from "./wakeUpVideos";

// 보상과 다운로드가 모두 완료되어야 보관함에 추가합니다. 적용 영상은 유지합니다.
export async function unlockWakeUpVideo(
  state: WakeUpLibraryState,
  id: WakeUpVideoId,
  steps: { reward(): Promise<boolean>; download(): Promise<void> },
): Promise<WakeUpLibraryState | null> {
  if (state.downloadedIds.includes(id)) return state;
  if (!await steps.reward()) return null;
  await steps.download();
  return addDownloadedWakeUpVideo(state, id);
}
