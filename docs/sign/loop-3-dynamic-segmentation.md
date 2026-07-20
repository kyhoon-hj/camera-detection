# SIGN LOOP 3 — 동적 수어 구간 감지

## 구현 결과

KSL 전용 시퀀스 상태 머신을 구현해 손이 나타난 모든 프레임을 무제한 모델 버퍼에 넣지 않고, 시작과 종료가 정의된 구간만 모델 추론에 전달한다.

```text
IDLE
  -> ACTIVE       양손 움직임 또는 250ms 정적 유지
  -> OCCLUDED     활성 구간 중 한 손 이상 누락
  -> ACTIVE       300ms 안에 양손 복구
  -> ENDED        450ms 움직임 정지 또는 최대 8초
  -> ENDED        손 가림이 300ms를 초과하면 폐기
```

## 기본 정책

| 항목 | 값 |
|---|---:|
| 움직임 시작 속도 | 정규화 화면 좌표 기준 초당 0.18 |
| 정적 표현 시작 대기 | 250ms |
| 움직임 종료 속도 | 초당 0.045 이하 |
| 종료 유지시간 | 450ms |
| 손 가림 유예 | 300ms |
| 최소 구간 | 300ms, 6프레임 |
| 최대 구간 | 8초 |

임계값은 초기 안전값이며 실제 농인 수어 사용자 데이터로 빠른/느린 수어, 왼손잡이, 양손 교차 조건을 측정한 뒤 조정해야 한다.

## 상태 응답

`GET /v1/cameras/{cameraId}/sign-input`의 `segment` 필드:

```json
{
  "state": "ACTIVE",
  "segmentId": "kslseg_uuid",
  "started": false,
  "ended": false,
  "acceptFrame": true,
  "sequenceReady": false,
  "frameCount": 12,
  "durationMs": 420,
  "motionSpeed": 0.21,
  "occlusionMs": 0,
  "endReason": null
}
```

종료 사유:

- `MOTION_SETTLED`: 정상 동작 종료
- `MAX_DURATION`: 최대 길이 도달
- `HAND_OCCLUSION`: 손 가림 유예 초과, 학습·번역 후보로 확정하지 않음

## 모델과 버퍼 수명

- KSL 모드에서만 segmenter가 실행된다.
- `acceptFrame=true`이고 SIGN LOOP 1 품질 게이트도 통과한 프레임만 ONNX 모델에 전달한다.
- 종료 시 최종 후보를 만든 뒤 해당 세션의 모델 시퀀스 버퍼를 초기화한다.
- 후보에는 `segmentId`, `segmentState`, `sequenceReady`를 기록한다.
- 일반 제스처와 졸음운전 모드는 segmenter 상태와 비용을 갖지 않는다.

## 시퀀스 저장

동의 기반 `POST /v1/sign/capture/sessions`로 세션을 만들고 기존 capture start/mark/stop API를 사용하면 프레임별 랜드마크가 동일 세션의 `landmarks.jsonl`에 시간순으로 저장된다. 원본 영상은 명시적으로 `saveVideo=true`를 선택한 경우에만 저장한다. 전문 검수 전 세션은 `PENDING`이며 학습 준비도에 포함되지 않는다.

## 완료 상태

- 정적 유지 및 움직임 시작 감지: 완료
- 정지 및 최대 길이 종료: 완료
- 일시 손 가림 복구: 완료
- 장기 손 가림 폐기: 완료
- 모델 버퍼 구간별 초기화: 완료
- 시퀀스 ID와 후보 추적: 완료
- 실제 사용자 속도·가림 임계값 검증: 미진행
- Transformer 비교: 실제 승인 데이터 확보 후 진행
