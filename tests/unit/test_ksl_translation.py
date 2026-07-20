from pathlib import Path

import pytest
from suha_core.ksl import GlossRegistry, GlossSequenceTracker, KoreanTranslationService


def _sequence(confidence: float = 0.9) -> dict[str, object]:
    return {
        "tokens": [
            {"code": "KSL_HOSPITAL", "gloss": "병원", "confidence": confidence},
            {"code": "KSL_WHERE", "gloss": "어디", "confidence": confidence},
            {"code": "KSL_PLEASE", "gloss": "부탁", "confidence": confidence},
        ]
    }


def test_translation_generates_semantics_ranked_sentences_and_confidence(tmp_path: Path) -> None:
    service = KoreanTranslationService(GlossRegistry(tmp_path).get)
    result = service.translate("session", _sequence())

    assert result["semanticTokens"] == ["ENTITY:HOSPITAL", "INTENT:LOCATION_REQUEST", "STYLE:POLITE"]
    assert result["candidates"][0]["text"] == "병원이 어디에 있는지 알려주세요."
    assert [item["rank"] for item in result["candidates"]] == [1, 2, 3]
    assert result["confidence"] == pytest.approx(0.9)
    assert result["decision"] == "AUTO_SELECT"
    assert result["status"] == "PENDING_USER_CONFIRMATION"


def test_translation_confirmation_correction_and_privacy_clear(tmp_path: Path) -> None:
    service = KoreanTranslationService(GlossRegistry(tmp_path).get)
    tracker = GlossSequenceTracker()
    tracker.add_clear_listener(service.clear)
    service.translate("session", _sequence(0.7))

    confirmed = service.confirm("session", action="CONFIRM", candidate_id="candidate-2")
    assert confirmed["status"] == "CONFIRMED"
    assert confirmed["confirmation"]["selectedText"] == "병원 위치를 알려주세요."
    assert confirmed["confirmation"]["improvementDataStored"] is False

    corrected = service.confirm(
        "session",
        action="CORRECT",
        corrected_text="  병원 위치를   안내해 주세요  ",
        reason="WORD_ORDER",
        consent_to_improve=True,
    )
    assert corrected["status"] == "CORRECTED"
    assert corrected["confirmation"]["selectedText"] == "병원 위치를 안내해 주세요."
    assert corrected["confirmation"]["consentToImprove"] is True
    assert corrected["confirmation"]["improvementDataStored"] is False

    tracker.clear("session")
    with pytest.raises(KeyError, match="Translation not found"):
        service.latest("session")


def test_translation_requires_input_and_valid_confirmation(tmp_path: Path) -> None:
    service = KoreanTranslationService(GlossRegistry(tmp_path).get)
    empty = service.translate("session", {"tokens": []})
    assert empty["status"] == "NEED_MORE_INPUT"
    assert empty["decision"] == "RETAKE"
    with pytest.raises(ValueError, match="valid candidateId"):
        service.confirm("session", action="CONFIRM", candidate_id="missing")
    with pytest.raises(ValueError, match="correctedText"):
        service.confirm("session", action="CORRECT")
