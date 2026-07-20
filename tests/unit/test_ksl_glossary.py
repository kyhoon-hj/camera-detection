from pathlib import Path

import pytest
from suha_core.domain import RecognitionCandidate
from suha_core.ksl import GlossRegistry, GlossSequenceTracker


def test_gloss_registry_seeds_catalog_and_persists_admin_changes(tmp_path: Path) -> None:
    registry = GlossRegistry(tmp_path)
    assert len(registry.list_entries()) == 20
    assert registry.get("HELP_NEEDED")["status"] == "PENDING_REVIEW"

    created = registry.register(
        code="CHILD_MISSING",
        gloss="아이 없어지다",
        korean_text="아이가 없어졌어요.",
        domains=["emergency"],
        emergency=True,
        actor="reviewer-1",
    )
    updated = registry.update(
        "CHILD_MISSING",
        aliases=["아이 잃어버리다"],
        status="PENDING_REVIEW",
        actor="reviewer-2",
    )

    assert created["revision"] == 1
    assert updated["revision"] == 2
    assert updated["aliases"] == ["아이 잃어버리다"]
    assert GlossRegistry(tmp_path).get("CHILD_MISSING")["revision"] == 2
    history = registry.history()
    assert [item["action"] for item in history] == ["REGISTERED", "UPDATED"]
    assert history[-1]["actor"] == "reviewer-2"


def test_gloss_registry_rejects_invalid_code_and_status(tmp_path: Path) -> None:
    registry = GlossRegistry(tmp_path)
    with pytest.raises(ValueError, match="uppercase"):
        registry.register(code="bad code", gloss="오류", korean_text="오류입니다.", domains=["daily"])
    with pytest.raises(ValueError, match="Unsupported"):
        registry.update("HELP_NEEDED", status="PUBLISHED")


def _candidate(segment_id: str, gloss: str, confidence: float, timestamp: int) -> RecognitionCandidate:
    return RecognitionCandidate(
        "SIGN_LANGUAGE",
        f"KSL_{gloss}",
        confidence,
        "person",
        None,
        timestamp - 500,
        timestamp,
        "test-model",
        metadata={"recognizedText": gloss, "segmentId": segment_id},
    )


def test_gloss_sequence_tracks_completed_segments_once_and_can_clear() -> None:
    tracker = GlossSequenceTracker()
    tracker.append("session", _candidate("one", "HOSPITAL", 0.9, 1000))
    tracker.append("session", _candidate("one", "HOSPITAL", 0.9, 1000))
    result = tracker.append("session", _candidate("two", "WHERE", 0.7, 2000))

    assert result["glossSequence"] == ["HOSPITAL", "WHERE"]
    assert result["tokenCount"] == 2
    assert result["averageConfidence"] == pytest.approx(0.8)
    assert tracker.clear("session")["glossSequence"] == []
