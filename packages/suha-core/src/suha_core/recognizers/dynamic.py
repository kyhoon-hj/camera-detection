from __future__ import annotations

from collections import defaultdict, deque
from dataclasses import dataclass

from suha_core.domain import FeatureFrame, RecognitionCandidate


@dataclass(slots=True)
class MotionPoint:
    timestamp_ms: int
    x: float
    y: float


class TemporalRecognizer:
    plugin_id = "temporal-trajectory"
    plugin_version = "0.1.0"

    def __init__(self, max_duration_ms: int = 2500) -> None:
        self.max_duration_ms = max_duration_ms
        self._hands: dict[str, deque[MotionPoint]] = defaultdict(deque)
        self._heads: dict[str, deque[MotionPoint]] = defaultdict(deque)
        self._last_emit: dict[tuple[str, str], int] = {}

    def reset(self, session_id: str | None = None) -> None:
        if session_id is None:
            self._hands.clear()
            self._heads.clear()
            self._last_emit.clear()
            return
        self._hands.pop(session_id, None)
        self._heads.pop(session_id, None)

    def process(self, features: FeatureFrame) -> list[RecognitionCandidate]:
        hand = features.right_hand or features.left_hand
        if hand:
            x, y, _ = hand.landmarks[0]
            self._append(self._hands[features.session_id], MotionPoint(features.timestamp_ms, x, y))
        if features.face:
            x, y, _ = features.face.landmarks[0]
            self._append(self._heads[features.session_id], MotionPoint(features.timestamp_ms, x, y))
        results: list[RecognitionCandidate] = []
        results.extend(self._recognize_hand(features, self._hands[features.session_id]))
        results.extend(self._recognize_head(features, self._heads[features.session_id]))
        return results

    def _append(self, buffer: deque[MotionPoint], point: MotionPoint) -> None:
        buffer.append(point)
        cutoff = point.timestamp_ms - self.max_duration_ms
        while buffer and buffer[0].timestamp_ms < cutoff:
            buffer.popleft()

    @staticmethod
    def _turns(values: list[float], epsilon: float = 0.012) -> int:
        directions: list[int] = []
        for previous, current in zip(values, values[1:], strict=False):
            delta = current - previous
            direction = 1 if delta > epsilon else -1 if delta < -epsilon else 0
            if direction and (not directions or direction != directions[-1]):
                directions.append(direction)
        return max(0, len(directions) - 1)

    def _recognize_hand(self, features: FeatureFrame, points: deque[MotionPoint]) -> list[RecognitionCandidate]:
        recent = [p for p in points if p.timestamp_ms >= features.timestamp_ms - 1100]
        if len(recent) < 5:
            return []
        xs = [p.x for p in recent]
        ys = [p.y for p in recent]
        span_x, span_y = max(xs) - min(xs), max(ys) - min(ys)
        duration = recent[-1].timestamp_ms - recent[0].timestamp_ms
        code: str | None = None
        confidence = 0.0
        if duration >= 450 and self._turns(xs) >= 3 and span_x > 0.18 and span_y < span_x * 0.55:
            code, confidence = "HAND_WAVE", min(0.99, 0.72 + span_x)
        elif duration <= 900 and abs(xs[-1] - xs[0]) > 0.22 and self._turns(xs) == 0:
            code = "SWIPE_RIGHT" if xs[-1] > xs[0] else "SWIPE_LEFT"
            confidence = min(0.99, 0.7 + abs(xs[-1] - xs[0]))
        elif duration <= 900 and ys[0] - ys[-1] > 0.12 and ys[-1] < 0.35 and self._turns(ys) == 0:
            code, confidence = "RAISE_HAND", 0.82
        if code and self._can_emit(features.session_id, code, features.timestamp_ms, 1500):
            return [
                self._candidate(
                    features,
                    code,
                    confidence,
                    recent[0].timestamp_ms,
                    {"spanX": span_x, "turns": self._turns(xs)},
                )
            ]
        return []

    def _recognize_head(self, features: FeatureFrame, points: deque[MotionPoint]) -> list[RecognitionCandidate]:
        recent = [p for p in points if p.timestamp_ms >= features.timestamp_ms - 1200]
        if len(recent) < 6:
            return []
        xs, ys = [p.x for p in recent], [p.y for p in recent]
        span_x, span_y = max(xs) - min(xs), max(ys) - min(ys)
        code: str | None = None
        if self._turns(ys, 0.008) >= 2 and span_y > 0.035 and span_x < 0.12:
            code = "HEAD_NOD"
        elif self._turns(xs, 0.012) >= 2 and span_x > 0.06 and span_y < 0.12:
            code = "HEAD_SHAKE"
        if code and self._can_emit(features.session_id, code, features.timestamp_ms, 1000):
            return [self._candidate(features, code, 0.8, recent[0].timestamp_ms, {"spanX": span_x, "spanY": span_y})]
        return []

    def _can_emit(self, session: str, code: str, now: int, cooldown: int) -> bool:
        key = (session, code)
        if now - self._last_emit.get(key, -cooldown) < cooldown:
            return False
        self._last_emit[key] = now
        return True

    def _candidate(
        self,
        features: FeatureFrame,
        code: str,
        confidence: float,
        start_ms: int,
        metadata: dict[str, object],
    ) -> RecognitionCandidate:
        category = "HEAD_MOTION" if code.startswith("HEAD_") else "GESTURE_DYNAMIC"
        return RecognitionCandidate(
            category,
            code,
            confidence,
            features.person_id,
            None,
            start_ms,
            features.timestamp_ms,
            self.plugin_id,
            metadata=metadata,
        )
