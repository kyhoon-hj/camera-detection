import time

from suha_core.pipeline import CoreRuntime


def test_synthetic_camera_to_events_and_clean_shutdown() -> None:
    runtime = CoreRuntime()
    runtime.start("synthetic-front")
    deadline = time.monotonic() + 3
    while time.monotonic() < deadline and not runtime.events.history:
        time.sleep(0.05)
    status = runtime.stop("synthetic-front")
    assert status["capturedFrames"] > 0
    assert status["inferredFrames"] > 0
    assert runtime.events.history
    assert status["running"] is False
