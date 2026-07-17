from __future__ import annotations

import math
import statistics
from dataclasses import dataclass, field

from suha_core.domain import FeatureFrame, LandmarkSet


@dataclass(frozen=True, slots=True)
class PostureSnapshot:
    status: str
    timestamp_ms: int
    pose_visible: bool
    calibration_progress: float
    issue: str
    shoulder_tilt_degrees: float
    head_offset_ratio: float
    head_height_ratio: float
    forward_head_delta: float
    bad_duration_ms: int
    posture_score: float
    message: str
    head_lean_degrees: float = 0.0
    forward_head_percent: float = 0.0
    camera_view_angle_degrees: float = 0.0
    camera_view: str = "UNKNOWN"
    posture_confidence: float = 0.0

    def to_dict(self) -> dict[str, object]:
        return {
            "status": self.status,
            "timestampMs": self.timestamp_ms,
            "poseVisible": self.pose_visible,
            "calibrationProgress": self.calibration_progress,
            "issue": self.issue,
            "shoulderTiltDegrees": self.shoulder_tilt_degrees,
            "headOffsetRatio": self.head_offset_ratio,
            "headHeightRatio": self.head_height_ratio,
            "forwardHeadDelta": self.forward_head_delta,
            "badDurationMs": self.bad_duration_ms,
            "postureScore": self.posture_score,
            "message": self.message,
            "headLeanDegrees": self.head_lean_degrees,
            "forwardHeadPercent": self.forward_head_percent,
            "cameraViewAngleDegrees": self.camera_view_angle_degrees,
            "cameraView": self.camera_view,
            "postureConfidence": self.posture_confidence,
        }


@dataclass(frozen=True, slots=True)
class _PoseMeasurement:
    shoulder_tilt: float
    head_offset: float
    head_height: float
    head_forward: float
    head_lean_degrees: float
    view_angle: float
    confidence: float


@dataclass(slots=True)
class _PostureState:
    calibration: list[_PoseMeasurement] = field(default_factory=list)
    calibration_started_at: int | None = None
    baseline: _PoseMeasurement | None = None
    pose_history: list[_PoseMeasurement] = field(default_factory=list)
    issue_since: int | None = None
    active_issue: str = "NONE"


class PostureMonitor:
    """Side-view-aware 3D upper-body posture calibration using local landmarks."""

    def __init__(
        self,
        calibration_frames: int | None = None,
        warning_ms: int = 2_000,
        calibration_duration_ms: int = 5_000,
        minimum_calibration_samples: int = 20,
    ) -> None:
        self.calibration_frames = calibration_frames
        self.warning_ms = warning_ms
        self.calibration_duration_ms = calibration_duration_ms
        self.minimum_calibration_samples = minimum_calibration_samples
        self._sessions: dict[str, _PostureState] = {}

    def reset(self, session_id: str | None = None) -> None:
        if session_id is None:
            self._sessions.clear()
        else:
            self._sessions.pop(session_id, None)

    def process(self, features: FeatureFrame) -> PostureSnapshot:
        state = self._sessions.setdefault(features.session_id, _PostureState())
        pose = features.pose
        now = features.timestamp_ms
        if not _upper_body_visible(pose):
            state.issue_since = None
            state.active_issue = "NONE"
            state.pose_history.clear()
            return self._missing_pose(state, now)

        assert pose is not None
        raw = _measure_pose(pose)
        if (
            abs(raw.shoulder_tilt) > 35
            or abs(raw.head_offset) > 1.2
            or not 0.2 <= raw.head_height <= 3.5
            or raw.confidence < 0.38
        ):
            state.issue_since = None
            state.active_issue = "NONE"
            state.pose_history.clear()
            return self._missing_pose(state, now)

        if state.baseline is None:
            if state.calibration_started_at is None:
                state.calibration_started_at = now
            state.calibration.append(raw)
            frame_target_met = self.calibration_frames is not None and len(state.calibration) >= self.calibration_frames
            duration_target_met = (
                self.calibration_frames is None
                and now - state.calibration_started_at >= self.calibration_duration_ms
                and len(state.calibration) >= self.minimum_calibration_samples
            )
            if frame_target_met or duration_target_met:
                state.baseline = _median_pose(state.calibration)
            else:
                return PostureSnapshot(
                    "CALIBRATING",
                    now,
                    True,
                    self._progress(state, now),
                    "NONE",
                    round(raw.shoulder_tilt, 2),
                    round(raw.head_offset, 3),
                    round(raw.head_height, 3),
                    0.0,
                    0,
                    1.0,
                    f"{_camera_view_label(raw.view_angle)} 촬영 기준을 측정하고 있습니다. 평소 자세를 유지하세요.",
                    round(raw.head_lean_degrees, 2),
                    0.0,
                    round(abs(raw.view_angle), 1),
                    _camera_view(raw.view_angle),
                    round(raw.confidence, 3),
                )

        baseline = state.baseline
        assert baseline is not None
        state.pose_history.append(raw)
        if len(state.pose_history) > 5:
            state.pose_history.pop(0)
        measured = _median_pose(state.pose_history)

        view_drift = _angle_distance(measured.view_angle, baseline.view_angle)
        view_confidence = _clamp(1.0 - max(0.0, view_drift - 18.0) / 42.0, 0.25, 1.0)
        confidence = _clamp(measured.confidence * view_confidence, 0.0, 1.0)
        side_tolerance = 1.0 + min(abs(measured.view_angle) / 90.0, 1.0) * 0.35
        shoulder_delta = abs(measured.shoulder_tilt - baseline.shoulder_tilt)
        head_offset_delta = measured.head_offset - baseline.head_offset
        head_lean_delta = abs(math.degrees(math.atan2(head_offset_delta, max(measured.head_height, 1e-6))))
        slouch_ratio = max(0.0, (baseline.head_height - measured.head_height) / max(baseline.head_height, 1e-6))
        forward_delta = measured.head_forward - baseline.head_forward
        severities = {
            "SHOULDER_TILT": max(0.0, (shoulder_delta - 5.0 * side_tolerance) / (9.0 * side_tolerance)),
            "LEANING": max(0.0, (head_lean_delta - 5.0 * side_tolerance) / (10.0 * side_tolerance)),
            "SLOUCHING": max(0.0, (slouch_ratio - 0.10) / 0.20),
            "FORWARD_HEAD": max(0.0, (forward_delta - 0.11 * side_tolerance) / (0.20 * side_tolerance)),
        }
        issue, severity = max(severities.items(), key=lambda item: item[1])
        low_confidence = confidence < 0.42 or view_drift > 48
        if low_confidence:
            issue = "CAMERA_ANGLE"
        elif severity <= 0:
            issue = "NONE"

        if issue != state.active_issue:
            state.active_issue = issue
            state.issue_since = now if issue not in {"NONE", "CAMERA_ANGLE"} else None
        bad_duration = max(0, now - state.issue_since) if state.issue_since is not None else 0

        if issue == "NONE":
            status = "GOOD"
        elif issue == "CAMERA_ANGLE" or bad_duration < self.warning_ms:
            status = "CHECKING"
        else:
            status = "WARNING"
        posture_score = 0.0 if low_confidence else 1.0 - _clamp(severity, 0.0, 1.0)
        return PostureSnapshot(
            status,
            now,
            True,
            1.0,
            issue,
            round(measured.shoulder_tilt - baseline.shoulder_tilt, 2),
            round(head_offset_delta, 3),
            round(measured.head_height / max(baseline.head_height, 1e-6), 3),
            round(forward_delta, 3),
            bad_duration,
            round(posture_score, 4),
            _posture_message(issue, shoulder_delta, head_lean_delta, slouch_ratio, forward_delta, view_drift),
            round(head_lean_delta, 2),
            round(forward_delta * 100.0, 1),
            round(abs(measured.view_angle), 1),
            _camera_view(measured.view_angle),
            round(confidence, 3),
        )

    def _progress(self, state: _PostureState, now: int) -> float:
        if self.calibration_frames is not None:
            return round(min(1.0, len(state.calibration) / self.calibration_frames), 4)
        if state.calibration_started_at is None:
            return 0.0
        return round(min(1.0, (now - state.calibration_started_at) / self.calibration_duration_ms), 4)

    def _missing_pose(self, state: _PostureState, now: int) -> PostureSnapshot:
        return PostureSnapshot(
            "NO_POSE",
            now,
            False,
            self._progress(state, now),
            "POSE_MISSING",
            0.0,
            0.0,
            0.0,
            0.0,
            0,
            0.0,
            "얼굴과 어깨가 한쪽이라도 충분히 보이게 카메라를 맞춰 주세요.",
        )


def _measure_pose(pose: LandmarkSet) -> _PoseMeasurement:
    nose = pose.landmarks[0]
    left_shoulder, right_shoulder = pose.landmarks[11], pose.landmarks[12]
    head_center = _weighted_pair(pose, 7, 8)
    shoulder_center = _weighted_pair(pose, 11, 12)
    shoulder_dx = right_shoulder[0] - left_shoulder[0]
    shoulder_dz = right_shoulder[2] - left_shoulder[2]
    shoulder_horizontal = max(math.hypot(shoulder_dx, shoulder_dz), 1e-6)
    shoulder_axis_x = shoulder_dx / shoulder_horizontal
    shoulder_axis_z = shoulder_dz / shoulder_horizontal
    forward_axis_x, forward_axis_z = -shoulder_axis_z, shoulder_axis_x
    head_vector_x = head_center[0] - shoulder_center[0]
    head_vector_z = head_center[2] - shoulder_center[2]
    face_forward_x = nose[0] - head_center[0]
    face_forward_z = nose[2] - head_center[2]
    orientation = face_forward_x * forward_axis_x + face_forward_z * forward_axis_z
    if abs(orientation) < 1e-6:
        orientation = head_vector_x * forward_axis_x + head_vector_z * forward_axis_z
    if orientation < 0:
        forward_axis_x *= -1
        forward_axis_z *= -1
    head_offset = (head_vector_x * shoulder_axis_x + head_vector_z * shoulder_axis_z) / shoulder_horizontal
    head_height = (shoulder_center[1] - head_center[1]) / shoulder_horizontal
    head_forward = (head_vector_x * forward_axis_x + head_vector_z * forward_axis_z) / shoulder_horizontal
    view_angle = math.degrees(math.atan2(shoulder_dz, abs(shoulder_dx) + 1e-6))
    confidence = _pose_confidence(pose)
    return _PoseMeasurement(
        math.degrees(math.atan2(right_shoulder[1] - left_shoulder[1], shoulder_horizontal)),
        head_offset,
        head_height,
        head_forward,
        math.degrees(math.atan2(head_offset, max(head_height, 1e-6))),
        view_angle,
        confidence,
    )


def _visibility(pose: LandmarkSet, index: int) -> float:
    if index >= len(pose.visibility):
        return 1.0
    return _clamp(float(pose.visibility[index]), 0.0, 1.0)


def _weighted_pair(pose: LandmarkSet, first_index: int, second_index: int) -> tuple[float, float, float]:
    first, second = pose.landmarks[first_index], pose.landmarks[second_index]
    first_weight = max(0.05, _visibility(pose, first_index))
    second_weight = max(0.05, _visibility(pose, second_index))
    total = first_weight + second_weight
    return tuple((first[i] * first_weight + second[i] * second_weight) / total for i in range(3))  # type: ignore[return-value]


def _pose_confidence(pose: LandmarkSet) -> float:
    ears = sorted((_visibility(pose, 7), _visibility(pose, 8)), reverse=True)
    shoulders = sorted((_visibility(pose, 11), _visibility(pose, 12)), reverse=True)
    return _clamp(
        _visibility(pose, 0) * 0.20 + ears[0] * 0.22 + ears[1] * 0.08 + shoulders[0] * 0.30 + shoulders[1] * 0.20,
        0.0,
        1.0,
    )


def _upper_body_visible(pose: LandmarkSet | None) -> bool:
    if pose is None or len(pose.landmarks) <= 12:
        return False
    ears = sorted((_visibility(pose, 7), _visibility(pose, 8)), reverse=True)
    shoulders = sorted((_visibility(pose, 11), _visibility(pose, 12)), reverse=True)
    return _visibility(pose, 0) >= 0.35 and ears[0] >= 0.45 and ears[1] >= 0.08 and shoulders[0] >= 0.5 and shoulders[1] >= 0.12


def _median_pose(samples: list[_PoseMeasurement]) -> _PoseMeasurement:
    return _PoseMeasurement(
        statistics.median(sample.shoulder_tilt for sample in samples),
        statistics.median(sample.head_offset for sample in samples),
        statistics.median(sample.head_height for sample in samples),
        statistics.median(sample.head_forward for sample in samples),
        statistics.median(sample.head_lean_degrees for sample in samples),
        _circular_median([sample.view_angle for sample in samples]),
        statistics.median(sample.confidence for sample in samples),
    )


def _normalize_angle(value: float) -> float:
    while value > 90:
        value -= 180
    while value < -90:
        value += 180
    return value


def _circular_median(values: list[float]) -> float:
    reference = values[0]
    return statistics.median(reference + _normalize_angle(value - reference) for value in values)


def _angle_distance(first: float, second: float) -> float:
    return abs(_normalize_angle(first - second))


def _camera_view(angle: float) -> str:
    absolute = abs(angle)
    return "SIDE" if absolute >= 58 else "OBLIQUE" if absolute >= 25 else "FRONT"


def _camera_view_label(angle: float) -> str:
    return {"FRONT": "정면", "OBLIQUE": "사선", "SIDE": "측면"}[_camera_view(angle)]


def _posture_message(issue: str, shoulder: float, head_lean: float, slouch: float, forward: float, view_drift: float) -> str:
    if issue == "CAMERA_ANGLE":
        return f"기준 촬영 각도와 {view_drift:.0f}° 차이입니다. 현재 각도로 다시 측정해 주세요."
    if issue == "SHOULDER_TILT":
        return f"어깨 높이 차이를 약 {shoulder:.1f}° 줄여 수평에 맞추세요."
    if issue == "LEANING":
        return f"머리 중심 기울기 {head_lean:.1f}°를 0°에 가깝게 맞추세요."
    if issue == "SLOUCHING":
        return f"상체와 머리 높이를 기준보다 약 {slouch * 100:.0f}% 올리세요."
    if issue == "FORWARD_HEAD":
        return f"머리를 어깨 폭의 약 {max(0.0, forward * 100):.0f}%만큼 뒤로 당기세요."
    return "3D 개인 기준 자세가 안정적입니다."


def _clamp(value: float, minimum: float, maximum: float) -> float:
    return min(maximum, max(minimum, value))
