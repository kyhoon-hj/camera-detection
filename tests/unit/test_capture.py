import json
from pathlib import Path

import numpy as np
from suha_core.datasets import validate_dataset
from suha_core.domain import FeatureFrame, FramePacket, FrameQuality, LandmarkSet
from suha_core.recording import CaptureManager


def _feature(timestamp: int) -> FeatureFrame:
    hand = LandmarkSet([(0.5, 0.3, 0.0)] * 21, [1.0] * 21, "RIGHT")
    return FeatureFrame(
        "synthetic-front",
        "session",
        timestamp,
        "person-001",
        None,
        hand,
        None,
        None,
        FrameQuality(hand_visibility=1.0),
    )


def _frame(timestamp: int) -> FramePacket:
    image = np.zeros((48, 64, 3), dtype=np.uint8)
    return FramePacket("synthetic-front", timestamp, timestamp, image, width=64, height=48)


def test_twenty_landmark_samples_create_valid_dataset_without_video(tmp_path: Path) -> None:
    manager = CaptureManager(tmp_path)
    session = manager.create(
        label="HAND_WAVE",
        target_samples=20,
        save_video=False,
        save_landmarks=True,
        consent_id="test-consent",
        camera_id="synthetic-front",
        tester_alias="tester-01",
    )
    manager.start(session.capture_id)
    for timestamp in range(20):
        manager.mark(session.capture_id, _feature(timestamp), _frame(timestamp))
    assert session.status == "COMPLETE"
    assert session.samples == 20
    assert not (session.output_dir / "video.mp4").exists()
    result = validate_dataset(tmp_path / "local-captures-v1")
    assert result.valid
    assert result.labels == {"HAND_WAVE": 20}


def test_validator_detects_corrupt_sample(tmp_path: Path) -> None:
    manager = CaptureManager(tmp_path)
    session = manager.create(
        label="NONE",
        target_samples=1,
        save_video=False,
        save_landmarks=True,
        consent_id="test-consent",
        camera_id="synthetic-front",
    )
    manager.start(session.capture_id)
    manager.mark(session.capture_id, _feature(1))
    with (session.output_dir / "landmarks.jsonl").open("a", encoding="utf-8") as handle:
        handle.write("{broken\n")
    result = validate_dataset(tmp_path / "local-captures-v1", write_report=False)
    assert not result.valid
    assert any("Invalid JSON" in error for error in result.errors)


def test_consent_is_required(tmp_path: Path) -> None:
    manager = CaptureManager(tmp_path)
    try:
        manager.create(
            label="NONE",
            target_samples=1,
            save_video=False,
            save_landmarks=True,
            consent_id=None,
            camera_id="synthetic-front",
        )
    except ValueError as error:
        assert "CONSENT_REQUIRED" in str(error)
    else:
        raise AssertionError("Missing consent must be rejected")


def test_session_metadata_contains_anonymous_subject(tmp_path: Path) -> None:
    manager = CaptureManager(tmp_path)
    session = manager.create(
        label="NONE",
        target_samples=1,
        save_video=False,
        save_landmarks=True,
        consent_id="consent",
        camera_id="synthetic-front",
        tester_alias="private-name",
    )
    metadata = json.loads((session.output_dir / "session.json").read_text(encoding="utf-8"))
    assert metadata["subjectId"].startswith("anonymous-")
    assert "private-name" not in json.dumps(metadata)
