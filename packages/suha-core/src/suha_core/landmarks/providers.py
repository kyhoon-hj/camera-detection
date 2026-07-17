from __future__ import annotations

from pathlib import Path
from typing import Any, Protocol

import cv2
import numpy as np

from suha_core.domain import FeatureFrame, FramePacket, FrameQuality, LandmarkSet

HAND_EDGE_MARGIN_RATIO = 0.10


class LandmarkProvider(Protocol):
    def warmup(self) -> None: ...
    def process(self, frame: FramePacket, session_id: str, *, hands_only: bool = False) -> FeatureFrame: ...
    def close(self) -> None: ...
    def health(self) -> dict[str, Any]: ...


def frame_quality(rgb: np.ndarray) -> FrameQuality:
    gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
    return FrameQuality(
        brightness=float(np.mean(gray) / 255.0),
        blur=float(min(cv2.Laplacian(gray, cv2.CV_64F).var() / 1000.0, 1.0)),
    )


def _edge_padded_hand_frame(rgb: np.ndarray, margin_ratio: float = HAND_EDGE_MARGIN_RATIO) -> tuple[np.ndarray, tuple[int, int]]:
    """Give the hand detector context outside the visible frame."""
    height, width = rgb.shape[:2]
    pad_x = max(1, round(width * margin_ratio))
    pad_y = max(1, round(height * margin_ratio))
    neutral = tuple(int(channel) for channel in cv2.mean(rgb)[:3])
    inner_width = max(1, width - pad_x * 2)
    inner_height = max(1, height - pad_y * 2)
    fitted = cv2.resize(rgb, (inner_width, inner_height), interpolation=cv2.INTER_AREA)
    padded = cv2.copyMakeBorder(fitted, pad_y, pad_y, pad_x, pad_x, cv2.BORDER_CONSTANT, value=neutral)
    return padded, (pad_x, pad_y)


def _unpad_hand_coordinate(
    x: float,
    y: float,
    source_width: int,
    source_height: int,
    pad_x: int,
    pad_y: int,
) -> tuple[float, float]:
    mapped_x = (x * source_width - pad_x) / (source_width - pad_x * 2)
    mapped_y = (y * source_height - pad_y) / (source_height - pad_y * 2)
    return mapped_x, mapped_y


class SyntheticLandmarkProvider:
    def warmup(self) -> None:
        return

    def process(self, frame: FramePacket, session_id: str, *, hands_only: bool = False) -> FeatureFrame:
        wrist = tuple(frame.metadata.get("wrist", [0.5, 0.5, 0.0]))
        head = tuple(frame.metadata.get("head", [0.5, 0.25, 0.0]))
        hand_points = [wrist for _ in range(21)]
        pose_points = [(0.4, 0.4, 0.0), (0.6, 0.4, 0.0), wrist]
        quality = frame_quality(frame.rgb)
        quality.hand_visibility = quality.pose_visibility = 1.0
        return FeatureFrame(
            frame.camera_id,
            session_id,
            frame.timestamp_ms,
            "person-001",
            None,
            LandmarkSet(hand_points, [1.0] * 21, "RIGHT"),
            LandmarkSet(pose_points, [1.0] * 3),
            LandmarkSet([head], [1.0]),
            quality,
            metadata={"staticGesture": frame.metadata.get("staticGesture")},
        )

    def close(self) -> None:
        return

    def health(self) -> dict[str, Any]:
        return {"ready": True, "provider": "synthetic"}


class MediaPipeLandmarkProvider:
    """MediaPipe Tasks adapter, imported lazily for actionable install failures."""

    def __init__(self, model_dir: str | Path = "models/mediapipe") -> None:
        self.model_dir = Path(model_dir)
        self._mp: Any = None
        self._hands: Any = None
        self._pose: Any = None
        self._face: Any = None

    def warmup(self) -> None:
        try:
            import mediapipe as mp
        except ImportError as error:
            raise RuntimeError("MediaPipe is missing. Use Python 3.11/3.12 and install: pip install -e '.[vision]'") from error
        paths = {
            "hand": self.model_dir / "hand_landmarker.task",
            "pose": self.model_dir / "pose_landmarker_lite.task",
            "face": self.model_dir / "face_landmarker.task",
        }
        missing = [str(path) for path in paths.values() if not path.is_file()]
        if missing:
            raise RuntimeError("MediaPipe model assets are missing: " + ", ".join(missing) + ". Run scripts/download_mediapipe_models.py")
        self._mp = mp
        base = mp.tasks.BaseOptions
        vision = mp.tasks.vision
        mode = vision.RunningMode.VIDEO
        self._hands = vision.HandLandmarker.create_from_options(
            vision.HandLandmarkerOptions(
                base_options=base(model_asset_path=str(paths["hand"])),
                running_mode=mode,
                num_hands=2,
                min_hand_detection_confidence=0.45,
                min_hand_presence_confidence=0.42,
                min_tracking_confidence=0.35,
            )
        )
        self._pose = vision.PoseLandmarker.create_from_options(
            vision.PoseLandmarkerOptions(
                base_options=base(model_asset_path=str(paths["pose"])),
                running_mode=mode,
                num_poses=1,
                min_pose_detection_confidence=0.6,
                min_pose_presence_confidence=0.6,
                min_tracking_confidence=0.6,
            )
        )
        self._face = vision.FaceLandmarker.create_from_options(
            vision.FaceLandmarkerOptions(
                base_options=base(model_asset_path=str(paths["face"])),
                running_mode=mode,
                num_faces=1,
                min_face_detection_confidence=0.6,
                min_face_presence_confidence=0.6,
                min_tracking_confidence=0.6,
            )
        )

    @staticmethod
    def _set(
        value: Any,
        handedness: str | None = None,
        edge_space: tuple[int, int, int, int] | None = None,
    ) -> LandmarkSet | None:
        if not value:
            return None
        landmarks: list[tuple[float, float, float]] = []
        for point in value:
            x, y = float(point.x or 0), float(point.y or 0)
            if edge_space is not None:
                source_width, source_height, pad_x, pad_y = edge_space
                x, y = _unpad_hand_coordinate(x, y, source_width, source_height, pad_x, pad_y)
            landmarks.append((x, y, float(point.z or 0)))
        return LandmarkSet(
            landmarks,
            [float(p.visibility if p.visibility is not None else 1.0) for p in value],
            handedness,
        )

    def process(self, frame: FramePacket, session_id: str, *, hands_only: bool = False) -> FeatureFrame:
        if self._hands is None:
            self.warmup()
        image = self._mp.Image(
            image_format=self._mp.ImageFormat.SRGB,
            data=np.ascontiguousarray(frame.rgb),
        )
        edge_space: tuple[int, int, int, int] | None = None
        hand_image = image
        if hands_only:
            padded_rgb, (pad_x, pad_y) = _edge_padded_hand_frame(frame.rgb)
            height, width = frame.rgb.shape[:2]
            edge_space = (width, height, pad_x, pad_y)
            hand_image = self._mp.Image(
                image_format=self._mp.ImageFormat.SRGB,
                data=np.ascontiguousarray(padded_rgb),
            )
        hand_result = self._hands.detect_for_video(hand_image, frame.timestamp_ms)
        pose_result = None if hands_only else self._pose.detect_for_video(image, frame.timestamp_ms)
        face_result = None if hands_only else self._face.detect_for_video(image, frame.timestamp_ms)
        left: LandmarkSet | None = None
        right: LandmarkSet | None = None
        for index, points in enumerate(hand_result.hand_landmarks):
            categories = hand_result.handedness[index]
            handedness = str(categories[0].category_name).upper() if categories else None
            value = self._set(points, handedness, edge_space)
            if handedness == "LEFT":
                left = value
            else:
                right = value
        pose = self._set(pose_result.pose_landmarks[0] if pose_result and pose_result.pose_landmarks else None)
        face = self._set(face_result.face_landmarks[0] if face_result and face_result.face_landmarks else None)
        quality = frame_quality(frame.rgb)
        quality.hand_visibility = max([0.0] + ([sum(left.visibility) / len(left.visibility)] if left else []) + ([sum(right.visibility) / len(right.visibility)] if right else []))
        quality.pose_visibility = sum(pose.visibility) / len(pose.visibility) if pose else 0.0
        return FeatureFrame(
            frame.camera_id,
            session_id,
            frame.timestamp_ms,
            "person-001" if any((left, right, pose, face)) else None,
            left,
            right,
            pose,
            face,
            quality,
        )

    def close(self) -> None:
        for task in (self._hands, self._pose, self._face):
            if task is not None:
                task.close()
        self._hands = self._pose = self._face = None
        self._mp = None

    def health(self) -> dict[str, Any]:
        return {"ready": self._hands is not None, "provider": "mediapipe-tasks"}
