import { WAKE_UP_COUNT_THRESHOLDS } from "./wakeUpVideos";

export interface Landmark {
  x: number;
  y: number;
  z: number;
  visibility?: number;
}

export interface VisionFrame {
  timestampMs: number;
  face: Landmark[] | null;
  pose: Landmark[] | null;
}

export type DriverStatus = "IDLE" | "CALIBRATING" | "AWAKE" | "WARNING" | "ALARM" | "NO_FACE";
export type MonitorMode = "DROWSINESS" | "POSTURE";

export interface MonitorSnapshot {
  status: DriverStatus;
  trigger: string;
  message: string;
  faceVisible: boolean;
  poseVisible: boolean;
  eyeAspectRatio: number | null;
  baselineEyeAspectRatio: number | null;
  eyesClosed: boolean;
  closedDurationMs: number;
  headDown: boolean;
  headDownDurationMs: number;
  combinedDurationMs: number;
  bodyCollapseDurationMs: number;
  bodyCollapseCountReady: boolean;
  postureStatus: "WAITING" | "GOOD" | "CHECKING" | "WARNING" | "NO_POSE";
  postureIssue: string;
  postureScore: number | null;
  postureConfidence: number;
  postureMessage: string;
  shoulderTiltDegrees: number | null;
  headLeanDegrees: number | null;
  forwardHeadPercent: number | null;
  cameraViewAngleDegrees: number | null;
  cameraView: "UNKNOWN" | "FRONT" | "OBLIQUE" | "SIDE";
  calibrationProgress: number;
  calibrationRemainingMs: number;
  calibrationStable: boolean;
}

interface PoseMeasurement {
  shoulderTilt: number;
  headOffset: number;
  headHeight: number;
  headForward: number;
  headLeanDegrees: number;
  viewAngle: number;
  confidence: number;
  noseX: number;
  noseY: number;
  shoulderX: number;
  shoulderY: number;
  shoulderWidth: number;
}

interface CalibrationSample {
  ear: number;
  pitch: number;
  pose: PoseMeasurement;
  poseAvailable: boolean;
  faceY: number;
  faceRoll: number;
}

interface Baseline {
  ear: number;
  pitch: number;
  headHeight: number;
  headForward: number;
  shoulderTilt: number;
  headOffset: number;
  viewAngle: number;
  noseX: number;
  noseY: number;
  shoulderX: number;
  shoulderY: number;
  shoulderWidth: number;
  poseAvailable: boolean;
  faceY: number;
  faceRoll: number;
}

interface PostureResult {
  status: MonitorSnapshot["postureStatus"];
  issue: string;
  postureStatus: MonitorSnapshot["postureStatus"];
  postureIssue: string;
  postureScore: number | null;
  postureConfidence: number;
  postureMessage: string;
  shoulderTiltDegrees: number | null;
  headLeanDegrees: number | null;
  forwardHeadPercent: number | null;
  cameraViewAngleDegrees: number | null;
  cameraView: MonitorSnapshot["cameraView"];
}

const RIGHT_EYE = [33, 160, 158, 133, 153, 144] as const;
const LEFT_EYE = [362, 385, 387, 263, 373, 380] as const;
export const CALIBRATION_DURATION_MS = 5_000;
const CALIBRATION_LOSS_GRACE_MS = 450;
const MIN_CALIBRATION_SAMPLES = 20;
const POSTURE_HISTORY_SIZE = 5;

export class DriverMonitor {
  private baseline: Baseline | null = null;
  private calibrationStartedAt: number | null = null;
  private invalidSince: number | null = null;
  private samples: CalibrationSample[] = [];
  private previousSample: CalibrationSample | null = null;
  private eyesClosedSince: number | null = null;
  private headDownSince: number | null = null;
  private faceMissingSince: number | null = null;
  private postureIssueSince: number | null = null;
  private lastPostureIssue = "NONE";
  private poseHistory: PoseMeasurement[] = [];
  private eyesWereClosed = false;
  private headWasDown = false;
  private mode: MonitorMode = "DROWSINESS";
  private active = false;

  begin(mode: MonitorMode = "DROWSINESS"): void {
    this.mode = mode;
    this.active = true;
    this.restartCalibration();
  }

  stop(): void {
    this.active = false;
    this.restartCalibration();
  }

  recalibrate(): void {
    this.restartCalibration();
  }

  hasBaseline(): boolean {
    return this.baseline !== null;
  }

  process(frame: VisionFrame): MonitorSnapshot {
    if (!this.active) return idleSnapshot();
    if (this.baseline === null) return this.calibrate(frame);
    return this.monitor(frame);
  }

  private restartCalibration(): void {
    this.baseline = null;
    this.calibrationStartedAt = null;
    this.invalidSince = null;
    this.samples = [];
    this.previousSample = null;
    this.eyesClosedSince = null;
    this.headDownSince = null;
    this.faceMissingSince = null;
    this.postureIssueSince = null;
    this.lastPostureIssue = "NONE";
    this.poseHistory = [];
    this.eyesWereClosed = false;
    this.headWasDown = false;
  }

  private calibrate(frame: VisionFrame): MonitorSnapshot {
    const requirePose = this.mode === "POSTURE";
    const sample = getCalibrationSample(frame, requirePose);
    const valid = sample !== null && isStableSample(this.previousSample, sample, requirePose);

    if (!valid) {
      if (this.invalidSince === null) this.invalidSince = frame.timestampMs;
      if (frame.timestampMs - this.invalidSince > CALIBRATION_LOSS_GRACE_MS) {
        this.calibrationStartedAt = null;
        this.samples = [];
        this.previousSample = null;
      }
      const progress = this.calibrationStartedAt === null
        ? 0
        : clamp((this.invalidSince - this.calibrationStartedAt) / CALIBRATION_DURATION_MS, 0, 0.99);
      return calibrationSnapshot(
        progress,
        Math.ceil((CALIBRATION_DURATION_MS * (1 - progress)) / 1_000) * 1_000,
        false,
        sample === null
          ? this.mode === "POSTURE"
            ? "얼굴과 양쪽 어깨가 모두 보이도록 휴대폰 위치를 맞춰 주세요."
            : "실제로 사용할 휴대폰 위치에서 얼굴이 보이도록 맞춰 주세요."
          : this.mode === "POSTURE"
            ? "몸을 움직이지 말고 정면을 보세요. 기준 측정을 다시 이어갑니다."
            : "평소 운전 자세를 유지해 주세요. 현재 보이는 각도를 기준으로 측정합니다.",
      );
    }

    this.invalidSince = null;
    this.previousSample = sample;
    if (this.calibrationStartedAt === null) this.calibrationStartedAt = frame.timestampMs;
    this.samples.push(sample);
    const elapsed = frame.timestampMs - this.calibrationStartedAt;
    const progress = clamp(elapsed / CALIBRATION_DURATION_MS, 0, 1);

    if (elapsed >= CALIBRATION_DURATION_MS && this.samples.length >= MIN_CALIBRATION_SAMPLES) {
      this.baseline = buildBaseline(this.samples);
      return this.monitor(frame);
    }

    return calibrationSnapshot(
      progress,
      Math.max(0, CALIBRATION_DURATION_MS - elapsed),
      true,
      this.mode === "POSTURE"
        ? `${getCameraViewLabel(sample.pose.viewAngle)} 촬영 기준을 잡고 있습니다. 평소 앉은 자세를 유지하세요.`
        : "현재 카메라 각도와 눈·고개 위치를 기준으로 잡고 있습니다. 평소 운전 자세를 유지하세요.",
    );
  }

  private monitor(frame: VisionFrame): MonitorSnapshot {
    const baseline = this.baseline;
    if (baseline === null) return this.calibrate(frame);
    const face = frame.face;
    const poseVisible = upperBodyVisible(frame.pose);

    if (!faceVisible(face)) {
      if (this.mode === "DROWSINESS" && baseline.poseAvailable && poseVisible && poseMatchesBaseline(frame.pose, baseline)) {
        this.faceMissingSince = null;
        this.eyesClosedSince = null;
        this.headDownSince = null;
        this.eyesWereClosed = false;
        this.headWasDown = false;
        const measured = measurePose(frame.pose);
        return {
          ...baseSnapshot("AWAKE"),
          trigger: "NONE",
          message: "초기 측정한 운전 각도를 정상 기준으로 감지하고 있습니다.",
          faceVisible: false,
          poseVisible: true,
          baselineEyeAspectRatio: round(baseline.ear, 3),
          postureStatus: "GOOD",
          postureIssue: "NONE",
          postureConfidence: round(measured.confidence, 3),
          postureMessage: "초기 측정 각도와 같은 운전 자세입니다.",
          cameraViewAngleDegrees: round(Math.abs(measured.viewAngle), 1),
          cameraView: cameraView(measured.viewAngle),
          calibrationProgress: 1,
          calibrationRemainingMs: 0,
          calibrationStable: true,
        };
      }
      if (this.faceMissingSince === null) this.faceMissingSince = frame.timestampMs;
      const missingMs = frame.timestampMs - this.faceMissingSince;
      this.eyesClosedSince = null;
      this.headDownSince = null;
      this.eyesWereClosed = false;
      this.headWasDown = false;
      const status: DriverStatus = missingMs >= 3_000 ? "ALARM" : missingMs >= 1_500 ? "WARNING" : "NO_FACE";
      return {
        ...baseSnapshot(status),
        trigger: "FACE_MISSING",
        message: missingMs >= 1_500
          ? "운전자 얼굴이 보이지 않습니다. 전방과 휴대폰 위치를 확인하세요."
          : "얼굴을 카메라 중앙에 보여 주세요.",
        poseVisible,
        postureStatus: "NO_POSE",
        postureMessage: "얼굴을 다시 화면에 맞춰 주세요.",
        cameraViewAngleDegrees: round(Math.abs(baseline.viewAngle), 1),
        cameraView: cameraView(baseline.viewAngle),
        baselineEyeAspectRatio: round(baseline.ear, 3),
      };
    }

    this.faceMissingSince = null;
    const ear = eyeAspectRatio(face);
    const closeThreshold = clamp(baseline.ear * 0.68, 0.13, 0.23);
    const openThreshold = closeThreshold + 0.025;
    const eyesClosed = ear < (this.eyesWereClosed ? openThreshold : closeThreshold);
    if (eyesClosed && !this.eyesWereClosed) this.eyesClosedSince = frame.timestampMs;
    if (!eyesClosed) this.eyesClosedSince = null;
    this.eyesWereClosed = eyesClosed;
    const closedDurationMs = eyesClosed && this.eyesClosedSince !== null
      ? frame.timestampMs - this.eyesClosedSince
      : 0;

    const pitch = headPitch(face);
    const headThreshold = baseline.pitch + (this.headWasDown ? 0.03 : 0.045);
    const headDown = pitch > headThreshold;
    if (headDown && !this.headWasDown) this.headDownSince = frame.timestampMs;
    if (!headDown) this.headDownSince = null;
    this.headWasDown = headDown;
    const headDownDurationMs = headDown && this.headDownSince !== null
      ? frame.timestampMs - this.headDownSince
      : 0;
    const combinedDurationMs = eyesClosed && headDown
      ? Math.min(closedDurationMs, headDownDurationMs)
      : 0;

    let status: DriverStatus = "AWAKE";
    let trigger = "NONE";
    let message = "정상적으로 주시하고 있습니다.";
    if (combinedDurationMs >= 1_400) {
      status = "ALARM"; trigger = "EYES_AND_HEAD"; message = "눈 감김과 고개 숙임이 함께 감지됐습니다. 즉시 안전한 곳에 정차하세요.";
    } else if (closedDurationMs >= 3_000) {
      status = "ALARM"; trigger = "EYES_ONLY"; message = "눈 감김이 오래 지속됐습니다. 즉시 안전한 곳에 정차하세요.";
    } else if (headDownDurationMs >= 5_000) {
      status = "ALARM"; trigger = "HEAD_ONLY"; message = "고개 숙임이 감지되었습니다. 즉시 안전한 곳에 정차하세요.";
    } else if (combinedDurationMs >= 650) {
      status = "WARNING"; trigger = "EYES_AND_HEAD"; message = "눈 감김과 고개 숙임이 동시에 감지됐습니다.";
    } else if (closedDurationMs >= 1_500) {
      status = "WARNING"; trigger = "EYES_ONLY"; message = "눈 감김이 감지되었습니다.";
    } else if (headDownDurationMs >= 2_000) {
      status = "WARNING"; trigger = "HEAD_ONLY"; message = "고개 숙임이 감지되었습니다.";
    }

    const posture = this.mode === "POSTURE"
      ? this.measurePosture(frame.pose, frame.timestampMs)
      : drowsinessFocusResult(baseline.viewAngle);
    return {
      status,
      trigger,
      message,
      faceVisible: true,
      poseVisible,
      eyeAspectRatio: round(ear, 3),
      baselineEyeAspectRatio: round(baseline.ear, 3),
      eyesClosed,
      closedDurationMs,
      headDown,
      headDownDurationMs,
      combinedDurationMs,
      bodyCollapseDurationMs: 0,
      bodyCollapseCountReady: false,
      postureStatus: posture.postureStatus,
      postureIssue: posture.postureIssue,
      postureScore: posture.postureScore,
      postureConfidence: posture.postureConfidence,
      postureMessage: posture.postureMessage,
      shoulderTiltDegrees: posture.shoulderTiltDegrees,
      headLeanDegrees: posture.headLeanDegrees,
      forwardHeadPercent: posture.forwardHeadPercent,
      cameraViewAngleDegrees: posture.cameraViewAngleDegrees,
      cameraView: posture.cameraView,
      calibrationProgress: 1,
      calibrationRemainingMs: 0,
      calibrationStable: true,
    };
  }

  private measurePosture(pose: Landmark[] | null, now: number): PostureResult {
    const baseline = this.baseline;
    if (baseline === null || !upperBodyVisible(pose)) {
      this.postureIssueSince = null;
      this.lastPostureIssue = "NONE";
      this.poseHistory = [];
      return missingPostureResult();
    }
    const raw = measurePose(pose);
    this.poseHistory.push(raw);
    if (this.poseHistory.length > POSTURE_HISTORY_SIZE) this.poseHistory.shift();
    const measured = medianPose(this.poseHistory);
    const viewDrift = angleDistance(measured.viewAngle, baseline.viewAngle);
    const viewConfidence = clamp(1 - Math.max(0, viewDrift - 18) / 42, 0.25, 1);
    const confidence = clamp(measured.confidence * viewConfidence, 0, 1);
    const sideTolerance = 1 + clamp(Math.abs(measured.viewAngle) / 90, 0, 1) * 0.35;
    const shoulderDelta = Math.abs(measured.shoulderTilt - baseline.shoulderTilt);
    const headOffsetDelta = measured.headOffset - baseline.headOffset;
    const headLeanDelta = Math.abs(Math.atan2(headOffsetDelta, Math.max(measured.headHeight, 1e-6)) * 180 / Math.PI);
    const slouchRatio = Math.max(0, (baseline.headHeight - measured.headHeight) / Math.max(baseline.headHeight, 1e-6));
    const forwardDelta = measured.headForward - baseline.headForward;
    const issues: Array<[string, number]> = [
      ["SHOULDER_TILT", Math.max(0, (shoulderDelta - 5 * sideTolerance) / (9 * sideTolerance))],
      ["LEANING", Math.max(0, (headLeanDelta - 5 * sideTolerance) / (10 * sideTolerance))],
      ["SLOUCHING", Math.max(0, (slouchRatio - 0.10) / 0.20)],
      ["FORWARD_HEAD", Math.max(0, (forwardDelta - 0.11 * sideTolerance) / (0.20 * sideTolerance))],
    ];
    const [candidate, severity] = issues.reduce((best, current) => current[1] > best[1] ? current : best);
    const lowConfidence = confidence < 0.42 || viewDrift > 48;
    const issue = lowConfidence ? "CAMERA_ANGLE" : severity > 0 ? candidate : "NONE";
    if (issue !== this.lastPostureIssue) {
      this.lastPostureIssue = issue;
      this.postureIssueSince = issue === "NONE" || issue === "CAMERA_ANGLE" ? null : now;
    }
    const badMs = this.postureIssueSince === null ? 0 : now - this.postureIssueSince;
    const status: MonitorSnapshot["postureStatus"] = issue === "NONE" ? "GOOD" : issue === "CAMERA_ANGLE" ? "CHECKING" : badMs >= 2_000 ? "WARNING" : "CHECKING";
    return {
      status,
      issue,
      postureStatus: status,
      postureIssue: issue,
      postureScore: lowConfidence ? null : Math.round(100 * (1 - clamp(severity, 0, 1))),
      postureConfidence: round(confidence, 3),
      postureMessage: postureCorrectionMessage(issue, shoulderDelta, headLeanDelta, slouchRatio, forwardDelta, viewDrift),
      shoulderTiltDegrees: round(measured.shoulderTilt - baseline.shoulderTilt, 1),
      headLeanDegrees: round(headLeanDelta, 1),
      forwardHeadPercent: round(forwardDelta * 100, 1),
      cameraViewAngleDegrees: round(Math.abs(measured.viewAngle), 1),
      cameraView: cameraView(measured.viewAngle),
    };
  }
}

export function eyeAspectRatio(face: Landmark[]): number {
  return (singleEyeAspectRatio(face, RIGHT_EYE) + singleEyeAspectRatio(face, LEFT_EYE)) / 2;
}

export function headPitch(face: Landmark[]): number {
  const eyeY = (face[33].y + face[133].y + face[263].y + face[362].y) / 4;
  const height = Math.max(distance(face[10], face[152]), 1e-6);
  return (face[1].y - eyeY) / height;
}

function getCalibrationSample(frame: VisionFrame, requirePose: boolean): CalibrationSample | null {
  if (!faceVisible(frame.face)) return null;
  if (requirePose && !upperBodyVisible(frame.pose)) return null;
  let pose: PoseMeasurement;
  let poseAvailable = false;
  if (upperBodyVisible(frame.pose)) {
    pose = measurePose(frame.pose);
    poseAvailable = true;
  } else {
    pose = faceOnlyMeasurement(frame.face);
  }
  return {
    ear: eyeAspectRatio(frame.face),
    pitch: headPitch(frame.face),
    pose,
    poseAvailable,
    faceY: frame.face[1].y,
    faceRoll: faceRoll(frame.face),
  };
}

function isStableSample(previous: CalibrationSample | null, current: CalibrationSample, requirePose: boolean): boolean {
  if (current.ear < 0.16) return false;
  if (requirePose && (Math.abs(current.pose.shoulderTilt) > 30 || Math.abs(current.pose.headOffset) > 0.85)) return false;
  if (requirePose && (current.pose.headHeight < 0.2 || current.pose.headHeight > 3.5)) return false;
  if (requirePose && current.pose.confidence < 0.42) return false;
  if (previous === null) return true;
  const faceMove = Math.hypot(current.pose.noseX - previous.pose.noseX, current.pose.noseY - previous.pose.noseY);
  if (!requirePose) return faceMove < 0.065;
  const shoulderMove = Math.hypot(current.pose.shoulderX - previous.pose.shoulderX, current.pose.shoulderY - previous.pose.shoulderY);
  const scaleChange = Math.abs(current.pose.shoulderWidth - previous.pose.shoulderWidth) / Math.max(previous.pose.shoulderWidth, 1e-6);
  return faceMove < 0.065 && shoulderMove < 0.055 && scaleChange < 0.18;
}

function buildBaseline(samples: CalibrationSample[]): Baseline {
  return {
    ear: median(samples.map((sample) => sample.ear)),
    pitch: median(samples.map((sample) => sample.pitch)),
    headHeight: median(samples.map((sample) => sample.pose.headHeight)),
    headForward: median(samples.map((sample) => sample.pose.headForward)),
    shoulderTilt: median(samples.map((sample) => sample.pose.shoulderTilt)),
    headOffset: median(samples.map((sample) => sample.pose.headOffset)),
    viewAngle: circularMedian(samples.map((sample) => sample.pose.viewAngle)),
    noseX: median(samples.map((sample) => sample.pose.noseX)),
    noseY: median(samples.map((sample) => sample.pose.noseY)),
    shoulderX: median(samples.map((sample) => sample.pose.shoulderX)),
    shoulderY: median(samples.map((sample) => sample.pose.shoulderY)),
    shoulderWidth: median(samples.map((sample) => sample.pose.shoulderWidth)),
    poseAvailable: samples.filter((sample) => sample.poseAvailable).length >= Math.ceil(samples.length * 0.6),
    faceY: median(samples.map((sample) => sample.faceY)),
    faceRoll: circularMedian(samples.map((sample) => sample.faceRoll)),
  };
}

function faceOnlyMeasurement(face: Landmark[]): PoseMeasurement {
  const faceHeight = Math.max(distance(face[10], face[152]), 0.2);
  return {
    shoulderTilt: 0,
    headOffset: 0,
    headHeight: faceHeight,
    headForward: 0,
    headLeanDegrees: faceRoll(face),
    viewAngle: 0,
    confidence: 1,
    noseX: face[1].x,
    noseY: face[1].y,
    shoulderX: face[1].x,
    shoulderY: Math.min(1, face[152].y + faceHeight),
    shoulderWidth: 0.4,
  };
}

function faceRoll(face: Landmark[]): number {
  const left = face[33];
  const right = face[263];
  return normalizeAngle(Math.atan2(right.y - left.y, right.x - left.x) * 180 / Math.PI);
}

function drowsinessFocusResult(viewAngle: number): PostureResult {
  return {
    status: "GOOD",
    issue: "NONE",
    postureStatus: "GOOD",
    postureIssue: "NONE",
    postureScore: null,
    postureConfidence: 1,
    postureMessage: "눈 감김과 고개 숙임을 확인하고 있습니다.",
    shoulderTiltDegrees: null,
    headLeanDegrees: null,
    forwardHeadPercent: null,
    cameraViewAngleDegrees: round(Math.abs(viewAngle), 1),
    cameraView: cameraView(viewAngle),
  };
}

function faceVisible(face: Landmark[] | null): face is Landmark[] {
  return face !== null && face.length > 387;
}

function upperBodyVisible(pose: Landmark[] | null): pose is Landmark[] {
  if (pose === null || pose.length <= 12) return false;
  const nose = visibility(pose[0]);
  const ears = [visibility(pose[7]), visibility(pose[8])].sort((a, b) => b - a);
  const shoulders = [visibility(pose[11]), visibility(pose[12])].sort((a, b) => b - a);
  return nose >= 0.35 && ears[0] >= 0.45 && ears[1] >= 0.08 && shoulders[0] >= 0.5 && shoulders[1] >= 0.12;
}

function poseMatchesBaseline(pose: Landmark[], baseline: Baseline): boolean {
  const measured = measurePose(pose);
  const scale = Math.max(baseline.shoulderWidth, measured.shoulderWidth, 0.12);
  const noseShift = Math.hypot(measured.noseX - baseline.noseX, measured.noseY - baseline.noseY);
  const shoulderShift = Math.hypot(measured.shoulderX - baseline.shoulderX, measured.shoulderY - baseline.shoulderY);
  const heightChange = Math.abs(measured.headHeight - baseline.headHeight) / Math.max(Math.abs(baseline.headHeight), 0.15);
  return angleDistance(measured.viewAngle, baseline.viewAngle) <= 28
    && noseShift <= Math.max(0.12, scale * 0.65)
    && shoulderShift <= Math.max(0.10, scale * 0.5)
    && heightChange <= 0.38
    && measured.confidence >= 0.38;
}

function measurePose(pose: Landmark[]): PoseMeasurement {
  const nose = pose[0];
  const leftEar = pose[7];
  const rightEar = pose[8];
  const leftShoulder = pose[11];
  const rightShoulder = pose[12];
  const shoulderCenter = weightedPair(leftShoulder, rightShoulder);
  const headCenter = weightedPair(leftEar, rightEar);
  const shoulderDx = rightShoulder.x - leftShoulder.x;
  const shoulderDz = rightShoulder.z - leftShoulder.z;
  const shoulderHorizontal = Math.max(Math.hypot(shoulderDx, shoulderDz), 1e-6);
  const shoulderWidth = Math.max(distance3d(leftShoulder, rightShoulder), 1e-6);
  const shoulderAxisX = shoulderDx / shoulderHorizontal;
  const shoulderAxisZ = shoulderDz / shoulderHorizontal;
  let forwardAxisX = -shoulderAxisZ;
  let forwardAxisZ = shoulderAxisX;
  const faceForwardX = nose.x - headCenter.x;
  const faceForwardZ = nose.z - headCenter.z;
  const headVectorX = headCenter.x - shoulderCenter.x;
  const headVectorZ = headCenter.z - shoulderCenter.z;
  let orientation = faceForwardX * forwardAxisX + faceForwardZ * forwardAxisZ;
  if (Math.abs(orientation) < 1e-6) orientation = headVectorX * forwardAxisX + headVectorZ * forwardAxisZ;
  if (orientation < 0) {
    forwardAxisX *= -1;
    forwardAxisZ *= -1;
  }
  const headOffset = (headVectorX * shoulderAxisX + headVectorZ * shoulderAxisZ) / shoulderHorizontal;
  const headHeight = (shoulderCenter.y - headCenter.y) / shoulderHorizontal;
  const headForward = (headVectorX * forwardAxisX + headVectorZ * forwardAxisZ) / shoulderHorizontal;
  const headLeanDegrees = Math.atan2(headOffset, Math.max(headHeight, 1e-6)) * 180 / Math.PI;
  const viewAngle = Math.atan2(shoulderDz, Math.abs(shoulderDx) + 1e-6) * 180 / Math.PI;
  const confidence = poseMeasurementConfidence(nose, leftEar, rightEar, leftShoulder, rightShoulder);
  return {
    shoulderTilt: Math.atan2(rightShoulder.y - leftShoulder.y, shoulderHorizontal) * 180 / Math.PI,
    headOffset,
    headHeight,
    headForward,
    headLeanDegrees,
    viewAngle,
    confidence,
    noseX: nose.x,
    noseY: nose.y,
    shoulderX: shoulderCenter.x,
    shoulderY: shoulderCenter.y,
    shoulderWidth,
  };
}

function singleEyeAspectRatio(face: Landmark[], indices: readonly number[]): number {
  const [first, upperOuter, upperInner, last, lowerInner, lowerOuter] = indices.map((index) => face[index]);
  const horizontal = Math.max(distance(first, last), 1e-6);
  return (distance(upperOuter, lowerOuter) + distance(upperInner, lowerInner)) / (2 * horizontal);
}

function distance(a: Landmark, b: Landmark): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function distance3d(a: Landmark, b: Landmark): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function visibility(point: Landmark): number {
  return clamp(point.visibility ?? 1, 0, 1);
}

function weightedPair(first: Landmark, second: Landmark): Landmark {
  const firstWeight = Math.max(0.05, visibility(first));
  const secondWeight = Math.max(0.05, visibility(second));
  const total = firstWeight + secondWeight;
  return {
    x: (first.x * firstWeight + second.x * secondWeight) / total,
    y: (first.y * firstWeight + second.y * secondWeight) / total,
    z: (first.z * firstWeight + second.z * secondWeight) / total,
    visibility: Math.max(firstWeight, secondWeight),
  };
}

function poseMeasurementConfidence(nose: Landmark, leftEar: Landmark, rightEar: Landmark, leftShoulder: Landmark, rightShoulder: Landmark): number {
  const nearEar = Math.max(visibility(leftEar), visibility(rightEar));
  const farEar = Math.min(visibility(leftEar), visibility(rightEar));
  const nearShoulder = Math.max(visibility(leftShoulder), visibility(rightShoulder));
  const farShoulder = Math.min(visibility(leftShoulder), visibility(rightShoulder));
  return clamp(
    visibility(nose) * 0.2 + nearEar * 0.22 + farEar * 0.08 + nearShoulder * 0.3 + farShoulder * 0.2,
    0,
    1,
  );
}

function medianPose(samples: PoseMeasurement[]): PoseMeasurement {
  const field = (key: keyof PoseMeasurement) => median(samples.map((sample) => sample[key] as number));
  return {
    shoulderTilt: field("shoulderTilt"),
    headOffset: field("headOffset"),
    headHeight: field("headHeight"),
    headForward: field("headForward"),
    headLeanDegrees: field("headLeanDegrees"),
    viewAngle: circularMedian(samples.map((sample) => sample.viewAngle)),
    confidence: field("confidence"),
    noseX: field("noseX"),
    noseY: field("noseY"),
    shoulderX: field("shoulderX"),
    shoulderY: field("shoulderY"),
    shoulderWidth: field("shoulderWidth"),
  };
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function circularMedian(values: number[]): number {
  if (values.length === 0) return 0;
  const reference = values[0];
  return median(values.map((value) => reference + normalizeAngle(value - reference)));
}

function normalizeAngle(value: number): number {
  let normalized = value;
  while (normalized > 90) normalized -= 180;
  while (normalized < -90) normalized += 180;
  return normalized;
}

function angleDistance(first: number, second: number): number {
  return Math.abs(normalizeAngle(first - second));
}

function cameraView(angle: number): MonitorSnapshot["cameraView"] {
  const absolute = Math.abs(angle);
  return absolute >= 58 ? "SIDE" : absolute >= 25 ? "OBLIQUE" : "FRONT";
}

function getCameraViewLabel(angle: number): string {
  return { FRONT: "정면", OBLIQUE: "사선", SIDE: "측면", UNKNOWN: "현재" }[cameraView(angle)];
}

function postureCorrectionMessage(issue: string, shoulderDegrees: number, headLeanDegrees: number, slouchRatio: number, forwardRatio: number, viewDrift: number): string {
  if (issue === "CAMERA_ANGLE") return `기준 촬영 각도와 ${Math.round(viewDrift)}° 차이입니다. 현재 각도로 다시 측정해 주세요.`;
  if (issue === "SHOULDER_TILT") return `어깨 높이 차이를 약 ${shoulderDegrees.toFixed(1)}° 줄여 수평에 맞추세요.`;
  if (issue === "LEANING") return `머리 중심 기울기 ${headLeanDegrees.toFixed(1)}°를 0°에 가깝게 맞추세요.`;
  if (issue === "SLOUCHING") return `상체와 머리 높이를 기준보다 약 ${(slouchRatio * 100).toFixed(0)}% 올리세요.`;
  if (issue === "FORWARD_HEAD") return `머리를 어깨 폭의 약 ${Math.max(0, forwardRatio * 100).toFixed(0)}%만큼 뒤로 당기세요.`;
  return "3D 개인 기준 자세가 안정적입니다.";
}

function missingPostureResult(): PostureResult {
  return {
    status: "NO_POSE",
    issue: "POSE_MISSING",
    postureStatus: "NO_POSE",
    postureIssue: "POSE_MISSING",
    postureScore: null,
    postureConfidence: 0,
    postureMessage: "얼굴과 어깨가 한쪽이라도 충분히 보이게 카메라를 맞춰 주세요.",
    shoulderTiltDegrees: null,
    headLeanDegrees: null,
    forwardHeadPercent: null,
    cameraViewAngleDegrees: null,
    cameraView: "UNKNOWN",
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function baseSnapshot(status: DriverStatus): MonitorSnapshot {
  return {
    status,
    trigger: "NONE",
    message: "",
    faceVisible: false,
    poseVisible: false,
    eyeAspectRatio: null,
    baselineEyeAspectRatio: null,
    eyesClosed: false,
    closedDurationMs: 0,
    headDown: false,
    headDownDurationMs: 0,
    combinedDurationMs: 0,
    bodyCollapseDurationMs: 0,
    bodyCollapseCountReady: false,
    postureStatus: "WAITING",
    postureIssue: "NONE",
    postureScore: null,
    postureConfidence: 0,
    postureMessage: "기준 측정 전입니다.",
    shoulderTiltDegrees: null,
    headLeanDegrees: null,
    forwardHeadPercent: null,
    cameraViewAngleDegrees: null,
    cameraView: "UNKNOWN",
    calibrationProgress: 0,
    calibrationRemainingMs: CALIBRATION_DURATION_MS,
    calibrationStable: false,
  };
}

function idleSnapshot(): MonitorSnapshot {
  return { ...baseSnapshot("IDLE"), message: "시작을 누르면 5초 기준 측정 후 감지를 시작합니다." };
}

function calibrationSnapshot(progress: number, remainingMs: number, stable: boolean, message: string): MonitorSnapshot {
  return {
    ...baseSnapshot("CALIBRATING"),
    trigger: "CALIBRATION",
    message,
    faceVisible: stable,
    poseVisible: stable,
    calibrationProgress: progress,
    calibrationRemainingMs: remainingMs,
    calibrationStable: stable,
  };
}
