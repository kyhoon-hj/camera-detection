from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import onnxruntime as ort
import torch
from suha_core.domain import FeatureFrame, FrameQuality, LandmarkSet
from suha_core.models.training import StaticGestureNet, train_static_gesture_model
from suha_core.recording import CaptureManager


def _hand(label: str, offset: float) -> LandmarkSet:
    points: list[tuple[float, float, float]] = []
    for index in range(21):
        finger = index // 4
        row = index % 4
        if label == "PINCH_CUSTOM":
            x = 0.45 + finger * 0.025 + offset
            y = 0.75 - row * 0.035
        else:
            x = 0.30 + finger * 0.09 + offset
            y = 0.85 - row * 0.12
        points.append((x, y, index * 0.001))
    points[0] = (0.5 + offset, 0.9, 0.0)
    return LandmarkSet(points, [1.0] * 21, "RIGHT")


def build_training_dataset(root: Path) -> Path:
    manager = CaptureManager(root / "recordings")
    timestamp = 1000
    for subject in ("alpha", "beta", "gamma"):
        for label in ("PINCH_CUSTOM", "SPREAD_CUSTOM"):
            session = manager.create(
                label=label,
                target_samples=4,
                save_video=False,
                save_landmarks=True,
                consent_id="training-test-consent",
                camera_id="synthetic-front",
                dataset_id="static-test",
                tester_alias=subject,
            )
            manager.start(session.capture_id)
            for sample in range(4):
                timestamp += 1
                features = FeatureFrame(
                    "synthetic-front",
                    "session",
                    timestamp,
                    "person",
                    None,
                    _hand(label, sample * 0.0002),
                    None,
                    None,
                    FrameQuality(hand_visibility=1.0),
                )
                manager.mark(session.capture_id, features)
    return root / "recordings" / "static-test"


def test_training_exports_matching_pytorch_and_onnx(tmp_path: Path) -> None:
    dataset = build_training_dataset(tmp_path)
    result = train_static_gesture_model(dataset, tmp_path / "bundle", model_id="custom-static", epochs=20)
    manifest = json.loads(result.manifest_path.read_text(encoding="utf-8"))
    report = json.loads(result.report_path.read_text(encoding="utf-8"))
    assert manifest["combinationPolicy"] == "RULE_AND_USER_MODEL"
    assert all(report["splits"][name]["subjects"] for name in ("train", "validation", "test"))

    checkpoint = torch.load(result.pytorch_path, weights_only=False)
    model = StaticGestureNet(len(checkpoint["labels"]), checkpoint["mean"], checkpoint["scale"])
    model.load_state_dict(checkpoint["stateDict"])
    model.eval()
    sample = np.linspace(-0.5, 0.5, 63, dtype=np.float32)[None, :]
    with torch.no_grad():
        pytorch_output = model(torch.tensor(sample)).numpy()
    session = ort.InferenceSession(str(result.onnx_path), providers=["CPUExecutionProvider"])
    onnx_output = session.run(None, {"features": sample})[0]
    np.testing.assert_allclose(pytorch_output, onnx_output, rtol=1e-5, atol=1e-5)
