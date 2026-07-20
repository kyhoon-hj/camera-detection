from __future__ import annotations

import math

from suha_core.domain import FeatureFrame, LandmarkSet

from .schema import NormalizedSignFeatures, Point3D


def _shoulders(pose: LandmarkSet | None) -> tuple[Point3D, Point3D] | None:
    if pose is None:
        return None
    if len(pose.landmarks) > 12:
        return pose.landmarks[11], pose.landmarks[12]
    if len(pose.landmarks) >= 2:
        return pose.landmarks[0], pose.landmarks[1]
    return None


def _normalize(points: list[Point3D], origin: Point3D, scale: float) -> list[Point3D]:
    ox, oy, oz = origin
    return [((x - ox) * scale, (y - oy) * scale, (z - oz) * scale) for x, y, z in points]


def _group(value: LandmarkSet | None, origin: Point3D, scale: float) -> list[Point3D] | None:
    return _normalize(value.landmarks, origin, scale) if value else None


def normalize_sign_features(features: FeatureFrame) -> NormalizedSignFeatures:
    shoulder_pair = _shoulders(features.pose)
    if shoulder_pair is None:
        origin = (0.5, 0.5, 0.0)
        shoulder_width = 1.0
    else:
        left, right = shoulder_pair
        origin = (
            (left[0] + right[0]) / 2,
            (left[1] + right[1]) / 2,
            (left[2] + right[2]) / 2,
        )
        shoulder_width = math.dist(left, right)
        if shoulder_width < 1e-6:
            shoulder_width = 1.0
    scale = 1.0 / shoulder_width
    return NormalizedSignFeatures(
        origin=origin,
        shoulder_width=shoulder_width,
        scale=scale,
        left_hand=_group(features.left_hand, origin, scale),
        right_hand=_group(features.right_hand, origin, scale),
        upper_body=_group(features.pose, origin, scale),
    )


def add_velocities(
    current: NormalizedSignFeatures,
    previous: NormalizedSignFeatures | None,
    elapsed_ms: int,
) -> NormalizedSignFeatures:
    if previous is None or elapsed_ms <= 0:
        return current
    elapsed_seconds = elapsed_ms / 1000.0
    velocities: dict[str, list[Point3D]] = {}
    for name, now, before in (
        ("leftHand", current.left_hand, previous.left_hand),
        ("rightHand", current.right_hand, previous.right_hand),
        ("upperBody", current.upper_body, previous.upper_body),
    ):
        if now is None or before is None or len(now) != len(before):
            continue
        velocities[name] = [
            ((x - px) / elapsed_seconds, (y - py) / elapsed_seconds, (z - pz) / elapsed_seconds)
            for (x, y, z), (px, py, pz) in zip(now, before, strict=True)
        ]
    return NormalizedSignFeatures(
        origin=current.origin,
        shoulder_width=current.shoulder_width,
        scale=current.scale,
        left_hand=current.left_hand,
        right_hand=current.right_hand,
        upper_body=current.upper_body,
        velocities=velocities,
        normalization_version=current.normalization_version,
    )
