import time
from typing import Any

import numpy as np
from suha_core.camera import (
    ActualDepthDistanceProvider,
    DeviceSdkCameraAdapter,
    MockDepthCameraAdapter,
    NearestDepthAlignment,
    RgbEstimatedDistanceProvider,
)
from suha_core.domain import (
    CameraCalibration,
    CameraCapabilities,
    FeatureFrame,
    FramePacket,
    RecognitionCandidate,
)
from suha_core.pipeline import CoreRuntime


def test_mock_depth_camera_alignment_and_distance_sources() -> None:
    camera = MockDepthCameraAdapter(width=64, height=48)
    camera.open()
    frame = camera.read()
    assert frame is not None and frame.depth is not None and frame.calibration is not None
    assert frame.depth.shape == frame.rgb.shape[:2]
    assert camera.capabilities().to_dict() == {
        "rgb": True,
        "depth": True,
        "infrared": False,
        "hardwareTimestamps": True,
        "calibration": True,
    }
    actual = ActualDepthDistanceProvider().measure(frame, (32, 17))
    assert actual is not None
    assert actual.source == "ACTUAL_DEPTH"
    assert 0.9 <= actual.distance_m <= 1.8
    estimated = RgbEstimatedDistanceProvider().estimate(1.4, 0.6, (32, 17))
    assert estimated.source == "RGB_ESTIMATED_Z"
    assert estimated.to_dict()["distanceMeters"] == 1.4
    aligned = NearestDepthAlignment().align(frame.depth[::2, ::2], frame.rgb, frame.calibration)
    assert aligned.shape == frame.rgb.shape[:2]
    camera.close()


class FakeDeviceBackend:
    def __init__(self) -> None:
        self.opened = False
        self.config = CameraCalibration(8, 6, 4.0, 4.0, 4.0, 3.0)

    def open(self) -> None:
        self.opened = True

    def read(self) -> tuple[np.ndarray, np.ndarray | None, int, dict[str, Any]] | None:
        return np.zeros((6, 8, 3), dtype=np.uint8), np.full((6, 8), 1000, dtype=np.uint16), 1234, {"vendor": "fake"}

    def close(self) -> None:
        self.opened = False

    def health(self) -> dict[str, Any]:
        return {"open": self.opened}

    def capabilities(self) -> CameraCapabilities:
        return CameraCapabilities(depth=True, calibration=True)

    def calibration(self) -> CameraCalibration:
        return self.config


def test_device_sdk_adapter_template_wraps_vendor_backend() -> None:
    backend = FakeDeviceBackend()
    camera = DeviceSdkCameraAdapter("vendor-depth", backend)
    camera.open()
    frame = camera.read()
    assert frame is not None
    assert frame.camera_id == "vendor-depth"
    assert frame.depth is not None
    assert frame.calibration == backend.config
    camera.close()
    assert backend.opened is False


class RecordingDepthRecognizer:
    plugin_id = "test-depth"
    plugin_version = "1.0.0"

    def __init__(self) -> None:
        self.frames: list[FramePacket] = []
        self.metadata: list[dict[str, Any]] = []

    def warmup(self) -> None:
        return

    def process(self, frame: FramePacket, features: FeatureFrame) -> list[RecognitionCandidate]:
        self.frames.append(frame)
        self.metadata.append(features.metadata)
        return []

    def reset(self, session_id: str | None = None) -> None:
        return

    def health(self) -> dict[str, Any]:
        return {"ready": True}


def test_depth_recognizer_plugin_receives_mock_depth_without_rgb_regression(tmp_path: Any) -> None:
    runtime = CoreRuntime(event_store_path=tmp_path / "events.db")
    recognizer = RecordingDepthRecognizer()
    runtime.register_depth_recognizer(recognizer)
    runtime.start("mock-depth-front")
    deadline = time.monotonic() + 2
    while not recognizer.frames and time.monotonic() < deadline:
        time.sleep(0.02)
    runtime.stop("mock-depth-front")
    assert recognizer.frames and recognizer.frames[0].depth is not None
    assert recognizer.metadata[0]["depth"]["source"] == "ACTUAL_DEPTH"
    assert runtime.status("synthetic-front")["capabilities"]["depth"] is False
    runtime.shutdown()
