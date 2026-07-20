from __future__ import annotations

import queue
import threading
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any
from uuid import uuid4

import cv2

from suha_core.camera import CameraAdapter, MockDepthCameraAdapter, NearestDepthAlignment, OpenCVCameraAdapter, SyntheticCameraAdapter
from suha_core.domain import CameraCalibration, EventEnvelope, FeatureFrame, FramePacket, RecognitionCandidate
from suha_core.drowsiness import DrowsinessMonitor, DrowsinessSnapshot
from suha_core.events import EventBus, EventStore
from suha_core.intents import IntentMapper
from suha_core.ksl import GlossSequenceTracker, KslSegmentSnapshot, KslSequenceSegmenter, SignFeatureFrame, SignInputAssembler
from suha_core.landmarks import (
    LandmarkProvider,
    MediaPipeLandmarkProvider,
    SyntheticLandmarkProvider,
)
from suha_core.models import OnnxGestureRecognizer, OnnxTemporalGestureRecognizer, fuse_dynamic_candidates
from suha_core.posture import PostureMonitor, PostureSnapshot
from suha_core.recognizers import DepthRecognizerPlugin, StaticGestureRecognizer, TemporalRecognizer
from suha_core.stabilization import EventStabilizer

HAND_CONNECTIONS = (
    (0, 1), (1, 2), (2, 3), (3, 4),
    (0, 5), (5, 6), (6, 7), (7, 8),
    (5, 9), (9, 10), (10, 11), (11, 12),
    (9, 13), (13, 14), (14, 15), (15, 16),
    (13, 17), (17, 18), (18, 19), (19, 20), (0, 17),
)
POSE_CONNECTIONS = (
    (11, 12), (11, 13), (13, 15), (12, 14), (14, 16),
    (11, 23), (12, 24), (23, 24), (23, 25), (25, 27),
    (24, 26), (26, 28), (15, 17), (15, 19), (15, 21),
    (16, 18), (16, 20), (16, 22),
)
FACE_PATHS = (
    (
        10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152,
        148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109, 10,
    ),
    (33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246, 33),
    (263, 249, 390, 373, 374, 380, 381, 382, 362, 398, 384, 385, 386, 387, 388, 466, 263),
    (61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291, 308, 324, 318, 402, 317, 14, 87, 178, 88, 95, 78, 61),
    (70, 63, 105, 66, 107), (336, 296, 334, 293, 300),
)


def _fit_analysis_size(width: int, height: int, max_width: int = 640, max_height: int = 480) -> tuple[int, int]:
    if width <= max_width and height <= max_height:
        return width, height
    scale = min(max_width / width, max_height / height)
    return max(1, round(width * scale)), max(1, round(height * scale))


@dataclass(slots=True)
class CameraRuntime:
    adapter: CameraAdapter
    provider: LandmarkProvider
    session_id: str = field(default_factory=lambda: f"ses_{uuid4().hex}")
    mode: str = "GENERIC_GESTURE"
    profile: str = "default"
    running: bool = False
    frame_queue: queue.Queue[FramePacket] = field(default_factory=lambda: queue.Queue(maxsize=2))
    capture_thread: threading.Thread | None = None
    inference_thread: threading.Thread | None = None
    stop_event: threading.Event = field(default_factory=threading.Event)
    last_frame: FramePacket | None = None
    last_features: FeatureFrame | None = None
    raw_candidates: list[RecognitionCandidate] = field(default_factory=list)
    captured: int = 0
    inferred: int = 0
    dropped: int = 0
    started_at: float = 0.0
    error: str | None = None
    drowsiness: DrowsinessSnapshot | None = None
    posture: PostureSnapshot | None = None
    last_sign_input: SignFeatureFrame | None = None
    last_sign_segment: KslSegmentSnapshot | None = None


class CoreRuntime:
    def __init__(
        self,
        intent_path: str = "config/intent-mapping.yaml",
        event_store_path: str | Path = "data/suha-events.db",
    ) -> None:
        self.events = EventBus(store=EventStore(event_store_path))
        self.mapper = IntentMapper(intent_path)
        self.static = StaticGestureRecognizer()
        self.custom_static: OnnxGestureRecognizer | None = None
        self.temporal = TemporalRecognizer()
        self.depth_recognizers: list[DepthRecognizerPlugin] = []
        self.depth_alignment = NearestDepthAlignment()
        self.custom_temporal: OnnxTemporalGestureRecognizer | None = None
        self.custom_ksl: OnnxTemporalGestureRecognizer | None = None
        self.ksl_enabled = False
        self.sign_input = SignInputAssembler()
        self.ksl_segments = KslSequenceSegmenter()
        self.gloss_sequences = GlossSequenceTracker()
        self.stabilizer = EventStabilizer(self.mapper)
        self.drowsiness = DrowsinessMonitor()
        self.posture = PostureMonitor()
        self._lock = threading.RLock()
        self.cameras: dict[str, CameraRuntime] = {}
        self.register("synthetic-front", SyntheticCameraAdapter(), SyntheticLandmarkProvider())
        self.register("mock-depth-front", MockDepthCameraAdapter(), SyntheticLandmarkProvider())
        self.register("laptop-front", OpenCVCameraAdapter("laptop-front", 0), MediaPipeLandmarkProvider())

    def register(self, camera_id: str, adapter: CameraAdapter, provider: LandmarkProvider) -> None:
        with self._lock:
            if camera_id in self.cameras and self.cameras[camera_id].running:
                raise RuntimeError(f"Camera {camera_id} is already running")
            self.cameras[camera_id] = CameraRuntime(adapter=adapter, provider=provider)

    def list_cameras(self) -> list[dict[str, Any]]:
        return [self.status(camera_id) for camera_id in self.cameras]

    def register_depth_recognizer(self, recognizer: DepthRecognizerPlugin) -> None:
        recognizer.warmup()
        self.depth_recognizers.append(recognizer)

    def status(self, camera_id: str) -> dict[str, Any]:
        runtime = self._get(camera_id)
        elapsed = max(time.monotonic() - runtime.started_at, 0.001) if runtime.running else 0.0
        calibration = runtime.adapter.calibration()
        return {
            "cameraId": camera_id,
            "running": runtime.running,
            "sessionId": runtime.session_id,
            "mode": runtime.mode,
            "profile": runtime.profile,
            "capturedFrames": runtime.captured,
            "inferredFrames": runtime.inferred,
            "droppedFrames": runtime.dropped,
            "captureFps": runtime.captured / elapsed if elapsed else 0.0,
            "inferenceFps": runtime.inferred / elapsed if elapsed else 0.0,
            "error": runtime.error,
            "health": runtime.adapter.health(),
            "capabilities": runtime.adapter.capabilities().to_dict(),
            "calibration": calibration.to_dict() if calibration else None,
        }

    def start(self, camera_id: str) -> dict[str, Any]:
        runtime = self._get(camera_id)
        with self._lock:
            if runtime.running:
                return self.status(camera_id)
            runtime.adapter.open()
            runtime.provider.warmup()
            runtime.running = True
            runtime.error = None
            runtime.stop_event.clear()
            runtime.started_at = time.monotonic()
            runtime.capture_thread = threading.Thread(target=self._capture_loop, args=(runtime,), name=f"capture-{camera_id}", daemon=True)
            runtime.inference_thread = threading.Thread(
                target=self._inference_loop,
                args=(runtime,),
                name=f"inference-{camera_id}",
                daemon=True,
            )
            runtime.capture_thread.start()
            runtime.inference_thread.start()
        return self.status(camera_id)

    def stop(self, camera_id: str) -> dict[str, Any]:
        runtime = self._get(camera_id)
        runtime.stop_event.set()
        for thread in (runtime.capture_thread, runtime.inference_thread):
            if thread:
                thread.join(timeout=2.0)
        runtime.adapter.close()
        runtime.provider.close()
        runtime.running = False
        self.temporal.reset(runtime.session_id)
        self.drowsiness.reset(runtime.session_id)
        self.posture.reset(runtime.session_id)
        if self.custom_temporal is not None:
            self.custom_temporal.reset(runtime.session_id)
        if self.custom_ksl is not None:
            self.custom_ksl.reset(runtime.session_id)
        self.sign_input.reset(runtime.session_id)
        self.ksl_segments.reset(runtime.session_id)
        runtime.last_sign_input = None
        runtime.last_sign_segment = None
        self.gloss_sequences.clear(runtime.session_id)
        for recognizer in self.depth_recognizers:
            recognizer.reset(runtime.session_id)
        return self.status(camera_id)

    def shutdown(self) -> None:
        for camera_id in list(self.cameras):
            if self.cameras[camera_id].running:
                self.stop(camera_id)
        self.events.close()

    def set_mode(self, camera_id: str, mode: str, profile: str = "default") -> dict[str, Any]:
        if mode not in {
            "IDLE",
            "GENERIC_GESTURE",
            "PEN_DRAW",
            "SIGN_LANGUAGE_KSL",
            "DATA_CAPTURE",
            "DIAGNOSTIC",
            "DROWSINESS_MONITOR",
        }:
            raise ValueError(f"Unsupported mode: {mode}")
        if mode == "SIGN_LANGUAGE_KSL" and not self.ksl_enabled:
            raise ValueError("SUHA-KSL-001 KSL_MODEL_NOT_ACTIVE")
        self.mapper.set_profile(profile)
        runtime = self._get(camera_id)
        runtime.mode, runtime.profile = mode, profile
        self.sign_input.reset(runtime.session_id)
        self.ksl_segments.reset(runtime.session_id)
        runtime.last_sign_input = None
        runtime.last_sign_segment = None
        self.gloss_sequences.clear(runtime.session_id)
        if mode == "DROWSINESS_MONITOR":
            self.drowsiness.reset(runtime.session_id)
            self.posture.reset(runtime.session_id)
            runtime.drowsiness = None
            runtime.posture = None
        return self.status(camera_id)

    def recalibrate_posture(self, camera_id: str) -> dict[str, object]:
        runtime = self._get(camera_id)
        self.posture.reset(runtime.session_id)
        runtime.posture = None
        return {"cameraId": camera_id, "recalibrated": True, "message": "Sit upright and face forward during calibration."}

    def set_model(self, recognizer: OnnxGestureRecognizer | OnnxTemporalGestureRecognizer | None) -> None:
        with self._lock:
            if isinstance(recognizer, OnnxTemporalGestureRecognizer):
                if recognizer.task == "SIGN_LANGUAGE_KSL":
                    self.custom_ksl = recognizer
                    self.ksl_enabled = True
                else:
                    self.custom_temporal = recognizer
            elif isinstance(recognizer, OnnxGestureRecognizer):
                self.custom_static = recognizer
            else:
                self.custom_static = None
                self.custom_temporal = None
                self.custom_ksl = None
                self.ksl_enabled = False

    def snapshot_jpeg(self, camera_id: str, overlay: bool = True) -> bytes | None:
        runtime = self._get(camera_id)
        if runtime.last_frame is None:
            return None
        bgr = cv2.cvtColor(runtime.last_frame.rgb.copy(), cv2.COLOR_RGB2BGR)
        if overlay and runtime.last_features:
            self._draw_landmarks(bgr, runtime.last_features)
        ok, encoded = cv2.imencode(".jpg", bgr, [cv2.IMWRITE_JPEG_QUALITY, 82])
        return encoded.tobytes() if ok else None

    @staticmethod
    def _draw_landmarks(image: Any, features: FeatureFrame) -> None:
        height, width = image.shape[:2]
        for landmark_set, color in ((features.left_hand, (255, 160, 40)), (features.right_hand, (40, 220, 120))):
            if landmark_set:
                CoreRuntime._draw_connections(image, landmark_set.landmarks, HAND_CONNECTIONS, color, width, height, 2, 3)
        if features.pose:
            CoreRuntime._draw_connections(image, features.pose.landmarks, POSE_CONNECTIONS, (220, 100, 220), width, height, 2, 3)
        if features.face:
            face_connections = tuple(
                (path[index], path[index + 1])
                for path in FACE_PATHS
                for index in range(len(path) - 1)
            )
            CoreRuntime._draw_connections(image, features.face.landmarks, face_connections, (80, 190, 255), width, height, 1, 1)

    @staticmethod
    def _draw_connections(
        image: Any,
        landmarks: list[tuple[float, float, float]],
        connections: tuple[tuple[int, int], ...],
        color: tuple[int, int, int],
        width: int,
        height: int,
        thickness: int,
        radius: int,
    ) -> None:
        points = [(int(x * width), int(y * height)) for x, y, _ in landmarks]
        for start, end in connections:
            if start < len(points) and end < len(points):
                cv2.line(image, points[start], points[end], color, thickness, cv2.LINE_AA)
        used = {index for connection in connections for index in connection if index < len(points)}
        for index in used:
            cv2.circle(image, points[index], radius, color, -1, cv2.LINE_AA)

    def diagnostics(self, camera_id: str) -> dict[str, Any]:
        runtime = self._get(camera_id)
        features = runtime.last_features
        quality = features.quality if features else None
        hand = None
        if features:
            pointer_candidate = next(
                (candidate for candidate in runtime.raw_candidates if candidate.code in {"POINTING_UP", "VICTORY"}),
                None,
            )
            if pointer_candidate and pointer_candidate.handedness == "LEFT":
                hand = features.left_hand
            elif pointer_candidate and pointer_candidate.handedness == "RIGHT":
                hand = features.right_hand
            hand = hand or features.right_hand or features.left_hand
        pointer = None
        if features and hand and len(hand.landmarks) > 8:
            x, y, z = hand.landmarks[8]
            pointer = {
                "x": x,
                "y": y,
                "z": z,
                "handedness": hand.handedness,
                "timestampMs": features.timestamp_ms,
            }
        return {
            **self.status(camera_id),
            "rawCandidates": [asdict(candidate) for candidate in runtime.raw_candidates],
            "pointer": pointer,
            "featureTimestampMs": features.timestamp_ms if features else None,
            "quality": {
                "brightness": quality.brightness,
                "blur": quality.blur,
                "handVisibility": quality.hand_visibility,
                "poseVisibility": quality.pose_visibility,
            }
            if quality
            else None,
            "drowsiness": runtime.drowsiness.to_dict() if runtime.drowsiness else None,
            "posture": runtime.posture.to_dict() if runtime.posture else None,
            "signInput": runtime.last_sign_input.to_dict() if runtime.last_sign_input else None,
            "signSegment": runtime.last_sign_segment.to_dict() if runtime.last_sign_segment else None,
        }

    def sign_input_diagnostics(self, camera_id: str) -> dict[str, Any]:
        runtime = self._get(camera_id)
        if runtime.last_sign_input is None:
            return {
                "available": False,
                "cameraId": camera_id,
                "mode": runtime.mode,
                "reason": "SIGN_INPUT_NOT_ACTIVE",
            }
        recognition = next((candidate for candidate in runtime.raw_candidates if candidate.category == "SIGN_LANGUAGE"), None)
        return {
            "available": True,
            **runtime.last_sign_input.to_dict(),
            "segment": runtime.last_sign_segment.to_dict() if runtime.last_sign_segment else None,
            "recognition": asdict(recognition) if recognition else None,
            "glossSequence": self.gloss_sequences.snapshot(runtime.session_id),
        }

    def gloss_sequence(self, session_id: str) -> dict[str, Any]:
        self._camera_for_session(session_id)
        return self.gloss_sequences.snapshot(session_id)

    def clear_gloss_sequence(self, session_id: str) -> dict[str, Any]:
        self._camera_for_session(session_id)
        return self.gloss_sequences.clear(session_id)

    def _camera_for_session(self, session_id: str) -> CameraRuntime:
        runtime = next((item for item in self.cameras.values() if item.session_id == session_id), None)
        if runtime is None:
            raise KeyError(f"Session not found: {session_id}")
        return runtime

    def _get(self, camera_id: str) -> CameraRuntime:
        try:
            return self.cameras[camera_id]
        except KeyError as error:
            raise KeyError(f"Unknown camera: {camera_id}") from error

    def _capture_loop(self, runtime: CameraRuntime) -> None:
        while not runtime.stop_event.is_set():
            try:
                frame = runtime.adapter.read()
                if frame is None:
                    break
                runtime.captured += 1
                runtime.last_frame = frame
                if runtime.frame_queue.full():
                    runtime.frame_queue.get_nowait()
                    runtime.dropped += 1
                runtime.frame_queue.put_nowait(frame)
                time.sleep(1 / 30)
            except Exception as error:  # camera boundary must not kill the server
                runtime.error = str(error)
                runtime.stop_event.set()
        runtime.running = not runtime.stop_event.is_set() and runtime.running

    def _inference_loop(self, runtime: CameraRuntime) -> None:
        while not runtime.stop_event.is_set() or not runtime.frame_queue.empty():
            try:
                frame = runtime.frame_queue.get(timeout=0.1)
            except queue.Empty:
                continue
            try:
                analysis_frame = frame
                if frame.width > 640 or frame.height > 480:
                    target_width, target_height = _fit_analysis_size(frame.width, frame.height)
                    resized = cv2.resize(frame.rgb, (target_width, target_height), interpolation=cv2.INTER_AREA)
                    aligned_depth = self.depth_alignment.align(frame.depth, resized, frame.calibration) if frame.depth is not None else None
                    calibration = self._scaled_calibration(frame.calibration, frame.width, frame.height, target_width, target_height)
                    analysis_frame = FramePacket(
                        frame.camera_id,
                        frame.sequence,
                        frame.timestamp_ms,
                        resized,
                        depth=aligned_depth,
                        width=target_width,
                        height=target_height,
                        metadata=frame.metadata,
                        calibration=calibration,
                    )
                features = runtime.provider.process(analysis_frame, runtime.session_id, hands_only=runtime.mode == "PEN_DRAW")
                features.metadata = {
                    **features.metadata,
                    "depth": {
                        "available": analysis_frame.depth is not None,
                        "source": "ACTUAL_DEPTH" if analysis_frame.depth is not None else "RGB_ESTIMATED_Z",
                        "alignedTo": analysis_frame.metadata.get("depthAlignedTo"),
                    },
                }
                runtime.last_features = features
                previous_drowsiness = runtime.drowsiness
                runtime.drowsiness = self.drowsiness.process(features)
                if runtime.mode == "DROWSINESS_MONITOR":
                    self._publish_drowsiness_transition(runtime, previous_drowsiness, runtime.drowsiness)
                    previous_posture = runtime.posture
                    runtime.posture = self.posture.process(features)
                    self._publish_posture_transition(runtime, previous_posture, runtime.posture)
                if runtime.mode == "DROWSINESS_MONITOR":
                    candidates = []
                elif runtime.mode == "SIGN_LANGUAGE_KSL":
                    runtime.last_sign_input = self.sign_input.assemble(analysis_frame, features)
                    runtime.last_sign_segment = self.ksl_segments.process(features)
                    candidates = (
                        self.custom_ksl.process(features)
                        if self.custom_ksl is not None
                        and runtime.last_sign_input.quality.ready_for_recognition
                        and runtime.last_sign_segment.accept_frame
                        else []
                    )
                    for candidate in candidates:
                        candidate.metadata.update(
                            {
                                "segmentId": runtime.last_sign_segment.segment_id,
                                "segmentState": runtime.last_sign_segment.state,
                                "sequenceReady": runtime.last_sign_segment.sequence_ready,
                            }
                        )
                    if runtime.last_sign_segment.sequence_ready and candidates:
                        self.gloss_sequences.append(runtime.session_id, candidates[0])
                    if runtime.last_sign_segment.ended and self.custom_ksl is not None:
                        self.custom_ksl.reset(runtime.session_id)
                else:
                    runtime.last_sign_input = None
                    runtime.last_sign_segment = None
                    custom = self.custom_static
                    candidates = self.static.process(features)
                    if custom is not None:
                        candidates.extend(custom.process(features))
                    rule_dynamic = self.temporal.process(features)
                    learned_dynamic = self.custom_temporal.process(features) if self.custom_temporal is not None else []
                    candidates.extend(fuse_dynamic_candidates(rule_dynamic, learned_dynamic))
                    for recognizer in self.depth_recognizers:
                        candidates.extend(recognizer.process(analysis_frame, features))
                runtime.raw_candidates = candidates
                for event in self.stabilizer.process(features, candidates, runtime.mode):
                    self.events.publish(event)
                runtime.inferred += 1
            except Exception as error:  # inference failure is surfaced, capture can be stopped cleanly
                runtime.error = str(error)
                runtime.stop_event.set()

    def _publish_drowsiness_transition(
        self,
        runtime: CameraRuntime,
        previous: DrowsinessSnapshot | None,
        current: DrowsinessSnapshot,
    ) -> None:
        previous_status = previous.status if previous else None
        if current.status == previous_status:
            return
        event_code: str | None = None
        phase = "START"
        if current.status == "ALARM":
            event_code = "DRIVER_FACE_MISSING" if not current.face_visible else "DROWSINESS_ALARM"
        elif current.status == "WARNING":
            event_code = "DRIVER_FACE_WARNING" if not current.face_visible else "DROWSINESS_WARNING"
        elif current.status == "AWAKE" and previous_status in {"WARNING", "ALARM"}:
            event_code, phase = "DROWSINESS_CLEARED", "END"
        if event_code is None:
            return
        self.events.publish(
            EventEnvelope(
                runtime.adapter.camera_id,
                runtime.session_id,
                "SAFETY",
                event_code,
                phase,
                current.risk_score if phase == "START" else 1.0,
                max(current.closed_duration_ms, current.head_down_duration_ms, current.face_missing_duration_ms),
                intent="SAFETY_ALERT" if phase == "START" else "SAFETY_CLEAR",
                person_id="person-001" if current.face_visible else None,
                source={"plugin": "local-face-drowsiness", "model": "mediapipe-face-landmarks"},
                metadata=current.to_dict(),
            )
        )

    def _publish_posture_transition(
        self,
        runtime: CameraRuntime,
        previous: PostureSnapshot | None,
        current: PostureSnapshot,
    ) -> None:
        previous_key = (previous.status, previous.issue) if previous else (None, None)
        current_key = (current.status, current.issue)
        if previous_key == current_key:
            return
        if current.status == "WARNING":
            event_code, phase, intent, confidence = "POSTURE_WARNING", "START", "CORRECT_POSTURE", 1.0 - current.posture_score
        elif current.status == "GOOD" and previous is not None and previous.status == "WARNING":
            event_code, phase, intent, confidence = "POSTURE_CLEARED", "END", "POSTURE_OK", 1.0
        else:
            return
        self.events.publish(
            EventEnvelope(
                runtime.adapter.camera_id,
                runtime.session_id,
                "POSTURE",
                event_code,
                phase,
                confidence,
                current.bad_duration_ms,
                intent=intent,
                person_id="person-001" if current.pose_visible else None,
                source={"plugin": "local-pose-posture", "model": "mediapipe-pose-landmarks"},
                metadata=current.to_dict(),
            )
        )

    @staticmethod
    def _scaled_calibration(
        calibration: CameraCalibration | None,
        source_width: int,
        source_height: int,
        target_width: int,
        target_height: int,
    ) -> CameraCalibration | None:
        if calibration is None or source_width <= 0 or source_height <= 0:
            return calibration
        scale_x, scale_y = target_width / source_width, target_height / source_height
        return CameraCalibration(
            target_width,
            target_height,
            calibration.fx * scale_x,
            calibration.fy * scale_y,
            calibration.cx * scale_x,
            calibration.cy * scale_y,
            calibration.depth_scale_m,
            calibration.model,
        )
