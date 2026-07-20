# SIGN LOOP 1 — Feature Schema

## 스키마 원칙

- 영상 프레임 하나당 `SignFeatureFrame` 하나를 생성한다.
- 모든 하위 결과는 같은 `frameId`, `sourceTimestampMs`, 미러링 상태를 공유한다.
- 좌표는 원본 정규화 좌표와 신체 기준 정규화 좌표를 구분한다.
- 누락은 빈 배열이 아니라 `null`과 사유 코드로 표현한다.
- 모델 입력에 영향을 주는 변경은 `schemaVersion` 또는 `normalizationVersion`을 올린다.
- 원본 RGB는 이 계약에 포함하지 않는다.

## 제안 타입

```text
SignFeatureFrame
├ schemaVersion: "1.0"
├ frameId: cameraId + sequence
├ cameraId / sessionId / sequence
├ sourceTimestampMs / processedTimestampMs
├ image: width, height, mirrored, rotationDegrees
├ subject: personId, trackingState, dominantHand
├ landmarks
│  ├ leftHand: LandmarkGroup | null
│  ├ rightHand: LandmarkGroup | null
│  ├ pose: LandmarkGroup | null
│  └ face: LandmarkGroup | null
├ normalized
│  ├ origin / shoulderWidth / scale
│  ├ leftHand / rightHand / upperBody
│  ├ jointAngles / velocities
│  └ normalizationVersion
├ nonManual
│  ├ eyebrow / head / mouth / gaze
│  └ extractorVersion
├ quality
│  ├ metrics
│  ├ issues[]
│  ├ readyForRecognition
│  └ guidanceCode
└ provenance: provider, model versions, runtime
```

## JSON 예시

```json
{
  "schemaVersion": "1.0",
  "frameId": "laptop-front:1842",
  "cameraId": "laptop-front",
  "sessionId": "ses_example",
  "sequence": 1842,
  "sourceTimestampMs": 1721379600123,
  "processedTimestampMs": 1721379600161,
  "image": {
    "width": 640,
    "height": 480,
    "mirrored": true,
    "rotationDegrees": 0
  },
  "subject": {
    "personId": "person-001",
    "trackingState": "TRACKED",
    "dominantHand": "UNKNOWN"
  },
  "landmarks": {
    "leftHand": {"count": 21, "points": [], "meanVisibility": 0.93, "handednessScore": 0.96},
    "rightHand": {"count": 21, "points": [], "meanVisibility": 0.91, "handednessScore": 0.95},
    "pose": {"count": 33, "points": [], "meanVisibility": 0.89},
    "face": {"count": 478, "points": [], "meanVisibility": 0.88}
  },
  "normalized": {
    "origin": [0.51, 0.39, 0.0],
    "shoulderWidth": 0.27,
    "scale": 3.7037,
    "leftHand": [],
    "rightHand": [],
    "upperBody": [],
    "jointAngles": {},
    "velocities": {},
    "normalizationVersion": "ksl-body-v1"
  },
  "nonManual": {
    "eyebrow": "UNKNOWN",
    "head": "NEUTRAL",
    "mouth": "UNKNOWN",
    "gaze": "UNKNOWN",
    "extractorVersion": "none"
  },
  "quality": {
    "metrics": {
      "brightness": 0.62,
      "sharpness": 0.78,
      "leftHandVisibility": 0.93,
      "rightHandVisibility": 0.91,
      "poseVisibility": 0.89,
      "faceVisibility": 0.88,
      "framingScore": 0.94,
      "syncSkewMs": 0
    },
    "issues": [],
    "readyForRecognition": true,
    "guidanceCode": "READY"
  },
  "provenance": {
    "provider": "mediapipe-tasks",
    "handModel": "hand_landmarker.task",
    "poseModel": "pose_landmarker_lite.task",
    "faceModel": "face_landmarker.task",
    "runtime": "local"
  }
}
```

## 품질 이슈 코드

| 코드 | 의미 | 결과 정책 |
|---|---|---|
| `NO_PERSON` | 얼굴과 상체를 찾지 못함 | 확정 금지 |
| `MULTIPLE_PEOPLE` | 여러 사람이 동시에 등장 | 확정 금지 |
| `FACE_MISSING` | 얼굴 미검출 | 전문 KSL 확정 금지 |
| `LEFT_HAND_MISSING` | 왼손 미검출 | 양손 표현 확정 금지 |
| `RIGHT_HAND_MISSING` | 오른손 미검출 | 양손 표현 확정 금지 |
| `HAND_OCCLUDED` | 손 가림 또는 visibility 급락 | 후보 누적 일시정지 |
| `BODY_OUT_OF_FRAME` | 어깨·상체 일부가 화면 밖 | 확정 금지 |
| `HAND_OUT_OF_FRAME` | 손이 프레임 경계 밖 | 후보 누적 일시정지 |
| `LOW_LIGHT` | 저조도 | 재촬영 안내 |
| `BACKLIGHT` | 역광 추정 | 위치 변경 안내 |
| `MOTION_BLUR` | 움직임 블러 | 후보 누적 일시정지 |
| `TOO_NEAR` / `TOO_FAR` | 프레이밍 불량 | 거리 안내 |
| `IDENTITY_UNSTABLE` | 좌우 손 또는 사람 추적 불안정 | 확정 금지 |
| `TIMESTAMP_REGRESSION` | 시간 역행/중복 | 프레임 폐기 |

## 기존 타입과의 호환

초기 구현은 기존 `FeatureFrame`을 제거하지 않는다. `SignFeatureFrame`은 KSL 모드에서 `FeatureFrame`을 입력으로 만드는 별도 변환 계층으로 둔다. 기존 recognizer와 운전자 모듈은 변경 없이 기존 계약을 소비하고, KSL recognizer만 새 스키마를 소비한다.

