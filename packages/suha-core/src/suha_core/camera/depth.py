from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Protocol

import cv2
import numpy as np

from suha_core.camera.adapters import CameraError, SyntheticCameraAdapter
from suha_core.domain import CameraCalibration, CameraCapabilities, FramePacket


class DepthAlignment(Protocol):
    def align(self, depth: np.ndarray, rgb: np.ndarray, calibration: CameraCalibration | None = None) -> np.ndarray: ...


class NearestDepthAlignment:
    """Aligns an already registered depth plane to the RGB pixel grid without inventing depth values."""

    def align(self, depth: np.ndarray, rgb: np.ndarray, calibration: CameraCalibration | None = None) -> np.ndarray:
        target_height, target_width = rgb.shape[:2]
        if depth.shape[:2] == (target_height, target_width):
            return depth.copy()
        return cv2.resize(depth, (target_width, target_height), interpolation=cv2.INTER_NEAREST)


@dataclass(frozen=True, slots=True)
class DistanceMeasurement:
    distance_m: float
    source: str
    pixel: tuple[int, int] | None
    confidence: float

    def to_dict(self) -> dict[str, Any]:
        return {
            "distanceMeters": self.distance_m,
            "source": self.source,
            "pixel": list(self.pixel) if self.pixel else None,
            "confidence": self.confidence,
        }


class ActualDepthDistanceProvider:
    source = "ACTUAL_DEPTH"

    def __init__(self, sample_radius: int = 1) -> None:
        self.sample_radius = max(0, sample_radius)

    def measure(self, frame: FramePacket, pixel: tuple[int, int]) -> DistanceMeasurement | None:
        if frame.depth is None:
            return None
        x, y = pixel
        height, width = frame.depth.shape[:2]
        if not (0 <= x < width and 0 <= y < height):
            return None
        radius = self.sample_radius
        sample = frame.depth[max(0, y - radius) : min(height, y + radius + 1), max(0, x - radius) : min(width, x + radius + 1)]
        valid = sample[np.isfinite(sample) & (sample > 0)]
        if valid.size == 0:
            return None
        scale = frame.calibration.depth_scale_m if frame.calibration else float(frame.metadata.get("depthScaleMeters", 0.001))
        return DistanceMeasurement(float(np.median(valid)) * scale, self.source, pixel, min(1.0, valid.size / sample.size))


class RgbEstimatedDistanceProvider:
    source = "RGB_ESTIMATED_Z"

    def estimate(self, estimated_distance_m: float, confidence: float = 0.5, pixel: tuple[int, int] | None = None) -> DistanceMeasurement:
        if estimated_distance_m <= 0:
            raise ValueError("RGB estimated distance must be positive")
        return DistanceMeasurement(float(estimated_distance_m), self.source, pixel, min(1.0, max(0.0, confidence)))


class MockDepthCameraAdapter(SyntheticCameraAdapter):
    """Deterministic RGB-D camera used when no physical depth device is installed."""

    def __init__(self, camera_id: str = "mock-depth-front", width: int = 640, height: int = 480) -> None:
        super().__init__(camera_id, width, height)
        self._calibration = CameraCalibration(width, height, 580.0, 580.0, width / 2, height / 2)

    def read(self) -> FramePacket | None:
        packet = super().read()
        if packet is None:
            return None
        depth = np.full((self.height, self.width), 1800, dtype=np.uint16)
        wrist = packet.metadata.get("wrist", [0.5, 0.5, 0.0])
        center = (int(float(wrist[0]) * self.width), int(float(wrist[1]) * self.height))
        cv2.circle(depth, center, 42, 950, -1)
        packet.depth = depth
        packet.calibration = self._calibration
        packet.metadata = {**packet.metadata, "depthAlignedTo": "RGB", "depthUnit": "millimeter"}
        return packet

    def capabilities(self) -> CameraCapabilities:
        return CameraCapabilities(depth=True, hardware_timestamps=True, calibration=True)

    def calibration(self) -> CameraCalibration:
        return self._calibration

    def health(self) -> dict[str, Any]:
        return {**super().health(), "depth": True, "depthUnit": "millimeter"}


class DeviceSdkBackend(Protocol):
    def open(self) -> None: ...
    def read(self) -> tuple[np.ndarray, np.ndarray | None, int, dict[str, Any]] | None: ...
    def close(self) -> None: ...
    def health(self) -> dict[str, Any]: ...
    def capabilities(self) -> CameraCapabilities: ...
    def calibration(self) -> CameraCalibration | None: ...


class DeviceSdkCameraAdapter:
    """Vendor-neutral adapter template; a device backend contains all proprietary SDK calls."""

    def __init__(self, camera_id: str, backend: DeviceSdkBackend) -> None:
        self.camera_id = camera_id
        self.backend = backend
        self._sequence = 0

    def open(self) -> None:
        self.backend.open()

    def read(self) -> FramePacket | None:
        value = self.backend.read()
        if value is None:
            return None
        rgb, depth, timestamp_ms, metadata = value
        if rgb.ndim != 3 or rgb.shape[2] != 3:
            raise CameraError("SUHA-CAMERA-004", "Device SDK backend must return an RGB HxWx3 array")
        self._sequence += 1
        return FramePacket(
            self.camera_id,
            self._sequence,
            timestamp_ms,
            rgb,
            depth=depth,
            width=rgb.shape[1],
            height=rgb.shape[0],
            metadata=metadata,
            calibration=self.backend.calibration(),
        )

    def close(self) -> None:
        self.backend.close()

    def health(self) -> dict[str, Any]:
        return self.backend.health()

    def capabilities(self) -> CameraCapabilities:
        return self.backend.capabilities()

    def calibration(self) -> CameraCalibration | None:
        return self.backend.calibration()
