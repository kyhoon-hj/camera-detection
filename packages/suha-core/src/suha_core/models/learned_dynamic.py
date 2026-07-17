from __future__ import annotations

import json
from collections import defaultdict, deque
from pathlib import Path

import numpy as np
import onnxruntime as ort

from suha_core.domain import FeatureFrame, RecognitionCandidate

from .learned_static import hand_feature_vector


def dynamic_feature(features: FeatureFrame) -> np.ndarray | None:
    hand = features.right_hand or features.left_hand
    if hand is None:
        return None
    wrist = np.asarray(hand.landmarks[0][:2], dtype=np.float32)
    return np.concatenate((hand_feature_vector(hand), wrist))


def prepare_sequence(values: np.ndarray, window: int = 32) -> tuple[np.ndarray, np.ndarray]:
    if len(values) == 0:
        raise ValueError("Sequence is empty")
    output = np.zeros((window, values.shape[1]), dtype=np.float32)
    mask = np.zeros(window, dtype=np.float32)
    if len(values) >= window:
        positions = np.linspace(0, len(values) - 1, window)
        left = np.floor(positions).astype(int)
        right = np.minimum(left + 1, len(values) - 1)
        ratio = (positions - left).astype(np.float32)[:, None]
        output = values[left] * (1 - ratio) + values[right] * ratio
        mask[:] = 1
    else:
        output[: len(values)] = values
        mask[: len(values)] = 1
    return output, mask


def fuse_dynamic_candidates(
    rule: list[RecognitionCandidate], model: list[RecognitionCandidate]
) -> list[RecognitionCandidate]:
    if not model:
        return rule
    if not rule:
        return [candidate for candidate in model if candidate.code != "NONE" and candidate.confidence >= 0.7]
    fused = list(rule)
    for learned in model:
        matching = next((candidate for candidate in rule if candidate.code == learned.code), None)
        if matching is not None:
            matching.confidence = min(0.99, (matching.confidence + learned.confidence) / 2 + 0.08)
            matching.metadata["fusion"] = "rule+model"
        elif learned.code != "NONE" and learned.confidence >= 0.9:
            fused.append(learned)
    return fused


class OnnxTemporalGestureRecognizer:
    def __init__(self, manifest_path: str | Path, providers: list[str] | None = None) -> None:
        path = Path(manifest_path)
        self.manifest = json.loads(path.read_text(encoding="utf-8"))
        self.plugin_id = str(self.manifest["modelId"])
        self.plugin_version = str(self.manifest["version"])
        self.labels = [str(label) for label in self.manifest["labels"]]
        self.task = str(self.manifest.get("task", "GESTURE_DYNAMIC"))
        self.window = int(self.manifest["input"]["shape"][1])
        model_path = path.parent / str(self.manifest["artifacts"]["onnx"])
        self.session = ort.InferenceSession(str(model_path), providers=providers or ["CPUExecutionProvider"])
        self._buffers: dict[str, deque[np.ndarray]] = defaultdict(lambda: deque(maxlen=self.window))

    def warmup(self) -> None:
        outputs = self.session.run(
            None,
            {
                "sequence": np.zeros((1, self.window, 65), dtype=np.float32),
                "mask": np.ones((1, self.window), dtype=np.float32),
            },
        )
        if not outputs or outputs[0].shape[-1] != len(self.labels):
            raise ValueError("ONNX output dimension does not match manifest labels")

    def reset(self, session_id: str | None = None) -> None:
        if session_id is None:
            self._buffers.clear()
        else:
            self._buffers.pop(session_id, None)

    def process(self, features: FeatureFrame) -> list[RecognitionCandidate]:
        vector = dynamic_feature(features)
        if vector is None:
            return []
        buffer = self._buffers[features.session_id]
        buffer.append(vector)
        if len(buffer) < 6:
            return []
        sequence, mask = prepare_sequence(np.stack(buffer), self.window)
        logits = self.session.run(None, {"sequence": sequence[None, :], "mask": mask[None, :]})[0][0]
        probabilities = _softmax(logits)
        index = int(np.argmax(probabilities))
        ksl = self.task == "SIGN_LANGUAGE_KSL"
        label = self.labels[index]
        return [
            RecognitionCandidate(
                "SIGN_LANGUAGE" if ksl else "GESTURE_DYNAMIC",
                f"KSL_{label}" if ksl else label,
                float(probabilities[index]),
                features.person_id,
                None,
                features.timestamp_ms - 1000,
                features.timestamp_ms,
                self.plugin_id,
                model_id=self.plugin_id,
                metadata={
                    "source": "onnx-temporal",
                    "windowFrames": len(buffer),
                    **({"language": "KSL", "recognitionType": "ISOLATED_SIGN", "recognizedText": label} if ksl else {}),
                },
            )
        ]


def _softmax(values: np.ndarray) -> np.ndarray:
    exponential = np.exp(values - np.max(values))
    result: np.ndarray = exponential / np.sum(exponential)
    return result
