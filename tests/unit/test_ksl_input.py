import numpy as np
import pytest
from suha_core.domain import FeatureFrame, FramePacket, FrameQuality, LandmarkSet
from suha_core.ksl import SignInputAssembler


def _landmarks(count: int, x: float, y: float, handedness: str | None = None) -> LandmarkSet:
    return LandmarkSet([(x, y, 0.0) for _ in range(count)], [1.0] * count, handedness)


def _features(timestamp_ms: int, *, left: bool = True, right_x: float = 0.65) -> FeatureFrame:
    pose_points = [(0.5, 0.5, 0.0) for _ in range(33)]
    pose_points[11] = (0.4, 0.4, 0.0)
    pose_points[12] = (0.6, 0.4, 0.0)
    return FeatureFrame(
        "camera",
        "session",
        timestamp_ms,
        "person-001",
        _landmarks(21, 0.35, 0.5, "LEFT") if left else None,
        _landmarks(21, right_x, 0.5, "RIGHT"),
        LandmarkSet(pose_points, [1.0] * 33),
        _landmarks(478, 0.5, 0.25),
        FrameQuality(brightness=0.6, blur=0.8, hand_visibility=1.0, pose_visibility=1.0),
        metadata={
            "landmarkProvider": {
                "provider": "test",
                "handCount": 2 if left else 1,
                "poseCount": 1,
                "faceCount": 1,
                "personCount": 1,
                "syncSkewMs": 0.0,
            }
        },
    )


def _frame(timestamp_ms: int, sequence: int = 1, *, mirrored: bool = True) -> FramePacket:
    return FramePacket(
        "camera",
        sequence,
        timestamp_ms,
        np.zeros((480, 640, 3), dtype=np.uint8),
        width=640,
        height=480,
        metadata={"mirrored": mirrored, "rotationDegrees": 0},
    )


def test_sign_input_combines_synchronized_full_body_features() -> None:
    result = SignInputAssembler().assemble(_frame(100), _features(100))

    assert result.frame_id == "camera:1"
    assert result.source_timestamp_ms == 100
    assert result.mirrored is True
    assert result.normalized.origin == pytest.approx((0.5, 0.4, 0.0))
    assert result.normalized.shoulder_width == pytest.approx(0.2)
    assert result.normalized.scale == pytest.approx(5.0)
    assert result.quality.ready_for_recognition is True
    assert result.quality.guidance_code == "READY"


def test_sign_input_blocks_missing_hand_and_timestamp_mismatch() -> None:
    result = SignInputAssembler().assemble(_frame(101), _features(100, left=False))

    assert result.quality.ready_for_recognition is False
    assert result.quality.guidance_code == "TIMESTAMP_REGRESSION"
    assert "LEFT_HAND_MISSING" in result.quality.issues
    assert "TIMESTAMP_REGRESSION" in result.quality.issues


def test_sign_input_calculates_body_normalized_velocity() -> None:
    assembler = SignInputAssembler()
    assembler.assemble(_frame(100, 1), _features(100, right_x=0.65))
    result = assembler.assemble(_frame(200, 2), _features(200, right_x=0.67))

    velocity = result.normalized.velocities["rightHand"][0]
    assert velocity[0] == pytest.approx(1.0)
    assert velocity[1:] == pytest.approx((0.0, 0.0))


def test_public_sign_input_diagnostics_do_not_expose_landmarks_by_default() -> None:
    result = SignInputAssembler().assemble(_frame(100), _features(100)).to_dict()

    assert "landmarks" not in result
    assert "leftHand" not in result["normalized"]
    assert result["image"]["mirrored"] is True
    assert result["quality"]["readyForRecognition"] is True
