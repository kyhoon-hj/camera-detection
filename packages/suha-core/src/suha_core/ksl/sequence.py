from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

from suha_core.domain import RecognitionCandidate


@dataclass(frozen=True, slots=True)
class GlossToken:
    gloss: str
    code: str
    confidence: float
    segment_id: str | None
    timestamp_ms: int

    def to_dict(self) -> dict[str, Any]:
        return {
            "gloss": self.gloss,
            "code": self.code,
            "confidence": self.confidence,
            "segmentId": self.segment_id,
            "timestampMs": self.timestamp_ms,
        }


@dataclass(slots=True)
class GlossSequenceTracker:
    max_tokens: int = 50
    _tokens: dict[str, list[GlossToken]] = field(default_factory=dict)
    _clear_listeners: list[Callable[[str], None]] = field(default_factory=list)

    def add_clear_listener(self, listener: Callable[[str], None]) -> None:
        self._clear_listeners.append(listener)

    def append(self, session_id: str, candidate: RecognitionCandidate) -> dict[str, Any]:
        if candidate.category != "SIGN_LANGUAGE":
            raise ValueError("Only sign-language candidates can become Gloss tokens")
        gloss = str(candidate.metadata.get("recognizedText") or candidate.code.removeprefix("KSL_"))
        segment_id_raw = candidate.metadata.get("segmentId")
        segment_id = str(segment_id_raw) if segment_id_raw else None
        tokens = self._tokens.setdefault(session_id, [])
        if segment_id and any(token.segment_id == segment_id for token in tokens):
            return self.snapshot(session_id)
        tokens.append(GlossToken(gloss, candidate.code, candidate.confidence, segment_id, candidate.end_ms))
        if len(tokens) > self.max_tokens:
            del tokens[: len(tokens) - self.max_tokens]
        return self.snapshot(session_id)

    def snapshot(self, session_id: str) -> dict[str, Any]:
        tokens = self._tokens.get(session_id, [])
        average = sum(token.confidence for token in tokens) / len(tokens) if tokens else 0.0
        return {
            "sessionId": session_id,
            "glossSequence": [token.gloss for token in tokens],
            "tokens": [token.to_dict() for token in tokens],
            "averageConfidence": average,
            "tokenCount": len(tokens),
        }

    def clear(self, session_id: str) -> dict[str, Any]:
        self._tokens.pop(session_id, None)
        for listener in self._clear_listeners:
            listener(session_id)
        return self.snapshot(session_id)
