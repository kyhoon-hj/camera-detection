from suha_core.camera import SyntheticCameraAdapter


def test_synthetic_timestamps_and_close() -> None:
    camera = SyntheticCameraAdapter()
    camera.open()
    first, second = camera.read(), camera.read()
    assert first and second
    assert second.sequence > first.sequence
    assert second.timestamp_ms >= first.timestamp_ms
    camera.close()
    assert camera.health()["open"] is False
