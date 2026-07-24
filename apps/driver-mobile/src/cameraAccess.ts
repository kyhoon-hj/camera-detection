import { isUsableVideoFrame } from "./vision";

export function cameraErrorMessage(cause: unknown): string {
  if (!(cause instanceof DOMException)) return cause instanceof Error ? cause.message : "카메라를 시작하지 못했습니다.";
  if (cause.name === "NotAllowedError" || cause.name === "SecurityError") {
    return "카메라 권한이 차단됐습니다. Chrome 주소창의 사이트 설정 → 카메라 → 허용으로 바꾼 뒤 다시 시작해 주세요.";
  }
  if (cause.name === "NotReadableError" || cause.name === "AbortError") {
    return "다른 앱이 카메라를 사용 중입니다. 카메라 앱이나 화상회의를 종료한 뒤 다시 시도해 주세요.";
  }
  if (cause.name === "NotFoundError" || cause.name === "OverconstrainedError") {
    return "사용 가능한 전면 카메라를 찾지 못했습니다. 기기의 카메라 연결과 Chrome 권한을 확인해 주세요.";
  }
  if (cause.name === "TimeoutError") {
    return "카메라 허용을 기다리는 시간이 초과됐습니다. 권한 창에서 허용을 선택한 뒤 다시 시작해 주세요.";
  }
  return `카메라를 시작하지 못했습니다. ${cause.message}`;
}

export async function requestUserCamera(constraints: MediaStreamConstraints): Promise<MediaStream> {
  let timedOut = false;
  const request = navigator.mediaDevices.getUserMedia(constraints);
  const timeout = new Promise<never>((_, reject) => {
    window.setTimeout(() => {
      timedOut = true;
      reject(new DOMException("카메라 권한 응답 시간 초과", "TimeoutError"));
    }, 20_000);
  });
  void request.then((stream) => {
    if (timedOut) stream.getTracks().forEach((track) => track.stop());
  }).catch(() => undefined);
  return Promise.race([request, timeout]);
}

export async function applyMinimumCameraZoom(stream: MediaStream): Promise<boolean> {
  const track = stream.getVideoTracks()[0];
  if (!track || typeof track.getCapabilities !== "function") return false;
  const capabilities = track.getCapabilities() as MediaTrackCapabilities & {
    zoom?: { min: number; max: number; step?: number };
  };
  const minimumZoom = capabilities.zoom?.min;
  if (!Number.isFinite(minimumZoom)) return false;
  try {
    await track.applyConstraints({
      advanced: [{ zoom: minimumZoom } as MediaTrackConstraintSet],
    });
    return true;
  } catch {
    return false;
  }
}

export async function waitForUsableVideoFrame(video: HTMLVideoElement, timeoutMs = 7_000): Promise<void> {
  const startedAt = performance.now();
  while (!isUsableVideoFrame(video)) {
    if (performance.now() - startedAt >= timeoutMs) {
      throw new Error("카메라 영상 크기를 확인하지 못했습니다. 앱을 다시 시작해 주세요.");
    }
    await nextVideoFrame(video);
  }
}

function nextVideoFrame(video: HTMLVideoElement): Promise<void> {
  if (typeof video.requestVideoFrameCallback === "function") {
    return new Promise((resolve) => {
      let settled = false;
      let timeout = 0;
      const finish = () => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);
        resolve();
      };
      const callbackId = video.requestVideoFrameCallback(finish);
      timeout = window.setTimeout(() => {
        video.cancelVideoFrameCallback(callbackId);
        finish();
      }, 250);
    });
  }
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}
