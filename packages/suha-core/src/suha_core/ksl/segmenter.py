from __future__ import annotations

import math
from dataclasses import dataclass, field
from uuid import uuid4

from suha_core.domain import FeatureFrame


@dataclass(frozen=True, slots=True)
class KslSegmentSnapshot:
    state: str
    segment_id: str | None
    started: bool
    ended: bool
    accept_frame: bool
    sequence_ready: bool
    frame_count: int
    duration_ms: int
    motion_speed: float
    occlusion_ms: int
    end_reason: str | None = None

    def to_dict(self) -> dict[str, object]:
        return {
            "state": self.state,
            "segmentId": self.segment_id,
            "started": self.started,
            "ended": self.ended,
            "acceptFrame": self.accept_frame,
            "sequenceReady": self.sequence_ready,
            "frameCount": self.frame_count,
            "durationMs": self.duration_ms,
            "motionSpeed": self.motion_speed,
            "occlusionMs": self.occlusion_ms,
            "endReason": self.end_reason,
        }


@dataclass(slots=True)
class _SegmentState:
    state: str = "IDLE"
    segment_id: str | None = None
    visible_since_ms: int | None = None
    active_since_ms: int | None = None
    still_since_ms: int | None = None
    occlusion_since_ms: int | None = None
    last_timestamp_ms: int | None = None
    last_anchor: tuple[float, float] | None = None
    frame_count: int = 0


@dataclass(slots=True)
class KslSequenceSegmenter:
    start_motion_speed: float = 0.18
    end_motion_speed: float = 0.045
    static_start_ms: int = 250
    end_hold_ms: int = 450
    occlusion_grace_ms: int = 300
    minimum_segment_ms: int = 300
    minimum_frames: int = 6
    maximum_segment_ms: int = 8000
    _sessions: dict[str, _SegmentState] = field(default_factory=dict)

    def process(self, features: FeatureFrame) -> KslSegmentSnapshot:
        session = self._sessions.setdefault(features.session_id, _SegmentState())
        timestamp = features.timestamp_ms
        both_hands_visible = features.left_hand is not None and features.right_hand is not None
        anchor = self._anchor(features) if both_hands_visible else None
        motion = self._motion_speed(session, anchor, timestamp)
        session.last_timestamp_ms = timestamp
        session.last_anchor = anchor

        if session.state == "IDLE":
            return self._idle(session, timestamp, both_hands_visible, motion)
        return self._active(session, timestamp, both_hands_visible, motion)

    def reset(self, session_id: str) -> None:
        self._sessions.pop(session_id, None)

    def _idle(self, session: _SegmentState, timestamp: int, visible: bool, motion: float) -> KslSegmentSnapshot:
        if not visible:
            session.visible_since_ms = None
            return self._snapshot(session, timestamp, motion)
        if session.visible_since_ms is None:
            session.visible_since_ms = timestamp
        visible_duration = timestamp - session.visible_since_ms
        if motion < self.start_motion_speed and visible_duration < self.static_start_ms:
            return self._snapshot(session, timestamp, motion)
        session.state = "ACTIVE"
        session.segment_id = f"kslseg_{uuid4().hex}"
        session.active_since_ms = timestamp
        session.still_since_ms = timestamp if motion <= self.end_motion_speed else None
        session.occlusion_since_ms = None
        session.frame_count = 1
        return self._snapshot(session, timestamp, motion, started=True, accept_frame=True)

    def _active(self, session: _SegmentState, timestamp: int, visible: bool, motion: float) -> KslSegmentSnapshot:
        if not visible:
            if session.occlusion_since_ms is None:
                session.occlusion_since_ms = timestamp
            session.still_since_ms = None
            occlusion_ms = timestamp - session.occlusion_since_ms
            if occlusion_ms <= self.occlusion_grace_ms:
                session.state = "OCCLUDED"
                return self._snapshot(session, timestamp, motion, occlusion_ms=occlusion_ms)
            return self._finish(session, timestamp, motion, "HAND_OCCLUSION", accept_frame=False, occlusion_ms=occlusion_ms)

        session.state = "ACTIVE"
        session.occlusion_since_ms = None
        session.frame_count += 1
        if motion <= self.end_motion_speed:
            if session.still_since_ms is None:
                session.still_since_ms = timestamp
        else:
            session.still_since_ms = None
        duration = self._duration(session, timestamp)
        still_duration = timestamp - session.still_since_ms if session.still_since_ms is not None else 0
        if duration >= self.minimum_segment_ms and still_duration >= self.end_hold_ms:
            return self._finish(session, timestamp, motion, "MOTION_SETTLED", accept_frame=True)
        if duration >= self.maximum_segment_ms:
            return self._finish(session, timestamp, motion, "MAX_DURATION", accept_frame=True)
        return self._snapshot(session, timestamp, motion, accept_frame=True)

    def _finish(
        self,
        session: _SegmentState,
        timestamp: int,
        motion: float,
        reason: str,
        *,
        accept_frame: bool,
        occlusion_ms: int = 0,
    ) -> KslSegmentSnapshot:
        segment_id = session.segment_id
        frame_count = session.frame_count
        duration = self._duration(session, timestamp)
        ready = frame_count >= self.minimum_frames and reason != "HAND_OCCLUSION"
        snapshot = KslSegmentSnapshot(
            "ENDED",
            segment_id,
            False,
            True,
            accept_frame,
            ready,
            frame_count,
            duration,
            motion,
            occlusion_ms,
            reason,
        )
        self._clear(session)
        return snapshot

    def _snapshot(
        self,
        session: _SegmentState,
        timestamp: int,
        motion: float,
        *,
        started: bool = False,
        accept_frame: bool = False,
        occlusion_ms: int = 0,
    ) -> KslSegmentSnapshot:
        return KslSegmentSnapshot(
            session.state,
            session.segment_id,
            started,
            False,
            accept_frame,
            False,
            session.frame_count,
            self._duration(session, timestamp),
            motion,
            occlusion_ms,
        )

    @staticmethod
    def _anchor(features: FeatureFrame) -> tuple[float, float]:
        assert features.left_hand is not None and features.right_hand is not None
        left = features.left_hand.landmarks[0]
        right = features.right_hand.landmarks[0]
        return ((left[0] + right[0]) / 2, (left[1] + right[1]) / 2)

    @staticmethod
    def _motion_speed(session: _SegmentState, anchor: tuple[float, float] | None, timestamp: int) -> float:
        if anchor is None or session.last_anchor is None or session.last_timestamp_ms is None:
            return 0.0
        elapsed_ms = timestamp - session.last_timestamp_ms
        if elapsed_ms <= 0:
            return 0.0
        return math.dist(anchor, session.last_anchor) / (elapsed_ms / 1000.0)

    @staticmethod
    def _duration(session: _SegmentState, timestamp: int) -> int:
        return max(0, timestamp - session.active_since_ms) if session.active_since_ms is not None else 0

    @staticmethod
    def _clear(session: _SegmentState) -> None:
        session.state = "IDLE"
        session.segment_id = None
        session.visible_since_ms = None
        session.active_since_ms = None
        session.still_since_ms = None
        session.occlusion_since_ms = None
        session.frame_count = 0
