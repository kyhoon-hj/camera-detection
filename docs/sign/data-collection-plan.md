# SIGN LOOP 1 — 데이터 수집 계획

## 목적

이 단계의 수집 목적은 단어 모델 학습이 아니라 공통 입력 계층의 동기화, 좌·우 손 안정성, 품질 판정, 정규화가 다양한 환경에서 재현되는지 검증하는 것이다. 승인되지 않은 자료를 정식 사전이나 학습 데이터로 사용하지 않는다.

## LOOP 1 검증 세트

최소 5명의 동의한 성인을 대상으로 각 조건 3회, 5~10초의 짧은 클립을 수집한다. 실제 운영 전에는 농인 수어 사용자와 한국수어 통역사의 검수 계획을 별도로 승인받는다.

| 축 | 조건 |
|---|---|
| 손 사용 | 오른손 우세, 왼손 우세, 양손 대칭, 양손 비대칭 |
| 동작 | 정지, 느림, 보통, 빠름, 반복 |
| 가림 | 손-손 교차, 손-얼굴 교차, 한 손 부분 가림 |
| 위치 | 중앙, 좌/우 경계, 위/아래 경계, 가까움, 멀리 있음 |
| 조명 | 정상, 저조도, 역광, 밝은 배경 |
| 배경 | 단순, 복잡, 피부색과 유사한 배경 |
| 카메라 | 미러 미리보기, 비미러 저장, 0/90/270도 회전 |
| 인원 | 0명, 1명, 2명 이상 |

## 수집 레코드

```text
captureId / sampleId / anonymousSignerId
consentId / consentScope / retentionUntil
deviceClass / cameraFacing / resolution / fps
mirrored / rotationDegrees / lightingCondition
sourceTimestampMs / sequence
Face / Pose / Left Hand / Right Hand landmarks
quality metrics / issue codes / readyForRecognition
manual review: expectedVisibleParts / handedness / pass-fail / notes
```

Gloss, 번역, 비수지 의미 라벨은 LOOP 1 필수값이 아니다. 잘못된 의미 라벨의 조기 축적을 피하기 위해 전문가 검수 체계가 준비된 뒤 추가한다.

## 개인정보 및 저장 정책

- 일반 사용 중 영상과 랜드마크는 저장하지 않는다.
- 검증 수집은 목적, 보존 기간, 저장 항목을 명시한 동의 후에만 시작한다.
- 기본값은 랜드마크 저장이며 원본 영상 저장은 별도 선택이다.
- 의료·법률·금융·긴급 대화는 LOOP 1 데이터로 수집하지 않는다.
- 촬영자 ID는 단방향 익명화하고 연락처와 분리한다.
- 삭제 요청은 영상, 랜드마크, 파생 특징, 인덱스를 함께 제거한다.
- 접근 로그와 승인 이력을 남기고 승인 데이터만 후속 학습 후보에 넣는다.
- 외부 KSL 데이터는 `docs/KSL_DATA_LICENSE_CHECKLIST.md` 검토를 통과해야 한다.

## 품질 승인 기준

- 동일 프레임의 모든 결과가 같은 `sourceTimestampMs`를 가진다.
- 타임스탬프 역행과 중복 프레임이 0건이다.
- 단일 인물 정상 조건에서 좌·우 손 identity 유지율이 99% 이상이다.
- 손 교차 후 identity 복구 시간이 300ms 이내이거나 `IDENTITY_UNSTABLE`로 차단된다.
- 필수 부위 누락 조건에서 `readyForRecognition=false`가 100% 적용된다.
- 정상 조건의 잘못된 차단률은 5% 이하를 목표로 한다.
- 원본 영상 비저장 설정에서 MP4/JPEG가 생성되지 않는다.

## 데이터 분할

향후 모델 학습으로 전환할 때는 프레임 단위가 아니라 촬영자 단위로 train/validation/test를 분리한다. 동일 촬영자 또는 동일 연속 클립이 여러 분할에 들어가지 않도록 한다. 왼손잡이, 조명, 배경 조건별 지표를 별도로 보고한다.

