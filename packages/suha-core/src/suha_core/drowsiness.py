from __future__ import annotations

import math
from collections import deque
from dataclasses import dataclass, field

from suha_core.domain import FeatureFrame, LandmarkSet

RIGHT_EYE = (33, 160, 158, 133, 153, 144)
LEFT_EYE = (362, 385, 387, 263, 373, 380)


@dataclass(frozen=True, slots=True)
class DrowsinessSnapshot:
    status: str
    timestamp_ms: int
    face_visible: bool
    eye_aspect_ratio: float | None
    eyes_closed: bool
    closed_duration_ms: int
    perclos: float
    blink_count: int
    head_down: bool
    head_down_duration_ms: int
    combined_duration_ms: int
    face_missing_duration_ms: int
    risk_score: float
    trigger: str
    message: str

    def to_dict(self) -> dict[str, object]:
        return {
            "status": self.status,
            "timestampMs": self.timestamp_ms,
            "faceVisible": self.face_visible,
            "eyeAspectRatio": self.eye_aspect_ratio,
            "eyesClosed": self.eyes_closed,
            "closedDurationMs": self.closed_duration_ms,
            "perclos": self.perclos,
            "blinkCount": self.blink_count,
            "headDown": self.head_down,
            "headDownDurationMs": self.head_down_duration_ms,
            "combinedDurationMs": self.combined_duration_ms,
            "faceMissingDurationMs": self.face_missing_duration_ms,
            "riskScore": self.risk_score,
            "trigger": self.trigger,
            "message": self.message,
        }


@dataclass(slots=True)
class _SessionState:
    eye_samples: deque[tuple[int, bool]] = field(default_factory=deque)
    eyes_closed_since: int | None = None
    head_down_since: int | None = None
    face_missing_since: int | None = None
    last_eyes_closed: bool = False
    last_head_down: bool = False
    blink_count: int = 0
    neutral_pitch: float | None = None


class DrowsinessMonitor:
    """Local face-landmark drowsiness monitor; no camera frame leaves the device."""

    def __init__(
        self,
        eye_closed_threshold: float = 0.19,
        eye_warning_ms: int = 1_500,
        eye_alarm_ms: int = 3_000,
        combined_warning_ms: int = 650,
        combined_alarm_ms: int = 1_400,
        head_warning_ms: int = 5_000,
        head_alarm_ms: int = 9_000,
        sample_window_ms: int = 30_000,
    ) -> None:
        self.eye_closed_threshold = eye_closed_threshold
        self.eye_open_threshold = eye_closed_threshold + 0.025
        self.eye_warning_ms = eye_warning_ms
        self.eye_alarm_ms = eye_alarm_ms
        self.combined_warning_ms = combined_warning_ms
        self.combined_alarm_ms = combined_alarm_ms
        self.head_warning_ms = head_warning_ms
        self.head_alarm_ms = head_alarm_ms
        self.sample_window_ms = sample_window_ms
        self._sessions: dict[str, _SessionState] = {}

    def reset(self, session_id: str | None = None) -> None:
        if session_id is None:
            self._sessions.clear()
        else:
            self._sessions.pop(session_id, None)

    def process(self, features: FeatureFrame) -> DrowsinessSnapshot:
        state = self._sessions.setdefault(features.session_id, _SessionState())
        now = features.timestamp_ms
        face = features.face
        if face is None or len(face.landmarks) <= max(*RIGHT_EYE, *LEFT_EYE, 387):
            return self._missing_face(state, now)

        state.face_missing_since = None
        ear = (_eye_aspect_ratio(face, RIGHT_EYE) + _eye_aspect_ratio(face, LEFT_EYE)) / 2
        eyes_closed = ear < (self.eye_open_threshold if state.last_eyes_closed else self.eye_closed_threshold)
        closed_duration = self._update_eyes(state, now, eyes_closed)

        state.eye_samples.append((now, eyes_closed))
        cutoff = now - self.sample_window_ms
        while state.eye_samples and state.eye_samples[0][0] < cutoff:
            state.eye_samples.popleft()
        perclos = sum(1 for _, closed in state.eye_samples if closed) / max(1, len(state.eye_samples))

        pitch = _head_pitch(face)
        head_down, head_down_duration = self._update_head(state, now, pitch, eyes_closed)
        combined_duration = min(closed_duration, head_down_duration) if eyes_closed and head_down else 0
        sample_span = state.eye_samples[-1][0] - state.eye_samples[0][0] if len(state.eye_samples) > 1 else 0
        fatigue_warning = sample_span >= 15_000 and perclos >= 0.45
        fatigue_alarm = sample_span >= 25_000 and perclos >= 0.65

        if combined_duration >= self.combined_alarm_ms:
            status, trigger, message = "ALARM", "EYES_AND_HEAD", "눈 감김과 고개 숙임이 함께 지속됩니다. 즉시 쉬어가세요."
        elif closed_duration >= self.eye_alarm_ms:
            status, trigger, message = "ALARM", "EYES_ONLY", "눈 감김이 오래 지속됩니다. 안전한 곳에서 쉬어가세요."
        elif head_down_duration >= self.head_alarm_ms:
            status, trigger, message = "ALARM", "HEAD_ONLY", "전방을 보지 않는 상태가 오래 지속됩니다."
        elif fatigue_alarm:
            status, trigger, message = "ALARM", "PERCLOS", "최근 눈 감김 비율이 매우 높습니다. 쉬어가세요."
        elif combined_duration >= self.combined_warning_ms:
            status, trigger, message = "WARNING", "EYES_AND_HEAD", "눈 감김과 고개 숙임이 동시에 감지됐습니다."
        elif closed_duration >= self.eye_warning_ms:
            status, trigger, message = "WARNING", "EYES_ONLY", "눈 감김이 길어지고 있습니다."
        elif head_down_duration >= self.head_warning_ms:
            status, trigger, message = "WARNING", "HEAD_ONLY", "고개 숙임이 오래 지속됩니다. 전방을 확인하세요."
        elif fatigue_warning:
            status, trigger, message = "WARNING", "PERCLOS", "최근 눈 감김 비율이 높아지고 있습니다."
        else:
            status, trigger, message = "AWAKE", "NONE", "정상적으로 주시하고 있습니다."

        risk_score = max(
            min(1.0, closed_duration / self.eye_alarm_ms),
            min(1.0, head_down_duration / self.head_alarm_ms),
            min(1.0, combined_duration / self.combined_alarm_ms),
            min(1.0, perclos / 0.65) if sample_span >= 15_000 else 0.0,
        )
        return DrowsinessSnapshot(
            status,
            now,
            True,
            round(ear, 4),
            eyes_closed,
            closed_duration,
            round(perclos, 4),
            state.blink_count,
            head_down,
            head_down_duration,
            combined_duration,
            0,
            round(risk_score, 4),
            trigger,
            message,
        )

    def _missing_face(self, state: _SessionState, now: int) -> DrowsinessSnapshot:
        if state.face_missing_since is None:
            state.face_missing_since = now
        missing_duration = max(0, now - state.face_missing_since)
        state.eyes_closed_since = None
        state.head_down_since = None
        state.last_eyes_closed = False
        state.last_head_down = False
        if missing_duration >= 3_000:
            status, message = "ALARM", "얼굴이 보이지 않습니다. 전방을 확인해 주세요."
        elif missing_duration >= 1_500:
            status, message = "WARNING", "운전자 얼굴을 다시 확인하고 있습니다."
        else:
            status, message = "NO_FACE", "카메라 중앙에 얼굴을 보여 주세요."
        return DrowsinessSnapshot(
            status,
            now,
            False,
            None,
            False,
            0,
            0.0,
            state.blink_count,
            False,
            0,
            0,
            missing_duration,
            round(min(1.0, missing_duration / 3_000), 4),
            "FACE_MISSING",
            message,
        )

    @staticmethod
    def _update_eyes(state: _SessionState, now: int, eyes_closed: bool) -> int:
        if eyes_closed and not state.last_eyes_closed:
            state.eyes_closed_since = now
        elif not eyes_closed and state.last_eyes_closed:
            duration = max(0, now - (state.eyes_closed_since or now))
            if 80 <= duration <= 900:
                state.blink_count += 1
            state.eyes_closed_since = None
        state.last_eyes_closed = eyes_closed
        return max(0, now - state.eyes_closed_since) if eyes_closed and state.eyes_closed_since is not None else 0

    @staticmethod
    def _update_head(state: _SessionState, now: int, pitch: float, eyes_closed: bool) -> tuple[bool, int]:
        if state.neutral_pitch is None:
            state.neutral_pitch = pitch
        threshold = state.neutral_pitch + (0.03 if state.last_head_down else 0.045)
        head_down = pitch > threshold
        if head_down and not state.last_head_down:
            state.head_down_since = now
        elif not head_down:
            state.head_down_since = None
            if not eyes_closed and abs(pitch - state.neutral_pitch) < 0.06:
                state.neutral_pitch = state.neutral_pitch * 0.98 + pitch * 0.02
        state.last_head_down = head_down
        duration = max(0, now - state.head_down_since) if head_down and state.head_down_since is not None else 0
        return head_down, duration


def _distance(first: tuple[float, float, float], second: tuple[float, float, float]) -> float:
    return math.hypot(first[0] - second[0], first[1] - second[1])


def _eye_aspect_ratio(face: LandmarkSet, indices: tuple[int, int, int, int, int, int]) -> float:
    first, upper_outer, upper_inner, last, lower_inner, lower_outer = (face.landmarks[index] for index in indices)
    horizontal = max(_distance(first, last), 1e-6)
    vertical = _distance(upper_outer, lower_outer) + _distance(upper_inner, lower_inner)
    return vertical / (2 * horizontal)


def _head_pitch(face: LandmarkSet) -> float:
    eye_y = sum(face.landmarks[index][1] for index in (33, 133, 263, 362)) / 4
    face_height = max(_distance(face.landmarks[10], face.landmarks[152]), 1e-6)
    return (face.landmarks[1][1] - eye_y) / face_height
