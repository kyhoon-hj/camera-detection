# SIGN LOOP 4 — Gloss 사전과 시퀀스 생성

## 구현 결과

SIGN LOOP 2의 핵심 표현 20개를 초기 데이터로 사용하는 영속 Gloss 사전을 추가했다. 관리자는 표현을 등록하거나 수정할 수 있고, 모든 변경은 행 단위 JSON 감사 기록으로 남는다. SIGN LOOP 3에서 유효하게 종료된 수어 구간은 세션별 Gloss 토큰으로 한 번만 누적된다.

이 단계의 출력은 자연어 한국어 문장이 아니라 시간순 **Gloss 시퀀스**다. 조사·어미 보정과 자연어 문장 생성은 다음 번역 단계에서 처리한다.

## 사전 구조

각 항목은 다음 정보를 가진다.

| 필드 | 설명 |
|---|---|
| `code` | 대문자·숫자·밑줄로 구성된 고유 코드 |
| `gloss` | 수어 표기용 Gloss |
| `koreanText` | 대표 한국어 의미 |
| `domains` | 의료·재난·일상 등 적용 도메인 |
| `aliases` | 검색과 호환을 위한 별칭 |
| `emergency` | 긴급 표현 여부 |
| `status` | `DRAFT`, `PENDING_REVIEW`, `APPROVED`, `RETIRED` |
| `revision` | 수정할 때마다 증가하는 개정 번호 |
| `source` | `CORE_CATALOG` 또는 `ADMIN` |

초기 20개 항목은 전문가 검토 전 상태인 `PENDING_REVIEW`로 생성한다. 파일은 `glossary.json`, 변경 이력은 `glossary-audit.jsonl`에 저장하며 사전 파일 교체는 임시 파일을 이용해 원자적으로 수행한다.

## 관리 API

- `GET /v1/sign/glossary`: 전체 목록 조회. `domain`, `status` 필터를 지원한다.
- `GET /v1/sign/glossary/{code}`: 단일 항목 조회.
- `POST /v1/sign/glossary`: 새 Gloss 등록.
- `PUT /v1/sign/glossary/{code}`: 기존 Gloss 수정 및 revision 증가.
- `GET /v1/sign/glossary/history?limit=100`: 최신 변경 이력 조회.

등록·수정 요청의 `actor`는 감사 기록에 저장된다. 운영 환경에서는 이 필드를 인증된 관리자 식별자로 서버에서 강제하는 후속 보안 작업이 필요하다.

## Gloss 시퀀스

수어 모드에서 구간 분석 결과가 `sequenceReady=true`가 되면 Top 1 수어 후보를 세션 시퀀스에 추가한다. 동일한 `segmentId`는 중복 추가하지 않으며 최근 50개 토큰만 메모리에 유지한다.

```json
{
  "sessionId": "session-id",
  "glossSequence": ["도와주세요", "병원"],
  "tokens": [
    {
      "gloss": "도와주세요",
      "code": "KSL_HELP_ME",
      "confidence": 0.91,
      "segmentId": "kslseg_123",
      "timestampMs": 4200
    }
  ],
  "averageConfidence": 0.91,
  "tokenCount": 1
}
```

- `GET /v1/sign/sequences/{sessionId}`: 현재 세션 시퀀스 조회.
- `POST /v1/sign/sequences/{sessionId}/clear`: 세션 시퀀스 즉시 삭제.

카메라 세션이 중지되거나 모드가 변경되면 해당 메모리 시퀀스를 자동 삭제한다. 영상이나 원본 랜드마크는 이 시퀀스 계층에 저장하지 않는다.

## 완료 및 남은 검증

- 영속 사전 초기화·재로딩: 완료
- 등록·수정·개정 번호·감사 이력: 완료
- 구간별 중복 방지와 시간순 시퀀스: 완료
- 세션 중지·모드 전환·명시적 요청 시 삭제: 완료
- 실제 수어 사용자 기반 Gloss 정확도와 전문가 승인: 미완료
- Gloss 시퀀스의 자연어 한국어 문장 변환: 다음 단계
