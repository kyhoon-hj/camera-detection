# SIGN LOOP 1 — 현재 수어 입력 아키텍처

## 결론

현재 서버 코어에는 한국수어 공통 입력의 기반이 이미 있다. 하나의 `FramePacket.timestamp_ms`를 MediaPipe Hand, Pose, Face 세 작업에 전달하고, 결과를 하나의 `FeatureFrame`으로 결합한다. 양손은 handedness에 따라 `left_hand`와 `right_hand`로 분리된다. 다만 이 구조는 일반 제스처 중심이며, 전문 수어에 필요한 입력 유효성, 좌우 교차 안정화, 정규화 버전, 비수지 특징, 다중 인물 거부 사유가 아직 명시적 계약으로 존재하지 않는다.

## 현재 서버 경로

```text
CameraAdapter
  -> FramePacket(camera_id, sequence, timestamp_ms, RGB)
  -> bounded queue(max=2, DROP_OLDEST)
  -> MediaPipeLandmarkProvider.process(frame, session_id)
       -> HandLandmarker.detect_for_video(timestamp_ms)
       -> PoseLandmarker.detect_for_video(timestamp_ms)
       -> FaceLandmarker.detect_for_video(timestamp_ms)
  -> FeatureFrame
       -> left_hand / right_hand / pose / face / quality
  -> mode-specific recognizer
  -> stabilizer -> event bus -> REST/WebSocket
```

관련 구현:

- `packages/suha-core/src/suha_core/domain/models.py`: `FramePacket`, `LandmarkSet`, `FrameQuality`, `FeatureFrame`
- `packages/suha-core/src/suha_core/landmarks/providers.py`: MediaPipe Tasks 초기화 및 프레임 결합
- `packages/suha-core/src/suha_core/pipeline/runtime.py`: 캡처·추론 스레드, 모드 분기, 이벤트 발행
- `packages/suha-core/src/suha_core/recording/capture.py`: 동의 기반 랜드마크/영상 수집
- `packages/suha-core/src/suha_core/models/learned_dynamic.py`: 제한 단어 `ISOLATED_SIGN` 추론

## 이미 확보된 장점

- Face, Pose, Hand 추론에 같은 입력 프레임과 같은 타임스탬프를 사용한다.
- 두 손을 최대 2개까지 검출하고 좌·우 필드로 분리한다.
- 얼굴·양손·상체를 한 `FeatureFrame`에 묶어 후속 인식기 입력을 단일화한다.
- 캡처와 추론을 분리하고 오래된 프레임을 버려 실시간 지연 누적을 막는다.
- 원본 영상은 기본 저장하지 않고, 수집은 명시적 동의가 있어야 시작된다.
- KSL 모델은 `SIGN_LANGUAGE_KSL` 모드와 활성 모델이 있을 때만 사용된다.
- 실제 모델이 없을 때 KSL 자유 문장을 지원한다고 표시하지 않는다.

## 전문 수어 입력 관점의 차이

| 영역 | 현재 상태 | SIGN LOOP 1 보완점 |
|---|---|---|
| 동기화 | 같은 프레임 타임스탬프로 세 Task를 순차 호출 | 결과별 원본/완료 시각과 동기화 오차 계약 추가 |
| 양손 | MediaPipe handedness를 즉시 좌·우로 매핑 | 미러링 정책, 교차·가림 시 identity 유지 필요 |
| 품질 | 밝기, 블러, 손/포즈 평균 visibility | 얼굴, 양손 개별, 프레이밍, 다중 인물, 결과 확정 가능 여부 필요 |
| 정규화 | 정규화 좌표를 그대로 전달 | 어깨 중심/폭, dominant hand, 속도, 관절각의 버전 고정 필요 |
| 비수지 | 얼굴 랜드마크 원본만 존재 | 눈썹, 고개, 입 모양의 파생 특징 계약 필요 |
| 사람 추적 | 검출되면 고정 `person-001` | 다중 인물 거부 및 단일 화자 추적 정책 필요 |
| 데이터 계약 | `FeatureFrame` 내부 Python dataclass | KSL 전용 버전 스키마 및 직렬화 계약 필요 |
| 사용자 안내 | 일반 brightness/blur/visibility | 화면 밖, 가림, 역광, 너무 멀거나 가까움 등 안내 코드 필요 |

## 모바일 운전자 모듈과의 경계

`apps/driver-mobile/src/vision.ts`는 Face와 Pose만 초기화해 졸음·자세를 로컬 계산한다. KSL을 위해 Hand 모델을 이 클래스에 무조건 추가하면 초기화 시간, 메모리, 발열, FPS가 모두 악화될 수 있다. 따라서 다음 경계를 유지한다.

```text
DriverVisionEngine (기존 유지)
  Face + Pose -> drowsiness/posture

SignVisionEngine (신규, KSL 화면에서만 생성)
  Face + Pose + Hands -> SignFeatureFrame

공유 가능 영역
  timestamp policy / coordinate types / quality codes / lifecycle helpers
```

KSL 모드 진입 전에는 Hand 모델을 로드하지 않는다. 화면 전환 시 기존 엔진을 닫은 뒤 새 엔진을 열거나, 기기 성능이 검증된 경우에만 명시적으로 동시 실행한다.

## LOOP 1 완료 기준

- 한 프레임에서 Face, Pose, Left Hand, Right Hand가 동일한 `frameId`와 `timestampMs`를 가진다.
- 품질 실패 시 인식 후보를 확정하지 않고 구조화된 안내 코드를 반환한다.
- 미러링과 좌·우 손 정책이 테스트로 고정된다.
- KSL 기능을 끈 상태의 일반 제스처·졸음운전 결과와 성능이 회귀하지 않는다.
- 원본 영상 저장은 기본 비활성이고, 저장 시 동의·목적·삭제 정책이 기록된다.

## 구현 상태

자동화 가능한 LOOP 1 항목은 완료됐다. `suha_core.ksl` 아래에 스키마, 품질 평가, 정규화, 입력 assembler가 추가됐고 `SIGN_LANGUAGE_KSL` 모드에서만 실행된다. `/v1/cameras/{camera_id}/sign-input`은 기본적으로 좌표를 제외한 진단 결과를 제공한다. 실제 농인 수어 사용자·통역사와 함께하는 카메라 품질 매트릭스는 외부 검수 단계로 남아 있다.
