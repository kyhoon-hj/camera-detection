from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Any

from suha_core.domain import FeatureFrame, FramePacket

from .normalization import add_velocities, normalize_sign_features
from .quality import evaluate_sign_quality
from .schema import NormalizedSignFeatures, SignFeatureFrame


@dataclass(slots=True)
class _PreviousFrame:
    timestamp_ms: int
    normalized: NormalizedSignFeatures


@dataclass(slots=True)
class SignInputAssembler:
    _previous: dict[str, _PreviousFrame] = field(default_factory=dict)

    def assemble(self, frame: FramePacket, features: FeatureFrame) -> SignFeatureFrame:
        previous = self._previous.get(features.session_id)
        timestamp_valid = frame.timestamp_ms == features.timestamp_ms and (
            previous is None or features.timestamp_ms > previous.timestamp_ms
        )
        normalized = normalize_sign_features(features)
        if previous is not None and timestamp_valid:
            normalized = add_velocities(normalized, previous.normalized, features.timestamp_ms - previous.timestamp_ms)
        provider_metadata = self._provider_metadata(features)
        quality = evaluate_sign_quality(features, provider_metadata, timestamp_valid=timestamp_valid)
        if timestamp_valid:
            self._previous[features.session_id] = _PreviousFrame(features.timestamp_ms, normalized)
        return SignFeatureFrame(
            frame_id=f"{frame.camera_id}:{frame.sequence}",
            camera_id=frame.camera_id,
            session_id=features.session_id,
            sequence=frame.sequence,
            source_timestamp_ms=frame.timestamp_ms,
            processed_timestamp_ms=time.monotonic_ns() // 1_000_000,
            width=frame.width or int(frame.rgb.shape[1]),
            height=frame.height or int(frame.rgb.shape[0]),
            mirrored=bool(frame.metadata.get("mirrored", False)),
            rotation_degrees=int(frame.metadata.get("rotationDegrees", 0)),
            person_id=features.person_id,
            tracking_state="TRACKED" if features.person_id else "NOT_FOUND",
            left_hand=features.left_hand,
            right_hand=features.right_hand,
            pose=features.pose,
            face=features.face,
            normalized=normalized,
            quality=quality,
            provenance={
                "provider": str(provider_metadata.get("provider", "unknown")),
                "runtime": "local",
                "handModel": provider_metadata.get("handModel"),
                "poseModel": provider_metadata.get("poseModel"),
                "faceModel": provider_metadata.get("faceModel"),
            },
        )

    def reset(self, session_id: str) -> None:
        self._previous.pop(session_id, None)

    @staticmethod
    def _provider_metadata(features: FeatureFrame) -> dict[str, Any]:
        value = features.metadata.get("landmarkProvider", {})
        return value if isinstance(value, dict) else {}
