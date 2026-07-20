from pathlib import Path

from suha_core.ksl import GlossRegistry, KoreanTranslationService, ProfessionalDictionary


def _lookup(root: Path):
    glossary = GlossRegistry(root)
    professional = ProfessionalDictionary()

    def get(code: str):
        try:
            return glossary.get(code)
        except KeyError:
            return professional.get(code)

    return get


def _sequence(*codes: str) -> dict[str, object]:
    return {
        "tokens": [
            {"code": f"KSL_{code}", "gloss": code, "confidence": 0.9}
            for code in codes
        ]
    }


def test_professional_dictionary_covers_six_domains_and_guide_terms() -> None:
    dictionary = ProfessionalDictionary()
    domains = dictionary.domains()
    assert {item["code"] for item in domains} == {
        "general",
        "public",
        "parking",
        "medical",
        "disaster",
        "transport",
        "finance",
    }
    assert {item["code"] for item in dictionary.list_terms("public")} >= {
        "QUEUE_NUMBER",
        "CIVIL_COMPLAINT",
        "DOCUMENT_ISSUANCE",
        "DEPARTMENT",
        "IDENTITY_VERIFICATION",
    }
    assert {item["code"] for item in dictionary.list_terms("medical")} >= {
        "PAIN_LOCATION",
        "PAIN_INTENSITY",
        "ALLERGY",
        "MEDICATION",
    }
    assert dictionary.get("EVACUATION")["critical"] is True


def test_domain_changes_candidate_priority_and_high_stakes_notice(tmp_path: Path) -> None:
    service = KoreanTranslationService(_lookup(tmp_path))
    service.set_domain("session", "parking")
    parking = service.translate("session", _sequence("PAYMENT", "ERROR"))
    service.set_domain("session", "finance")
    finance = service.translate("session", _sequence("PAYMENT", "ERROR"))

    assert parking["candidates"][0]["text"] == "주차 요금 결제 중 오류가 발생했습니다."
    assert parking["safetyNotice"] is None
    assert finance["candidates"][0]["text"] == "결제 오류를 확인해 주세요."
    assert finance["domainRisk"] == "HIGH_STAKES"
    assert "담당자" in finance["safetyNotice"]
    assert finance["candidates"][0]["source"] == "KSL_RULE_V1:finance"


def test_professional_term_fallback_and_session_domain_clear(tmp_path: Path) -> None:
    service = KoreanTranslationService(_lookup(tmp_path))
    service.set_domain("session", "finance")
    result = service.translate("session", _sequence("REFUND"))
    assert result["candidates"][0]["text"] == "환불받고 싶습니다."
    service.clear("session")
    assert service.domain("session")["domain"] == "general"
