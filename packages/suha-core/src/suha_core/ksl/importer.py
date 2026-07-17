from __future__ import annotations

import hashlib
import json
import re
from collections import Counter
from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any


@dataclass(frozen=True, slots=True)
class MappingProfile:
    dataset_type: str
    video_keys: tuple[str, ...]
    label_keys: tuple[str, ...]
    subject_keys: tuple[str, ...]
    keypoint_keys: tuple[str, ...]


PROFILES = {
    "aihub-sign-video": MappingProfile(
        "aihub-sign-video",
        ("video_path", "videoPath", "file_name", "fileName", "video"),
        ("gloss", "label", "word", "korean_text"),
        ("signer_id", "signerId", "person_id", "personId"),
        ("keypoints", "landmarks", "frames"),
    ),
    "aihub-disaster-safety": MappingProfile(
        "aihub-disaster-safety",
        ("video_path", "videoPath", "file_name", "fileName", "clip"),
        ("gloss", "label", "sentence", "expression"),
        ("signer_id", "signerId", "speaker_id", "person_id"),
        ("keypoints", "landmarks", "frames"),
    ),
    "nikl-parallel": MappingProfile(
        "nikl-parallel",
        ("video_path", "videoPath", "media", "file"),
        ("gloss", "sign_text", "translation", "korean_text"),
        ("signer_id", "signerId", "speaker", "participant_id"),
        ("keypoints", "landmarks", "frames"),
    ),
}


@dataclass(slots=True)
class KslSourceRecord:
    metadata_path: str
    video_path: str | None
    label: str
    subject_id: str
    keypoints: list[dict[str, Any]] | None = None


@dataclass(slots=True)
class KslValidation:
    valid: bool
    dataset_type: str
    records: int
    labels: dict[str, int]
    subjects: int
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(slots=True)
class KslImportOptions:
    dataset_type: str
    source: Path
    target: Path
    license_confirmed: bool = False
    anonymize_metadata: bool = True
    extract_landmarks: bool = False
    license_reference: str = "USER_CONFIRMED_SOURCE_TERMS"


def validate_ksl_source(dataset_type: str, source: str | Path) -> tuple[KslValidation, list[KslSourceRecord]]:
    root = Path(source).resolve()
    profile = _profile(dataset_type)
    errors: list[str] = []
    warnings: list[str] = []
    records: list[KslSourceRecord] = []
    if not root.is_dir():
        return KslValidation(False, dataset_type, 0, {}, 0, [f"Source directory not found: {root}"]), []
    metadata_files = sorted(root.rglob("*.json"))
    if not metadata_files:
        errors.append("No JSON metadata files found")
    for metadata_path in metadata_files:
        try:
            payload = json.loads(metadata_path.read_text(encoding="utf-8-sig"))
        except (OSError, json.JSONDecodeError) as error:
            errors.append(f"Invalid metadata {metadata_path}: {error}")
            continue
        for item in _objects(payload):
            label = _first(item, profile.label_keys)
            subject = _first(item, profile.subject_keys)
            video_value = _first(item, profile.video_keys)
            keypoints_value = _first_value(item, profile.keypoint_keys)
            if not label or not subject or (not video_value and not isinstance(keypoints_value, list)):
                continue
            video_path = _resolve_media(root, metadata_path, video_value) if video_value else None
            if video_path and not Path(video_path).is_file():
                errors.append(f"Missing video referenced by {metadata_path}: {video_value}")
                continue
            if video_path and not _video_readable(Path(video_path)):
                errors.append(f"Corrupt or unreadable video referenced by {metadata_path}: {video_value}")
                continue
            records.append(
                KslSourceRecord(
                    str(metadata_path),
                    video_path,
                    _normalize_label(label),
                    _anonymous_subject(subject),
                    keypoints_value if isinstance(keypoints_value, list) else None,
                )
            )
    if not records and not errors:
        errors.append(f"No records matched mapping profile: {dataset_type}")
    labels = Counter(record.label for record in records)
    subjects = {record.subject_id for record in records}
    if len(labels) < 2:
        warnings.append("At least two labels are required for an isolated-sign training smoke test")
    if len(subjects) < 3:
        warnings.append("At least three signers are required for leakage-safe train/validation/test splits")
    return KslValidation(not errors, dataset_type, len(records), dict(sorted(labels.items())), len(subjects), errors, warnings), records


def import_ksl_dataset(options: KslImportOptions) -> KslValidation:
    if not options.license_confirmed:
        raise ValueError("KSL-DATA-001 LICENSE_CONFIRMATION_REQUIRED")
    validation, records = validate_ksl_source(options.dataset_type, options.source)
    if not validation.valid:
        raise ValueError("Source validation failed: " + "; ".join(validation.errors))
    options.target.mkdir(parents=True, exist_ok=True)
    sessions_root = options.target / "sessions"
    sessions_root.mkdir(exist_ok=True)
    split_by_subject = _subject_splits({record.subject_id for record in records})
    provider: Any = None
    if options.extract_landmarks and any(not record.keypoints and record.video_path for record in records):
        from suha_core.landmarks import MediaPipeLandmarkProvider

        provider = MediaPipeLandmarkProvider()
        provider.warmup()
    try:
        for index, record in enumerate(records):
            session_id = f"cap_ksl_{index:06d}"
            session_dir = sessions_root / session_id
            session_dir.mkdir(exist_ok=False)
            frames = record.keypoints or []
            if not frames and options.extract_landmarks and record.video_path:
                frames = _extract_video_landmarks(Path(record.video_path), provider, session_id)
            session = {
            "schemaVersion": "1.0",
            "captureId": session_id,
            "datasetId": options.target.name,
            "task": "SIGN_LANGUAGE_KSL",
            "recognitionType": "ISOLATED_SIGN",
            "label": record.label,
            "subjectId": record.subject_id,
            "split": split_by_subject[record.subject_id],
            "samples": len(frames),
            "saveLandmarks": bool(frames),
            "saveVideo": False,
            "status": "COMPLETE",
            "sourceReference": {
                "metadataPath": record.metadata_path,
                "videoPath": record.video_path,
                "externalOnly": True,
            },
            }
            (session_dir / "session.json").write_text(json.dumps(session, ensure_ascii=False, indent=2), encoding="utf-8")
            if frames:
                lines: list[str] = []
                labels: list[str] = []
                for frame_index, frame in enumerate(frames):
                    sample_id = f"{session_id}_{frame_index:06d}"
                    normalized = _normalize_keypoint_frame(frame, sample_id, record.label, frame_index)
                    lines.append(json.dumps(normalized, ensure_ascii=False))
                    labels.append(
                        json.dumps(
                            {"schemaVersion": "1.0", "sampleId": sample_id, "label": record.label, "timestampMs": frame_index},
                            ensure_ascii=False,
                        )
                    )
                (session_dir / "landmarks.jsonl").write_text("\n".join(lines) + "\n", encoding="utf-8")
                (session_dir / "labels.jsonl").write_text("\n".join(labels) + "\n", encoding="utf-8")
    finally:
        if provider is not None:
            provider.close()
    manifest = {
        "schemaVersion": "1.0",
        "datasetId": options.target.name,
        "task": "SIGN_LANGUAGE_KSL",
        "recognitionType": "ISOLATED_SIGN",
        "datasetType": options.dataset_type,
        "createdAt": datetime.now(UTC).isoformat(),
        "sourceRoot": str(options.source.resolve()),
        "sourceFilesCopied": False,
        "license": {"confirmedByUser": True, "reference": options.license_reference, "redistributionAllowed": False},
        "privacy": {"anonymizedSubjects": True, "anonymizeMetadataRequested": options.anonymize_metadata},
        "landmarkExtractionRequested": options.extract_landmarks,
        "mappingProfile": options.dataset_type,
    }
    (options.target / "dataset.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    reports = options.target / "reports"
    reports.mkdir(exist_ok=True)
    (reports / "validation.json").write_text(json.dumps(validation.to_dict(), ensure_ascii=False, indent=2), encoding="utf-8")
    (reports / "statistics.json").write_text(
        json.dumps({"records": validation.records, "labels": validation.labels, "subjects": validation.subjects}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return validation


def _profile(dataset_type: str) -> MappingProfile:
    try:
        return PROFILES[dataset_type]
    except KeyError as error:
        raise ValueError(f"Unsupported KSL dataset type: {dataset_type}") from error


def _objects(value: Any) -> list[dict[str, Any]]:
    output: list[dict[str, Any]] = []
    if isinstance(value, dict):
        output.append(value)
        for nested in value.values():
            output.extend(_objects(nested))
    elif isinstance(value, list):
        for nested in value:
            output.extend(_objects(nested))
    return output


def _first(value: dict[str, Any], keys: tuple[str, ...]) -> str | None:
    found = _first_value(value, keys)
    return str(found).strip() if isinstance(found, str | int) else None


def _first_value(value: dict[str, Any], keys: tuple[str, ...]) -> Any:
    for key in keys:
        if key in value:
            return value[key]
    return None


def _resolve_media(root: Path, metadata: Path, value: str) -> str:
    raw = Path(value)
    candidates = [raw] if raw.is_absolute() else [metadata.parent / raw, root / raw, root / "videos" / raw.name]
    existing = next((candidate.resolve() for candidate in candidates if candidate.is_file()), candidates[0].resolve())
    return str(existing)


def _video_readable(path: Path) -> bool:
    import cv2

    capture = cv2.VideoCapture(str(path))
    try:
        ok, frame = capture.read()
        return bool(capture.isOpened() and ok and frame is not None)
    finally:
        capture.release()


def _normalize_label(value: str) -> str:
    normalized = re.sub(r"[^0-9A-Z가-힣]+", "_", value.strip().upper()).strip("_")
    return normalized or "UNKNOWN"


def _anonymous_subject(value: str) -> str:
    return "anonymous-" + hashlib.sha256(value.encode()).hexdigest()[:12]


def _subject_splits(subjects: set[str]) -> dict[str, str]:
    ordered = sorted(subjects, key=lambda subject: hashlib.sha256(subject.encode()).hexdigest())
    result: dict[str, str] = {}
    for index, subject in enumerate(ordered):
        result[subject] = "test" if index % 10 == 0 else "validation" if index % 10 == 1 else "train"
    if len(ordered) == 3:
        result = {ordered[0]: "test", ordered[1]: "validation", ordered[2]: "train"}
    return result


def _normalize_keypoint_frame(frame: dict[str, Any], sample_id: str, label: str, timestamp: int) -> dict[str, Any]:
    def landmark(name: str) -> dict[str, Any] | None:
        value = frame.get(name) or frame.get(name[0].lower() + name[1:])
        if not value:
            return None
        points = value.get("landmarks", value) if isinstance(value, dict) else value
        if not isinstance(points, list):
            return None
        return {"landmarks": points, "visibility": [1.0] * len(points), "handedness": "LEFT" if "left" in name.lower() else "RIGHT"}

    return {
        "schemaVersion": "1.0",
        "sampleId": sample_id,
        "label": label,
        "timestampMs": timestamp,
        "cameraId": "external-ksl",
        "personId": None,
        "leftHand": landmark("leftHand"),
        "rightHand": landmark("rightHand"),
        "pose": landmark("pose"),
        "face": landmark("face"),
        "quality": {"brightness": 0.0, "blur": 0.0, "hand_visibility": 1.0, "pose_visibility": 0.0, "latency_ms": 0.0},
    }


def _extract_video_landmarks(video_path: Path, provider: Any, session_id: str) -> list[dict[str, Any]]:
    import cv2

    from suha_core.domain import FramePacket

    capture = cv2.VideoCapture(str(video_path))
    if not capture.isOpened():
        raise ValueError(f"Corrupt or unreadable video: {video_path}")
    fps = max(float(capture.get(cv2.CAP_PROP_FPS)), 1.0)
    stride = max(1, round(fps / 10))
    frames: list[dict[str, Any]] = []
    index = 0
    try:
        while True:
            ok, bgr = capture.read()
            if not ok:
                break
            if index % stride == 0:
                rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
                feature = provider.process(
                    FramePacket("external-ksl", index, round(index / fps * 1000), rgb, width=rgb.shape[1], height=rgb.shape[0]),
                    session_id,
                )
                frames.append(
                    {
                        "leftHand": asdict(feature.left_hand) if feature.left_hand else None,
                        "rightHand": asdict(feature.right_hand) if feature.right_hand else None,
                        "pose": asdict(feature.pose) if feature.pose else None,
                        "face": asdict(feature.face) if feature.face else None,
                    }
                )
            index += 1
    finally:
        capture.release()
    if not frames:
        raise ValueError(f"No decodable frames in video: {video_path}")
    return frames
