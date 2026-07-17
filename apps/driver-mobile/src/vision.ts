import {
  FaceLandmarker,
  FilesetResolver,
  PoseLandmarker,
  type FaceLandmarkerResult,
  type PoseLandmarkerResult,
} from "@mediapipe/tasks-vision";
import type { Landmark, VisionFrame } from "./monitor";

export interface DetectionFrame extends VisionFrame {
  faceResult: FaceLandmarkerResult;
  poseResult: PoseLandmarkerResult;
}

export class MobileVisionEngine {
  private faceLandmarker: FaceLandmarker | null = null;
  private poseLandmarker: PoseLandmarker | null = null;

  async initialize(): Promise<void> {
    const files = await FilesetResolver.forVisionTasks("/wasm");
    this.faceLandmarker = await this.createFaceLandmarker(files, "GPU").catch(() => this.createFaceLandmarker(files, "CPU"));
    this.poseLandmarker = await this.createPoseLandmarker(files, "GPU").catch(() => this.createPoseLandmarker(files, "CPU"));
  }

  detect(video: HTMLVideoElement, timestampMs: number): DetectionFrame {
    if (this.faceLandmarker === null || this.poseLandmarker === null) {
      throw new Error("비전 엔진이 아직 준비되지 않았습니다.");
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
  }

  private createFaceLandmarker(files: Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>>, delegate: "GPU" | "CPU") {
    return FaceLandmarker.createFromOptions(files, {
      baseOptions: { modelAssetPath: "/models/face_landmarker.task", delegate },
      runningMode: "VIDEO",
      numFaces: 1,
      minFaceDetectionConfidence: 0.55,
      minFacePresenceConfidence: 0.55,
      minTrackingConfidence: 0.5,
      outputFaceBlendshapes: false,
      outputFacialTransformationMatrixes: false,
    });
  }

  private createPoseLandmarker(files: Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>>, delegate: "GPU" | "CPU") {
    return PoseLandmarker.createFromOptions(files, {
      baseOptions: { modelAssetPath: "/models/pose_landmarker_lite.task", delegate },
      runningMode: "VIDEO",
      numPoses: 1,
      minPoseDetectionConfidence: 0.5,
      minPosePresenceConfidence: 0.5,
      minTrackingConfidence: 0.45,
    });
  }
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
