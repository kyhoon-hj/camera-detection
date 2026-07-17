from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

import numpy as np


@dataclass(frozen=True, slots=True)
class CameraCapabilities:
    rgb: bool = True
    depth: bool = False
    infrared: bool = False
    hardware_timestamps: bool = False
    calibration: bool = False

    def to_dict(self) -> dict[str, bool]:
        return {
            "rgb": self.rgb,
            "depth": self.depth,
            "infrared": self.infrared,
            "hardwareTimestamps": self.hardware_timestamps,
            "calibration": self.calibration,
        }


@dataclass(frozen=True, slots=True)
class CameraCalibration:
    width: int
    height: int
    fx: float
    fy: float
    cx: float
    cy: float
    depth_scale_m: float = 0.001
    model: str = "PINHOLE"

    def to_dict(self) -> dict[str, Any]:
        return {
            "width": self.width,
            "height": self.height,
            "fx": self.fx,
            "fy": self.fy,
            "cx": self.cx,
            "cy": self.cy,
            "depthScaleMeters": self.depth_scale_m,
            "model": self.model,
        }


@dataclass(slots=True)
class FramePacket:
    camera_id: str
    sequence: int
    timestamp_ms: int
    rgb: np.ndarray
    depth: np.ndarray | None = None
    width: int = 0
    height: int = 0
    metadata: dict[str, Any] = field(default_factory=dict)
    calibration: CameraCalibration | None = None


@dataclass(slots=True)
class LandmarkSet:
    landmarks: list[tuple[float, float, float]]
    visibility: list[float]
    handedness: str | None = None


@dataclass(slots=True)
class FrameQuality:
    brightness: float = 0.0
    blur: float = 0.0
    hand_visibility: float = 0.0
    pose_visibility: float = 0.0
    latency_ms: float = 0.0


@dataclass(slots=True)
class FeatureFrame:
    camera_id: str
    session_id: str
    timestamp_ms: int
    person_id: str | None
    left_hand: LandmarkSet | None
    right_hand: LandmarkSet | None
    pose: LandmarkSet | None
    face: LandmarkSet | None
    quality: FrameQuality
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass(slots=True)
class RecognitionCandidate:
    category: str
    code: str
    confidence: float
    person_id: str | None
    handedness: str | None
    start_ms: int
    end_ms: int
    source_plugin: str
    model_id: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass(slots=True)
class EventEnvelope:
    camera_id: str
    session_id: str
    category: str
    event_code: str
    phase: str
    confidence: float
    duration_ms: int
    intent: str = "NONE"
    person_id: str | None = None
    source: dict[str, Any] = field(default_factory=dict)
    quality: dict[str, Any] = field(default_factory=dict)
    metadata: dict[str, Any] = field(default_factory=dict)
    schema_version: str = "1.0"
    event_id: str = field(default_factory=lambda: f"evt_{uuid4().hex}")
    trace_id: str = field(default_factory=lambda: f"trc_{uuid4().hex}")
    timestamp: str = field(default_factory=lambda: datetime.now(UTC).isoformat())

    def to_dict(self) -> dict[str, Any]:
        raw = asdict(self)
        return {
            "schemaVersion": raw.pop("schema_version"),
            "eventId": raw.pop("event_id"),
            "traceId": raw.pop("trace_id"),
            "cameraId": raw.pop("camera_id"),
            "sessionId": raw.pop("session_id"),
            "personId": raw.pop("person_id"),
            "timestamp": raw.pop("timestamp"),
            "category": raw.pop("category"),
            "eventCode": raw.pop("event_code"),
            "phase": raw.pop("phase"),
            "intent": raw.pop("intent"),
            "confidence": raw.pop("confidence"),
            "durationMs": raw.pop("duration_ms"),
            **raw,
        }
