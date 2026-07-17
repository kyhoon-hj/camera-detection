from __future__ import annotations

import json
from collections import Counter
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any


@dataclass(slots=True)
class DatasetValidation:
    valid: bool
    sessions: int = 0
    samples: int = 0
    labels: dict[str, int] = field(default_factory=dict)
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def _json_lines(path: Path, errors: list[str]) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    if not path.is_file():
        errors.append(f"Missing file: {path}")
        return records
    for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        try:
            value = json.loads(line)
        except json.JSONDecodeError as error:
            errors.append(f"Invalid JSON at {path}:{number}: {error.msg}")
            continue
        if not isinstance(value, dict):
            errors.append(f"Record must be an object at {path}:{number}")
            continue
        records.append(value)
    return records


def validate_dataset(path: str | Path, write_report: bool = True) -> DatasetValidation:
    root = Path(path)
    errors: list[str] = []
    warnings: list[str] = []
    if not root.is_dir():
        return DatasetValidation(False, errors=[f"Dataset directory not found: {root}"])
    session_dirs = sorted((root / "sessions").glob("cap_*")) if (root / "sessions").is_dir() else []
    if not session_dirs and (root / "session.json").is_file():
        session_dirs = [root]
    if not session_dirs:
        errors.append("No capture sessions found")
    labels: Counter[str] = Counter()
    sample_count = 0
    for session_dir in session_dirs:
        try:
            session = json.loads((session_dir / "session.json").read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as error:
            errors.append(f"Invalid session metadata in {session_dir}: {error}")
            continue
        label_records = _json_lines(session_dir / "labels.jsonl", errors)
        landmark_records = _json_lines(session_dir / "landmarks.jsonl", errors) if session.get("saveLandmarks") else []
        if session.get("saveLandmarks") and len(landmark_records) != len(label_records):
            errors.append(f"Label/landmark count mismatch in {session_dir}")
        if not session.get("saveVideo") and (session_dir / "video.mp4").exists():
            errors.append(f"Privacy violation: unexpected video in {session_dir}")
        if session.get("saveVideo") and not (session_dir / "video.mp4").is_file():
            errors.append(f"Declared video is missing in {session_dir}")
        if int(session.get("samples", -1)) != len(label_records):
            errors.append(f"Session sample count mismatch in {session_dir}")
        for record in label_records:
            label = record.get("label")
            sample_id = record.get("sampleId")
            if not label or not sample_id:
                errors.append(f"Missing label/sampleId in {session_dir}")
            else:
                labels[str(label)] += 1
        sample_count += len(label_records)
        if session.get("status") != "COMPLETE":
            warnings.append(f"Incomplete session: {session_dir.name}")
    result = DatasetValidation(not errors, len(session_dirs), sample_count, dict(sorted(labels.items())), errors, warnings)
    if write_report:
        report_dir = root / "reports"
        report_dir.mkdir(parents=True, exist_ok=True)
        (report_dir / "validation.json").write_text(json.dumps(result.to_dict(), ensure_ascii=False, indent=2), encoding="utf-8")
        (report_dir / "distribution.json").write_text(
            json.dumps({"labels": result.labels, "samples": sample_count}, indent=2),
            encoding="utf-8",
        )
    return result
