import pytest
from suha_core.ksl import ProfessionalQaStore


def test_qa_scenarios_validate_tags_rank_latency_and_persist(tmp_path) -> None:
    store = ProfessionalQaStore(tmp_path)
    with pytest.raises(ValueError, match="variant tags"):
        store.record(
            scenario_id="dominant-hand-left", source="SYNTHETIC_REGRESSION",
            expected_code="HELP_NEEDED", observed_candidates=["HELP_NEEDED"], confidence=.9,
            latency_ms=500, variant_tags={}, expert_accepted=True, notes="",
        )
    passed = store.record(
        scenario_id="dominant-hand-left", source="SYNTHETIC_REGRESSION",
        expected_code="HELP_NEEDED", observed_candidates=["HELP_NEEDED"], confidence=.9,
        latency_ms=500, variant_tags={"dominantHand": "LEFT"}, expert_accepted=True, notes="fixture",
    )
    emergency = store.record(
        scenario_id="emergency-recall", source="HUMAN_REVIEWED_RECORDING",
        expected_code="FIRE", observed_candidates=["DANGER", "FIRE"], confidence=.9,
        latency_ms=500, variant_tags={"emergencyExpression": "FIRE"}, expert_accepted=True, notes="rank two",
    )
    assert passed["passed"] is True
    assert emergency["passed"] is False
    assert ProfessionalQaStore(tmp_path).results()[0]["qaResultId"] == passed["qaResultId"]


def test_release_readiness_ignores_synthetic_coverage(tmp_path) -> None:
    store = ProfessionalQaStore(tmp_path)
    for scenario in store.scenarios():
        tags = {tag: "fixture" for tag in scenario["requiredTags"]}
        store.record(
            scenario_id=scenario["scenarioId"], source="SYNTHETIC_REGRESSION",
            expected_code="HELP_NEEDED", observed_candidates=["HELP_NEEDED"], confidence=.95,
            latency_ms=200, variant_tags=tags, expert_accepted=True, notes="automated",
        )
    summary = store.summary()
    assert summary["releaseReady"] is False
    assert summary["humanReviewedResults"] == 0
    assert len(summary["missingCategories"]) == 7
