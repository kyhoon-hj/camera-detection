from __future__ import annotations

from typing import Any

from suha_core.domain import FeatureFrame, LandmarkSet

from .schema import SignQualityReport

GUIDANCE_PRIORITY = (
    "TIMESTAMP_REGRESSION",
    "MULTIPLE_PEOPLE",
    "NO_PERSON",
    "FACE_MISSING",
    "BODY_OUT_OF_FRAME",
    "LEFT_HAND_MISSING",
    "RIGHT_HAND_MISSING",
    "IDENTITY_UNSTABLE",
    "HAND_OUT_OF_FRAME",
    "LOW_LIGHT",
    "MOTION_BLUR",
)


def _mean_visibility(value: LandmarkSet | None) -> float:
    if value is None or not value.visibility:
        return 0.0
    return sum(value.visibility) / len(value.visibility)


def _near_edge(value: LandmarkSet | None, margin: float = 0.02) -> bool:
    return bool(value and any(x < margin or x > 1 - margin or y < margin or y > 1 - margin for x, y, _ in value.landmarks))


def _identity_unstable(features: FeatureFrame) -> bool:
    return bool(
        (features.left_hand and features.left_hand.handedness not in {None, "LEFT"})
        or (features.right_hand and features.right_hand.handedness not in {None, "RIGHT"})
    )


def evaluate_sign_quality(
    features: FeatureFrame,
    provider_metadata: dict[str, Any],
    *,
    timestamp_valid: bool = True,
) -> SignQualityReport:
    issues: list[str] = []
    person_count = int(provider_metadata.get("personCount", 1 if features.person_id else 0))
    if not timestamp_valid:
        issues.append("TIMESTAMP_REGRESSION")
    if person_count > 1:
        issues.append("MULTIPLE_PEOPLE")
    if features.person_id is None:
        issues.append("NO_PERSON")
    if features.face is None:
        issues.append("FACE_MISSING")
    if features.pose is None:
        issues.append("BODY_OUT_OF_FRAME")
    if features.left_hand is None:
        issues.append("LEFT_HAND_MISSING")
    if features.right_hand is None:
        issues.append("RIGHT_HAND_MISSING")
    if _identity_unstable(features):
        issues.append("IDENTITY_UNSTABLE")
    if _near_edge(features.left_hand) or _near_edge(features.right_hand):
        issues.append("HAND_OUT_OF_FRAME")
    if features.quality.brightness < 0.15:
        issues.append("LOW_LIGHT")
    if features.quality.blur < 0.05:
        issues.append("MOTION_BLUR")
    guidance = next((code for code in GUIDANCE_PRIORITY if code in issues), "READY")
    metrics = {
        "brightness": features.quality.brightness,
        "sharpness": features.quality.blur,
        "leftHandVisibility": _mean_visibility(features.left_hand),
        "rightHandVisibility": _mean_visibility(features.right_hand),
        "poseVisibility": _mean_visibility(features.pose),
        "faceVisibility": _mean_visibility(features.face),
        "syncSkewMs": float(provider_metadata.get("syncSkewMs", 0.0)),
        "personCount": float(person_count),
    }
    return SignQualityReport(metrics, issues, not issues, guidance)
