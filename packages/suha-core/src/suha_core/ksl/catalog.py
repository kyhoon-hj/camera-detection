from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any


@dataclass(frozen=True, slots=True)
class KslExpression:
    code: str
    gloss: str
    korean_text: str
    domains: tuple[str, ...]
    emergency: bool = False
    collection_status: str = "PLANNED"

    def to_dict(self) -> dict[str, Any]:
        value = asdict(self)
        return {
            "code": value["code"],
            "gloss": value["gloss"],
            "koreanText": value["korean_text"],
            "domains": value["domains"],
            "emergency": value["emergency"],
            "collectionStatus": value["collection_status"],
            "requiresExpertReview": True,
        }


CORE_EXPRESSIONS: tuple[KslExpression, ...] = (
    KslExpression("HELP_NEEDED", "도움 필요", "도움이 필요합니다.", ("daily", "public", "emergency"), True),
    KslExpression("HOSPITAL", "병원", "병원에 가고 싶습니다.", ("medical", "transport")),
    KslExpression("POLICE", "경찰", "경찰을 불러주세요.", ("public", "emergency"), True),
    KslExpression("AMBULANCE", "구급차", "구급차를 불러주세요.", ("medical", "emergency"), True),
    KslExpression("FIRE", "화재", "화재입니다.", ("emergency",), True),
    KslExpression("DANGER", "위험", "위험합니다.", ("emergency",), True),
    KslExpression("EXIT", "출구", "출구가 어디인가요?", ("public", "transport", "emergency")),
    KslExpression("WHERE", "어디", "어디에 있나요?", ("daily", "public")),
    KslExpression("PLEASE", "부탁", "부탁드립니다.", ("daily", "public")),
    KslExpression("THANK_YOU", "감사", "감사합니다.", ("daily",)),
    KslExpression("YES", "네", "네.", ("daily",)),
    KslExpression("NO", "아니요", "아니요.", ("daily",)),
    KslExpression("PAIN", "아프다", "아픕니다.", ("medical",)),
    KslExpression("DIZZY", "어지럽다", "어지럽습니다.", ("medical",)),
    KslExpression("PARKING_ENTRY", "입차", "주차장에 입차했습니다.", ("parking", "transport")),
    KslExpression("PARKING_EXIT", "출차", "주차장에서 출차하려고 합니다.", ("parking", "transport")),
    KslExpression("PAYMENT", "결제", "결제하려고 합니다.", ("parking", "finance")),
    KslExpression("DISCOUNT", "할인", "할인을 받고 싶습니다.", ("parking", "finance")),
    KslExpression("VEHICLE_NUMBER", "차량 번호", "차량 번호를 확인해주세요.", ("parking",)),
    KslExpression("ERROR", "오류", "오류가 발생했습니다.", ("parking", "public", "finance")),
)

EXPRESSION_BY_CODE = {expression.code: expression for expression in CORE_EXPRESSIONS}


@dataclass(slots=True)
class _CollectionCounter:
    samples: int = 0
    approved_samples: int = 0
    signers: set[str] = field(default_factory=set)
    approved_signers: set[str] = field(default_factory=set)


def collection_status(root: str | Path) -> dict[str, Any]:
    counts = {expression.code: _CollectionCounter() for expression in CORE_EXPRESSIONS}
    for path in Path(root).glob("*/sessions/cap_*/session.json"):
        try:
            raw: Any = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        if not isinstance(raw, dict) or raw.get("status") != "COMPLETE":
            continue
        code = str(raw.get("label", ""))
        if code not in counts:
            continue
        samples = int(raw.get("samples", 0))
        subject = str(raw.get("subjectId", "unknown"))
        counts[code].samples += samples
        counts[code].signers.add(subject)
        metadata = raw.get("metadata", {})
        approved = isinstance(metadata, dict) and metadata.get("reviewStatus") == "APPROVED"
        if approved:
            counts[code].approved_samples += samples
            counts[code].approved_signers.add(subject)
    expressions: list[dict[str, Any]] = []
    for expression in CORE_EXPRESSIONS:
        item = counts[expression.code]
        approved_samples = item.approved_samples
        approved_signers = len(item.approved_signers)
        expressions.append(
            {
                "code": expression.code,
                "samples": item.samples,
                "signers": len(item.signers),
                "approvedSamples": approved_samples,
                "approvedSigners": approved_signers,
                "ready": approved_samples >= 30 and approved_signers >= 3,
            }
        )
    ready_count = sum(1 for item in expressions if item["ready"])
    return {
        "catalogVersion": "ksl-core-20-v1",
        "expressionCount": len(CORE_EXPRESSIONS),
        "readyExpressionCount": ready_count,
        "trainingReady": ready_count == len(CORE_EXPRESSIONS),
        "minimumApprovedSamplesPerExpression": 30,
        "minimumApprovedSignersPerExpression": 3,
        "expressions": expressions,
        "disclaimer": "Only consented, expert-approved sessions count toward training readiness.",
    }
