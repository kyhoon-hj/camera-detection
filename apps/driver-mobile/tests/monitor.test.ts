import { describe, expect, it } from "vitest";
import { CALIBRATION_DURATION_MS, DriverMonitor, bothEyesStableForCalibration, seatedTorsoVisible, type Landmark, type VisionFrame } from "../src/monitor";

describe("DriverMonitor 5초 기준 측정", () => {
  it("현재 검출된 잘린 허리 위치를 열공 기준으로 사용한다", () => {
    const pose = makePose();
    pose[23] = { ...pose[23], y: 1.55, visibility: 0 };
    pose[24] = { ...pose[24], y: 1.55, visibility: 0 };

    expect(seatedTorsoVisible(pose)).toBe(true);

    const monitor = new DriverMonitor();
    monitor.begin("STUDY");
    for (let time = 0; time < CALIBRATION_DURATION_MS; time += 100) {
      expect(monitor.process(frame(time, false, pose)).status).toBe("CALIBRATING");
    }
    const calibrated = monitor.process(frame(CALIBRATION_DURATION_MS, false, pose));
    expect(calibrated.status).toBe("NORMAL");
    expect(calibrated.postureIssue).toBe("NONE");
    expect(calibrated.baselineGuide?.showTorso).toBe(true);
  });

  it("열공 모드에서 허리를 유지하고 책을 보는 고개 숙임은 상체 숙임으로 경고하지 않는다", () => {
    const monitor = new DriverMonitor();
    monitor.begin("STUDY");
    for (let time = 0; time <= CALIBRATION_DURATION_MS; time += 100) {
      monitor.process(frame(time));
    }

    const readingPose = makePose({ verticalDrop: 0.12 });
    monitor.process(frame(5_100, false, readingPose));
    const reading = monitor.process(frame(7_300, false, readingPose));

    expect(reading.postureIssue).not.toBe("SLOUCHING");
    expect(reading.postureStatus).not.toBe("WARNING");
  });
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
    expect(snapshot.status).toBe("NORMAL");
    expect(snapshot.baselineEyeAspectRatio).toBeCloseTo(0.25, 2);
  });

  it("호출 화면이 요청한 기준 측정 시간을 별도로 적용할 수 있다", () => {
    const monitor = new DriverMonitor();
    monitor.begin("POSTURE", 3_000);
    let snapshot = monitor.process(frame(0));
    for (let time = 100; time < 3_000; time += 100) snapshot = monitor.process(frame(time));
    expect(snapshot.status).toBe("CALIBRATING");
    expect(monitor.process(frame(3_000)).status).toBe("NORMAL");
  });

  it("열공 모드는 사용자의 현재 기울어진 자세도 5초 기준으로 저장한다", () => {
    const monitor = new DriverMonitor();
    const currentPose = makePose({ rightShoulderDrop: 0.25 });
    monitor.begin("POSTURE");

    for (let time = 0; time < CALIBRATION_DURATION_MS; time += 100) {
      expect(monitor.process(frame(time, false, currentPose)).status).toBe("CALIBRATING");
    }

    const calibrated = monitor.process(frame(CALIBRATION_DURATION_MS, false, currentPose));
    expect(calibrated.status).toBe("NORMAL");
    expect(calibrated.postureIssue).toBe("NONE");
  });

  it("정면에서 양쪽 눈이 안정적으로 보일 때만 열공 기준 측정을 허용한다", () => {
    const front = makeFace(false);
    expect(bothEyesStableForCalibration(front)).toBe(true);

    const side = makeFace(false);
    side[1] = { ...side[1], x: 0.66 };
    expect(bothEyesStableForCalibration(side)).toBe(false);

    const oneEyeClosed = makeFace(false);
    setEyeOpening(oneEyeClosed, LEFT_EYE_TEST, 0.08);
    expect(bothEyesStableForCalibration(oneEyeClosed)).toBe(false);
  });

  it("측정 중 얼굴이나 어깨를 오래 잃으면 5초 측정을 다시 시작한다", () => {
    const monitor = new DriverMonitor();
    monitor.begin("POSTURE");
    for (let time = 0; time <= 2_500; time += 100) monitor.process(frame(time));

    monitor.process({ timestampMs: 2_600, face: null, pose: null });
    const lost = monitor.process({ timestampMs: 3_900, face: null, pose: null });
    expect(lost.status).toBe("CALIBRATING");
    expect(lost.calibrationProgress).toBe(0);
    expect(lost.calibrationStable).toBe(false);

    expect(monitor.process(frame(4_000)).status).toBe("CALIBRATING");
    for (let time = 4_100; time < 9_000; time += 100) monitor.process(frame(time));
    expect(monitor.process(frame(9_000)).status).toBe("NORMAL");
  });

  it("1초 안쪽의 잠깐 흔들림은 기준 측정을 취소하지 않고 멈춘 지점부터 이어간다", () => {
    const monitor = new DriverMonitor();
    monitor.begin("POSTURE");
    for (let time = 0; time <= 2_500; time += 100) monitor.process(frame(time));

    monitor.process({ timestampMs: 2_600, face: null, pose: null });
    const paused = monitor.process({ timestampMs: 3_400, face: null, pose: null });
    expect(paused.status).toBe("CALIBRATING");
    expect(paused.calibrationProgress).toBeGreaterThan(0.45);

    const resumed = monitor.process(frame(3_500));
    expect(resumed.calibrationProgress).toBeGreaterThan(0.45);
    for (let time = 3_600; time < 5_900; time += 100) monitor.process(frame(time));
    expect(monitor.process(frame(5_900)).status).toBe("NORMAL");
  });

  it("운전 중 생기는 작은 좌우 흔들림은 기준 측정을 계속한다", () => {
    const monitor = new DriverMonitor();
    monitor.begin("DROWSINESS");
    let snapshot = monitor.process({ timestampMs: 0, face: shiftedFace(0), pose: null });
    for (let time = 100; time <= CALIBRATION_DURATION_MS; time += 100) {
      const shift = Math.floor(time / 100) % 2 === 0 ? 0 : 0.07;
      snapshot = monitor.process({ timestampMs: time, face: shiftedFace(shift), pose: null });
    }
    expect(snapshot.status).toBe("NORMAL");
  });

  it("개인 기준 눈 크기로 보정한 후 지속된 눈 감김을 경고한다", () => {
    const monitor = calibratedMonitor();
    expect(monitor.process(frame(5_100, true)).status).toBe("NORMAL");
    const warning = monitor.process(frame(7_100, true));
    expect(warning.status).toBe("WARNING");
    expect(warning.trigger).toBe("EYES_ONLY");
    expect(warning.message).toBe("눈 감김이 2초 이상 감지됐습니다.");
  });

  it("눈 감김 지속시간에 따라 정상, 주의, 경고, 위험 4단계로 전환한다", () => {
    const monitor = calibratedMonitor();
    expect(monitor.process(frame(5_100, true)).status).toBe("NORMAL");
    expect(monitor.process(frame(6_100, true)).status).toBe("CAUTION");
    expect(monitor.process(frame(7_100, true)).status).toBe("WARNING");
    expect(monitor.process(frame(8_100, true)).status).toBe("DANGER");
  });

  it("70도 측면 촬영도 3D 어깨축으로 보정하고 수치를 제공한다", () => {
    const monitor = new DriverMonitor();
    monitor.begin("POSTURE");
    let snapshot = monitor.process(frame(0, false, makePose({ yawDegrees: 70 })));
    for (let time = 100; time <= CALIBRATION_DURATION_MS; time += 100) {
      snapshot = monitor.process(frame(time, false, makePose({ yawDegrees: 70 })));
    }

    expect(snapshot.status).toBe("NORMAL");
    expect(snapshot.cameraView).toBe("SIDE");
    expect(snapshot.cameraViewAngleDegrees).toBeCloseTo(70, 0);
    expect(snapshot.postureScore).toBe(100);
    expect(snapshot.shoulderTiltDegrees).toBeCloseTo(0, 1);
    expect(snapshot.postureConfidence).toBeGreaterThan(0.7);
  });

  it("열공 모드도 졸음운전의 측면 보정을 사용하면서 자세 수치를 유지한다", () => {
    const sidePose = makePose({ yawDegrees: 70 });
    const monitor = new DriverMonitor();
    monitor.begin("STUDY");
    let snapshot = monitor.process(frame(0, false, sidePose));
    for (let time = 100; time <= CALIBRATION_DURATION_MS; time += 100) {
      snapshot = monitor.process(frame(time, false, sidePose));
    }
    expect(snapshot.status).toBe("NORMAL");
    expect(snapshot.cameraView).toBe("SIDE");
    expect(snapshot.postureScore).toBe(100);

    const faceMeshLostAtSide = monitor.process({ timestampMs: 5_100, face: null, pose: sidePose });
    expect(faceMeshLostAtSide.status).toBe("NORMAL");
    expect(faceMeshLostAtSide.faceVisible).toBe(false);
    expect(faceMeshLostAtSide.poseVisible).toBe(true);
    expect(faceMeshLostAtSide.trigger).toBe("NONE");
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
    expect(tilted.postureIssue).not.toBe("SHOULDER_TILT");
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

  it("얼굴과 머리 랜드마크만 흔들린 경우 몸 기울어짐으로 오인하지 않는다", () => {
    const monitor = new DriverMonitor();
    monitor.begin("STUDY");
    for (let time = 0; time <= CALIBRATION_DURATION_MS; time += 100) {
      monitor.process(frame(time));
    }

    const headShiftOnly = makePose({ headSideShift: 0.1 });
    for (let time = 5_100; time <= 7_600; time += 100) {
      monitor.process(frame(time, false, headShiftOnly));
    }
    const snapshot = monitor.process(frame(7_700, false, headShiftOnly));
    expect(snapshot.postureIssue).toBe("NONE");
    expect(snapshot.postureStatus).toBe("GOOD");
  });

  it("어깨 중심과 허리 중심을 잇는 상체 축이 기준에서 기울면 몸 기울어짐으로 판정한다", () => {
    const monitor = new DriverMonitor();
    monitor.begin("STUDY");
    for (let time = 0; time <= CALIBRATION_DURATION_MS; time += 100) {
      monitor.process(frame(time));
    }

    const leaning = makePose({ torsoLean: 0.1 });
    for (let time = 5_100; time <= 7_600; time += 100) {
      monitor.process(frame(time, false, leaning));
    }
    const snapshot = monitor.process(frame(7_700, false, leaning));
    expect(snapshot.postureIssue).toBe("LEANING");
    expect(snapshot.postureStatus).toBe("WARNING");
    expect(snapshot.torsoLeanDegrees).toBeGreaterThan(10);
  });

  it("열공 모드에서 팔을 올린 동작은 몸 기울어짐으로 판정하지 않는다", () => {
    const monitor = new DriverMonitor();
    monitor.begin("STUDY");
    for (let time = 0; time <= CALIBRATION_DURATION_MS; time += 100) {
      monitor.process(frame(time));
    }

    const raisedArm = makePose({ torsoLean: 0.1, rightShoulderDrop: 0.08, raisedArm: "RIGHT" });
    for (let time = 5_100; time <= 7_600; time += 100) {
      monitor.process(frame(time, false, raisedArm));
    }
    const snapshot = monitor.process(frame(7_700, false, raisedArm));
    expect(snapshot.postureIssue).toBe("NONE");
    expect(snapshot.postureStatus).toBe("GOOD");
  });

  it("졸음운전 모드는 어깨가 없어도 얼굴 기준 측정을 완료한다", () => {
    const monitor = new DriverMonitor();
    monitor.begin("DROWSINESS");
    let snapshot = monitor.process({ timestampMs: 0, face: makeFace(false), pose: null });
    for (let time = 100; time <= CALIBRATION_DURATION_MS; time += 100) {
      snapshot = monitor.process({ timestampMs: time, face: makeFace(false), pose: null });
    }
    expect(snapshot.status).toBe("NORMAL");
  });

  it("측면에서는 얼굴 기울기나 정면 기준의 작은 하강만으로 쓰러짐 처리하지 않는다", () => {
    const sidePose = makePose({ yawDegrees: 70 });
    const monitor = calibratedMonitor(sidePose);
    const tiltedFace = rotateFace(makeFace(false), 60);

    monitor.process({ timestampMs: 5_100, face: tiltedFace, pose: sidePose });
    const tiltOnly = monitor.process({ timestampMs: 8_500, face: tiltedFace, pose: sidePose });
    expect(tiltOnly.status).toBe("NORMAL");
    expect(tiltOnly.trigger).toBe("NONE");
    expect(tiltOnly.postureIssue).toBe("NONE");
    expect(tiltOnly.cameraView).toBe("SIDE");

    const smallDropFace = makeFace(false).map((point) => ({ ...point, y: point.y + 0.14 }));
    monitor.process({ timestampMs: 8_600, face: smallDropFace, pose: sidePose });
    const smallDrop = monitor.process({ timestampMs: 11_000, face: smallDropFace, pose: sidePose });
    expect(smallDrop.status).toBe("NORMAL");
    expect(smallDrop.trigger).toBe("NONE");
    expect(smallDrop.postureIssue).toBe("NONE");
  });

  it("우측 에어컨 위치의 사선 촬영에서는 얼굴 원근 변화만으로 고개 숙임을 판정하지 않는다", () => {
    const sidePose = makePose({ yawDegrees: 55 });
    const monitor = calibratedMonitor(sidePose);
    const perspectiveFace = makeFace(false);
    perspectiveFace[1] = { ...perspectiveFace[1], y: perspectiveFace[1].y + 0.06 };

    monitor.process({ timestampMs: 5_100, face: perspectiveFace, pose: sidePose });
    const snapshot = monitor.process({ timestampMs: 8_500, face: perspectiveFace, pose: sidePose });
    expect(snapshot.status).toBe("NORMAL");
    expect(snapshot.headDown).toBe(false);
    expect(snapshot.trigger).toBe("NONE");
  });

  it("사선 아래 카메라에서 위를 보며 두 눈이 가늘어져도 눈 감김으로 오인하지 않는다", () => {
    const sidePose = makePose({ yawDegrees: 55 });
    const monitor = calibratedMonitor(sidePose);
    const squintingFace = makeFace(false);
    setEyeOpening(squintingFace, RIGHT_EYE_TEST, 0.14);
    setEyeOpening(squintingFace, LEFT_EYE_TEST, 0.14);

    monitor.process({ timestampMs: 5_100, face: squintingFace, pose: sidePose });
    const snapshot = monitor.process({ timestampMs: 8_500, face: squintingFace, pose: sidePose });
    expect(snapshot.status).toBe("NORMAL");
    expect(snapshot.eyesClosed).toBe(false);
    expect(snapshot.trigger).toBe("NONE");
  });

  it("측면에서 작게 잡힌 열린 눈은 개인 기준보다 조금 좁아져도 졸음으로 오인하지 않는다", () => {
    const sidePose = makePose({ yawDegrees: 70 });
    const openSideFace = makeFace(false);
    setEyeOpening(openSideFace, RIGHT_EYE_TEST, 0.11);
    setEyeOpening(openSideFace, LEFT_EYE_TEST, 0.11);
    const monitor = new DriverMonitor();
    monitor.begin("STUDY");
    for (let time = 0; time <= CALIBRATION_DURATION_MS; time += 100) {
      monitor.process({ timestampMs: time, face: openSideFace, pose: sidePose });
    }

    const slightlyNarrower = makeFace(false);
    setEyeOpening(slightlyNarrower, RIGHT_EYE_TEST, 0.09);
    setEyeOpening(slightlyNarrower, LEFT_EYE_TEST, 0.09);
    monitor.process({ timestampMs: 5_100, face: slightlyNarrower, pose: sidePose });
    const open = monitor.process({ timestampMs: 8_500, face: slightlyNarrower, pose: sidePose });
    expect(open.status).toBe("NORMAL");
    expect(open.eyesClosed).toBe(false);
    expect(open.trigger).toBe("NONE");

    const actuallyClosed = makeFace(false);
    setEyeOpening(actuallyClosed, RIGHT_EYE_TEST, 0.02);
    setEyeOpening(actuallyClosed, LEFT_EYE_TEST, 0.02);
    monitor.process({ timestampMs: 8_600, face: actuallyClosed, pose: sidePose });
    const warning = monitor.process({ timestampMs: 10_600, face: actuallyClosed, pose: sidePose });
    expect(warning.status).toBe("WARNING");
    expect(warning.eyesClosed).toBe(true);
    expect(warning.trigger).toBe("EYES_ONLY");
  });

  it("사선 촬영 보정 중에도 실제로 두 눈을 감으면 경고한다", () => {
    const sidePose = makePose({ yawDegrees: 55 });
    const monitor = calibratedMonitor(sidePose);

    monitor.process({ timestampMs: 5_100, face: makeFace(true), pose: sidePose });
    const warning = monitor.process({ timestampMs: 7_100, face: makeFace(true), pose: sidePose });
    expect(warning.status).toBe("WARNING");
    expect(warning.eyesClosed).toBe(true);
    expect(warning.trigger).toBe("EYES_ONLY");
  });

  it("차량 모드의 기준 자세 이탈은 표시만 하고 졸음 단계에는 영향을 주지 않는다", () => {
    const baselinePose = makePose({ yawDegrees: 55 });
    const monitor = calibratedMonitor(baselinePose);
    const changedPose = makePose({ yawDegrees: 5 });

    const snapshot = monitor.process({ timestampMs: 5_100, face: makeFace(false), pose: changedPose });
    expect(snapshot.baselineDeviated).toBe(true);
    expect(snapshot.baselineGuide).not.toBeNull();
    expect(snapshot.baselineGuide?.faceX).toBeGreaterThan(0);
    expect(snapshot.baselineGuide?.faceX).toBeLessThan(1);
    expect(snapshot.baselineGuide?.faceHeight).toBeGreaterThan(0);
    expect(snapshot.baselineGuide?.shoulderWidth).toBeGreaterThan(0);
    expect(snapshot.status).toBe("NORMAL");
    expect(snapshot.trigger).toBe("NONE");
    expect(snapshot.eyesClosed).toBe(false);
    expect(snapshot.headDown).toBe(false);
  });

  it("사선 촬영에서도 얼굴과 상체가 함께 내려가면 실제 고개 숙임으로 판정한다", () => {
    const sidePose = makePose({ yawDegrees: 55 });
    const monitor = calibratedMonitor(sidePose);
    const loweredFace = makeFace(false);
    loweredFace[1] = { ...loweredFace[1], y: loweredFace[1].y + 0.08 };
    const loweredPose = makePose({ yawDegrees: 55, verticalDrop: 0.1 });

    monitor.process({ timestampMs: 5_100, face: loweredFace, pose: loweredPose });
    const warning = monitor.process({ timestampMs: 7_100, face: loweredFace, pose: loweredPose });
    expect(warning.status).toBe("WARNING");
    expect(warning.headDown).toBe(true);
    expect(warning.trigger).toBe("HEAD_ONLY");
  });

  it("잠깐 아래를 보거나 가볍게 끄덕인 정도는 고개 숙임으로 처리하지 않는다", () => {
    const monitor = calibratedMonitor();
    const glanceDown = makeFace(false);
    glanceDown[1] = { ...glanceDown[1], y: glanceDown[1].y + 0.04 };
    monitor.process({ timestampMs: 5_100, face: glanceDown, pose: makePose({ verticalDrop: 0.03 }) });
    const normal = monitor.process({ timestampMs: 7_100, face: glanceDown, pose: makePose({ verticalDrop: 0.03 }) });
    expect(normal.status).toBe("NORMAL");
    expect(normal.headDown).toBe(false);
    expect(normal.trigger).toBe("NONE");
  });

  it("얼굴과 머리가 충분히 크게 내려간 상태가 2초 지속되면 경고한다", () => {
    const monitor = calibratedMonitor();
    const loweredHead = makeFace(false);
    loweredHead[1] = { ...loweredHead[1], y: loweredHead[1].y + 0.08 };
    const loweredPose = makePose({ verticalDrop: 0.1 });
    monitor.process({ timestampMs: 5_100, face: loweredHead, pose: loweredPose });
    const warning = monitor.process({ timestampMs: 7_100, face: loweredHead, pose: loweredPose });
    expect(warning.status).toBe("WARNING");
    expect(warning.trigger).toBe("HEAD_ONLY");
    expect(warning.message).toBe("고개 숙임이 2초 이상 감지됐습니다.");
  });
});

function calibratedMonitor(pose = makePose()): DriverMonitor {
  const monitor = new DriverMonitor();
  monitor.begin();
  for (let time = 0; time <= CALIBRATION_DURATION_MS; time += 100) monitor.process(frame(time, false, pose));
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

function shiftedFace(horizontalShift: number): Landmark[] {
  return makeFace(false).map((point) => ({ ...point, x: point.x + horizontalShift }));
}

const RIGHT_EYE_TEST = [33, 160, 158, 133, 153, 144];
const LEFT_EYE_TEST = [362, 385, 387, 263, 373, 380];

function setEyeOpening(face: Landmark[], indices: number[], ratio: number): void {
  const left = face[indices[0]].x;
  const right = face[indices[3]].x;
  const halfGap = (right - left) * ratio / 2;
  face[indices[1]].y = 0.45 - halfGap;
  face[indices[2]].y = 0.45 - halfGap;
  face[indices[4]].y = 0.45 + halfGap;
  face[indices[5]].y = 0.45 + halfGap;
}

function rotateFace(face: Landmark[], degrees: number): Landmark[] {
  const radians = degrees * Math.PI / 180;
  return face.map((point) => {
    const x = point.x - 0.5;
    const y = point.y - 0.5;
    return {
      ...point,
      x: 0.5 + x * Math.cos(radians) - y * Math.sin(radians),
      y: 0.5 + x * Math.sin(radians) + y * Math.cos(radians),
    };
  });
}

function makePose(options: { yawDegrees?: number; rightShoulderDrop?: number; forwardShift?: number; verticalDrop?: number; headSideShift?: number; torsoLean?: number; raisedArm?: "LEFT" | "RIGHT" } = {}): Landmark[] {
  const landmarks = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 1 }));
  const forwardShift = options.forwardShift ?? 0;
  const verticalDrop = options.verticalDrop ?? 0;
  const headSideShift = options.headSideShift ?? 0;
  const torsoLean = options.torsoLean ?? 0;
  landmarks[0] = { x: 0.5 + headSideShift + torsoLean, y: 0.25 + verticalDrop, z: -0.1 - forwardShift, visibility: 1 };
  landmarks[7] = { x: 0.45 + headSideShift + torsoLean, y: 0.32 + verticalDrop, z: -0.08 - forwardShift, visibility: 1 };
  landmarks[8] = { x: 0.55 + headSideShift + torsoLean, y: 0.32 + verticalDrop, z: -0.08 - forwardShift, visibility: 1 };
  landmarks[11] = { x: 0.38 + torsoLean, y: 0.6, z: 0, visibility: 1 };
  landmarks[12] = { x: 0.62 + torsoLean, y: 0.6 + (options.rightShoulderDrop ?? 0), z: 0, visibility: 1 };
  landmarks[13] = { x: 0.32 + torsoLean, y: 0.74, z: 0, visibility: 1 };
  landmarks[14] = { x: 0.68 + torsoLean, y: 0.74, z: 0, visibility: 1 };
  landmarks[15] = { x: 0.29 + torsoLean, y: 0.88, z: 0, visibility: 1 };
  landmarks[16] = { x: 0.71 + torsoLean, y: 0.88, z: 0, visibility: 1 };
  if (options.raisedArm === "LEFT") {
    landmarks[13] = { x: 0.3 + torsoLean, y: 0.48, z: 0, visibility: 1 };
    landmarks[15] = { x: 0.28 + torsoLean, y: 0.35, z: 0, visibility: 1 };
  }
  if (options.raisedArm === "RIGHT") {
    landmarks[14] = { x: 0.7 + torsoLean, y: 0.48, z: 0, visibility: 1 };
    landmarks[16] = { x: 0.72 + torsoLean, y: 0.35, z: 0, visibility: 1 };
  }
  landmarks[23] = { x: 0.42, y: 0.92, z: 0, visibility: 1 };
  landmarks[24] = { x: 0.58, y: 0.92, z: 0, visibility: 1 };
  const yaw = (options.yawDegrees ?? 0) * Math.PI / 180;
  if (yaw !== 0) {
    for (const index of [0, 7, 8, 11, 12, 23, 24]) {
      const point = landmarks[index];
      const x = point.x - 0.5;
      const z = point.z;
      point.x = 0.5 + x * Math.cos(yaw) + z * Math.sin(yaw);
      point.z = -x * Math.sin(yaw) + z * Math.cos(yaw);
    }
    landmarks[7].visibility = 0.2;
    landmarks[11].visibility = 0.25;
    landmarks[23].visibility = 0.25;
  }
  return landmarks;
}
