from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from .errors import SuhaSchemaError


@dataclass(frozen=True, slots=True)
class CameraStatus:
    camera_id: str
    running: bool
    session_id: str
    mode: str
    profile: str
    capture_fps: float
    inference_fps: float
    dropped_frames: int
    error: str | None = None

    @classmethod
    def from_dict(cls, value: dict[str, Any]) -> CameraStatus:
        try:
            return cls(
                camera_id=str(value["cameraId"]),
                running=bool(value["running"]),
                session_id=str(value["sessionId"]),
                mode=str(value["mode"]),
                profile=str(value["profile"]),
                capture_fps=float(value["captureFps"]),
                inference_fps=float(value["inferenceFps"]),
                dropped_frames=int(value["droppedFrames"]),
                error=str(value["error"]) if value.get("error") is not None else None,
            )
        except (KeyError, TypeError, ValueError) as error:
            raise SuhaSchemaError(f"Malformed camera response: {error}") from error


@dataclass(frozen=True, slots=True)
class SuhaEvent:
    schema_version: str
    event_id: str
    trace_id: str
    camera_id: str
    session_id: str
    person_id: str | None
    timestamp: str
    category: str
    event_code: str
    phase: str
    intent: str
    confidence: float
    duration_ms: int
    source: dict[str, Any] = field(default_factory=dict)
    quality: dict[str, Any] = field(default_factory=dict)
    metadata: dict[str, Any] = field(default_factory=dict)

    @classmethod
    def from_dict(cls, value: dict[str, Any]) -> SuhaEvent:
        version = value.get("schemaVersion")
        if version != "1.0":
            raise SuhaSchemaError(f"Unsupported event schema: {version}")
        required_strings = ("eventId", "traceId", "cameraId", "sessionId", "timestamp", "category", "eventCode", "phase", "intent")
        missing = [key for key in required_strings if not isinstance(value.get(key), str)]
        if missing:
            raise SuhaSchemaError(f"Malformed event string fields: {missing}")
        confidence = value.get("confidence")
        duration = value.get("durationMs")
        if not isinstance(confidence, int | float) or not isinstance(duration, int):
            raise SuhaSchemaError("Malformed event confidence or durationMs")
        return cls(
            version,
            value["eventId"],
            value["traceId"],
            value["cameraId"],
            value["sessionId"],
            str(value["personId"]) if value.get("personId") is not None else None,
            value["timestamp"],
            value["category"],
            value["eventCode"],
            value["phase"],
            value["intent"],
            float(confidence),
            duration,
            dict(value.get("source", {})),
            dict(value.get("quality", {})),
            dict(value.get("metadata", {})),
        )
