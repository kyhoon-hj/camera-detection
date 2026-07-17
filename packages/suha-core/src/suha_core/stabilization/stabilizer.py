from __future__ import annotations

from dataclasses import dataclass

from suha_core.domain import EventEnvelope, FeatureFrame, RecognitionCandidate
from suha_core.intents import IntentMapper


@dataclass(slots=True)
class ActiveState:
    candidate: RecognitionCandidate
    first_ms: int
    last_ms: int
    started: bool = False
    held: bool = False


class EventStabilizer:
    def __init__(self, mapper: IntentMapper, min_hold_ms: int = 450, cooldown_ms: int = 900) -> None:
        self.mapper = mapper
        self.min_hold_ms = min_hold_ms
        self.cooldown_ms = cooldown_ms
        self._active: dict[tuple[str, str], ActiveState] = {}
        self._cooldowns: dict[tuple[str, str], int] = {}

    def process(self, features: FeatureFrame, candidates: list[RecognitionCandidate], mode: str) -> list[EventEnvelope]:
        now = features.timestamp_ms
        seen = {(c.person_id or "none", c.code) for c in candidates if c.confidence >= 0.75}
        output: list[EventEnvelope] = []
        for candidate in candidates:
            key = (candidate.person_id or "none", candidate.code)
            if candidate.confidence < 0.75:
                continue
            if candidate.category != "GESTURE_STATIC":
                if now >= self._cooldowns.get(key, 0):
                    output.append(self._event(features, candidate, "END", mode))
                    self._cooldowns[key] = now + self.cooldown_ms
                continue
            state = self._active.get(key)
            if state is None:
                channel = (candidate.person_id or "none", f"GESTURE_STATIC:{candidate.handedness or 'UNKNOWN'}")
                if now < self._cooldowns.get(channel, 0):
                    continue
                state = self._active[key] = ActiveState(candidate, now, now)
            state.last_ms = now
            state.candidate = candidate
            duration = now - state.first_ms
            if not state.started:
                output.append(self._event(features, candidate, "START", mode, duration))
                state.started = True
            if duration >= self.min_hold_ms and not state.held:
                output.append(self._event(features, candidate, "HOLD", mode, duration))
                state.held = True
        for key, state in list(self._active.items()):
            if key not in seen and now - state.last_ms > 120:
                output.append(self._event(features, state.candidate, "END", mode, state.last_ms - state.first_ms))
                channel = (state.candidate.person_id or "none", f"GESTURE_STATIC:{state.candidate.handedness or 'UNKNOWN'}")
                self._cooldowns[channel] = now + self.cooldown_ms
                del self._active[key]
        return output

    def _event(
        self,
        features: FeatureFrame,
        candidate: RecognitionCandidate,
        phase: str,
        mode: str,
        duration_ms: int | None = None,
    ) -> EventEnvelope:
        duration = duration_ms if duration_ms is not None else candidate.end_ms - candidate.start_ms
        should_map = phase == "HOLD" or (phase == "END" and duration >= self.min_hold_ms)
        intent = self.mapper.map(candidate.code, candidate.confidence, mode) if should_map else "NONE"
        return EventEnvelope(
            features.camera_id,
            features.session_id,
            candidate.category,
            candidate.code,
            phase,
            candidate.confidence,
            duration,
            intent,
            candidate.person_id,
            source={
                "pluginId": candidate.source_plugin,
                "pluginVersion": "0.1.0",
                "modelId": candidate.model_id,
            },
            quality={
                "brightness": features.quality.brightness,
                "blur": features.quality.blur,
                "handVisibility": features.quality.hand_visibility,
                "poseVisibility": features.quality.pose_visibility,
            },
            metadata={**candidate.metadata, "handedness": candidate.handedness},
        )
