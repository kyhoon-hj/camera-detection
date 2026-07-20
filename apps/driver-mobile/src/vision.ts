import {
  FaceLandmarker,
  FilesetResolver,
  PoseLandmarker,
  type FaceLandmarkerResult,
  type PoseLandmarkerResult,
} from "@mediapipe/tasks-vision";
import type { Landmark, VisionFrame } from "./monitor";

export type VisionDelegate = "GPU" | "CPU";

const VISION_WASM_ROOT = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm";
const FACE_LANDMARKER_MODEL = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";
const POSE_LANDMARKER_MODEL = "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task";

export interface VideoFrameState {
  readyState: number;
  videoWidth: number;
  videoHeight: number;
  paused: boolean;
  ended: boolean;
}

export interface DetectionFrame extends VisionFrame {
  faceResult: FaceLandmarkerResult;
  poseResult: PoseLandmarkerResult;
}

export class VisionFrameUnavailableError extends Error {
  constructor() {
    super("카메라 영상 프레임이 아직 준비되지 않았습니다.");
    this.name = "VisionFrameUnavailableError";
  }
}

export class MobileVisionEngine {
  private faceLandmarker: FaceLandmarker | null = null;
  private poseLandmarker: PoseLandmarker | null = null;
  private delegate: VisionDelegate | null = null;

  get activeDelegate(): VisionDelegate | null {
    return this.delegate;
  }

  async initialize(preferredDelegate: VisionDelegate = "GPU"): Promise<void> {
    this.close();
    const files = await FilesetResolver.forVisionTasks(VISION_WASM_ROOT);
    if (preferredDelegate === "GPU") {
      try {
        await this.initializeWithDelegate(files, "GPU");
        return;
      } catch {
        this.close();
      }
    }
    await this.initializeWithDelegate(files, "CPU");
  }

  detect(video: HTMLVideoElement, timestampMs: number): DetectionFrame {
    if (this.faceLandmarker === null || this.poseLandmarker === null) {
      throw new Error("비전 엔진이 아직 준비되지 않았습니다.");
    }
    if (!isUsableVideoFrame(video) || !Number.isFinite(timestampMs)) {
      throw new VisionFrameUnavailableError();
    }
    const faceResult = this.faceLandmarker.detectForVideo(video, timestampMs);
    const poseResult = this.poseLandmarker.detectForVideo(video, timestampMs);
    return {
      timestampMs,
      face: (faceResult.faceLandmarks[0] as Landmark[] | undefined) ?? null,
      pose: (poseResult.landmarks[0] as Landmark[] | undefined) ?? null,
      faceResult,
      poseResult,
    };
  }

  close(): void {
    this.faceLandmarker?.close();
    this.poseLandmarker?.close();
    this.faceLandmarker = null;
    this.poseLandmarker = null;
    this.delegate = null;
  }

  private async initializeWithDelegate(
    files: Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>>,
    delegate: VisionDelegate,
  ): Promise<void> {
    const faceLandmarker = await this.createFaceLandmarker(files, delegate);
    try {
      const poseLandmarker = await this.createPoseLandmarker(files, delegate);
      this.faceLandmarker = faceLandmarker;
      this.poseLandmarker = poseLandmarker;
      this.delegate = delegate;
    } catch (cause) {
      faceLandmarker.close();
      throw cause;
    }
  }

  private createFaceLandmarker(files: Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>>, delegate: VisionDelegate) {
    return FaceLandmarker.createFromOptions(files, {
      baseOptions: { modelAssetPath: FACE_LANDMARKER_MODEL, delegate },
      runningMode: "VIDEO",
      numFaces: 1,
      minFaceDetectionConfidence: 0.55,
      minFacePresenceConfidence: 0.55,
      minTrackingConfidence: 0.5,
      outputFaceBlendshapes: false,
      outputFacialTransformationMatrixes: false,
    });
  }

  private createPoseLandmarker(files: Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>>, delegate: VisionDelegate) {
    return PoseLandmarker.createFromOptions(files, {
      baseOptions: { modelAssetPath: POSE_LANDMARKER_MODEL, delegate },
      runningMode: "VIDEO",
      numPoses: 1,
      minPoseDetectionConfidence: 0.5,
      minPosePresenceConfidence: 0.5,
      minTrackingConfidence: 0.45,
    });
  }
}

export function isUsableVideoFrame(video: VideoFrameState): boolean {
  return video.readyState >= 2
    && Number.isFinite(video.videoWidth)
    && Number.isFinite(video.videoHeight)
    && video.videoWidth > 0
    && video.videoHeight > 0
    && !video.paused
    && !video.ended;
}

export function isRecoverableVisionError(cause: unknown): boolean {
  const message = cause instanceof Error ? cause.message : String(cause);
  return /ROI contains NaN|NormalizedRect|CalculatorGraph::Run|Graph has errors|WaitUntilIdle failed/i.test(message);
}

export function visionErrorMessage(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : String(cause);
  if (/ROI contains NaN|NormalizedRect/i.test(message)) {
    return "카메라 영상 크기가 일시적으로 변경되어 분석을 중지했습니다. 휴대폰을 세로로 고정한 뒤 다시 시작해 주세요.";
  }
  return "영상 분석 엔진에 오류가 발생해 카메라를 중지했습니다. 앱을 다시 시작해 주세요.";
}

const EYE_PATHS = [
  [33, 160, 158, 133, 153, 144, 33],
  [362, 385, 387, 263, 373, 380, 362],
];
const POSE_PATHS = [[7, 0, 8], [7, 11, 12, 8], [11, 12]];

export function drawLandmarks(
  canvas: HTMLCanvasElement,
  video: HTMLVideoElement,
  frame: DetectionFrame,
  alert: boolean,
): void {
  const width = video.videoWidth;
  const height = video.videoHeight;
  if (width === 0 || height === 0) return;
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const context = canvas.getContext("2d");
  if (context === null) return;
  context.clearRect(0, 0, width, height);
  context.lineWidth = Math.max(2, width / 320);
  context.strokeStyle = alert ? "#ff665e" : "#41f2af";
  context.fillStyle = alert ? "#ff665e" : "#eafcf5";

  if (frame.face !== null) {
    for (const path of EYE_PATHS) drawPath(context, frame.face, path, width, height);
    for (const index of [1, 33, 133, 263, 362]) drawPoint(context, frame.face[index], width, height, 3.2);
  }
  if (frame.pose !== null) {
    for (const path of POSE_PATHS) drawPath(context, frame.pose, path, width, height);
    for (const index of [0, 7, 8, 11, 12]) drawPoint(context, frame.pose[index], width, height, 4);
  }
}

function drawPath(
  context: CanvasRenderingContext2D,
  landmarks: Landmark[],
  path: number[],
  width: number,
  height: number,
): void {
  context.beginPath();
  path.forEach((index, position) => {
    const point = landmarks[index];
    const x = (1 - point.x) * width;
    const y = point.y * height;
    if (position === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  });
  context.stroke();
}

function drawPoint(
  context: CanvasRenderingContext2D,
  point: Landmark,
  width: number,
  height: number,
  radius: number,
): void {
  context.beginPath();
  context.arc((1 - point.x) * width, point.y * height, radius, 0, Math.PI * 2);
  context.fill();
}
