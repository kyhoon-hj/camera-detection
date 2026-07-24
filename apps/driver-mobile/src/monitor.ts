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

export interface BaselineGuide {
  faceX: number;
  faceY: number;
  faceWidth: number;
  faceHeight: number;
  shoulderX: number;
  shoulderY: number;
  shoulderWidth: number;
  hipX: number;
  hipY: number;
  showShoulders: boolean;
  showTorso: boolean;
}

export type DriverStatus = "IDLE" | "CALIBRATING" | "NORMAL" | "CAUTION" | "WARNING" | "DANGER" | "NO_FACE";
export type MonitorMode = "DROWSINESS" | "POSTURE" | "STUDY";

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
  baselineDeviated: boolean;
  baselineGuide: BaselineGuide | null;
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
  torsoLeanDegrees: number | null;
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
  hipX: number;
  hipY: number;
  torsoSide: number;
  torsoForward: number;
  torsoAvailable: boolean;
}

interface CalibrationSample {
  ear: number;
  rightEar: number;
  leftEar: number;
  pitch: number;
  pose: PoseMeasurement;
  poseAvailable: boolean;
  faceX: number;
  faceY: number;
  faceWidth: number;
  faceHeight: number;
  faceRoll: number;
}

interface Baseline {
  ear: number;
  rightEar: number;
  leftEar: number;
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
  hipX: number;
  hipY: number;
  torsoSide: number;
  torsoForward: number;
  torsoAvailable: boolean;
  poseAvailable: boolean;
  faceX: number;
  faceY: number;
  faceWidth: number;
  faceHeight: number;
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
  torsoLeanDegrees: number | null;
  forwardHeadPercent: number | null;
  cameraViewAngleDegrees: number | null;
  cameraView: MonitorSnapshot["cameraView"];
}

const RIGHT_EYE = [33, 160, 158, 133, 153, 144] as const;
const LEFT_EYE = [362, 385, 387, 263, 373, 380] as const;
export const CALIBRATION_DURATION_MS = 5_000;
export const DROWSINESS_STAGE_THRESHOLDS = {
  cautionMs: 1_000,
  warningMs: 2_000,
  dangerMs: 3_000,
} as const;
const CALIBRATION_LOSS_GRACE_MS = 1_200;
const HEAD_DOWN_CONFIRM_MS = 500;
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
  private headDownCandidateSince: number | null = null;
  private faceMissingSince: number | null = null;
  private postureIssueSince: number | null = null;
  private lastPostureIssue = "NONE";
  private poseHistory: PoseMeasurement[] = [];
  private eyesWereClosed = false;
  private headWasDown = false;
  private mode: MonitorMode = "DROWSINESS";
  private active = false;
  private calibrationDurationMs = CALIBRATION_DURATION_MS;

  begin(mode: MonitorMode = "DROWSINESS", calibrationDurationMs = CALIBRATION_DURATION_MS): void {
    this.mode = mode;
    this.calibrationDurationMs = clamp(calibrationDurationMs, 1_000, CALIBRATION_DURATION_MS);
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

  resetTransientDetection(): void {
    this.eyesClosedSince = null;
    this.headDownSince = null;
    this.headDownCandidateSince = null;
    this.faceMissingSince = null;
    this.postureIssueSince = null;
    this.lastPostureIssue = "NONE";
    this.poseHistory = [];
    this.eyesWereClosed = false;
    this.headWasDown = false;
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
    this.headDownCandidateSince = null;
    this.faceMissingSince = null;
    this.postureIssueSince = null;
    this.lastPostureIssue = "NONE";
    this.poseHistory = [];
    this.eyesWereClosed = false;
    this.headWasDown = false;
  }

  private calibrate(frame: VisionFrame): MonitorSnapshot {
    const requirePose = this.mode !== "DROWSINESS";
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
        : clamp((this.invalidSince - this.calibrationStartedAt) / this.calibrationDurationMs, 0, 0.99);
      return calibrationSnapshot(
        progress,
        Math.ceil((this.calibrationDurationMs * (1 - progress)) / 1_000) * 1_000,
        false,
        sample === null
          ? requirePose
            ? "얼굴, 양쪽 어깨와 허리선이 모두 보이도록 휴대폰 위치를 맞춰 주세요."
            : "실제로 사용할 휴대폰 위치에서 얼굴이 보이도록 맞춰 주세요."
          : requirePose
            ? "몸을 움직이지 말고 정면을 보세요. 기준 측정을 다시 이어갑니다."
            : "평소 운전 자세를 유지해 주세요. 현재 보이는 각도를 기준으로 측정합니다.",
      );
    }

    if (this.invalidSince !== null && this.calibrationStartedAt !== null) {
      this.calibrationStartedAt += frame.timestampMs - this.invalidSince;
    }
    this.invalidSince = null;
    this.previousSample = sample;
    if (this.calibrationStartedAt === null) this.calibrationStartedAt = frame.timestampMs;
    this.samples.push(sample);
    const elapsed = frame.timestampMs - this.calibrationStartedAt;
    const progress = clamp(elapsed / this.calibrationDurationMs, 0, 1);

    if (elapsed >= this.calibrationDurationMs && this.samples.length >= MIN_CALIBRATION_SAMPLES) {
      this.baseline = buildBaseline(this.samples);
      return this.monitor(frame);
    }

    return calibrationSnapshot(
      progress,
      Math.max(0, this.calibrationDurationMs - elapsed),
      true,
      requirePose
        ? `${getCameraViewLabel(sample.pose.viewAngle)} 촬영 기준으로 어깨선과 목-허리 상체 축을 잡고 있습니다.`
        : "현재 카메라 각도와 눈·고개 위치를 기준으로 잡고 있습니다. 평소 운전 자세를 유지하세요.",
    );
  }

  private monitor(frame: VisionFrame): MonitorSnapshot {
    const baseline = this.baseline;
    if (baseline === null) return this.calibrate(frame);
    const face = frame.face;
    const pose = frame.pose;
    const poseVisible = upperBodyVisible(pose);

    if (!faceVisible(face)) {
      if (this.mode !== "POSTURE" && baseline.poseAvailable && upperBodyVisible(pose) && poseMatchesBaseline(pose, baseline)) {
        this.faceMissingSince = null;
        this.eyesClosedSince = null;
        this.headDownSince = null;
        this.headDownCandidateSince = null;
        this.eyesWereClosed = false;
        this.headWasDown = false;
        const measured = measurePose(pose);
        return {
          ...baseSnapshot("NORMAL"),
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
      this.headDownCandidateSince = null;
      this.eyesWereClosed = false;
      this.headWasDown = false;
      const status: DriverStatus = missingMs >= DROWSINESS_STAGE_THRESHOLDS.dangerMs
        ? "DANGER"
        : missingMs >= DROWSINESS_STAGE_THRESHOLDS.warningMs
          ? "WARNING"
          : missingMs >= DROWSINESS_STAGE_THRESHOLDS.cautionMs
            ? "CAUTION"
            : "NO_FACE";
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
    const currentPose = upperBodyVisible(pose) ? measurePose(pose) : null;
    const [rightEar, leftEar] = eyeAspectRatios(face);
    const ear = (rightEar + leftEar) / 2;
    const viewAngle = Math.abs(currentPose?.viewAngle ?? baseline.viewAngle);
    const sideFactor = clamp((viewAngle - 20) / 50, 0, 1);
    const closeRatio = 0.68 - sideFactor * 0.22;
    const reopenRatioMargin = this.eyesWereClosed ? 0.02 : 0;
    const rightRatioFromBaseline = rightEar / Math.max(baseline.rightEar, 1e-6);
    const leftRatioFromBaseline = leftEar / Math.max(baseline.leftEar, 1e-6);
    const eyesClosed = rightRatioFromBaseline < closeRatio + reopenRatioMargin
      && leftRatioFromBaseline < closeRatio + reopenRatioMargin;
    if (eyesClosed && !this.eyesWereClosed) this.eyesClosedSince = frame.timestampMs;
    if (!eyesClosed) this.eyesClosedSince = null;
    this.eyesWereClosed = eyesClosed;
    const closedDurationMs = eyesClosed && this.eyesClosedSince !== null
      ? frame.timestampMs - this.eyesClosedSince
      : 0;

    const pitch = headPitch(face);
    const headDownCandidate = detectHeadDown(pitch, currentPose, baseline, this.headWasDown);
    if (headDownCandidate && this.headDownCandidateSince === null) this.headDownCandidateSince = frame.timestampMs;
    if (!headDownCandidate) this.headDownCandidateSince = null;
    const headDown = headDownCandidate
      && this.headDownCandidateSince !== null
      && frame.timestampMs - this.headDownCandidateSince >= HEAD_DOWN_CONFIRM_MS;
    const baselineDeviated = this.mode !== "POSTURE"
      && currentPose !== null
      && baseline.poseAvailable
      && hasBaselineDeviation(currentPose, baseline);
    if (headDown && !this.headWasDown) this.headDownSince = this.headDownCandidateSince;
    if (!headDown) this.headDownSince = null;
    this.headWasDown = headDown;
    const headDownDurationMs = headDown && this.headDownSince !== null
      ? frame.timestampMs - this.headDownSince
      : 0;
    const combinedDurationMs = eyesClosed && headDown
      ? Math.min(closedDurationMs, headDownDurationMs)
      : 0;

    let status: DriverStatus = "NORMAL";
    let trigger = "NONE";
    let message = "정상적으로 주시하고 있습니다.";
    const eventDurationMs = Math.max(closedDurationMs, headDownDurationMs);
    if (eventDurationMs >= DROWSINESS_STAGE_THRESHOLDS.cautionMs) {
      trigger = eyesClosed && headDown ? "EYES_AND_HEAD" : eyesClosed ? "EYES_ONLY" : "HEAD_ONLY";
      if (eventDurationMs >= DROWSINESS_STAGE_THRESHOLDS.dangerMs) {
        status = "DANGER";
        message = trigger === "EYES_AND_HEAD"
          ? "눈 감김과 고개 숙임이 계속되고 있습니다. 즉시 안전한 곳에 정차하세요."
          : trigger === "EYES_ONLY"
            ? "눈 감김이 3초 이상 지속되고 있습니다. 즉시 눈을 뜨고 안전을 확인하세요."
            : "고개 숙임이 3초 이상 지속되고 있습니다. 즉시 고개를 들고 안전을 확인하세요.";
      } else if (eventDurationMs >= DROWSINESS_STAGE_THRESHOLDS.warningMs) {
        status = "WARNING";
        message = trigger === "EYES_AND_HEAD"
          ? "눈 감김과 고개 숙임이 감지됐습니다. 경고가 누적됩니다."
          : trigger === "EYES_ONLY"
            ? "눈 감김이 2초 이상 감지됐습니다."
            : "고개 숙임이 2초 이상 감지됐습니다.";
      } else {
        status = "CAUTION";
        message = trigger === "EYES_AND_HEAD"
          ? "눈을 뜨고 고개를 들어 주세요."
          : trigger === "EYES_ONLY"
            ? "눈을 떠 주세요."
            : "고개를 들어 주세요.";
      }
    }

    const posture = this.mode !== "DROWSINESS"
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
      baselineDeviated,
      baselineGuide: {
        faceX: baseline.faceX,
        faceY: baseline.faceY,
        faceWidth: baseline.faceWidth,
        faceHeight: baseline.faceHeight,
        shoulderX: baseline.shoulderX,
        shoulderY: baseline.shoulderY,
        shoulderWidth: baseline.shoulderWidth,
        hipX: baseline.hipX,
        hipY: baseline.hipY,
        showShoulders: baseline.poseAvailable,
        showTorso: baseline.torsoAvailable,
      },
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
      torsoLeanDegrees: posture.torsoLeanDegrees,
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
    const armGestureActive = armOrHandGestureActive(pose);
    const raw = measurePose(pose);
    this.poseHistory.push(raw);
    if (this.poseHistory.length > POSTURE_HISTORY_SIZE) this.poseHistory.shift();
    const measured = medianPose(this.poseHistory);
    const viewDrift = angleDistance(measured.viewAngle, baseline.viewAngle);
    const viewConfidence = clamp(1 - Math.max(0, viewDrift - 18) / 42, 0.25, 1);
    const confidence = clamp(measured.confidence * viewConfidence, 0, 1);
    const sideTolerance = 1 + clamp(Math.abs(measured.viewAngle) / 90, 0, 1) * 0.35;
    const shoulderDelta = Math.abs(measured.shoulderTilt - baseline.shoulderTilt);
    // Side-view depth perspective can look like a large shoulder height gap.
    // Only use screen-space shoulder tilt while both views remain frontal enough.
    const shoulderTiltReliable = Math.abs(baseline.viewAngle) <= 45
      && Math.abs(measured.viewAngle) <= 45;
    const headOffsetDelta = measured.headOffset - baseline.headOffset;
    const headLeanDelta = Math.abs(Math.atan2(headOffsetDelta, Math.max(measured.headHeight, 1e-6)) * 180 / Math.PI);
    const torsoReady = baseline.torsoAvailable && measured.torsoAvailable;
    const torsoLeanDelta = torsoReady
      ? Math.atan(Math.hypot(measured.torsoSide - baseline.torsoSide, measured.torsoForward - baseline.torsoForward)) * 180 / Math.PI
      : 0;
    const slouchRatio = Math.max(0, (baseline.headHeight - measured.headHeight) / Math.max(baseline.headHeight, 1e-6));
    const forwardDelta = measured.headForward - baseline.headForward;
    const leaningStartDegrees = this.mode === "STUDY" ? 12 : 6;
    const studyTorsoCollapsed = torsoReady && torsoLeanDelta >= 12;
    const slouchSeverity = this.mode === "STUDY"
      ? studyTorsoCollapsed
        ? Math.max(0, (slouchRatio - 0.16) / 0.24)
        : 0
      : Math.max(0, (slouchRatio - 0.10) / 0.20);
    const issues: Array<[string, number]> = [
      ["SHOULDER_TILT", shoulderTiltReliable && !armGestureActive
        ? Math.max(0, (shoulderDelta - 5 * sideTolerance) / (9 * sideTolerance))
        : 0],
      ["LEANING", torsoReady && !armGestureActive ? Math.max(0, (torsoLeanDelta - leaningStartDegrees * sideTolerance) / (12 * sideTolerance)) : 0],
      ["SLOUCHING", armGestureActive ? 0 : slouchSeverity],
      ["FORWARD_HEAD", armGestureActive ? 0 : Math.max(0, (forwardDelta - 0.11 * sideTolerance) / (0.20 * sideTolerance))],
    ];
    const [candidate, severity] = issues.reduce((best, current) => current[1] > best[1] ? current : best);
    const lowConfidence = confidence < 0.42 || viewDrift > 48;
    const issue = lowConfidence
      ? "CAMERA_ANGLE"
      : !torsoReady
        ? "TORSO_MISSING"
        : severity > 0
          ? candidate
          : "NONE";
    if (issue !== this.lastPostureIssue) {
      this.lastPostureIssue = issue;
      this.postureIssueSince = issue === "NONE" || issue === "CAMERA_ANGLE" || issue === "TORSO_MISSING" ? null : now;
    }
    const badMs = this.postureIssueSince === null ? 0 : now - this.postureIssueSince;
    const status: MonitorSnapshot["postureStatus"] = issue === "NONE"
      ? "GOOD"
      : issue === "CAMERA_ANGLE" || issue === "TORSO_MISSING"
        ? "CHECKING"
        : badMs >= 2_000
          ? "WARNING"
          : "CHECKING";
    return {
      status,
      issue,
      postureStatus: status,
      postureIssue: issue,
      postureScore: lowConfidence ? null : Math.round(100 * (1 - clamp(severity, 0, 1))),
      postureConfidence: round(confidence, 3),
      postureMessage: postureCorrectionMessage(issue, shoulderDelta, torsoLeanDelta, slouchRatio, forwardDelta, viewDrift),
      shoulderTiltDegrees: round(measured.shoulderTilt - baseline.shoulderTilt, 1),
      headLeanDegrees: round(headLeanDelta, 1),
      torsoLeanDegrees: torsoReady ? round(torsoLeanDelta, 1) : null,
      forwardHeadPercent: round(forwardDelta * 100, 1),
      cameraViewAngleDegrees: round(Math.abs(measured.viewAngle), 1),
      cameraView: cameraView(measured.viewAngle),
    };
  }
}

export function eyeAspectRatio(face: Landmark[]): number {
  const [right, left] = eyeAspectRatios(face);
  return (right + left) / 2;
}

export function bothEyesStableForCalibration(face: Landmark[] | null): boolean {
  if (!face || face.length <= LEFT_EYE[5]) return false;
  const [rightEar, leftEar] = eyeAspectRatios(face);
  const rightWidth = distance(face[RIGHT_EYE[0]], face[RIGHT_EYE[3]]);
  const leftWidth = distance(face[LEFT_EYE[0]], face[LEFT_EYE[3]]);
  const widthRatio = rightWidth / Math.max(leftWidth, 1e-6);
  const outerLeftX = Math.min(face[RIGHT_EYE[0]].x, face[LEFT_EYE[3]].x);
  const outerRightX = Math.max(face[RIGHT_EYE[0]].x, face[LEFT_EYE[3]].x);
  const nosePosition = (face[1].x - outerLeftX) / Math.max(outerRightX - outerLeftX, 1e-6);
  return rightEar >= 0.16
    && leftEar >= 0.16
    && rightWidth >= 0.035
    && leftWidth >= 0.035
    && widthRatio >= 0.55
    && widthRatio <= 1.8
    && nosePosition >= 0.3
    && nosePosition <= 0.7;
}

function eyeAspectRatios(face: Landmark[]): [number, number] {
  return [singleEyeAspectRatio(face, RIGHT_EYE), singleEyeAspectRatio(face, LEFT_EYE)];
}

export function headPitch(face: Landmark[]): number {
  const eyeY = (face[33].y + face[133].y + face[263].y + face[362].y) / 4;
  const height = Math.max(distance(face[10], face[152]), 1e-6);
  return (face[1].y - eyeY) / height;
}

function detectHeadDown(pitch: number, pose: PoseMeasurement | null, baseline: Baseline, wasDown: boolean): boolean {
  const viewAngle = pose?.viewAngle ?? baseline.viewAngle;
  const sideFactor = clamp((Math.abs(viewAngle) - 20) / 50, 0, 1);
  const faceThreshold = baseline.pitch + (wasDown ? 0.065 : 0.09) + sideFactor * 0.025;
  const faceIndicatesDown = pitch > faceThreshold;
  if (!faceIndicatesDown) return false;

  const poseReliable = baseline.poseAvailable
    && pose !== null
    && pose.confidence >= 0.38
    && angleDistance(pose.viewAngle, baseline.viewAngle) <= 30;
  if (!poseReliable) {
    const faceOnlyThreshold = baseline.pitch + (wasDown ? 0.085 : 0.12) + sideFactor * 0.025;
    return pitch > faceOnlyThreshold;
  }

  const headHeightDrop = (baseline.headHeight - pose.headHeight) / Math.max(Math.abs(baseline.headHeight), 0.2);
  const requiredDrop = wasDown ? 0.08 : 0.12;
  return headHeightDrop >= requiredDrop;
}

function getCalibrationSample(frame: VisionFrame, requirePose: boolean): CalibrationSample | null {
  if (!faceVisible(frame.face)) return null;
  if (requirePose && !seatedTorsoVisible(frame.pose)) return null;
  let pose: PoseMeasurement;
  let poseAvailable = false;
  if (upperBodyVisible(frame.pose)) {
    pose = measurePose(frame.pose);
    poseAvailable = true;
  } else {
    pose = faceOnlyMeasurement(frame.face);
  }
  const [rightEar, leftEar] = eyeAspectRatios(frame.face);
  return {
    ear: (rightEar + leftEar) / 2,
    rightEar,
    leftEar,
    pitch: headPitch(frame.face),
    pose,
    poseAvailable,
    faceX: (frame.face[10].x + frame.face[152].x) / 2,
    faceY: (frame.face[10].y + frame.face[152].y) / 2,
    faceWidth: Math.max(distance(frame.face[234], frame.face[454]), 0.08),
    faceHeight: Math.max(distance(frame.face[10], frame.face[152]), 0.12),
    faceRoll: faceRoll(frame.face),
  };
}

function isStableSample(previous: CalibrationSample | null, current: CalibrationSample, requirePose: boolean): boolean {
  if (!Number.isFinite(current.ear) || current.ear <= 0.04) return false;
  const sideFactor = clamp((Math.abs(current.pose.viewAngle) - 20) / 50, 0, 1);
  const minimumOpenEyeRatio = 0.16 - sideFactor * 0.08;
  if (current.ear < minimumOpenEyeRatio) return false;
  if (requirePose && !Number.isFinite(current.pose.headHeight)) return false;
  if (requirePose && current.pose.confidence < 0.42) return false;
  if (previous === null) return true;
  const faceMove = Math.hypot(current.pose.noseX - previous.pose.noseX, current.pose.noseY - previous.pose.noseY);
  if (!requirePose) return faceMove < 0.09;
  const shoulderMove = Math.hypot(current.pose.shoulderX - previous.pose.shoulderX, current.pose.shoulderY - previous.pose.shoulderY);
  const scaleChange = Math.abs(current.pose.shoulderWidth - previous.pose.shoulderWidth) / Math.max(previous.pose.shoulderWidth, 1e-6);
  return faceMove < 0.08 && shoulderMove < 0.075 && scaleChange < 0.25;
}

function buildBaseline(samples: CalibrationSample[]): Baseline {
  const torsoSamples = samples.filter((sample) => sample.pose.torsoAvailable);
  return {
    ear: median(samples.map((sample) => sample.ear)),
    rightEar: median(samples.map((sample) => sample.rightEar)),
    leftEar: median(samples.map((sample) => sample.leftEar)),
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
    hipX: torsoSamples.length > 0 ? median(torsoSamples.map((sample) => sample.pose.hipX)) : median(samples.map((sample) => sample.pose.shoulderX)),
    hipY: torsoSamples.length > 0 ? median(torsoSamples.map((sample) => sample.pose.hipY)) : median(samples.map((sample) => sample.pose.shoulderY)),
    torsoSide: torsoSamples.length > 0 ? median(torsoSamples.map((sample) => sample.pose.torsoSide)) : 0,
    torsoForward: torsoSamples.length > 0 ? median(torsoSamples.map((sample) => sample.pose.torsoForward)) : 0,
    torsoAvailable: torsoSamples.length >= Math.ceil(samples.length * 0.6),
    poseAvailable: samples.filter((sample) => sample.poseAvailable).length >= Math.ceil(samples.length * 0.6),
    faceX: median(samples.map((sample) => sample.faceX)),
    faceY: median(samples.map((sample) => sample.faceY)),
    faceWidth: median(samples.map((sample) => sample.faceWidth)),
    faceHeight: median(samples.map((sample) => sample.faceHeight)),
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
    hipX: face[1].x,
    hipY: Math.min(1, face[152].y + faceHeight * 2),
    torsoSide: 0,
    torsoForward: 0,
    torsoAvailable: false,
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
    torsoLeanDegrees: null,
    forwardHeadPercent: null,
    cameraViewAngleDegrees: round(Math.abs(viewAngle), 1),
    cameraView: cameraView(viewAngle),
  };
}

function faceVisible(face: Landmark[] | null): face is Landmark[] {
  return face !== null && face.length > 387;
}

export function upperBodyVisible(pose: Landmark[] | null): pose is Landmark[] {
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

export function seatedTorsoVisible(pose: Landmark[] | null): pose is Landmark[] {
  if (!upperBodyVisible(pose) || pose.length <= 24) return false;
  const leftHip = pose[23];
  const rightHip = pose[24];
  if (![leftHip.x, leftHip.y, leftHip.z, rightHip.x, rightHip.y, rightHip.z].every(Number.isFinite)) return false;
  const shoulderCenter = weightedPair(pose[11], pose[12]);
  const hipCenter = weightedPair(leftHip, rightHip);
  const torsoHeight = hipCenter.y - shoulderCenter.y;
  const torsoWidth = distance(leftHip, rightHip);
  return hipCenter.x >= -0.5
    && hipCenter.x <= 1.5
    && hipCenter.y >= -0.1
    && hipCenter.y <= 2.5
    && torsoHeight >= 0.08
    && torsoHeight <= 2
    && torsoWidth <= 1.2;
}

function armOrHandGestureActive(pose: Landmark[]): boolean {
  const sides = [
    { shoulder: pose[11], elbow: pose[13], wrist: pose[15], hand: [pose[17], pose[19], pose[21]] },
    { shoulder: pose[12], elbow: pose[14], wrist: pose[16], hand: [pose[18], pose[20], pose[22]] },
  ];
  return sides.some(({ shoulder, elbow, wrist, hand }) => {
    if ([shoulder, elbow, wrist].some((point) => !point || visibility(point) < 0.35)) return false;
    const visibleHandPoints = hand.filter((point) => point
      && visibility(point) >= 0.25
      && Math.hypot(point.x - wrist.x, point.y - wrist.y) <= 0.32);
    const handNearUpperBody = visibleHandPoints.length >= 2
      && visibleHandPoints.some((point) => point.y <= shoulder.y + 0.12);
    const raisedArm = elbow.y <= shoulder.y + 0.08 && wrist.y <= shoulder.y + 0.16;
    return raisedArm || handNearUpperBody;
  });
}

function hasBaselineDeviation(measured: PoseMeasurement, baseline: Baseline): boolean {
  const scale = Math.max(baseline.shoulderWidth, measured.shoulderWidth, 0.12);
  const noseShift = Math.hypot(measured.noseX - baseline.noseX, measured.noseY - baseline.noseY);
  const shoulderShift = Math.hypot(measured.shoulderX - baseline.shoulderX, measured.shoulderY - baseline.shoulderY);
  const heightChange = Math.abs(measured.headHeight - baseline.headHeight) / Math.max(Math.abs(baseline.headHeight), 0.15);
  return angleDistance(measured.viewAngle, baseline.viewAngle) > 32
    || noseShift > Math.max(0.14, scale * 0.75)
    || shoulderShift > Math.max(0.12, scale * 0.6)
    || heightChange > 0.32;
}

function measurePose(pose: Landmark[]): PoseMeasurement {
  const nose = pose[0];
  const leftEar = pose[7];
  const rightEar = pose[8];
  const leftShoulder = pose[11];
  const rightShoulder = pose[12];
  const torsoAvailable = seatedTorsoVisible(pose);
  const leftHip = torsoAvailable ? pose[23] : leftShoulder;
  const rightHip = torsoAvailable ? pose[24] : rightShoulder;
  const shoulderCenter = weightedPair(leftShoulder, rightShoulder);
  const hipCenter = weightedPair(leftHip, rightHip);
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
  const torsoVectorX = shoulderCenter.x - hipCenter.x;
  const torsoVectorZ = shoulderCenter.z - hipCenter.z;
  const torsoHeight = Math.max(hipCenter.y - shoulderCenter.y, shoulderWidth * 0.35, 1e-6);
  const torsoSide = torsoAvailable
    ? (torsoVectorX * shoulderAxisX + torsoVectorZ * shoulderAxisZ) / torsoHeight
    : 0;
  const torsoForward = torsoAvailable
    ? (torsoVectorX * forwardAxisX + torsoVectorZ * forwardAxisZ) / torsoHeight
    : 0;
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
    hipX: hipCenter.x,
    hipY: hipCenter.y,
    torsoSide,
    torsoForward,
    torsoAvailable,
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
    hipX: field("hipX"),
    hipY: field("hipY"),
    torsoSide: field("torsoSide"),
    torsoForward: field("torsoForward"),
    torsoAvailable: samples.filter((sample) => sample.torsoAvailable).length >= Math.ceil(samples.length * 0.6),
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

function postureCorrectionMessage(issue: string, shoulderDegrees: number, torsoLeanDegrees: number, slouchRatio: number, forwardRatio: number, viewDrift: number): string {
  if (issue === "CAMERA_ANGLE") return `기준 촬영 각도와 ${Math.round(viewDrift)}° 차이입니다. 현재 각도로 다시 측정해 주세요.`;
  if (issue === "TORSO_MISSING") return "목부터 허리까지 보이도록 카메라 각도를 맞춰 주세요.";
  if (issue === "SHOULDER_TILT") return `어깨 높이 차이를 약 ${shoulderDegrees.toFixed(1)}° 줄여 수평에 맞추세요.`;
  if (issue === "LEANING") return `목에서 허리로 이어지는 상체 축 기울기 ${torsoLeanDegrees.toFixed(1)}°를 기준 자세에 가깝게 맞추세요.`;
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
    postureMessage: "얼굴, 양쪽 어깨와 허리선이 충분히 보이게 카메라를 맞춰 주세요.",
    shoulderTiltDegrees: null,
    headLeanDegrees: null,
    torsoLeanDegrees: null,
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
    baselineDeviated: false,
    baselineGuide: null,
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
    torsoLeanDegrees: null,
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
