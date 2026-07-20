from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any

from suha_core.domain import LandmarkSet

Point3D = tuple[float, float, float]


@dataclass(frozen=True, slots=True)
class SignQualityReport:
    metrics: dict[str, float]
    issues: list[str]
    ready_for_recognition: bool
    guidance_code: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "metrics": self.metrics,
            "issues": self.issues,
            "readyForRecognition": self.ready_for_recognition,
            "guidanceCode": self.guidance_code,
        }


@dataclass(frozen=True, slots=True)
class NormalizedSignFeatures:
    origin: Point3D
    shoulder_width: float
    scale: float
    left_hand: list[Point3D] | None
    right_hand: list[Point3D] | None
    upper_body: list[Point3D] | None
    velocities: dict[str, list[Point3D]] = field(default_factory=dict)
    normalization_version: str = "ksl-body-v1"

    def to_dict(self) -> dict[str, Any]:
        return {
            "origin": self.origin,
            "shoulderWidth": self.shoulder_width,
            "scale": self.scale,
            "leftHand": self.left_hand,
            "rightHand": self.right_hand,
            "upperBody": self.upper_body,
            "velocities": self.velocities,
            "normalizationVersion": self.normalization_version,
        }


@dataclass(frozen=True, slots=True)
class SignFeatureFrame:
    frame_id: str
    camera_id: str
    session_id: str
    sequence: int
    source_timestamp_ms: int
    processed_timestamp_ms: int
    width: int
    height: int
    mirrored: bool
    rotation_degrees: int
    person_id: str | None
    tracking_state: str
    left_hand: LandmarkSet | None
    right_hand: LandmarkSet | None
    pose: LandmarkSet | None
    face: LandmarkSet | None
    normalized: NormalizedSignFeatures
    quality: SignQualityReport
    provenance: dict[str, Any]
    schema_version: str = "1.0"

    def to_dict(self, *, include_landmarks: bool = False) -> dict[str, Any]:
        result: dict[str, Any] = {
            "schemaVersion": self.schema_version,
            "frameId": self.frame_id,
            "cameraId": self.camera_id,
            "sessionId": self.session_id,
            "sequence": self.sequence,
            "sourceTimestampMs": self.source_timestamp_ms,
            "processedTimestampMs": self.processed_timestamp_ms,
            "image": {
                "width": self.width,
                "height": self.height,
                "mirrored": self.mirrored,
                "rotationDegrees": self.rotation_degrees,
            },
            "subject": {
                "personId": self.person_id,
                "trackingState": self.tracking_state,
                "dominantHand": "UNKNOWN",
            },
            "normalized": self.normalized.to_dict() if include_landmarks else {
                "origin": self.normalized.origin,
                "shoulderWidth": self.normalized.shoulder_width,
                "scale": self.normalized.scale,
                "normalizationVersion": self.normalized.normalization_version,
            },
            "nonManual": {
                "eyebrow": "UNKNOWN",
                "head": "UNKNOWN",
                "mouth": "UNKNOWN",
                "gaze": "UNKNOWN",
                "extractorVersion": "none",
            },
            "quality": self.quality.to_dict(),
            "provenance": self.provenance,
        }
        if include_landmarks:
            result["landmarks"] = {
                "leftHand": asdict(self.left_hand) if self.left_hand else None,
                "rightHand": asdict(self.right_hand) if self.right_hand else None,
                "pose": asdict(self.pose) if self.pose else None,
                "face": asdict(self.face) if self.face else None,
            }
        return result
