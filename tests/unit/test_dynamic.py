from suha_core.domain import FeatureFrame, FrameQuality, LandmarkSet
from suha_core.recognizers import TemporalRecognizer


def frame(timestamp: int, x: float, y: float = 0.3) -> FeatureFrame:
    hand = LandmarkSet([(x, y, 0.0)] * 21, [1.0] * 21, "RIGHT")
    return FeatureFrame("cam", "session", timestamp, "person", None, hand, None, None, FrameQuality())


def test_wave_and_swipe_are_distinguished() -> None:
    recognizer = TemporalRecognizer()
    wave = []
    for index, x in enumerate((0.4, 0.58, 0.38, 0.6, 0.4, 0.58)):
        wave += recognizer.process(frame(index * 150, x))
    assert any(item.code == "HAND_WAVE" for item in wave)
    recognizer.reset()
    swipe = []
    for index, x in enumerate((0.2, 0.27, 0.36, 0.45, 0.56)):
        swipe += recognizer.process(frame(index * 150, x, 0.5))
    assert any(item.code == "SWIPE_RIGHT" for item in swipe)
    assert not any(item.code == "HAND_WAVE" for item in swipe)


def test_raise_hand_requires_upward_motion_and_does_not_repeat_while_held() -> None:
    recognizer = TemporalRecognizer()
    held = []
    for index, y in enumerate((0.3, 0.3, 0.3, 0.3, 0.3, 0.3)):
        held += recognizer.process(frame(index * 150, 0.5, y))
    assert not any(item.code == "RAISE_HAND" for item in held)

    recognizer.reset()
    raised = []
    for index, y in enumerate((0.62, 0.56, 0.49, 0.41, 0.33, 0.27)):
        raised += recognizer.process(frame(index * 150, 0.5, y))
    assert sum(item.code == "RAISE_HAND" for item in raised) == 1
    for index in range(6, 18):
        raised += recognizer.process(frame(index * 150, 0.5, 0.27))
    assert sum(item.code == "RAISE_HAND" for item in raised) == 1
