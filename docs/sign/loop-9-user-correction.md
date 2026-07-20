# SIGN LOOP 9 — 사용자 문장 교정과 동의 데이터 큐

## 구현 결과

사용자는 한국어 번역 문장을 직접 수정하고 수정 사유를 선택할 수 있다. 수정문은 동의 여부와 관계없이 현재 통역 결과에 즉시 반영되지만, 개선 데이터 큐에는 `consentToImprove=true`와 비어 있지 않은 `consentId`가 모두 있을 때만 저장한다.

```text
번역 후보
  -> 문장 수정
  -> 수정 사유 선택
  -> 현재 통역 결과에 적용
       ├ 동의 안 함: 세션 메모리에만 유지
       └ 명시적 동의: PENDING_REVIEW 개선 큐
```

## 수정 사유

- `HANDSHAPE_MISRECOGNITION`: 손 모양 오인식
- `WORD_ORDER`: 문장 순서 오류
- `NON_MANUAL_MISSING`: 표정·비수지 의미 누락
- `WORD_MISSING`: 단어 누락
- `CONTEXT_ERROR`: 문맥 오류
- `DIFFERENT_EXPRESSION`: 다른 표현
- `OTHER`: 기타

`CORRECT` 요청에는 수정 사유와 비어 있지 않은 수정문이 반드시 필요하다.

## 동의 데이터 큐

저장 항목:

- 피드백 ID와 번역 ID
- 원래 후보 문장과 수정 문장
- 수정 사유와 선택 분야
- Gloss 시퀀스
- 해시 처리된 세션 참조와 동의 참조
- 동의 시각
- 검수 상태

원본 세션 ID와 동의 ID는 저장하지 않고 SHA-256 기반 짧은 참조값만 저장한다. 영상과 랜드마크는 교정 큐에 포함하지 않는다.

모든 신규 항목은 다음 상태로 생성한다.

```json
{
  "status": "PENDING_REVIEW",
  "trainingEligible": false,
  "containsVideo": false,
  "containsLandmarks": false
}
```

사용자가 동의했더라도 SIGN LOOP 10의 전문가 승인을 통과하기 전에는 학습 데이터로 사용할 수 없다.

## API

문장 수정은 기존 확인 API를 사용한다.

- `POST /v1/sign/translations/{sessionId}/confirm`

```json
{
  "action": "CORRECT",
  "correctedText": "가까운 병원 위치를 안내해 주세요.",
  "reason": "CONTEXT_ERROR",
  "consentToImprove": true,
  "consentId": "explicit-consent-reference"
}
```

개선 데이터 관리:

- `GET /v1/sign/feedback?sessionId=...`: 현재 세션이 동의한 개선 데이터 조회.
- `DELETE /v1/sign/feedback/{feedbackId}?sessionId=...`: 한 건 삭제.
- `DELETE /v1/sign/feedback?sessionId=...`: 현재 세션 개선 데이터 전체 삭제.

삭제 감사 로그에는 시각·피드백 ID·해시 세션 참조·작업만 남고 수정 문장 내용은 남기지 않는다.

## 콘솔

수어 통역 패널에 다음 흐름을 추가했다.

- `문장 수정` 버튼
- 올바른 문장 입력
- 7개 수정 사유 선택
- 개선 데이터 저장 동의 체크
- 동의한 경우에만 동의 ID 입력
- 수정 결과를 수어 사용자 대화 문장으로 반영
- 동의 큐의 `PENDING_REVIEW / 학습 사용 차단` 표시
- 큐 항목 개별 삭제 및 전체 삭제

## 개인정보 생명주기

- 동의하지 않은 수정문: 현재 번역 세션 메모리에만 존재하며 시퀀스 삭제·모드 변경·카메라 중지 시 삭제.
- 동의한 개선 데이터: 로컬 개선 큐에 저장하며 사용자가 개별 또는 전체 삭제 가능.
- 원본 영상·랜드마크·마이크 오디오: 교정 큐에 저장하지 않음.
- 의료·금융·재난 수정도 명시적 동의 없이는 저장하지 않음.
- 서버 재시작 후에도 동의 큐는 유지되므로 삭제 API와 콘솔에서 철회 가능.

## 완료 및 제한

- 문장 직접 수정과 수정 사유: 완료
- 명시적 동의·동의 ID 검증: 완료
- 익명화된 개선 데이터 큐: 완료
- 개별·세션 전체 삭제: 완료
- 비동의 데이터 저장 차단: 완료
- 학습 사용 기본 차단: 완료
- 전문가 승인·반려와 검수 이력: SIGN LOOP 10에서 구현 완료 (`loop-10-expert-review.md`)
