from suha_core.domain import FeatureFrame, FrameQuality, LandmarkSet
from suha_core.ksl import KslSequenceSegmenter


def _hand(x: float, handedness: str) -> LandmarkSet:
    return LandmarkSet([(x, 0.5, 0.0)] * 21, [1.0] * 21, handedness)


def _features(timestamp: int, x: float = 0.5, *, left: bool = True, right: bool = True) -> FeatureFrame:
    return FeatureFrame(
        "camera",
        "session",
        timestamp,
        "person",
        _hand(x - 0.1, "LEFT") if left else None,
        _hand(x + 0.1, "RIGHT") if right else None,
        None,
        None,
        FrameQuality(),
    )


def test_static_hold_creates_and_completes_a_sequence() -> None:
    segmenter = KslSequenceSegmenter()

    assert segmenter.process(_features(0)).state == "IDLE"
    assert segmenter.process(_features(100)).state == "IDLE"
    started = segmenter.process(_features(250))
    assert started.state == "ACTIVE"
    assert started.started is True
    assert started.accept_frame is True
    result = started
    for timestamp in (350, 450, 550, 650, 700):
        result = segmenter.process(_features(timestamp))
    assert result.state == "ENDED"
    assert result.ended is True
    assert result.sequence_ready is True
    assert result.end_reason == "MOTION_SETTLED"
    assert result.frame_count == 6


def test_motion_starts_without_waiting_for_static_hold() -> None:
    segmenter = KslSequenceSegmenter()
    segmenter.process(_features(0, 0.45))

    started = segmenter.process(_features(100, 0.48))

    assert started.started is True
    assert started.state == "ACTIVE"
    assert started.motion_speed > segmenter.start_motion_speed


def test_short_hand_occlusion_pauses_and_recovers_segment() -> None:
    segmenter = KslSequenceSegmenter()
    segmenter.process(_features(0, 0.45))
    segmenter.process(_features(100, 0.48))

    occluded = segmenter.process(_features(200, right=False))
    still_occluded = segmenter.process(_features(400, right=False))
    recovered = segmenter.process(_features(450, 0.48))

    assert occluded.state == "OCCLUDED"
    assert still_occluded.state == "OCCLUDED"
    assert still_occluded.occlusion_ms == 200
    assert recovered.state == "ACTIVE"
    assert recovered.ended is False
    assert recovered.accept_frame is True


def test_long_hand_occlusion_ends_without_ready_sequence() -> None:
    segmenter = KslSequenceSegmenter()
    segmenter.process(_features(0, 0.45))
    segmenter.process(_features(100, 0.48))
    segmenter.process(_features(200, left=False))

    ended = segmenter.process(_features(550, left=False))

    assert ended.state == "ENDED"
    assert ended.end_reason == "HAND_OCCLUSION"
    assert ended.sequence_ready is False
    assert ended.accept_frame is False
