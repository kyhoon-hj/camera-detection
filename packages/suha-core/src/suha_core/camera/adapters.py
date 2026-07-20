from __future__ import annotations

import math
import time
from typing import Any, Protocol

import cv2
import numpy as np

from suha_core.domain import CameraCalibration, CameraCapabilities, FramePacket


class CameraError(RuntimeError):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


class CameraAdapter(Protocol):
    camera_id: str

    def open(self) -> None: ...
    def read(self) -> FramePacket | None: ...
    def close(self) -> None: ...
    def health(self) -> dict[str, Any]: ...
    def capabilities(self) -> CameraCapabilities: ...
    def calibration(self) -> CameraCalibration | None: ...


class OpenCVCameraAdapter:
    def __init__(
        self,
        camera_id: str,
        source: int | str,
        width: int = 1280,
        height: int = 720,
        mirror: bool = True,
    ) -> None:
        self.camera_id = camera_id
        self.source = source
        self.width = width
        self.height = height
        self.mirror = mirror
        self._capture: cv2.VideoCapture | None = None
        self._sequence = 0

    def open(self) -> None:
        if self._capture is not None and self._capture.isOpened():
            return
        capture = cv2.VideoCapture(self.source)
        capture.set(cv2.CAP_PROP_FRAME_WIDTH, self.width)
        capture.set(cv2.CAP_PROP_FRAME_HEIGHT, self.height)
        if not capture.isOpened():
            capture.release()
            raise CameraError("SUHA-CAMERA-001", f"Cannot open camera source {self.source!r}")
        self._capture = capture

    def read(self) -> FramePacket | None:
        if self._capture is None or not self._capture.isOpened():
            raise CameraError("SUHA-CAMERA-004", "Camera is not open")
        ok, bgr = self._capture.read()
        if not ok:
            return None
        if self.mirror:
            bgr = cv2.flip(bgr, 1)
        rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
        self._sequence += 1
        return FramePacket(
            self.camera_id,
            self._sequence,
            time.monotonic_ns() // 1_000_000,
            rgb,
            width=rgb.shape[1],
            height=rgb.shape[0],
            metadata={"mirrored": self.mirror, "rotationDegrees": 0},
        )

    def close(self) -> None:
        if self._capture is not None:
            self._capture.release()
        self._capture = None

    def health(self) -> dict[str, Any]:
        return {"open": bool(self._capture and self._capture.isOpened()), "source": self.source}

    def capabilities(self) -> CameraCapabilities:
        return CameraCapabilities()

    def calibration(self) -> CameraCalibration | None:
        return None


class VideoFileCameraAdapter(OpenCVCameraAdapter):
    def __init__(self, camera_id: str, path: str, loop: bool = False) -> None:
        super().__init__(camera_id, path, mirror=False)
        self.loop = loop

    def read(self) -> FramePacket | None:
        packet = super().read()
        if packet is None and self.loop and self._capture is not None:
            self._capture.set(cv2.CAP_PROP_POS_FRAMES, 0)
            packet = super().read()
        return packet


class SyntheticCameraAdapter:
    """Deterministic CI camera; metadata drives the same downstream recognizers."""

    def __init__(self, camera_id: str = "synthetic-front", width: int = 640, height: int = 480) -> None:
        self.camera_id = camera_id
        self.width = width
        self.height = height
        self._open = False
        self._sequence = 0
        self._started_ms = 0

    def open(self) -> None:
        self._open = True
        self._started_ms = time.monotonic_ns() // 1_000_000

    def read(self) -> FramePacket | None:
        if not self._open:
            raise CameraError("SUHA-CAMERA-004", "Synthetic camera is not open")
        self._sequence += 1
        now = time.monotonic_ns() // 1_000_000
        t = (now - self._started_ms) / 1000.0
        frame = np.zeros((self.height, self.width, 3), dtype=np.uint8)
        frame[:, :, 1] = 24
        x = int(self.width * (0.5 + 0.22 * math.sin(t * 4.5)))
        cv2.circle(frame, (x, int(self.height * 0.35)), 38, (70, 210, 255), -1)
        phase = int(t) % 8
        gesture = "THUMB_UP" if phase in {1, 2} else "OPEN_PALM"
        return FramePacket(
            self.camera_id,
            self._sequence,
            now,
            frame,
            width=self.width,
            height=self.height,
            metadata={
                "synthetic": True,
                "mirrored": False,
                "rotationDegrees": 0,
                "staticGesture": gesture,
                "wrist": [x / self.width, 0.35 + 0.02 * math.sin(t * 2), 0.0],
                "head": [0.5 + 0.04 * math.sin(t * 5), 0.25 + 0.025 * math.sin(t * 6), 0.0],
            },
        )

    def close(self) -> None:
        self._open = False

    def health(self) -> dict[str, Any]:
        return {"open": self._open, "source": "synthetic", "sequence": self._sequence}

    def capabilities(self) -> CameraCapabilities:
        return CameraCapabilities()

    def calibration(self) -> CameraCalibration | None:
        return None
