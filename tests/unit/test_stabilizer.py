from suha_core.domain import FeatureFrame, FrameQuality, RecognitionCandidate
from suha_core.intents import IntentMapper
from suha_core.stabilization import EventStabilizer


def feature(timestamp: int) -> FeatureFrame:
    return FeatureFrame("cam", "session", timestamp, "person", None, None, None, None, FrameQuality())


def candidate(timestamp: int) -> RecognitionCandidate:
    return RecognitionCandidate("GESTURE_STATIC", "THUMB_UP", 0.94, "person", "RIGHT", timestamp, timestamp, "test")


def test_short_glance_has_no_confirm_and_hold_does() -> None:
    stabilizer = EventStabilizer(IntentMapper("config/intent-mapping.yaml"), min_hold_ms=450)
    first = stabilizer.process(feature(0), [candidate(0)], "GENERIC_GESTURE")
    short = stabilizer.process(feature(200), [], "GENERIC_GESTURE")
    assert [event.phase for event in first + short] == ["START", "END"]
    assert all(event.intent == "NONE" for event in first + short)
    stabilizer = EventStabilizer(IntentMapper("config/intent-mapping.yaml"), min_hold_ms=450)
    phases = []
    intents = []
    for timestamp in (0, 200, 460, 700):
        events = stabilizer.process(feature(timestamp), [candidate(timestamp)], "GENERIC_GESTURE")
        phases += [event.phase for event in events]
        intents += [event.intent for event in events]
    assert phases == ["START", "HOLD"]
    assert "CONFIRM" in intents


def test_static_gesture_does_not_restart_during_channel_cooldown() -> None:
    stabilizer = EventStabilizer(IntentMapper("config/intent-mapping.yaml"), min_hold_ms=450, cooldown_ms=900)
    events = []
    for timestamp in (0, 500, 700):
        values = [candidate(timestamp)] if timestamp < 700 else []
        events += stabilizer.process(feature(timestamp), values, "GENERIC_GESTURE")
    events += stabilizer.process(feature(800), [candidate(800)], "GENERIC_GESTURE")
    assert [event.phase for event in events] == ["START", "HOLD", "END"]
