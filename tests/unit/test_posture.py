import math

from suha_core.domain import FeatureFrame, FrameQuality, LandmarkSet
from suha_core.posture import PostureMonitor


def _pose(*, head_y: float = 0.32, nose_x: float = 0.5, shoulder_delta_y: float = 0.0, head_z: float = 0.0) -> LandmarkSet:
    points = [(0.5, 0.5, 0.0)] * 33
    points[0] = (nose_x, head_y - 0.02, head_z)
    points[7] = (0.46, head_y, head_z)
    points[8] = (0.54, head_y, head_z)
    points[11] = (0.4, 0.6, 0.1)
    points[12] = (0.6, 0.6 + shoulder_delta_y, 0.1)
    return LandmarkSet(points, [1.0] * len(points))


def _features(timestamp_ms: int, pose: LandmarkSet | None) -> FeatureFrame:
    face = LandmarkSet([(0.5, 0.4, 0.0)] * 478, [1.0] * 478) if pose else None
    return FeatureFrame("cam", "session", timestamp_ms, "person" if pose else None, None, None, pose, face, FrameQuality())


def _calibrated_monitor() -> PostureMonitor:
    monitor = PostureMonitor(calibration_frames=5)
    for index in range(5):
        monitor.process(_features(index * 100, _pose()))
    return monitor


def test_posture_calibrates_then_reports_good() -> None:
    monitor = _calibrated_monitor()
    result = monitor.process(_features(600, _pose()))
    assert result.status == "GOOD"
    assert result.posture_score == 1.0


def test_slouch_is_confirmed_only_after_two_seconds() -> None:
    monitor = _calibrated_monitor()
    checking = monitor.process(_features(700, _pose(head_y=0.48)))
    warning = monitor.process(_features(2_800, _pose(head_y=0.48)))
    assert checking.status == "CHECKING"
    assert warning.status == "WARNING"
    assert warning.issue == "SLOUCHING"


def test_posture_reset_starts_calibration_again() -> None:
    monitor = _calibrated_monitor()
    monitor.reset("session")
    result = monitor.process(_features(1_000, _pose()))
    assert result.status == "CALIBRATING"
    assert result.calibration_progress == 0.2


def test_side_view_uses_3d_shoulder_axis_without_false_tilt() -> None:
    monitor = PostureMonitor(calibration_frames=5)
    for index in range(5):
        result = monitor.process(_features(index * 100, _side_pose(70)))
    assert result.status == "GOOD"
    assert result.camera_view == "SIDE"
    assert result.camera_view_angle_degrees == 70.0
    assert result.shoulder_tilt_degrees == 0.0
    assert result.posture_score == 1.0
    assert result.posture_confidence > 0.7


def test_side_view_reports_numeric_tilt_and_forward_head_correction() -> None:
    monitor = PostureMonitor(calibration_frames=5)
    for index in range(5):
        monitor.process(_features(index * 100, _side_pose(70)))

    tilted_pose = _side_pose(70, shoulder_delta_y=0.07)
    for timestamp in range(700, 1_300, 100):
        monitor.process(_features(timestamp, tilted_pose))
    tilted = monitor.process(_features(3_500, tilted_pose))
    assert tilted.status == "WARNING"
    assert tilted.issue == "SHOULDER_TILT"
    assert abs(tilted.shoulder_tilt_degrees) > 10

    monitor.reset("session")
    for index in range(5):
        monitor.process(_features(4_000 + index * 100, _side_pose(70)))
    forward_pose = _side_pose(70, forward_shift=0.1)
    for timestamp in range(4_700, 5_300, 100):
        monitor.process(_features(timestamp, forward_pose))
    forward = monitor.process(_features(7_500, forward_pose))
    assert forward.status == "WARNING"
    assert forward.issue == "FORWARD_HEAD"
    assert forward.forward_head_percent > 20


def _side_pose(yaw_degrees: float, *, shoulder_delta_y: float = 0.0, forward_shift: float = 0.0) -> LandmarkSet:
    source = _pose(shoulder_delta_y=shoulder_delta_y)
    points = [list(point) for point in source.landmarks]
    for index in (0, 7, 8):
        points[index][2] -= forward_shift
    radians = math.radians(yaw_degrees)
    for index in (0, 7, 8, 11, 12):
        x = points[index][0] - 0.5
        z = points[index][2]
        points[index][0] = 0.5 + x * math.cos(radians) + z * math.sin(radians)
        points[index][2] = -x * math.sin(radians) + z * math.cos(radians)
    visibility = [1.0] * len(points)
    visibility[7] = 0.2
    visibility[11] = 0.25
    return LandmarkSet([tuple(point) for point in points], visibility)
