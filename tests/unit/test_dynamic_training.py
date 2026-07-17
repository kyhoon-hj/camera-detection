from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np
import onnxruntime as ort
import torch
from suha_core.domain import FeatureFrame, FrameQuality, LandmarkSet
from suha_core.models.dynamic_training import TemporalConvNet, train_dynamic_gesture_model
from suha_core.models.learned_dynamic import prepare_sequence
from suha_core.recording import CaptureManager


def _dynamic_hand(label: str, step: int, subject_offset: float) -> LandmarkSet:
    progress = step / 11
    if label == "HAND_WAVE":
        wrist_x = 0.5 + math.sin(progress * math.pi * 4) * 0.16
    elif label == "SWIPE_LEFT":
        wrist_x = 0.75 - progress * 0.5
    elif label == "SWIPE_RIGHT":
        wrist_x = 0.25 + progress * 0.5
    else:
        wrist_x = 0.5 + math.sin(progress * math.pi) * 0.005
    wrist_x += subject_offset
    points = [(wrist_x + (index % 4) * 0.01, 0.75 - (index // 4) * 0.02, 0.0) for index in range(21)]
    points[0] = (wrist_x, 0.85, 0.0)
    return LandmarkSet(points, [1.0] * 21, "RIGHT")


def _dataset(root: Path) -> Path:
    manager = CaptureManager(root / "recordings")
    timestamp = 0
    for subject_index, subject in enumerate(("one", "two", "three")):
        for label in ("HAND_WAVE", "SWIPE_LEFT", "SWIPE_RIGHT", "NONE"):
            for _ in range(2):
                capture = manager.create(
                    label=label,
                    target_samples=12,
                    save_video=False,
                    save_landmarks=True,
                    consent_id="dynamic-consent",
                    camera_id="synthetic-front",
                    dataset_id="dynamic-test",
                    tester_alias=subject,
                )
                manager.start(capture.capture_id)
                for step in range(12):
                    timestamp += 1
                    manager.mark(
                        capture.capture_id,
                        FeatureFrame(
                            "synthetic-front",
                            "session",
                            timestamp,
                            "person",
                            None,
                            _dynamic_hand(label, step, subject_index * 0.002),
                            None,
                            None,
                            FrameQuality(hand_visibility=1.0),
                        ),
                    )
    return root / "recordings" / "dynamic-test"


def test_dynamic_training_reports_fusion_false_activation_and_onnx_parity(tmp_path: Path) -> None:
    result = train_dynamic_gesture_model(_dataset(tmp_path), tmp_path / "dynamic-bundle", model_id="dynamic-custom", epochs=20)
    report = json.loads(result.report_path.read_text(encoding="utf-8"))
    assert report["subjectExcludedEvaluation"] is True
    assert report["latencyMsP50Approx"] >= 0
    assert set(report["splits"]["test"]["falseActivation"]) == {"rule", "model", "fusion"}

    checkpoint = torch.load(result.pytorch_path, weights_only=False)
    model = TemporalConvNet(len(checkpoint["labels"]))
    model.load_state_dict(checkpoint["stateDict"])
    model.eval()
    raw = np.stack([np.linspace(0, 1, 65, dtype=np.float32) + index * 0.001 for index in range(12)])
    sequence, mask = prepare_sequence(raw, int(checkpoint["window"]))
    with torch.no_grad():
        expected = model(torch.tensor(sequence[None, :]), torch.tensor(mask[None, :])).numpy()
    session = ort.InferenceSession(str(result.onnx_path), providers=["CPUExecutionProvider"])
    actual = session.run(None, {"sequence": sequence[None, :], "mask": mask[None, :]})[0]
    np.testing.assert_allclose(expected, actual, rtol=1e-5, atol=1e-5)
