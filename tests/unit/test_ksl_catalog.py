import json
from collections import defaultdict, deque
from pathlib import Path
from typing import Any

import numpy as np
from suha_core.domain import FeatureFrame, FrameQuality, LandmarkSet
from suha_core.ksl import CORE_EXPRESSIONS, collection_status
from suha_core.models.learned_dynamic import OnnxTemporalGestureRecognizer, rank_predictions


def test_core_catalog_contains_twenty_unique_review_required_expressions() -> None:
    assert len(CORE_EXPRESSIONS) == 20
    assert len({item.code for item in CORE_EXPRESSIONS}) == 20
    assert all(item.collection_status == "PLANNED" for item in CORE_EXPRESSIONS)
    assert {item.code for item in CORE_EXPRESSIONS if item.emergency} >= {"HELP_NEEDED", "POLICE", "AMBULANCE", "FIRE", "DANGER"}


def test_collection_readiness_counts_only_completed_expert_approved_sessions(tmp_path: Path) -> None:
    for index, signer in enumerate(("one", "two", "three")):
        session = tmp_path / "ksl-core" / "sessions" / f"cap_{index}"
        session.mkdir(parents=True)
        (session / "session.json").write_text(
            json.dumps(
                {
                    "status": "COMPLETE",
                    "label": "HELP_NEEDED",
                    "samples": 10,
                    "subjectId": signer,
                    "metadata": {"reviewStatus": "APPROVED"},
                }
            ),
            encoding="utf-8",
        )
    status = collection_status(tmp_path)
    help_status = next(item for item in status["expressions"] if item["code"] == "HELP_NEEDED")

    assert help_status["ready"] is True
    assert help_status["approvedSamples"] == 30
    assert help_status["approvedSigners"] == 3
    assert status["readyExpressionCount"] == 1
    assert status["trainingReady"] is False


def test_rank_predictions_returns_descending_top_three() -> None:
    ranked = rank_predictions(np.asarray([0.05, 0.55, 0.10, 0.30]), ["A", "B", "C", "D"])

    assert [item.label for item in ranked] == ["B", "D", "C"]
    assert [item.confidence for item in ranked] == [0.55, 0.30, 0.10]


class _FakeOnnxSession:
    def run(self, _: Any, __: dict[str, np.ndarray]) -> list[np.ndarray]:
        return [np.asarray([[0.0, 3.0, 2.0, 1.0]], dtype=np.float32)]


def _feature(timestamp: int) -> FeatureFrame:
    points = [(0.35 + index * 0.01, 0.75 - index * 0.01, 0.0) for index in range(21)]
    return FeatureFrame(
        "camera",
        "session",
        timestamp,
        "person",
        None,
        LandmarkSet(points, [1.0] * 21, "RIGHT"),
        None,
        None,
        FrameQuality(hand_visibility=1.0),
    )


def test_ksl_recognizer_exposes_three_candidates_and_confirmation_policy() -> None:
    recognizer = OnnxTemporalGestureRecognizer.__new__(OnnxTemporalGestureRecognizer)
    recognizer.labels = ["YES", "HELP_NEEDED", "HOSPITAL", "NO"]
    recognizer.task = "SIGN_LANGUAGE_KSL"
    recognizer.window = 8
    recognizer.plugin_id = "ksl-test"
    recognizer.session = _FakeOnnxSession()
    recognizer._buffers = defaultdict(lambda: deque(maxlen=recognizer.window))

    result = []
    for timestamp in range(1, 7):
        result = recognizer.process(_feature(timestamp * 100))
    candidate = result[0]
    alternatives = candidate.metadata["candidates"]

    assert candidate.code == "KSL_HELP_NEEDED"
    assert [item["gloss"] for item in alternatives] == ["HELP_NEEDED", "HOSPITAL", "NO"]
    assert candidate.metadata["requiresConfirmation"] is True
    assert candidate.metadata["decision"] == "SELECT_CANDIDATE"
