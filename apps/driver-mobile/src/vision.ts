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
const FACE_OVAL_PATH = [
  10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365,
  379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93,
  234, 127, 162, 21, 54, 103, 67, 109, 10,
];

export interface PostureOverlayAngles {
  headTiltDegrees: number | null;
  shoulderTiltDegrees: number | null;
}

export function calculatePostureOverlayAngles(
  face: Landmark[] | null,
  pose: Landmark[] | null,
  width: number,
  height: number,
): PostureOverlayAngles {
  const forehead = face?.[10];
  const chin = face?.[152];
  const leftShoulder = pose?.[11];
  const rightShoulder = pose?.[12];
  return {
    headTiltDegrees: forehead && chin
      ? roundAngle(Math.atan2(
        Math.abs((chin.x - forehead.x) * width),
        Math.abs((chin.y - forehead.y) * height),
      ) * 180 / Math.PI)
      : null,
    shoulderTiltDegrees: leftShoulder && rightShoulder
      ? roundAngle(Math.atan2(
        Math.abs((rightShoulder.y - leftShoulder.y) * height),
        Math.abs((rightShoulder.x - leftShoulder.x) * width),
      ) * 180 / Math.PI)
      : null,
  };
}

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
  context.save();
  context.lineCap = "round";
  context.lineJoin = "round";
  const accent = alert ? "rgba(255, 181, 91, .92)" : "rgba(79, 231, 176, .9)";
  const subtle = alert ? "rgba(255, 205, 143, .62)" : "rgba(181, 255, 229, .64)";
  const fineLine = Math.max(1, width / 960);
  const bodyLine = Math.max(1.2, width / 760);

  if (frame.face !== null) {
    context.lineWidth = fineLine;
    context.strokeStyle = accent;
    context.setLineDash([Math.max(2, width / 250), Math.max(3, width / 190)]);
    drawPath(context, frame.face, FACE_OVAL_PATH, width, height);

    context.strokeStyle = subtle;
    context.setLineDash([1.5, 3.5]);
    for (const path of EYE_PATHS) drawPath(context, frame.face, path, width, height);

    context.setLineDash([3, 5]);
    drawPath(context, frame.face, [10, 152], width, height);
  }
  if (frame.pose !== null) {
    context.lineWidth = bodyLine;
    context.strokeStyle = subtle;
    context.setLineDash([5, 6]);
    drawPath(context, frame.pose, [11, 23], width, height);
    drawPath(context, frame.pose, [12, 24], width, height);

    context.strokeStyle = accent;
    context.setLineDash([]);
    drawPath(context, frame.pose, [11, 12], width, height);
    drawShoulderReference(context, frame.pose, width, height, accent, subtle);

    context.fillStyle = accent;
    for (const index of [11, 12]) drawPoint(context, frame.pose[index], width, height, Math.max(1.8, width / 420));
  }
  if (frame.face !== null && frame.pose !== null) {
    drawNeckGuide(context, frame.face, frame.pose, width, height, subtle);
  }

  const angles = calculatePostureOverlayAngles(frame.face, frame.pose, width, height);
  drawAngleLabels(context, frame.face, frame.pose, angles, width, height, alert);
  context.restore();
}

function drawShoulderReference(
  context: CanvasRenderingContext2D,
  pose: Landmark[],
  width: number,
  height: number,
  accent: string,
  subtle: string,
): void {
  const left = toCanvasPoint(pose[11], width, height);
  const right = toCanvasPoint(pose[12], width, height);
  const center = midpoint(left, right);
  const halfLength = Math.min(38, Math.abs(right.x - left.x) * 0.28);
  context.strokeStyle = subtle;
  context.lineWidth = Math.max(1, width / 1050);
  context.setLineDash([2, 4]);
  context.beginPath();
  context.moveTo(center.x - halfLength, center.y);
  context.lineTo(center.x + halfLength, center.y);
  context.stroke();

  const actualAngle = Math.atan2(right.y - left.y, right.x - left.x);
  const referenceAngle = right.x >= left.x ? 0 : Math.PI;
  context.strokeStyle = accent;
  context.setLineDash([]);
  context.beginPath();
  context.arc(center.x, center.y, Math.max(10, width / 46), referenceAngle, actualAngle, actualAngle < referenceAngle);
  context.stroke();
}

function drawNeckGuide(
  context: CanvasRenderingContext2D,
  face: Landmark[],
  pose: Landmark[],
  width: number,
  height: number,
  color: string,
): void {
  const chin = toCanvasPoint(face[152], width, height);
  const shoulderCenter = midpoint(toCanvasPoint(pose[11], width, height), toCanvasPoint(pose[12], width, height));
  const neckEnd = midpoint(chin, shoulderCenter);
  context.strokeStyle = color;
  context.lineWidth = Math.max(1, width / 1000);
  context.setLineDash([3, 5]);
  context.beginPath();
  context.moveTo(chin.x, chin.y);
  context.lineTo(neckEnd.x, neckEnd.y);
  context.stroke();
}

function drawAngleLabels(
  context: CanvasRenderingContext2D,
  face: Landmark[] | null,
  pose: Landmark[] | null,
  angles: PostureOverlayAngles,
  width: number,
  height: number,
  alert: boolean,
): void {
  const labels: Array<{ text: string; x: number; y: number }> = [];
  if (face && angles.headTiltDegrees !== null) {
    const chin = toCanvasPoint(face[152], width, height);
    labels.push({ text: `고개 ${angles.headTiltDegrees.toFixed(1)}°`, x: chin.x + 8, y: chin.y - 10 });
  }
  if (pose && angles.shoulderTiltDegrees !== null) {
    const center = midpoint(toCanvasPoint(pose[11], width, height), toCanvasPoint(pose[12], width, height));
    labels.push({ text: `어깨 ${angles.shoulderTiltDegrees.toFixed(1)}°`, x: center.x + 8, y: center.y + 18 });
  }
  const fontSize = Math.max(9, Math.min(13, width / 55));
  context.font = `600 ${fontSize}px system-ui, sans-serif`;
  context.textBaseline = "middle";
  for (const label of labels) {
    const paddingX = 6;
    const boxHeight = fontSize + 8;
    const boxWidth = context.measureText(label.text).width + paddingX * 2;
    const x = Math.max(4, Math.min(label.x, width - boxWidth - 4));
    const y = Math.max(boxHeight / 2 + 4, Math.min(label.y, height - boxHeight / 2 - 4));
    context.fillStyle = "rgba(8, 24, 20, .64)";
    roundedRect(context, x, y - boxHeight / 2, boxWidth, boxHeight, boxHeight / 2);
    context.fill();
    context.fillStyle = alert ? "#ffd6a6" : "#d9ffef";
    context.fillText(label.text, x + paddingX, y + 0.5);
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

function toCanvasPoint(point: Landmark, width: number, height: number): { x: number; y: number } {
  return { x: (1 - point.x) * width, y: point.y * height };
}

function midpoint(a: { x: number; y: number }, b: { x: number; y: number }): { x: number; y: number } {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function roundAngle(value: number): number {
  return Math.round(value * 10) / 10;
}

function roundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  const r = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + r, y);
  context.arcTo(x + width, y, x + width, y + height, r);
  context.arcTo(x + width, y + height, x, y + height, r);
  context.arcTo(x, y + height, x, y, r);
  context.arcTo(x, y, x + width, y, r);
  context.closePath();
}
