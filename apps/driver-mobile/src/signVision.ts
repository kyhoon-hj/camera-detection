import {
  FaceLandmarker,
  FilesetResolver,
  HandLandmarker,
  PoseLandmarker,
  type FaceLandmarkerResult,
  type HandLandmarkerResult,
  type PoseLandmarkerResult,
} from "@mediapipe/tasks-vision";

const WASM_ROOT = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm";
const FACE_MODEL = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";
const POSE_MODEL = "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task";
const HAND_MODEL = "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

export type SignFrameQuality = {
  face: boolean;
  upperBody: boolean;
  leftHand: boolean;
  rightHand: boolean;
  ready: boolean;
  guidance: string;
};

export function getSignFrameQuality(
  face: FaceLandmarkerResult,
  pose: PoseLandmarkerResult,
  hands: HandLandmarkerResult,
): SignFrameQuality {
  const handedness = hands.handedness.flat().map((item) => item.categoryName.toLowerCase());
  // Mirrored selfie video reverses the user's visual left/right, while MediaPipe
  // reports anatomical handedness. Keep the anatomical labels in state.
  const leftHand = handedness.includes("left");
  const rightHand = handedness.includes("right");
  const faceVisible = face.faceLandmarks.length > 0;
  const poseLandmarks = pose.landmarks[0];
  const upperBody = Boolean(poseLandmarks?.[11] && poseLandmarks?.[12]);
  const ready = faceVisible && upperBody && leftHand && rightHand;
  const guidance = !faceVisible
    ? "얼굴이 화면 중앙에 보이도록 맞춰 주세요."
    : !upperBody
      ? "양쪽 어깨와 상체가 보이도록 조금 뒤로 이동해 주세요."
      : !leftHand || !rightHand
        ? "양손이 모두 화면 안에 보이도록 맞춰 주세요."
        : "얼굴·양손·상체 입력이 준비되었습니다.";
  return { face: faceVisible, upperBody, leftHand, rightHand, ready, guidance };
}

export class SignVisionEngine {
  private face: FaceLandmarker | null = null;
  private pose: PoseLandmarker | null = null;
  private hands: HandLandmarker | null = null;

  async initialize(): Promise<void> {
    this.close();
    const files = await FilesetResolver.forVisionTasks(WASM_ROOT);
    try {
      await this.initializeWithDelegate(files, "GPU");
    } catch {
      this.close();
      await this.initializeWithDelegate(files, "CPU");
    }
  }

  private async initializeWithDelegate(files: Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>>, delegate: "GPU" | "CPU") {
    const face = await FaceLandmarker.createFromOptions(files, {
        runningMode: "VIDEO",
        baseOptions: { modelAssetPath: FACE_MODEL, delegate },
        numFaces: 1,
        minFaceDetectionConfidence: 0.5,
        minFacePresenceConfidence: 0.5,
        minTrackingConfidence: 0.45,
      });
    try {
      const pose = await PoseLandmarker.createFromOptions(files, {
        runningMode: "VIDEO",
        baseOptions: { modelAssetPath: POSE_MODEL, delegate },
        numPoses: 1,
        minPoseDetectionConfidence: 0.45,
        minPosePresenceConfidence: 0.45,
        minTrackingConfidence: 0.4,
      });
      try {
        const hands = await HandLandmarker.createFromOptions(files, {
        runningMode: "VIDEO",
        baseOptions: { modelAssetPath: HAND_MODEL, delegate },
        numHands: 2,
        minHandDetectionConfidence: 0.45,
        minHandPresenceConfidence: 0.45,
        minTrackingConfidence: 0.4,
        });
        this.face = face;
        this.pose = pose;
        this.hands = hands;
      } catch (cause) {
        pose.close();
        throw cause;
      }
    } catch (cause) {
      face.close();
      throw cause;
    }
  }

  detect(video: HTMLVideoElement, timestampMs: number): SignFrameQuality {
    if (!this.face || !this.pose || !this.hands) throw new Error("수어 입력 엔진이 준비되지 않았습니다.");
    return getSignFrameQuality(
      this.face.detectForVideo(video, timestampMs),
      this.pose.detectForVideo(video, timestampMs),
      this.hands.detectForVideo(video, timestampMs),
    );
  }

  close(): void {
    this.face?.close();
    this.pose?.close();
    this.hands?.close();
    this.face = null;
    this.pose = null;
    this.hands = null;
  }
}
