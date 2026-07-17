from suha_core.domain import FeatureFrame, FrameQuality, LandmarkSet
from suha_core.drowsiness import DrowsinessMonitor


def _face(ear: float = 0.28, nose_y: float = 0.5) -> LandmarkSet:
    points = [(0.5, 0.45, 0.0)] * 478
    points[10] = (0.5, 0.2, 0.0)
    points[152] = (0.5, 0.7, 0.0)
    points[1] = (0.5, nose_y, 0.0)
    for indices, left, right in (
        ((33, 160, 158, 133, 153, 144), 0.30, 0.44),
        ((362, 385, 387, 263, 373, 380), 0.56, 0.70),
    ):
        width = right - left
        vertical = ear * width
        points[indices[0]] = (left, 0.4, 0.0)
        points[indices[3]] = (right, 0.4, 0.0)
        points[indices[1]] = points[indices[2]] = ((left + right) / 2, 0.4 - vertical / 2, 0.0)
        points[indices[4]] = points[indices[5]] = ((left + right) / 2, 0.4 + vertical / 2, 0.0)
    return LandmarkSet(points, [1.0] * len(points))


def _features(timestamp_ms: int, face: LandmarkSet | None) -> FeatureFrame:
    return FeatureFrame("cam", "session", timestamp_ms, "person" if face else None, None, None, None, face, FrameQuality())


def test_long_eye_closure_moves_from_warning_to_alarm_and_recovers() -> None:
    monitor = DrowsinessMonitor()
    assert monitor.process(_features(0, _face())).status == "AWAKE"

    statuses = [monitor.process(_features(timestamp, _face(0.12))).status for timestamp in range(100, 3301, 200)]

    assert "WARNING" in statuses
    assert statuses[-1] == "ALARM"
    recovered = monitor.process(_features(3400, _face()))
    assert recovered.status == "AWAKE"
    assert recovered.eyes_closed is False


def test_short_blink_is_counted_without_warning() -> None:
    monitor = DrowsinessMonitor()
    monitor.process(_features(0, _face()))
    monitor.process(_features(100, _face(0.12)))
    monitor.process(_features(350, _face(0.12)))
    result = monitor.process(_features(450, _face()))

    assert result.status == "AWAKE"
    assert result.blink_count == 1


def test_short_head_drop_does_not_warn_but_a_long_one_does() -> None:
    monitor = DrowsinessMonitor()
    monitor.process(_features(0, _face()))
    assert monitor.process(_features(4_000, _face(nose_y=0.54))).status == "AWAKE"
    warning = monitor.process(_features(9_100, _face(nose_y=0.54)))
    assert warning.status == "WARNING"
    assert warning.trigger == "HEAD_ONLY"


def test_closed_eyes_and_head_drop_warn_quickly() -> None:
    monitor = DrowsinessMonitor()
    monitor.process(_features(0, _face()))
    monitor.process(_features(100, _face(0.12, nose_y=0.54)))
    warning = monitor.process(_features(800, _face(0.12, nose_y=0.54)))
    alarm = monitor.process(_features(1_600, _face(0.12, nose_y=0.54)))
    assert warning.status == "WARNING"
    assert warning.trigger == "EYES_AND_HEAD"
    assert alarm.status == "ALARM"


def test_missing_face_escalates_to_alarm() -> None:
    monitor = DrowsinessMonitor()
    assert monitor.process(_features(0, None)).status == "NO_FACE"
    assert monitor.process(_features(1600, None)).status == "WARNING"
    result = monitor.process(_features(3200, None))
    assert result.status == "ALARM"
    assert result.face_missing_duration_ms == 3200
