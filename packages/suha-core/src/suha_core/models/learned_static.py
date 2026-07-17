from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import onnxruntime as ort

from suha_core.domain import FeatureFrame, LandmarkSet, RecognitionCandidate


def hand_feature_vector(hand: LandmarkSet) -> np.ndarray:
    points = np.asarray(hand.landmarks[:21], dtype=np.float32)
    if points.shape != (21, 3):
        raise ValueError("A static gesture sample requires 21 hand landmarks")
    points -= points[0]
    if (hand.handedness or "").upper() == "LEFT":
        points[:, 0] *= -1
    scale = float(np.max(np.linalg.norm(points, axis=1)))
    if scale < 1e-6:
        raise ValueError("Degenerate hand landmark sample")
    return (points / scale).reshape(63)


class OnnxGestureRecognizer:
    def __init__(self, manifest_path: str | Path, providers: list[str] | None = None) -> None:
        self.manifest_path = Path(manifest_path)
        self.manifest = json.loads(self.manifest_path.read_text(encoding="utf-8"))
        self.plugin_id = str(self.manifest["modelId"])
        self.plugin_version = str(self.manifest["version"])
        self.labels = [str(label) for label in self.manifest["labels"]]
        model_path = self.manifest_path.parent / str(self.manifest["artifacts"]["onnx"])
        self.session = ort.InferenceSession(str(model_path), providers=providers or ["CPUExecutionProvider"])
        self.input_name = self.session.get_inputs()[0].name

    def warmup(self) -> None:
        outputs = self.session.run(None, {self.input_name: np.zeros((1, 63), dtype=np.float32)})
        if not outputs or outputs[0].shape[-1] != len(self.labels):
            raise ValueError("ONNX output dimension does not match manifest labels")

    def process(self, features: FeatureFrame) -> list[RecognitionCandidate]:
        candidates: list[RecognitionCandidate] = []
        for hand in (features.left_hand, features.right_hand):
            if hand is None:
                continue
            vector = hand_feature_vector(hand)[None, :]
            logits = self.session.run(None, {self.input_name: vector})[0][0]
            probabilities = _softmax(logits)
            index = int(np.argmax(probabilities))
            candidates.append(
                RecognitionCandidate(
                    "GESTURE_STATIC",
                    self.labels[index],
                    float(probabilities[index]),
                    features.person_id,
                    hand.handedness,
                    features.timestamp_ms,
                    features.timestamp_ms,
                    self.plugin_id,
                    model_id=self.plugin_id,
                    metadata={"source": "onnx", "modelVersion": self.plugin_version},
                )
            )
        return candidates


def _softmax(values: np.ndarray) -> np.ndarray:
    shifted = values - np.max(values)
    exponential = np.exp(shifted)
    result: np.ndarray = exponential / np.sum(exponential)
    return result
