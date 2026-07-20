from __future__ import annotations

import re
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any
from uuid import uuid4

from .professional import PROFESSIONAL_DOMAINS

SEMANTIC_TOKENS: dict[str, str] = {
    "HELP_NEEDED": "INTENT:HELP_REQUEST",
    "HOSPITAL": "ENTITY:HOSPITAL",
    "POLICE": "ENTITY:POLICE",
    "AMBULANCE": "ENTITY:AMBULANCE",
    "FIRE": "ALERT:FIRE",
    "DANGER": "ALERT:DANGER",
    "EXIT": "ENTITY:EXIT",
    "WHERE": "INTENT:LOCATION_REQUEST",
    "PLEASE": "STYLE:POLITE",
    "THANK_YOU": "SPEECH_ACT:THANKS",
    "YES": "RESPONSE:YES",
    "NO": "RESPONSE:NO",
    "PAIN": "SYMPTOM:PAIN",
    "DIZZY": "SYMPTOM:DIZZY",
    "PARKING_ENTRY": "PARKING:ENTRY",
    "PARKING_EXIT": "PARKING:EXIT",
    "PAYMENT": "INTENT:PAYMENT",
    "DISCOUNT": "INTENT:DISCOUNT",
    "VEHICLE_NUMBER": "ENTITY:VEHICLE_NUMBER",
    "ERROR": "STATE:ERROR",
}

LOCATION_NOUNS = {"HOSPITAL": "병원", "EXIT": "출구"}
TOKEN_CODE = re.compile(r"^KSL_")


@dataclass(frozen=True, slots=True)
class SentenceCandidate:
    candidate_id: str
    text: str
    confidence: float
    rank: int
    source: str = "KSL_RULE_V1"

    def to_dict(self) -> dict[str, Any]:
        return {
            "candidateId": self.candidate_id,
            "text": self.text,
            "confidence": self.confidence,
            "rank": self.rank,
            "source": self.source,
        }


class KoreanTranslationService:
    def __init__(self, glossary_lookup: Callable[[str], dict[str, Any]]) -> None:
        self._lookup = glossary_lookup
        self._results: dict[str, dict[str, Any]] = {}
        self._domains: dict[str, str] = {}

    def domain(self, session_id: str) -> dict[str, Any]:
        code = self._domains.get(session_id, "general")
        return {"domain": code, **PROFESSIONAL_DOMAINS[code]}

    def set_domain(self, session_id: str, domain: str) -> dict[str, Any]:
        if domain not in PROFESSIONAL_DOMAINS:
            raise ValueError(f"Unsupported professional domain: {domain}")
        self._domains[session_id] = domain
        self._results.pop(session_id, None)
        return self.domain(session_id)

    def translate(self, session_id: str, sequence: dict[str, Any]) -> dict[str, Any]:
        domain = self._domains.get(session_id, "general")
        domain_profile = PROFESSIONAL_DOMAINS[domain]
        raw_tokens = sequence.get("tokens", [])
        tokens = [item for item in raw_tokens if isinstance(item, dict)]
        if not tokens:
            result = {
                "translationId": f"ksltr_{uuid4().hex}",
                "sessionId": session_id,
                "glossSequence": [],
                "semanticTokens": [],
                "candidates": [],
                "confidence": 0.0,
                "decision": "RETAKE",
                "status": "NEED_MORE_INPUT",
                "confirmation": None,
                "domain": domain,
                "domainRisk": domain_profile["risk"],
                "safetyNotice": self._safety_notice(domain),
                "privacy": "Translation and confirmation remain in memory for this camera session.",
            }
            self._results[session_id] = result
            return result

        codes = [self._code(item) for item in tokens]
        glosses = [str(item.get("gloss", code)) for item, code in zip(tokens, codes, strict=True)]
        confidence = sum(float(item.get("confidence", 0.0)) for item in tokens) / len(tokens)
        sentence_options = self._sentence_options(codes, glosses, domain)
        candidates = [
            SentenceCandidate(
                f"candidate-{rank}",
                self._postprocess(text),
                round(max(0.0, confidence - ((rank - 1) * 0.12)), 4),
                rank,
                f"KSL_RULE_V1:{domain}",
            ).to_dict()
            for rank, text in enumerate(sentence_options[:3], 1)
        ]
        result = {
            "translationId": f"ksltr_{uuid4().hex}",
            "sessionId": session_id,
            "glossSequence": glosses,
            "semanticTokens": [SEMANTIC_TOKENS.get(code, f"GLOSS:{code}") for code in codes],
            "candidates": candidates,
            "confidence": round(confidence, 4),
            "decision": self._decision(confidence),
            "status": "PENDING_USER_CONFIRMATION",
            "confirmation": None,
            "domain": domain,
            "domainRisk": domain_profile["risk"],
            "safetyNotice": self._safety_notice(domain),
            "privacy": "Translation and confirmation remain in memory for this camera session.",
        }
        self._results[session_id] = result
        return result

    def latest(self, session_id: str) -> dict[str, Any]:
        try:
            return self._results[session_id]
        except KeyError as error:
            raise KeyError(f"Translation not found for session: {session_id}") from error

    def confirm(
        self,
        session_id: str,
        *,
        action: str,
        candidate_id: str | None = None,
        corrected_text: str | None = None,
        reason: str | None = None,
        consent_to_improve: bool = False,
    ) -> dict[str, Any]:
        result = self.latest(session_id)
        if action not in {"CONFIRM", "CORRECT", "REJECT"}:
            raise ValueError(f"Unsupported confirmation action: {action}")
        selected_text: str | None = None
        if action == "CONFIRM":
            selected = next(
                (item for item in result["candidates"] if item["candidateId"] == candidate_id),
                None,
            )
            if selected is None:
                raise ValueError("A valid candidateId is required to confirm a translation")
            selected_text = str(selected["text"])
        elif action == "CORRECT":
            if corrected_text is None or not corrected_text.strip():
                raise ValueError("correctedText is required when action is CORRECT")
            selected_text = self._postprocess(corrected_text)

        result["confirmation"] = {
            "action": action,
            "candidateId": candidate_id,
            "selectedText": selected_text,
            "reason": reason,
            "consentToImprove": consent_to_improve,
            "improvementDataStored": False,
        }
        result["status"] = {"CONFIRM": "CONFIRMED", "CORRECT": "CORRECTED", "REJECT": "REJECTED"}[action]
        return result

    def clear(self, session_id: str) -> None:
        self._results.pop(session_id, None)
        self._domains.pop(session_id, None)

    @staticmethod
    def _code(token: dict[str, Any]) -> str:
        return TOKEN_CODE.sub("", str(token.get("code", ""))).upper()

    def _sentence_options(self, codes: list[str], glosses: list[str], domain: str) -> list[str]:
        code_set = set(codes)
        location_code = next((code for code in codes if code in LOCATION_NOUNS), None)
        if location_code and "WHERE" in code_set:
            noun = LOCATION_NOUNS[location_code]
            if domain == "medical" and location_code == "HOSPITAL":
                return [
                    "가까운 병원 위치를 안내해 주세요.",
                    "병원이 어디에 있는지 알려주세요.",
                    "진료받을 수 있는 병원으로 안내해 주세요.",
                ]
            if domain == "disaster" and location_code == "EXIT":
                return [
                    "가장 가까운 비상구를 알려주세요.",
                    "안전한 대피 출구로 안내해 주세요.",
                    "출구가 어디에 있는지 알려주세요.",
                ]
            if domain == "transport" and location_code == "EXIT":
                return [
                    "교통시설 출구 위치를 안내해 주세요.",
                    "가까운 출구를 알려주세요.",
                    "출구가 어디에 있는지 알려주세요.",
                ]
            return [
                f"{noun}이 어디에 있는지 알려주세요.",
                f"{noun} 위치를 알려주세요.",
                f"{noun}에 가는 길을 안내해주세요.",
            ]
        if "HELP_NEEDED" in code_set and "PAIN" in code_set:
            return ["아파서 도움이 필요합니다.", "몸이 아픕니다. 도와주세요.", "의료 도움이 필요합니다."]
        if "HELP_NEEDED" in code_set and "DIZZY" in code_set:
            return ["어지러워서 도움이 필요합니다.", "어지럽습니다. 도와주세요.", "의료 도움이 필요합니다."]
        if "PAYMENT" in code_set and "ERROR" in code_set:
            if domain == "parking":
                return [
                    "주차 요금 결제 중 오류가 발생했습니다.",
                    "주차 결제 오류를 확인해 주세요.",
                    "주차 요금을 결제할 수 없습니다.",
                ]
            if domain == "finance":
                return [
                    "결제 오류를 확인해 주세요.",
                    "금융 결제가 정상적으로 처리되지 않았습니다.",
                    "결제 내역을 확인해 주세요.",
                ]
        if "PAYMENT" in code_set and "DISCOUNT" in code_set:
            if domain == "parking":
                return ["주차 할인 적용 후 결제해 주세요.", "주차 할인을 확인해 주세요.", "할인받아 결제하고 싶습니다."]
            return ["할인받아 결제하고 싶습니다.", "할인 적용 후 결제해주세요.", "결제 할인을 확인해주세요."]
        if "HELP_NEEDED" in code_set and domain == "disaster":
            return ["구조가 필요합니다. 도와주세요.", "긴급 도움이 필요합니다.", "안전요원에게 알려주세요."]
        if "HELP_NEEDED" in code_set and domain == "medical":
            return ["의료진의 도움이 필요합니다.", "진료 도움이 필요합니다.", "도와주세요."]

        primary = [self._korean_text(code, gloss) for code, gloss in zip(codes, glosses, strict=True)]
        return [" ".join(primary)]

    def _korean_text(self, code: str, gloss: str) -> str:
        try:
            return str(self._lookup(code)["koreanText"])
        except KeyError:
            return f"{gloss} 표현입니다."

    @staticmethod
    def _postprocess(text: str) -> str:
        normalized = re.sub(r"\s+", " ", text).strip()
        normalized = re.sub(r"([.!?])(?:\s*\1)+", r"\1", normalized)
        normalized = re.sub(r"\.\s+([.!?])", r"\1", normalized)
        if normalized and normalized[-1] not in ".!?":
            normalized += "."
        return normalized

    @staticmethod
    def _decision(confidence: float) -> str:
        if confidence >= 0.85:
            return "AUTO_SELECT"
        if confidence >= 0.60:
            return "SELECT_CANDIDATE"
        return "RETAKE"

    @staticmethod
    def _safety_notice(domain: str) -> str | None:
        if PROFESSIONAL_DOMAINS[domain]["risk"] == "HIGH_STAKES":
            return "AI 번역 결과입니다. 중요한 결정은 전문 통역사 또는 담당자에게 확인하세요."
        return None
