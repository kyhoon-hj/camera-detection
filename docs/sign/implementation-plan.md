# SIGN LOOP 1 — 구현 계획

## 구현 결과 (2026-07-19)

SIGN LOOP 1 공통 입력 계층 구현을 완료했다.

- `SignFeatureFrame`, 품질 보고서, 신체 기준 정규화 스키마 추가
- 같은 프레임/타임스탬프의 Face, Pose, Left/Right Hand 결합
- 어깨 중심·어깨 폭 기준 좌표와 프레임 간 속도 계산
- 손·얼굴·상체 누락, 좌우 불안정, 경계 이탈, 저조도, 블러, 시간 역행 품질 게이트
- KSL 모드에서 품질 통과 전에는 모델을 호출하지 않음
- 일반 제스처와 졸음운전 모드에서는 KSL 입력을 생성하지 않음
- 진단 API는 좌표를 제외한 품질·스키마 정보만 기본 노출
- Python 60개, TypeScript 26개 테스트, Ruff, strict mypy, 전체 빌드 통과

## 변경 범위

런타임 공통 계약은 유지하고 KSL 전용 모듈과 선택 진단 경로를 추가했다. 학습 모델, Gloss 번역, TTS/STT 기능은 이번 LOOP 범위에 포함하지 않았다.

## 제안 모듈 경계

```text
existing FramePacket + FeatureFrame
  -> ksl/input/assembler.py
  -> ksl/input/quality.py
  -> ksl/input/normalize.py
  -> SignFeatureFrame
  -> later SIGN LOOP recognizers
```

기존 `CoreRuntime._inference_loop`는 일반 제스처와 졸음운전 흐름을 유지한다. `SIGN_LANGUAGE_KSL` 모드에서만 KSL assembler를 호출하며, KSL 품질이 실패하면 후보 확정을 건너뛰고 안내 상태만 노출한다.

## 변경 예정 파일

| 파일 | 구현 내용 |
|---|---|
| `packages/suha-core/src/suha_core/ksl/schema.py` | KSL 프레임, 품질, 정규화 dataclass와 직렬화 |
| `packages/suha-core/src/suha_core/ksl/input.py` | 기존 `FeatureFrame`을 KSL 공통 입력으로 조립 |
| `packages/suha-core/src/suha_core/ksl/quality.py` | 부위 누락, 프레이밍, 조명, 블러, 다중 인물 정책 |
| `packages/suha-core/src/suha_core/ksl/normalization.py` | 어깨 중심/폭, 좌표·속도·각도 정규화 |
| `packages/suha-core/src/suha_core/landmarks/providers.py` | handedness score, 얼굴 visibility, 검출 개수의 보존 |
| `packages/suha-core/src/suha_core/domain/models.py` | 기존 계약을 깨지 않는 선택 메타데이터 보강 |
| `packages/suha-core/src/suha_core/pipeline/runtime.py` | KSL 모드 전용 assembler/quality 분기 |
| `apps/core-server/src/suha_server/main.py` | KSL 입력 진단 조회 API 추가 |
| `tests/unit/test_ksl_input.py` | 동기화, 미러링, 좌우 교차, 품질 코드 테스트 |
| `tests/integration/test_api.py` | KSL 비활성/품질 실패/정상 응답 회귀 테스트 |
| `apps/driver-mobile/src/sign-vision.ts` | 모바일 KSL 화면 구현 시 후속 추가; 기존 운전자 엔진은 변경하지 않음 |

## 라이브러리

- 서버: 기존 `mediapipe`, `numpy`, `opencv-python` 범위에서 LOOP 1 구현 가능하다.
- 모바일: 기존 `@mediapipe/tasks-vision`으로 HandLandmarker를 추가할 수 있다.
- 신규 외부 의존성은 우선 추가하지 않는다.
- 비수지 표현 고도화나 다중 인물 추적이 필요해질 때만 별도 라이브러리를 평가한다.

## 구현 순서

1. `SignFeatureFrame` 및 품질 코드 타입을 추가한다.
2. 합성 `FeatureFrame` fixture로 조립·미러링·정규화 테스트를 먼저 작성한다.
3. MediaPipe provider가 handedness score, 검출 개수, 얼굴 품질을 보존하도록 확장한다.
4. KSL 전용 품질 게이트를 추가하고 실패 시 후보 확정을 막는다.
5. `SIGN_LANGUAGE_KSL` 분기에만 assembler를 연결한다.
6. 진단 API에서 원본 좌표가 아닌 품질·가이드·스키마 버전을 노출한다.
7. 실제 카메라로 오른손/왼손/양손/가림/저조도 매트릭스를 검증한다.
8. 전체 기존 게이트를 다시 실행해 일반 제스처와 졸음운전 회귀가 없음을 확인한다.

## 성능 위험과 방어

| 위험 | 영향 | 방어 |
|---|---|---|
| Face/Pose/Hands 순차 추론 | CPU FPS 저하 | KSL 모드에서만 전체 모델 사용, 분석 해상도 제한 |
| 모바일 Hand 모델 상시 로드 | 초기화·메모리·발열 증가 | `SignVisionEngine` 지연 로드, 화면 종료 시 close |
| 파생 각도·속도 계산 | 프레임 지연 증가 | NumPy 벡터화, 필요한 상체/손 점만 계산 |
| 다중 큐/후처리 | 오래된 프레임 누적 | 기존 max=2 `DROP_OLDEST` 유지 |
| 손 교차 identity 보정 | 잘못된 손 전환 | 짧은 temporal tracker와 불확실 시 차단 정책 |

성능 기준은 서버 CPU에서 KSL 입력 12 FPS 이상을 1차 목표로 두고, 캡처 지연 p95 150ms 이하, 메모리 누수 없음, stop 후 카메라 핸들 해제를 확인한다. 기존 `PEN_DRAW`와 `DROWSINESS_MONITOR` FPS는 현재 기준 대비 5% 이상 악화되면 실패로 본다.

## 개인정보 위험과 방어

- 얼굴·손 랜드마크도 민감 데이터로 취급한다.
- 진단 API는 기본적으로 좌표 전체를 외부에 노출하지 않는다.
- 이벤트 DB에는 번역에 필요한 최소 결과만 남기고 프레임 특징은 보관하지 않는다.
- 데이터 수집은 기존 `CONSENT_REQUIRED`를 유지하고 KSL 목적·보존 기간을 추가한다.
- 앱 종료, 모드 종료, 오류 시 카메라와 임시 시퀀스 버퍼를 즉시 해제한다.
- 사용자 교정 데이터는 별도 동의 없이는 학습 큐에 넣지 않는다.

## 회귀 방지 테스트

```powershell
.\.venv\Scripts\python.exe -m pytest
.\.venv\Scripts\ruff.exe check .
.\.venv\Scripts\python.exe -m mypy packages\suha-core\src
pnpm -r test
pnpm -r build
```

추가로 다음을 통과해야 한다.

- KSL 모드가 비활성 모델에서 계속 `KSL_MODEL_NOT_ACTIVE`를 반환한다.
- 일반 제스처 모드의 후보와 이벤트가 이전과 동일하다.
- 졸음운전 모바일 엔진이 Hand 모델을 로드하지 않는다.
- 원본 영상 비저장 수집에서 영상 파일이 생성되지 않는다.
- 동일 타임스탬프, 미러링, 좌·우 손, 필수 부위 누락 테스트가 통과한다.

## 다음 결정 게이트

SIGN LOOP 1 자동 검증은 완료됐다. LOOP 2의 20개 표현 분류로 넘어가기 전에 실제 사람을 대상으로 한 좌·우 손, 양손 교차, 가림, 조명 품질 매트릭스와 전문가 데이터 검수 체계를 통과해야 한다.
