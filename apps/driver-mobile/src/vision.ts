import {
  FaceLandmarker,
  FilesetResolver,
  PoseLandmarker,
  type FaceLandmarkerResult,
  type PoseLandmarkerResult,
} from "@mediapipe/tasks-vision";
import type { BaselineGuide, Landmark, VisionFrame } from "./monitor";

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

export function stabilizeOverlayFrame<T extends VisionFrame>(current: T, previous: VisionFrame | null): T {
  if (previous === null) return current;
  return {
    ...current,
    timestampMs: current.timestampMs,
    face: stabilizeLandmarks(current.face, previous.face, 0.0025, 0.38),
    pose: stabilizeLandmarks(current.pose, previous.pose, 0.0035, 0.34),
  };
}

function stabilizeLandmarks(
  current: Landmark[] | null,
  previous: Landmark[] | null,
  deadZone: number,
  response: number,
): Landmark[] | null {
  if (current === null || previous === null || current.length !== previous.length) return current;
  return current.map((point, index) => {
    const prior = previous[index];
    const movement = Math.hypot(point.x - prior.x, point.y - prior.y, point.z - prior.z);
    if (movement <= deadZone) return { ...point, x: prior.x, y: prior.y, z: prior.z };
    return {
      ...point,
      x: prior.x + (point.x - prior.x) * response,
      y: prior.y + (point.y - prior.y) * response,
      z: prior.z + (point.z - prior.z) * response,
    };
  });
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
  torsoTiltDegrees: number | null;
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
  const leftHip = pose?.[23];
  const rightHip = pose?.[24];
  const shoulderCenter = leftShoulder && rightShoulder
    ? midpoint(toCanvasPoint(leftShoulder, width, height), toCanvasPoint(rightShoulder, width, height))
    : null;
  const hipCenter = leftHip && rightHip
    ? midpoint(toCanvasPoint(leftHip, width, height), toCanvasPoint(rightHip, width, height))
    : null;
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
    torsoTiltDegrees: shoulderCenter && hipCenter
      ? roundAngle(Math.atan2(
        Math.abs(hipCenter.x - shoulderCenter.x),
        Math.abs(hipCenter.y - shoulderCenter.y),
      ) * 180 / Math.PI)
      : null,
  };
}

export function drawLandmarks(
  canvas: HTMLCanvasElement,
  video: HTMLVideoElement,
  frame: DetectionFrame,
  alert: boolean,
  showPostureGuides = true,
  baselineGuide: BaselineGuide | null = null,
  baselineDeviated = false,
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
  const shoulderColor = alert ? "rgba(255, 107, 74, .98)" : "rgba(255, 78, 78, .98)";
  const torsoColor = alert ? "rgba(255, 214, 74, .98)" : "rgba(255, 224, 46, .98)";
  const subtle = alert ? "rgba(255, 205, 143, .62)" : "rgba(181, 255, 229, .64)";
  const fineLine = Math.max(1, width / 960);
  const bodyLine = Math.max(1.2, width / 760);

  if (baselineGuide !== null) {
    drawBaselineGuide(context, baselineGuide, width, height, baselineDeviated);
  }

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
  if (showPostureGuides && frame.pose !== null) {
    context.lineWidth = bodyLine;
    context.strokeStyle = subtle;
    context.setLineDash([5, 6]);
    if (frame.pose.length > 24) {
      drawPath(context, frame.pose, [11, 23], width, height);
      drawPath(context, frame.pose, [12, 24], width, height);
    }

    context.strokeStyle = shoulderColor;
    context.setLineDash([]);
    drawPath(context, frame.pose, [11, 12], width, height);
    drawArmAndHandGuides(context, frame.pose, width, height, accent);
    drawShoulderReference(context, frame.pose, width, height, shoulderColor, subtle);
    if (frame.pose.length > 24) drawTorsoAxis(context, frame.face, frame.pose, width, height, torsoColor);

    context.fillStyle = accent;
    for (const index of frame.pose.length > 24 ? [11, 12, 23, 24] : [11, 12]) {
      drawPoint(context, frame.pose[index], width, height, Math.max(1.8, width / 420));
    }
  }
  if (showPostureGuides && frame.face !== null && frame.pose !== null) {
    drawNeckGuide(context, frame.face, frame.pose, width, height, subtle);
  }

  if (showPostureGuides) {
    const angles = calculatePostureOverlayAngles(frame.face, frame.pose, width, height);
    drawAngleLabels(context, frame.face, frame.pose, angles, width, height, alert);
  }
  context.restore();
}

function drawBaselineGuide(
  context: CanvasRenderingContext2D,
  guide: BaselineGuide,
  width: number,
  height: number,
  deviated: boolean,
): void {
  const color = deviated ? "rgba(255, 183, 77, .95)" : "rgba(109, 231, 187, .55)";
  const faceX = normalizedXToMirroredCanvas(guide.faceX, width);
  const faceY = guide.faceY * height;
  const shoulderX = normalizedXToMirroredCanvas(guide.shoulderX, width);
  const shoulderY = guide.shoulderY * height;
  const hipX = normalizedXToMirroredCanvas(guide.hipX, width);
  const hipY = guide.hipY * height;
  const shoulderHalf = Math.max(28, guide.shoulderWidth * width * 0.5);
  const faceRadiusX = Math.max(22, guide.faceWidth * width * 0.55);
  const faceRadiusY = Math.max(30, guide.faceHeight * height * 0.55);

  context.save();
  context.strokeStyle = color;
  context.fillStyle = color;
  context.lineWidth = Math.max(1.5, width / 520);
  context.setLineDash([Math.max(5, width / 100), Math.max(5, width / 100)]);
  context.beginPath();
  context.ellipse(faceX, faceY, faceRadiusX, faceRadiusY, 0, 0, Math.PI * 2);
  context.stroke();
  if (guide.showShoulders) {
    context.beginPath();
    context.moveTo(shoulderX - shoulderHalf, shoulderY);
    context.lineTo(shoulderX + shoulderHalf, shoulderY);
    context.stroke();
  }
  if (guide.showTorso) {
    context.beginPath();
    context.moveTo(shoulderX, shoulderY);
    context.lineTo(hipX, hipY);
    context.stroke();
  }
  context.setLineDash([]);
  context.font = `700 ${Math.max(12, width / 48)}px sans-serif`;
  context.textAlign = "center";
  context.fillText("처음 위치", faceX, Math.max(18, faceY - faceRadiusY - 10));
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

function drawArmAndHandGuides(
  context: CanvasRenderingContext2D,
  pose: Landmark[],
  width: number,
  height: number,
  color: string,
): void {
  const sides = [
    { arm: [11, 13, 15], hand: [15, 17, 19, 21] },
    { arm: [12, 14, 16], hand: [16, 18, 20, 22] },
  ];
  context.save();
  context.strokeStyle = color;
  context.fillStyle = color;
  context.lineWidth = Math.max(2, width / 480);
  context.setLineDash([]);
  for (const side of sides) {
    const armVisible = side.arm.every((index) => pose[index] && (pose[index].visibility ?? 1) >= 0.25);
    if (!armVisible) continue;
    drawPath(context, pose, side.arm, width, height);
    for (const index of side.arm.slice(1)) {
      drawPoint(context, pose[index], width, height, Math.max(2.4, width / 340));
    }
    const visibleHand = side.hand.filter((index) => pose[index] && (pose[index].visibility ?? 1) >= 0.2);
    if (visibleHand.length < 3) continue;
    context.globalAlpha = 0.82;
    for (const index of visibleHand.slice(1)) drawPath(context, pose, [side.hand[0], index], width, height);
    const palm = visibleHand.slice(1).map((index) => toCanvasPoint(pose[index], width, height));
    if (palm.length >= 3) {
      context.beginPath();
      context.moveTo(palm[0].x, palm[0].y);
      palm.slice(1).forEach((point) => context.lineTo(point.x, point.y));
      context.closePath();
      context.globalAlpha = 0.12;
      context.fill();
      context.globalAlpha = 0.82;
      context.stroke();
    }
    for (const index of visibleHand) drawPoint(context, pose[index], width, height, Math.max(2, width / 390));
    context.globalAlpha = 1;
  }
  context.restore();
}

function drawTorsoAxis(
  context: CanvasRenderingContext2D,
  face: Landmark[] | null,
  pose: Landmark[],
  width: number,
  height: number,
  color: string,
): void {
  const shoulderCenter = midpoint(toCanvasPoint(pose[11], width, height), toCanvasPoint(pose[12], width, height));
  const neckStart = face !== null
    ? faceOvalExitToward(face, shoulderCenter, width, height)
    : shoulderCenter;
  const measuredHipCenter = midpoint(toCanvasPoint(pose[23], width, height), toCanvasPoint(pose[24], width, height));
  const availableHeight = Math.max(1, height * 0.96 - shoulderCenter.y);
  const measuredHeight = Math.max(1, measuredHipCenter.y - shoulderCenter.y);
  const visibleRatio = Math.min(1, availableHeight / measuredHeight);
  const hipCenter = {
    x: shoulderCenter.x + (measuredHipCenter.x - shoulderCenter.x) * visibleRatio,
    y: shoulderCenter.y + (measuredHipCenter.y - shoulderCenter.y) * visibleRatio,
  };
  context.strokeStyle = color;
  context.lineWidth = Math.max(2.6, width / 420);
  context.setLineDash([]);
  context.lineJoin = "round";
  context.lineCap = "round";
  context.beginPath();
  context.moveTo(neckStart.x, neckStart.y);
  context.lineTo(shoulderCenter.x, shoulderCenter.y);
  context.lineTo(hipCenter.x, hipCenter.y);
  context.stroke();
}

function faceOvalExitToward(
  face: Landmark[],
  target: { x: number; y: number },
  width: number,
  height: number,
): { x: number; y: number } {
  const points = FACE_OVAL_PATH.map((index) => toCanvasPoint(face[index], width, height));
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const center = { x: (minX + maxX) * 0.5, y: (minY + maxY) * 0.5 };
  const radiusX = Math.max(1, (maxX - minX) * 0.5);
  const radiusY = Math.max(1, (maxY - minY) * 0.5);
  const dx = target.x - center.x;
  const dy = target.y - center.y;
  const scale = 1 / Math.max(Math.sqrt((dx * dx) / (radiusX * radiusX) + (dy * dy) / (radiusY * radiusY)), 1e-6);
  return {
    x: center.x + dx * scale,
    y: center.y + dy * scale,
  };
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
  if (pose && pose.length > 24 && angles.torsoTiltDegrees !== null) {
    const shoulderCenter = midpoint(toCanvasPoint(pose[11], width, height), toCanvasPoint(pose[12], width, height));
    const hipCenter = midpoint(toCanvasPoint(pose[23], width, height), toCanvasPoint(pose[24], width, height));
    const center = midpoint(shoulderCenter, hipCenter);
    labels.push({ text: `상체 축 ${angles.torsoTiltDegrees.toFixed(1)}°`, x: center.x + 8, y: center.y });
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
    const x = normalizedXToMirroredCanvas(point.x, width);
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
  context.arc(normalizedXToMirroredCanvas(point.x, width), point.y * height, radius, 0, Math.PI * 2);
  context.fill();
}

function toCanvasPoint(point: Landmark, width: number, height: number): { x: number; y: number } {
  return { x: normalizedXToMirroredCanvas(point.x, width), y: point.y * height };
}

export function normalizedXToMirroredCanvas(normalizedX: number, canvasWidth: number): number {
  return (1 - normalizedX) * canvasWidth;
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
