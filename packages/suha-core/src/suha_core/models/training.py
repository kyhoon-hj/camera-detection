from __future__ import annotations

import hashlib
import json
import random
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np
import torch
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, confusion_matrix
from torch import nn

from suha_core.domain import LandmarkSet

from .learned_static import hand_feature_vector


class StaticGestureNet(nn.Module):
    mean: torch.Tensor
    scale: torch.Tensor

    def __init__(self, classes: int, mean: np.ndarray, scale: np.ndarray) -> None:
        super().__init__()
        self.register_buffer("mean", torch.tensor(mean, dtype=torch.float32))
        self.register_buffer("scale", torch.tensor(scale, dtype=torch.float32))
        self.layers = nn.Sequential(nn.Linear(63, 48), nn.ReLU(), nn.Linear(48, classes))

    def forward(self, values: torch.Tensor) -> torch.Tensor:
        result: torch.Tensor = self.layers((values - self.mean) / self.scale)
        return result


@dataclass(slots=True)
class TrainingResult:
    manifest_path: Path
    report_path: Path
    pytorch_path: Path
    onnx_path: Path


def train_static_gesture_model(
    dataset_path: str | Path,
    output_path: str | Path,
    *,
    model_id: str,
    version: str = "1.0.0",
    epochs: int = 80,
    seed: int = 42,
) -> TrainingResult:
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)
    output = Path(output_path)
    output.mkdir(parents=True, exist_ok=True)
    features, labels_raw, subjects = _load_dataset(Path(dataset_path))
    labels = sorted(set(labels_raw))
    if len(labels) < 2:
        raise ValueError("Training requires at least two gesture labels")
    indices = {label: index for index, label in enumerate(labels)}
    targets = np.asarray([indices[label] for label in labels_raw], dtype=np.int64)
    split = _subject_split(subjects, seed)
    x_train, y_train = features[split["train"]], targets[split["train"]]
    mean = x_train.mean(axis=0)
    scale = x_train.std(axis=0)
    scale[scale < 1e-6] = 1.0

    baseline = LogisticRegression(max_iter=500, random_state=seed).fit(x_train, y_train)
    model = StaticGestureNet(len(labels), mean, scale)
    optimizer = torch.optim.Adam(model.parameters(), lr=0.01)
    criterion = nn.CrossEntropyLoss()
    train_x = torch.tensor(x_train, dtype=torch.float32)
    train_y = torch.tensor(y_train, dtype=torch.long)
    model.train()
    for _ in range(epochs):
        optimizer.zero_grad()
        loss = criterion(model(train_x), train_y)
        loss.backward()
        optimizer.step()
    model.eval()

    pytorch_path = output / "model.pt"
    onnx_path = output / "model.onnx"
    torch.save({"stateDict": model.state_dict(), "labels": labels, "mean": mean, "scale": scale}, pytorch_path)
    torch.onnx.export(
        model,
        (torch.zeros((1, 63), dtype=torch.float32),),
        onnx_path,
        input_names=["features"],
        output_names=["logits"],
        dynamic_axes={"features": {0: "batch"}, "logits": {0: "batch"}},
        opset_version=18,
        dynamo=False,
    )

    report: dict[str, Any] = {"splits": {}, "labels": labels, "subjectSplit": True}
    for name, sample_indices in split.items():
        x_values, y_values = features[sample_indices], targets[sample_indices]
        with torch.no_grad():
            predicted = model(torch.tensor(x_values, dtype=torch.float32)).argmax(dim=1).numpy()
        baseline_predicted = baseline.predict(x_values)
        report["splits"][name] = {
            "samples": len(sample_indices),
            "subjects": sorted({subjects[index] for index in sample_indices}),
            "accuracy": float(accuracy_score(y_values, predicted)),
            "baselineAccuracy": float(accuracy_score(y_values, baseline_predicted)),
            "confusionMatrix": confusion_matrix(y_values, predicted, labels=list(range(len(labels)))).tolist(),
        }
    report_path = output / "evaluation.json"
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    manifest = {
        "schemaVersion": "1.0",
        "modelId": model_id,
        "version": version,
        "task": "GESTURE_STATIC",
        "format": "ONNX",
        "input": {"name": "features", "shape": [None, 63], "normalization": "wrist-origin-max-radius"},
        "labels": labels,
        "combinationPolicy": "RULE_AND_USER_MODEL",
        "artifacts": {"onnx": onnx_path.name, "pytorch": pytorch_path.name, "evaluation": report_path.name},
        "sha256": {"onnx": _sha256(onnx_path), "pytorch": _sha256(pytorch_path)},
    }
    manifest_path = output / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    return TrainingResult(manifest_path, report_path, pytorch_path, onnx_path)


def _load_dataset(root: Path) -> tuple[np.ndarray, list[str], list[str]]:
    session_dirs = sorted((root / "sessions").glob("cap_*"))
    vectors: list[np.ndarray] = []
    labels: list[str] = []
    subjects: list[str] = []
    for session_dir in session_dirs:
        session = json.loads((session_dir / "session.json").read_text(encoding="utf-8"))
        for line in (session_dir / "landmarks.jsonl").read_text(encoding="utf-8").splitlines():
            record = json.loads(line)
            raw_hand = record.get("rightHand") or record.get("leftHand")
            if not raw_hand:
                continue
            hand = LandmarkSet(
                landmarks=[tuple(point) for point in raw_hand["landmarks"]],
                visibility=[float(value) for value in raw_hand.get("visibility", [1.0] * 21)],
                handedness=str(raw_hand.get("handedness", "RIGHT")),
            )
            vectors.append(hand_feature_vector(hand))
            labels.append(str(record["label"]))
            subjects.append(str(session["subjectId"]))
    if not vectors:
        raise ValueError("No compatible hand landmark samples found")
    return np.stack(vectors), labels, subjects


def _subject_split(subjects: list[str], seed: int) -> dict[str, np.ndarray]:
    unique = sorted(set(subjects))
    if len(unique) < 3:
        raise ValueError("User-based train/validation/test split requires at least three anonymous subjects")
    random.Random(seed).shuffle(unique)
    test_subject, validation_subject = unique[0], unique[1]
    result = {
        "train": np.asarray([index for index, subject in enumerate(subjects) if subject not in {test_subject, validation_subject}]),
        "validation": np.asarray([index for index, subject in enumerate(subjects) if subject == validation_subject]),
        "test": np.asarray([index for index, subject in enumerate(subjects) if subject == test_subject]),
    }
    if any(len(indices) == 0 for indices in result.values()):
        raise ValueError("Each user-based split must contain samples")
    return result


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()
