from __future__ import annotations

import json
from pathlib import Path

import pytest
from suha_core.datasets import validate_dataset
from suha_core.ksl import KslImportOptions, import_ksl_dataset, validate_ksl_source
from suha_core.models.dynamic_training import train_dynamic_gesture_model
from suha_core.models.learned_dynamic import OnnxTemporalGestureRecognizer
from suha_core.pipeline import CoreRuntime


def _source(root: Path) -> Path:
    source = root / "user-downloaded-aihub-sample"
    source.mkdir()
    records = []
    for subject in ("signer-a", "signer-b", "signer-c"):
        for label in ("도움", "감사"):
            frames = []
            for frame_index in range(8):
                wrist = 0.4 + frame_index * (0.01 if label == "도움" else -0.01)
                points = [[wrist + (index % 4) * 0.01, 0.8 - (index // 4) * 0.02, 0.0] for index in range(21)]
                frames.append({"rightHand": points})
            records.append({"gloss": label, "signer_id": subject, "keypoints": frames})
    (source / "labels.json").write_text(json.dumps({"annotations": records}, ensure_ascii=False), encoding="utf-8")
    return source


def test_ksl_validate_import_external_reference_and_leakage_safe_split(tmp_path: Path) -> None:
    source = _source(tmp_path)
    validation, _ = validate_ksl_source("aihub-sign-video", source)
    assert validation.valid
    assert validation.records == 6
    assert validation.subjects == 3

    target = tmp_path / "imported"
    result = import_ksl_dataset(
        KslImportOptions(
            "aihub-sign-video",
            source,
            target,
            license_confirmed=True,
            anonymize_metadata=True,
            license_reference="TEST-TERMS-2026",
        )
    )
    assert result.valid
    manifest = json.loads((target / "dataset.json").read_text(encoding="utf-8"))
    assert manifest["sourceFilesCopied"] is False
    assert manifest["license"]["redistributionAllowed"] is False
    sessions = [json.loads(path.read_text(encoding="utf-8")) for path in target.glob("sessions/*/session.json")]
    subject_splits: dict[str, set[str]] = {}
    for session in sessions:
        subject_splits.setdefault(session["subjectId"], set()).add(session["split"])
        assert session["sourceReference"]["externalOnly"] is True
    assert all(len(splits) == 1 for splits in subject_splits.values())
    assert validate_dataset(target).valid
    trained = train_dynamic_gesture_model(
        target,
        tmp_path / "ksl-baseline",
        model_id="ksl-isolated-test",
        epochs=10,
        task="SIGN_LANGUAGE_KSL",
    )
    model_manifest = json.loads(trained.manifest_path.read_text(encoding="utf-8"))
    assert model_manifest["task"] == "SIGN_LANGUAGE_KSL"
    assert set(model_manifest["labels"]) == {"감사", "도움"}
    runtime = CoreRuntime(event_store_path=tmp_path / "events.db")
    runtime.set_model(OnnxTemporalGestureRecognizer(trained.manifest_path))
    assert runtime.set_mode("synthetic-front", "SIGN_LANGUAGE_KSL")["mode"] == "SIGN_LANGUAGE_KSL"
    runtime.shutdown()


def test_ksl_import_requires_explicit_license_confirmation(tmp_path: Path) -> None:
    source = _source(tmp_path)
    with pytest.raises(ValueError, match="LICENSE_CONFIRMATION_REQUIRED"):
        import_ksl_dataset(KslImportOptions("aihub-sign-video", source, tmp_path / "target"))
