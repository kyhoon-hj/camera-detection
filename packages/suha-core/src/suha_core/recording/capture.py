from __future__ import annotations

import hashlib
import json
import threading
from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from uuid import uuid4

import cv2

from suha_core.domain import FeatureFrame, FramePacket


def _now() -> str:
    return datetime.now(UTC).isoformat()


@dataclass(slots=True)
class CaptureSession:
    capture_id: str
    dataset_id: str
    label: str
    target_samples: int
    save_video: bool
    save_landmarks: bool
    consent_id: str
    subject_id: str
    camera_id: str
    metadata: dict[str, Any]
    output_dir: Path
    status: str = "CREATED"
    samples: int = 0
    created_at: str = field(default_factory=_now)
    started_at: str | None = None
    completed_at: str | None = None
    last_timestamp_ms: int = -1
    error: str | None = None

    def public(self) -> dict[str, Any]:
        return {
            "captureId": self.capture_id,
            "datasetId": self.dataset_id,
            "label": self.label,
            "targetSamples": self.target_samples,
            "saveVideo": self.save_video,
            "saveLandmarks": self.save_landmarks,
            "subjectId": self.subject_id,
            "cameraId": self.camera_id,
            "metadata": self.metadata,
            "status": self.status,
            "samples": self.samples,
            "createdAt": self.created_at,
            "startedAt": self.started_at,
            "completedAt": self.completed_at,
            "outputPath": str(self.output_dir.resolve()),
            "error": self.error,
        }


class CaptureManager:
    def __init__(self, root: str | Path = "data/recordings") -> None:
        self.root = Path(root)
        self.sessions: dict[str, CaptureSession] = {}
        self._writers: dict[str, cv2.VideoWriter] = {}
        self._lock = threading.RLock()

    def create(
        self,
        *,
        label: str,
        target_samples: int,
        save_video: bool,
        save_landmarks: bool,
        consent_id: str | None,
        camera_id: str,
        dataset_id: str = "local-captures-v1",
        tester_alias: str = "anonymous",
        metadata: dict[str, Any] | None = None,
    ) -> CaptureSession:
        if not consent_id:
            raise ValueError("SUHA-DATA-003 CONSENT_REQUIRED")
        if not save_video and not save_landmarks:
            raise ValueError("At least one capture output must be enabled")
        capture_id = f"cap_{uuid4().hex}"
        subject_hash = hashlib.sha256(tester_alias.encode()).hexdigest()[:12]
        output_dir = self.root / dataset_id / "sessions" / capture_id
        output_dir.mkdir(parents=True, exist_ok=False)
        session = CaptureSession(
            capture_id,
            dataset_id,
            label.upper(),
            target_samples,
            save_video,
            save_landmarks,
            consent_id,
            f"anonymous-{subject_hash}",
            camera_id,
            metadata or {},
            output_dir,
        )
        self.sessions[capture_id] = session
        self._write_session(session)
        self._ensure_dataset_manifest(session)
        return session

    def start(self, capture_id: str) -> CaptureSession:
        session = self.get(capture_id)
        if session.status not in {"CREATED", "STOPPED"}:
            raise ValueError(f"Capture cannot start from {session.status}")
        session.status = "CAPTURING"
        session.started_at = _now()
        self._write_session(session)
        return session

    def mark(self, capture_id: str, features: FeatureFrame, frame: FramePacket | None = None) -> CaptureSession:
        with self._lock:
            session = self.get(capture_id)
            if session.status != "CAPTURING":
                raise ValueError(f"Capture is not active: {session.status}")
            if features.timestamp_ms <= session.last_timestamp_ms:
                raise ValueError("Duplicate or stale feature frame")
            if not any((features.left_hand, features.right_hand, features.pose)):
                raise ValueError("No visible hand or pose landmarks")
            sample_id = f"smp_{uuid4().hex}"
            label_record = {
                "schemaVersion": "1.0",
                "sampleId": sample_id,
                "label": session.label,
                "timestampMs": features.timestamp_ms,
            }
            self._append_jsonl(session.output_dir / "labels.jsonl", label_record)
            if session.save_landmarks:
                landmark_record = {
                    **label_record,
                    "cameraId": features.camera_id,
                    "personId": features.person_id,
                    "leftHand": asdict(features.left_hand) if features.left_hand else None,
                    "rightHand": asdict(features.right_hand) if features.right_hand else None,
                    "pose": asdict(features.pose) if features.pose else None,
                    "face": asdict(features.face) if features.face else None,
                    "quality": asdict(features.quality),
                }
                self._append_jsonl(session.output_dir / "landmarks.jsonl", landmark_record)
            if session.save_video:
                if frame is None:
                    raise ValueError("Video frame is unavailable")
                self._write_video_frame(session, frame)
            session.samples += 1
            session.last_timestamp_ms = features.timestamp_ms
            if session.samples >= session.target_samples:
                session.status = "COMPLETE"
                session.completed_at = _now()
                self._close_writer(session.capture_id)
            self._write_session(session)
            return session

    def stop(self, capture_id: str) -> CaptureSession:
        session = self.get(capture_id)
        if session.status == "CAPTURING":
            session.status = "STOPPED"
            session.completed_at = _now()
        self._close_writer(capture_id)
        self._write_session(session)
        return session

    def get(self, capture_id: str) -> CaptureSession:
        try:
            return self.sessions[capture_id]
        except KeyError as error:
            raise KeyError(f"Capture not found: {capture_id}") from error

    def _write_video_frame(self, session: CaptureSession, frame: FramePacket) -> None:
        writer = self._writers.get(session.capture_id)
        if writer is None:
            path = session.output_dir / "video.mp4"
            fourcc = getattr(cv2, "VideoWriter_fourcc")(*"mp4v")  # noqa: B009
            writer = cv2.VideoWriter(str(path), fourcc, 10.0, (frame.width, frame.height))
            if not writer.isOpened():
                raise RuntimeError("Unable to initialize video writer")
            self._writers[session.capture_id] = writer
        writer.write(cv2.cvtColor(frame.rgb, cv2.COLOR_RGB2BGR))

    def _close_writer(self, capture_id: str) -> None:
        writer = self._writers.pop(capture_id, None)
        if writer:
            writer.release()

    @staticmethod
    def _append_jsonl(path: Path, record: dict[str, Any]) -> None:
        with path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(record, ensure_ascii=False) + "\n")

    def _write_session(self, session: CaptureSession) -> None:
        private = {
            **session.public(),
            "consentId": session.consent_id,
            "lastTimestampMs": session.last_timestamp_ms,
        }
        (session.output_dir / "session.json").write_text(json.dumps(private, ensure_ascii=False, indent=2), encoding="utf-8")

    def _ensure_dataset_manifest(self, session: CaptureSession) -> None:
        dataset_root = self.root / session.dataset_id
        manifest = dataset_root / "dataset.json"
        if not manifest.exists():
            manifest.write_text(
                json.dumps(
                    {
                        "schemaVersion": "1.0",
                        "datasetId": session.dataset_id,
                        "task": "GESTURE_CAPTURE",
                        "createdAt": _now(),
                        "privacy": {"rawVideoDefault": False, "anonymousSubjectIds": True},
                    },
                    indent=2,
                ),
                encoding="utf-8",
            )
