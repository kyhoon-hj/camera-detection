from __future__ import annotations

import hashlib
import json
import threading
from collections.abc import Callable
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import onnx
import onnxruntime as ort

from suha_core import __version__

from .learned_dynamic import OnnxTemporalGestureRecognizer
from .learned_static import OnnxGestureRecognizer

ModelRecognizer = OnnxGestureRecognizer | OnnxTemporalGestureRecognizer
ModelChangeCallback = Callable[[str, str | None], None]


class ModelRegistry:
    def __init__(
        self,
        root: str | Path,
        activate: Callable[[ModelRecognizer | None], None],
        on_change: ModelChangeCallback | None = None,
    ) -> None:
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)
        self._catalog_path = self.root / "registry.json"
        self._active_path = self.root / "active.json"
        self._audit_path = self.root / "audit.jsonl"
        self._activate = activate
        self._on_change = on_change
        self._models: dict[str, dict[str, Any]] = {}
        self._active: str | None = None
        self._previous: str | None = None
        self._lock = threading.RLock()
        self._load()
        self._restore_active()

    def list(self) -> list[dict[str, Any]]:
        return [dict(value) for value in sorted(self._models.values(), key=lambda item: str(item["modelId"]))]

    def get(self, model_id: str) -> dict[str, Any]:
        return dict(self._get(model_id))

    def providers(self) -> dict[str, Any]:
        available = ort.get_available_providers()
        return {
            "default": "CPUExecutionProvider",
            "available": available,
            "extensionPoints": ["CUDAExecutionProvider", "DmlExecutionProvider", "OpenVINOExecutionProvider"],
        }

    def register(self, manifest_path: str | Path) -> dict[str, Any]:
        path = Path(manifest_path).resolve()
        manifest = self._read_manifest(path)
        model_id = str(manifest["modelId"])
        if model_id == "landmark-rule-static":
            raise ValueError("The built-in rule model ID is reserved")
        record = {
            "modelId": model_id,
            "version": str(manifest["version"]),
            "task": str(manifest["task"]),
            "status": "REGISTERED",
            "manifestPath": str(path),
            "provider": None,
            "error": None,
            "registeredAt": _now(),
        }
        with self._lock:
            self._models[model_id] = record
            self._persist()
            self._audit("REGISTERED", model_id)
        return dict(record)

    def validate(self, model_id: str) -> dict[str, Any]:
        record = self._get(model_id)
        try:
            manifest, provider, recognizer = self._prepare(record)
            recognizer.warmup()
            record.update(
                {
                    "status": "VALIDATED",
                    "provider": provider,
                    "error": None,
                    "validatedAt": _now(),
                    "compatibility": {
                        "coreVersion": __version__,
                        "minCoreVersion": manifest.get("runtime", {}).get("minCoreVersion", "0.1.0"),
                    },
                }
            )
            self._persist()
            self._audit("VALIDATED", model_id, provider=provider)
            return dict(record)
        except Exception as error:
            self._quarantine(record, str(error))
            raise ValueError(f"Model validation failed and was quarantined: {error}") from error

    def activate(self, model_id: str) -> dict[str, Any]:
        record = self._get(model_id)
        if record["status"] not in {"VALIDATED", "DEPRECATED", "ACTIVE"}:
            raise ValueError("Model must be validated before activation")
        try:
            _, provider, recognizer = self._prepare(record)
            recognizer.warmup()
        except Exception as error:
            self._quarantine(record, str(error))
            raise ValueError(f"Model activation failed; previous model retained: {error}") from error
        with self._lock:
            old_active = self._active
            self._activate(recognizer)
            if old_active and old_active in self._models and old_active != model_id:
                self._models[old_active]["status"] = "DEPRECATED"
            self._previous = old_active
            self._active = model_id
            record.update({"status": "ACTIVE", "provider": provider, "activatedAt": _now(), "error": None})
            self._write_active_pointer()
            self._persist()
            self._audit("ACTIVATED", model_id, previous=old_active, provider=provider)
        if self._on_change is not None:
            self._on_change(model_id, old_active)
        return dict(record)

    def rollback(self) -> dict[str, Any]:
        with self._lock:
            target = self._previous
            current = self._active
        if target is None:
            self._activate(None)
            if current and current in self._models:
                self._models[current]["status"] = "DEPRECATED"
            self._previous = current
            self._active = None
            self._write_active_pointer()
            self._persist()
            self._audit("ROLLED_BACK", "landmark-rule-static", previous=current)
            if self._on_change is not None:
                self._on_change("landmark-rule-static", current)
            return {"modelId": "landmark-rule-static", "version": "0.1.0", "status": "ACTIVE"}
        result = self.activate(target)
        self._audit("ROLLED_BACK", target, previous=current)
        return result

    def quarantine(self, model_id: str, reason: str) -> dict[str, Any]:
        record = self._get(model_id)
        if self._active == model_id:
            raise ValueError("An active model must be rolled back before quarantine")
        self._quarantine(record, reason)
        return dict(record)

    def _prepare(self, record: dict[str, Any]) -> tuple[dict[str, Any], str, ModelRecognizer]:
        path = Path(record["manifestPath"])
        manifest = self._read_manifest(path)
        if manifest["modelId"] != record["modelId"] or manifest["version"] != record["version"]:
            raise ValueError("Manifest identity changed after registration")
        self._validate_compatibility(manifest)
        onnx_path = path.parent / str(manifest["artifacts"]["onnx"])
        expected = str(manifest["sha256"]["onnx"])
        if hashlib.sha256(onnx_path.read_bytes()).hexdigest() != expected:
            raise ValueError("ONNX checksum mismatch")
        onnx.checker.check_model(onnx.load(str(onnx_path)))
        provider = self._select_provider(manifest)
        return manifest, provider, self._recognizer(path, manifest, provider)

    @staticmethod
    def _read_manifest(path: Path) -> dict[str, Any]:
        raw = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(raw, dict):
            raise ValueError("Manifest root must be an object")
        manifest: dict[str, Any] = raw
        required = {"schemaVersion", "modelId", "version", "task", "format", "input", "labels", "artifacts", "sha256"}
        missing = required - manifest.keys()
        if missing:
            raise ValueError(f"Manifest fields missing: {sorted(missing)}")
        if manifest["format"] != "ONNX":
            raise ValueError("Only ONNX model artifacts are supported")
        return manifest

    @staticmethod
    def _validate_compatibility(manifest: dict[str, Any]) -> None:
        task = str(manifest["task"])
        shape = manifest["input"].get("shape")
        labels = manifest["labels"]
        if not isinstance(labels, list) or len(labels) < 2 or len(set(labels)) != len(labels):
            raise ValueError("Output labels must contain at least two unique values")
        if task == "GESTURE_STATIC" and (not isinstance(shape, list) or len(shape) != 2 or shape[-1] != 63):
            raise ValueError("Incompatible static input schema; expected [batch, 63]")
        if task in {"GESTURE_DYNAMIC", "SIGN_LANGUAGE_KSL"} and (
            not isinstance(shape, list) or len(shape) != 3 or shape[-1] != 65 or not manifest["input"].get("mask")
        ):
            raise ValueError("Incompatible temporal input schema; expected [batch, window, 65] with mask")
        if task not in {"GESTURE_STATIC", "GESTURE_DYNAMIC", "SIGN_LANGUAGE_KSL"}:
            raise ValueError(f"Unsupported model task: {task}")
        minimum = str(manifest.get("runtime", {}).get("minCoreVersion", "0.1.0"))
        if _version_tuple(minimum) > _version_tuple(__version__):
            raise ValueError(f"Model requires core version {minimum}, current version is {__version__}")

    @staticmethod
    def _select_provider(manifest: dict[str, Any]) -> str:
        requested = manifest.get("runtime", {}).get("providers", ["CPUExecutionProvider"])
        if not isinstance(requested, list) or not requested:
            raise ValueError("runtime.providers must be a non-empty list")
        available = set(ort.get_available_providers())
        selected = next((str(provider) for provider in requested if provider in available), None)
        if selected is None:
            raise ValueError(f"No requested ONNX Runtime provider is available: {requested}")
        return selected

    @staticmethod
    def _recognizer(path: Path, manifest: dict[str, Any], provider: str) -> ModelRecognizer:
        if manifest["task"] in {"GESTURE_DYNAMIC", "SIGN_LANGUAGE_KSL"}:
            return OnnxTemporalGestureRecognizer(path, providers=[provider])
        return OnnxGestureRecognizer(path, providers=[provider])

    def _quarantine(self, record: dict[str, Any], reason: str) -> None:
        record.update({"status": "QUARANTINED", "error": reason, "quarantinedAt": _now()})
        self._persist()
        self._audit("QUARANTINED", str(record["modelId"]), reason=reason)

    def _get(self, model_id: str) -> dict[str, Any]:
        try:
            return self._models[model_id]
        except KeyError as error:
            raise KeyError(f"Model not found: {model_id}") from error

    def _load(self) -> None:
        if self._catalog_path.is_file():
            payload = json.loads(self._catalog_path.read_text(encoding="utf-8"))
            self._models = {str(item["modelId"]): item for item in payload.get("models", [])}
        if self._active_path.is_file():
            pointer = json.loads(self._active_path.read_text(encoding="utf-8"))
            self._active = pointer.get("activeModelId")
            self._previous = pointer.get("previousModelId")

    def _restore_active(self) -> None:
        if self._active is None or self._active not in self._models:
            return
        record = self._models[self._active]
        try:
            _, _, recognizer = self._prepare(record)
            recognizer.warmup()
            self._activate(recognizer)
        except Exception as error:
            self._quarantine(record, f"Startup restore failed: {error}")
            self._active = None
            self._write_active_pointer()

    def _persist(self) -> None:
        self._atomic_json(self._catalog_path, {"schemaVersion": "1.0", "models": self.list()})

    def _write_active_pointer(self) -> None:
        self._atomic_json(
            self._active_path,
            {"schemaVersion": "1.0", "activeModelId": self._active, "previousModelId": self._previous, "updatedAt": _now()},
        )

    @staticmethod
    def _atomic_json(path: Path, payload: dict[str, Any]) -> None:
        temporary = path.with_suffix(path.suffix + ".tmp")
        temporary.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        temporary.replace(path)

    def _audit(self, action: str, model_id: str, **details: Any) -> None:
        record = {"timestamp": _now(), "action": action, "modelId": model_id, **details}
        with self._audit_path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(record, ensure_ascii=False) + "\n")


def _now() -> str:
    return datetime.now(UTC).isoformat()


def _version_tuple(value: str) -> tuple[int, ...]:
    try:
        return tuple(int(part) for part in value.split(".")[:3])
    except ValueError as error:
        raise ValueError(f"Invalid semantic version: {value}") from error
