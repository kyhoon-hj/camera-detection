# SIGN LOOP 5 — Gloss에서 한국어로 변환

## 구현 결과

세션별 Gloss 시퀀스를 의미 토큰으로 바꾸고, 결정적 규칙과 자연어 후처리를 거쳐 최대 3개의 한국어 문장 후보를 생성한다. 사용자는 후보를 확정하거나 직접 수정하거나 번역을 거절할 수 있다.

이 구현은 `KSL_RULE_V1` 규칙 엔진이며 외부 AI 서비스에 수어·Gloss·문장을 전송하지 않는다. 20개 핵심 표현과 제한된 조합을 위한 초기 번역 계층이므로 자유 대화를 완전하게 번역한다고 표시하지 않는다.

## 처리 흐름

```text
종료 구간별 Gloss 토큰
  -> 코드 정규화(KSL_ 접두사 제거)
  -> 의미 토큰 생성
  -> 조합 규칙 적용
  -> 공백·문장부호 자연어 후처리
  -> 최대 3개 후보와 신뢰도
  -> 사용자 확정·수정·거절
```

예시:

```text
Gloss: 병원 / 어디 / 부탁
의미: ENTITY:HOSPITAL / INTENT:LOCATION_REQUEST / STYLE:POLITE

1. 병원이 어디에 있는지 알려주세요.
2. 병원 위치를 알려주세요.
3. 병원에 가는 길을 안내해주세요.
```

현재 조합 규칙은 위치 요청, 통증·어지럼 도움 요청, 할인 결제에 우선 적용한다. 규칙에 없는 조합은 Gloss 사전의 `koreanText`를 순서대로 결합하고 공백과 문장부호를 정리한다.

## 신뢰도 정책

문장 신뢰도는 입력 Gloss 토큰의 평균 인식 신뢰도를 넘지 않는다. 2위와 3위 후보는 각각 0.12씩 감산한다.

| 평균 신뢰도 | 결정 |
|---:|---|
| 0.85 이상 | `AUTO_SELECT` |
| 0.60 이상 0.85 미만 | `SELECT_CANDIDATE` |
| 0.60 미만 | `RETAKE` |

`AUTO_SELECT`도 결과 상태는 `PENDING_USER_CONFIRMATION`으로 반환한다. 자동 음성 출력은 SIGN LOOP 6에서 별도 설정으로 연결한다.

## API

- `POST /v1/sign/translations/{sessionId}`: 현재 Gloss 시퀀스를 번역한다.
- `GET /v1/sign/translations/{sessionId}`: 최근 번역과 확인 상태를 조회한다.
- `POST /v1/sign/translations/{sessionId}/confirm`: 후보 확정, 직접 수정 또는 거절한다.

확인 요청 예시:

```json
{
  "action": "CORRECT",
  "correctedText": "병원 위치를 안내해 주세요.",
  "reason": "WORD_ORDER",
  "consentToImprove": true
}
```

지원 action:

- `CONFIRM`: 유효한 `candidateId`가 필요하다.
- `CORRECT`: 비어 있지 않은 `correctedText`가 필요하다.
- `REJECT`: 후보를 채택하지 않는다.

## 개인정보와 교정 데이터

번역 결과와 사용자 확인은 카메라 세션 메모리에만 존재한다. Gloss 시퀀스를 삭제하거나 카메라를 중지하거나 모드를 바꾸면 번역 상태도 함께 삭제된다.

SIGN LOOP 9부터 `consentToImprove=true`와 `consentId`가 모두 있는 수정문만 별도 개선 큐에 저장한다. 저장 항목도 `PENDING_REVIEW`, `trainingEligible=false`이므로 SIGN LOOP 10 전문가 승인 전에는 학습 데이터로 사용할 수 없다. 동의하지 않은 수정은 계속 세션 메모리에만 유지한다.

## 완료 및 제한

- Gloss→의미 토큰 규칙: 완료
- 최대 3개 문장 후보와 신뢰도: 완료
- 공백·문장부호 후처리: 완료
- 사용자 확정·수정·거절: 완료
- 세션 종료 연동 삭제: 완료
- 전문가가 승인한 한국수어 문법 규칙: 미완료
- 자유대화 문맥 번역 모델: 미완료
- 한국어 문장의 TTS 출력: SIGN LOOP 6
