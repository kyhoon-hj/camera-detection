from __future__ import annotations

import hashlib
import json
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np
import onnxruntime as ort
import torch
from sklearn.metrics import accuracy_score, confusion_matrix
from torch import nn

from suha_core.domain import LandmarkSet

from .learned_dynamic import prepare_sequence
from .learned_static import hand_feature_vector
from .training import _subject_split


class TemporalConvNet(nn.Module):
    def __init__(self, classes: int) -> None:
        super().__init__()
        self.network = nn.Sequential(nn.Conv1d(65, 48, 5, padding=2), nn.ReLU(), nn.Conv1d(48, 32, 3, padding=1), nn.ReLU())
        self.classifier = nn.Linear(32, classes)

    def forward(self, sequence: torch.Tensor, mask: torch.Tensor) -> torch.Tensor:
        encoded = self.network(sequence.transpose(1, 2)).transpose(1, 2)
        weights = mask.unsqueeze(-1)
        pooled = (encoded * weights).sum(dim=1) / weights.sum(dim=1).clamp(min=1)
        result: torch.Tensor = self.classifier(pooled)
        return result


@dataclass(slots=True)
class DynamicTrainingResult:
    manifest_path: Path
    report_path: Path
    pytorch_path: Path
    onnx_path: Path


def train_dynamic_gesture_model(
    dataset_path: str | Path,
    output_path: str | Path,
    *,
    model_id: str,
    version: str = "1.0.0",
    epochs: int = 80,
    window: int = 32,
    seed: int = 42,
    task: str = "GESTURE_DYNAMIC",
) -> DynamicTrainingResult:
    torch.manual_seed(seed)
    np.random.seed(seed)
    sequences, masks, labels_raw, subjects = _load_sequences(Path(dataset_path), window)
    labels = sorted(set(labels_raw))
    generic_dynamic = task == "GESTURE_DYNAMIC"
    required = {"HAND_WAVE", "SWIPE_LEFT", "SWIPE_RIGHT", "NONE"}
    if generic_dynamic and not required.issubset(labels):
        raise ValueError(f"Dynamic training requires labels: {sorted(required)}")
    if not generic_dynamic and len(labels) < 2:
        raise ValueError("Isolated-sign training requires at least two labels")
    label_index = {label: index for index, label in enumerate(labels)}
    targets = np.asarray([label_index[label] for label in labels_raw], dtype=np.int64)
    split = _subject_split(subjects, seed)
    model = TemporalConvNet(len(labels))
    optimizer = torch.optim.Adam(model.parameters(), lr=0.008)
    criterion = nn.CrossEntropyLoss()
    train_sequence = torch.tensor(sequences[split["train"]])
    train_mask = torch.tensor(masks[split["train"]])
    train_target = torch.tensor(targets[split["train"]])
    model.train()
    for _ in range(epochs):
        optimizer.zero_grad()
        loss = criterion(model(train_sequence, train_mask), train_target)
        loss.backward()
        optimizer.step()
    model.eval()
    output = Path(output_path)
    output.mkdir(parents=True, exist_ok=True)
    pytorch_path, onnx_path = output / "model.pt", output / "model.onnx"
    torch.save({"stateDict": model.state_dict(), "labels": labels, "window": window}, pytorch_path)
    torch.onnx.export(
        model,
        (torch.zeros((1, window, 65)), torch.ones((1, window))),
        onnx_path,
        input_names=["sequence", "mask"],
        output_names=["logits"],
        dynamic_axes={"sequence": {0: "batch"}, "mask": {0: "batch"}, "logits": {0: "batch"}},
        opset_version=18,
        dynamo=False,
    )
    report: dict[str, Any] = {"labels": labels, "subjectExcludedEvaluation": True, "splits": {}}
    for name, indices in split.items():
        with torch.no_grad():
            logits = model(torch.tensor(sequences[indices]), torch.tensor(masks[indices]))
            probability = torch.softmax(logits, dim=1).numpy()
        model_prediction = probability.argmax(axis=1)
        truth = targets[indices]
        split_report = {
            "samples": len(indices),
            "subjects": sorted({subjects[index] for index in indices}),
            "modelAccuracy": float(accuracy_score(truth, model_prediction)),
            "modelConfusionMatrix": confusion_matrix(truth, model_prediction, labels=list(range(len(labels)))).tolist(),
        }
        if generic_dynamic:
            rule_prediction = np.asarray([_rule_predict(sequences[index], masks[index], label_index) for index in indices])
            fusion_prediction = np.asarray(
                [rule if rule != label_index["NONE"] else learned for rule, learned in zip(rule_prediction, model_prediction, strict=True)]
            )
            split_report.update(
                {
                    "ruleAccuracy": float(accuracy_score(truth, rule_prediction)),
                    "fusionAccuracy": float(accuracy_score(truth, fusion_prediction)),
                    "falseActivation": {
                        "rule": _false_activation(truth, rule_prediction, label_index["NONE"]),
                        "model": _false_activation(truth, model_prediction, label_index["NONE"]),
                        "fusion": _false_activation(truth, fusion_prediction, label_index["NONE"]),
                    },
                }
            )
        report["splits"][name] = split_report
    session = ort.InferenceSession(str(onnx_path), providers=["CPUExecutionProvider"])
    started = time.perf_counter()
    for _ in range(100):
        session.run(None, {"sequence": sequences[:1], "mask": masks[:1]})
    report["latencyMsP50Approx"] = (time.perf_counter() - started) * 10
    report_path = output / "evaluation.json"
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    manifest = {
        "schemaVersion": "1.0",
        "modelId": model_id,
        "version": version,
        "task": task,
        "format": "ONNX",
        "input": {"shape": [None, window, 65], "mask": True, "resampling": "linear-or-pad"},
        "labels": labels,
        "combinationPolicy": "RULE_MODEL_FUSION" if generic_dynamic else "ISOLATED_SIGN_MODEL",
        "artifacts": {"onnx": onnx_path.name, "pytorch": pytorch_path.name, "evaluation": report_path.name},
        "sha256": {"onnx": _sha256(onnx_path), "pytorch": _sha256(pytorch_path)},
    }
    manifest_path = output / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    return DynamicTrainingResult(manifest_path, report_path, pytorch_path, onnx_path)


def _load_sequences(root: Path, window: int) -> tuple[np.ndarray, np.ndarray, list[str], list[str]]:
    sequences: list[np.ndarray] = []
    masks: list[np.ndarray] = []
    labels: list[str] = []
    subjects: list[str] = []
    for session_dir in sorted((root / "sessions").glob("cap_*")):
        session = json.loads((session_dir / "session.json").read_text(encoding="utf-8"))
        frames: list[np.ndarray] = []
        for line in (session_dir / "landmarks.jsonl").read_text(encoding="utf-8").splitlines():
            record = json.loads(line)
            raw = record.get("rightHand") or record.get("leftHand")
            if raw:
                hand = LandmarkSet([tuple(point) for point in raw["landmarks"]], raw.get("visibility", [1.0] * 21), raw.get("handedness"))
                frames.append(np.concatenate((hand_feature_vector(hand), np.asarray(hand.landmarks[0][:2], dtype=np.float32))))
        if frames:
            sequence, mask = prepare_sequence(np.stack(frames), window)
            sequences.append(sequence)
            masks.append(mask)
            labels.append(str(session["label"]))
            subjects.append(str(session["subjectId"]))
    if not sequences:
        raise ValueError("No compatible dynamic gesture sessions found")
    return np.stack(sequences), np.stack(masks), labels, subjects


def _rule_predict(sequence: np.ndarray, mask: np.ndarray, labels: dict[str, int]) -> int:
    wrist_x = sequence[: int(mask.sum()), 63]
    if len(wrist_x) < 3:
        return labels["NONE"]
    deltas = np.diff(wrist_x)
    directions = np.sign(deltas[np.abs(deltas) > 0.015])
    turns = int(np.sum(directions[1:] != directions[:-1])) if len(directions) > 1 else 0
    span = float(wrist_x.max() - wrist_x.min())
    if turns >= 2 and span > 0.12:
        return labels["HAND_WAVE"]
    displacement = float(wrist_x[-1] - wrist_x[0])
    if abs(displacement) > 0.2:
        return labels["SWIPE_RIGHT"] if displacement > 0 else labels["SWIPE_LEFT"]
    return labels["NONE"]


def _false_activation(truth: np.ndarray, prediction: np.ndarray, none_index: int) -> float:
    none = truth == none_index
    return float(np.mean(prediction[none] != none_index)) if np.any(none) else 0.0


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()
