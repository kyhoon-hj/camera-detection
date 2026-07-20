from __future__ import annotations

from dataclasses import dataclass
from typing import Any

PROFESSIONAL_DOMAINS: dict[str, dict[str, str]] = {
    "general": {"koreanName": "일반", "risk": "STANDARD"},
    "public": {"koreanName": "공공기관", "risk": "STANDARD"},
    "parking": {"koreanName": "주차·키오스크", "risk": "STANDARD"},
    "medical": {"koreanName": "병원·의료", "risk": "HIGH_STAKES"},
    "disaster": {"koreanName": "재난·안전", "risk": "HIGH_STAKES"},
    "transport": {"koreanName": "교통", "risk": "STANDARD"},
    "finance": {"koreanName": "금융·결제", "risk": "HIGH_STAKES"},
}


@dataclass(frozen=True, slots=True)
class ProfessionalTerm:
    code: str
    gloss: str
    korean_text: str
    domains: tuple[str, ...]
    critical: bool = False

    def to_dict(self) -> dict[str, Any]:
        return {
            "code": self.code,
            "gloss": self.gloss,
            "koreanText": self.korean_text,
            "domains": list(self.domains),
            "critical": self.critical,
            "status": "PENDING_EXPERT_REVIEW",
        }


PROFESSIONAL_TERMS: tuple[ProfessionalTerm, ...] = (
    ProfessionalTerm("QUEUE_NUMBER", "번호표", "번호표가 필요합니다.", ("public",)),
    ProfessionalTerm("CIVIL_COMPLAINT", "민원", "민원 상담을 받고 싶습니다.", ("public",)),
    ProfessionalTerm("DOCUMENT_ISSUANCE", "서류 발급", "서류를 발급받고 싶습니다.", ("public",)),
    ProfessionalTerm("DEPARTMENT", "담당 부서", "담당 부서를 알려주세요.", ("public",)),
    ProfessionalTerm("IDENTITY_VERIFICATION", "본인 확인", "본인 확인이 필요합니다.", ("public", "finance")),
    ProfessionalTerm("PAIN_LOCATION", "통증 위치", "아픈 위치를 확인해주세요.", ("medical",)),
    ProfessionalTerm("PAIN_INTENSITY", "통증 강도", "통증이 매우 심합니다.", ("medical",), True),
    ProfessionalTerm("SYMPTOM_ONSET", "증상 시작", "증상이 시작된 시간을 말씀드리겠습니다.", ("medical",)),
    ProfessionalTerm("ALLERGY", "알레르기", "알레르기가 있습니다.", ("medical",), True),
    ProfessionalTerm("MEDICATION", "복용 약", "복용 중인 약이 있습니다.", ("medical",), True),
    ProfessionalTerm("EMERGENCY_STATUS", "응급 여부", "응급 상황입니다.", ("medical", "disaster"), True),
    ProfessionalTerm("PARKING_FEE", "주차 요금", "주차 요금을 확인해주세요.", ("parking",)),
    ProfessionalTerm("SEASON_PASS", "정기권", "주차 정기권을 확인해주세요.", ("parking",)),
    ProfessionalTerm("PAYMENT_ERROR", "결제 오류", "결제 오류를 확인해주세요.", ("parking", "finance")),
    ProfessionalTerm("EVACUATION", "대피", "안전한 곳으로 대피해야 합니다.", ("disaster",), True),
    ProfessionalTerm("RESCUE_REQUEST", "구조 요청", "구조가 필요합니다.", ("disaster",), True),
    ProfessionalTerm("BUS", "버스", "버스를 이용하려고 합니다.", ("transport",)),
    ProfessionalTerm("SUBWAY", "지하철", "지하철을 이용하려고 합니다.", ("transport",)),
    ProfessionalTerm("STOP", "정류장", "정류장 위치를 알려주세요.", ("transport",)),
    ProfessionalTerm("TRANSFER", "환승", "환승 방법을 알려주세요.", ("transport",)),
    ProfessionalTerm("DESTINATION", "목적지", "목적지에 가는 방법을 알려주세요.", ("transport",)),
    ProfessionalTerm("CANCEL", "취소", "결제를 취소하고 싶습니다.", ("finance",)),
    ProfessionalTerm("REFUND", "환불", "환불받고 싶습니다.", ("finance",)),
    ProfessionalTerm("CARD", "카드", "카드로 결제하겠습니다.", ("finance",)),
    ProfessionalTerm("CASH", "현금", "현금으로 결제하겠습니다.", ("finance",)),
    ProfessionalTerm("RECEIPT", "영수증", "영수증을 발급해주세요.", ("finance",)),
)


class ProfessionalDictionary:
    def __init__(self) -> None:
        self._terms = {term.code: term for term in PROFESSIONAL_TERMS}

    def domains(self) -> list[dict[str, Any]]:
        counts = {
            domain: sum(domain in term.domains for term in PROFESSIONAL_TERMS)
            for domain in PROFESSIONAL_DOMAINS
        }
        return [
            {"code": code, **profile, "termCount": counts[code]}
            for code, profile in PROFESSIONAL_DOMAINS.items()
        ]

    def list_terms(self, domain: str | None = None) -> list[dict[str, Any]]:
        if domain is not None and domain not in PROFESSIONAL_DOMAINS:
            raise ValueError(f"Unsupported professional domain: {domain}")
        return [
            term.to_dict()
            for term in PROFESSIONAL_TERMS
            if domain is None or domain in term.domains
        ]

    def get(self, code: str) -> dict[str, Any]:
        try:
            return self._terms[code.upper()].to_dict()
        except KeyError as error:
            raise KeyError(f"Professional term not found: {code}") from error
