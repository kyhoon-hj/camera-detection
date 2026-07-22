import { describe, expect, it } from "vitest";
import { CALIBRATION_DURATION_MS, DriverMonitor, type Landmark, type VisionFrame } from "../src/monitor";

describe("DriverMonitor 5초 기준 측정", () => {
  it("유효한 얼굴과 자세를 5초간 모은 뒤에만 감지를 시작한다", () => {
    const monitor = new DriverMonitor();
    monitor.begin("POSTURE");
    let snapshot = monitor.process(frame(0));
    expect(snapshot.status).toBe("CALIBRATING");

    for (let time = 100; time < CALIBRATION_DURATION_MS; time += 100) {
      snapshot = monitor.process(frame(time));
    }
    expect(snapshot.status).toBe("CALIBRATING");
    expect(snapshot.calibrationProgress).toBeGreaterThan(0.95);

    snapshot = monitor.process(frame(CALIBRATION_DURATION_MS));
    expect(snapshot.status).toBe("AWAKE");
    expect(snapshot.baselineEyeAspectRatio).toBeCloseTo(0.25, 2);
  });

  it("측정 중 얼굴이나 어깨를 오래 잃으면 5초 측정을 다시 시작한다", () => {
    const monitor = new DriverMonitor();
    monitor.begin("POSTURE");
    for (let time = 0; time <= 2_500; time += 100) monitor.process(frame(time));

    monitor.process({ timestampMs: 2_600, face: null, pose: null });
    const lost = monitor.process({ timestampMs: 3_100, face: null, pose: null });
    expect(lost.status).toBe("CALIBRATING");
    expect(lost.calibrationProgress).toBe(0);
    expect(lost.calibrationStable).toBe(false);

    expect(monitor.process(frame(3_200)).status).toBe("CALIBRATING");
    for (let time = 3_300; time < 8_200; time += 100) monitor.process(frame(time));
    expect(monitor.process(frame(8_200)).status).toBe("AWAKE");
  });

  it("개인 기준 눈 크기로 보정한 후 지속된 눈 감김을 경고한다", () => {
    const monitor = calibratedMonitor();
    expect(monitor.process(frame(5_100, true)).status).toBe("AWAKE");
    const warning = monitor.process(frame(6_700, true));
    expect(warning.status).toBe("WARNING");
    expect(warning.trigger).toBe("EYES_ONLY");
    expect(warning.message).toBe("눈 감김이 감지되었습니다.");
  });

  it("70도 측면 촬영도 3D 어깨축으로 보정하고 수치를 제공한다", () => {
    const monitor = new DriverMonitor();
    monitor.begin("POSTURE");
    let snapshot = monitor.process(frame(0, false, makePose({ yawDegrees: 70 })));
    for (let time = 100; time <= CALIBRATION_DURATION_MS; time += 100) {
      snapshot = monitor.process(frame(time, false, makePose({ yawDegrees: 70 })));
    }

    expect(snapshot.status).toBe("AWAKE");
    expect(snapshot.cameraView).toBe("SIDE");
    expect(snapshot.cameraViewAngleDegrees).toBeCloseTo(70, 0);
    expect(snapshot.postureScore).toBe(100);
    expect(snapshot.shoulderTiltDegrees).toBeCloseTo(0, 1);
    expect(snapshot.postureConfidence).toBeGreaterThan(0.7);
  });

  it("측면에서도 실제 어깨 기울기와 거북목 이동을 기준 자세 대비 감지한다", () => {
    const monitor = new DriverMonitor();
    monitor.begin("POSTURE");
    for (let time = 0; time <= CALIBRATION_DURATION_MS; time += 100) {
      monitor.process(frame(time, false, makePose({ yawDegrees: 70 })));
    }

    const tiltedPose = makePose({ yawDegrees: 70, rightShoulderDrop: 0.07 });
    for (let time = 5_100; time <= 5_700; time += 100) monitor.process(frame(time, false, tiltedPose));
    const tilted = monitor.process(frame(8_000, false, tiltedPose));
    expect(tilted.postureStatus).toBe("WARNING");
    expect(tilted.postureIssue).toBe("SHOULDER_TILT");
    expect(Math.abs(tilted.shoulderTiltDegrees ?? 0)).toBeGreaterThan(10);

    monitor.recalibrate();
    for (let time = 9_000; time <= 14_000; time += 100) {
      monitor.process(frame(time, false, makePose({ yawDegrees: 70 })));
    }
    const forwardPose = makePose({ yawDegrees: 70, forwardShift: 0.1 });
    for (let time = 14_100; time <= 14_700; time += 100) monitor.process(frame(time, false, forwardPose));
    const forward = monitor.process(frame(17_000, false, forwardPose));
    expect(forward.postureStatus).toBe("WARNING");
    expect(forward.postureIssue).toBe("FORWARD_HEAD");
    expect(forward.forwardHeadPercent).toBeGreaterThan(20);
  });

  it("졸음운전 모드는 어깨가 없어도 얼굴 기준 측정을 완료한다", () => {
    const monitor = new DriverMonitor();
    monitor.begin("DROWSINESS");
    let snapshot = monitor.process({ timestampMs: 0, face: makeFace(false), pose: null });
    for (let time = 100; time <= CALIBRATION_DURATION_MS; time += 100) {
      snapshot = monitor.process({ timestampMs: time, face: makeFace(false), pose: null });
    }
    expect(snapshot.status).toBe("AWAKE");
  });

  it("졸음운전 모드는 어깨 기울기 대신 지속된 상체 쓰러짐을 경고한다", () => {
    const monitor = calibratedMonitor();
    const collapsedFace = makeFace(false).map((point) => ({ ...point, y: point.y + 0.14 }));
    monitor.process({ timestampMs: 5_100, face: collapsedFace, pose: makePose({ rightShoulderDrop: 0.08 }) });
    const warning = monitor.process({ timestampMs: 6_200, face: collapsedFace, pose: makePose({ rightShoulderDrop: 0.08 }) });
    expect(warning.status).toBe("WARNING");
    expect(warning.trigger).toBe("BODY_COLLAPSE");
    expect(warning.postureIssue).toBe("BODY_COLLAPSE");
    expect(warning.shoulderTiltDegrees).toBeNull();
  });

  it("고개 숙임이 2초 지속되면 별도 안내를 제공한다", () => {
    const monitor = calibratedMonitor();
    const loweredHead = makeFace(false);
    loweredHead[1] = { ...loweredHead[1], y: loweredHead[1].y + 0.08 };
    monitor.process({ timestampMs: 5_100, face: loweredHead, pose: makePose() });
    const warning = monitor.process({ timestampMs: 7_100, face: loweredHead, pose: makePose() });
    expect(warning.status).toBe("WARNING");
    expect(warning.trigger).toBe("HEAD_ONLY");
    expect(warning.message).toBe("고개 숙임이 감지되었습니다.");
  });
});

function calibratedMonitor(): DriverMonitor {
  const monitor = new DriverMonitor();
  monitor.begin();
  for (let time = 0; time <= CALIBRATION_DURATION_MS; time += 100) monitor.process(frame(time));
  return monitor;
}

function frame(timestampMs: number, closed = false, pose = makePose()): VisionFrame {
  return { timestampMs, face: makeFace(closed), pose };
}

function makeFace(closed: boolean): Landmark[] {
  const landmarks = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
  landmarks[10] = { x: 0.5, y: 0.3, z: 0 };
  landmarks[152] = { x: 0.5, y: 0.7, z: 0 };
  landmarks[1] = { x: 0.5, y: 0.5, z: 0 };
  setEye(landmarks, [33, 160, 158, 133, 153, 144], 0.4, 0.48, closed);
  setEye(landmarks, [362, 385, 387, 263, 373, 380], 0.52, 0.6, closed);
  return landmarks;
}

function setEye(face: Landmark[], indices: number[], left: number, right: number, closed: boolean): void {
  const upper = closed ? 0.449 : 0.44;
  const lower = closed ? 0.451 : 0.46;
  face[indices[0]] = { x: left, y: 0.45, z: 0 };
  face[indices[1]] = { x: left + 0.025, y: upper, z: 0 };
  face[indices[2]] = { x: right - 0.025, y: upper, z: 0 };
  face[indices[3]] = { x: right, y: 0.45, z: 0 };
  face[indices[4]] = { x: right - 0.025, y: lower, z: 0 };
  face[indices[5]] = { x: left + 0.025, y: lower, z: 0 };
}

function makePose(options: { yawDegrees?: number; rightShoulderDrop?: number; forwardShift?: number } = {}): Landmark[] {
  const landmarks = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 1 }));
  const forwardShift = options.forwardShift ?? 0;
  landmarks[0] = { x: 0.5, y: 0.25, z: -0.1 - forwardShift, visibility: 1 };
  landmarks[7] = { x: 0.45, y: 0.32, z: -0.08 - forwardShift, visibility: 1 };
  landmarks[8] = { x: 0.55, y: 0.32, z: -0.08 - forwardShift, visibility: 1 };
  landmarks[11] = { x: 0.38, y: 0.6, z: 0, visibility: 1 };
  landmarks[12] = { x: 0.62, y: 0.6 + (options.rightShoulderDrop ?? 0), z: 0, visibility: 1 };
  const yaw = (options.yawDegrees ?? 0) * Math.PI / 180;
  if (yaw !== 0) {
    for (const index of [0, 7, 8, 11, 12]) {
      const point = landmarks[index];
      const x = point.x - 0.5;
      const z = point.z;
      point.x = 0.5 + x * Math.cos(yaw) + z * Math.sin(yaw);
      point.z = -x * Math.sin(yaw) + z * Math.cos(yaw);
    }
    landmarks[7].visibility = 0.2;
    landmarks[11].visibility = 0.25;
  }
  return landmarks;
}
