from __future__ import annotations

import argparse
import importlib.util
import json
import platform
import sys
from pathlib import Path
from typing import Any

import cv2
import uvicorn
from suha_core import __version__
from suha_core.datasets import validate_dataset
from suha_core.models.dynamic_training import train_dynamic_gesture_model
from suha_core.models.training import train_static_gesture_model


def doctor() -> int:
    camera = cv2.VideoCapture(0)
    camera_available = camera.isOpened()
    camera.release()
    report: dict[str, Any] = {
        "version": __version__,
        "python": sys.version.split()[0],
        "platform": platform.platform(),
        "opencv": cv2.__version__,
        "mediapipe": bool(importlib.util.find_spec("mediapipe")),
        "cameraAvailable": camera_available,
        "syntheticFallback": True,
        "privacy": {"rawVideoSavedByDefault": False},
    }
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0


def main() -> None:
    parser = argparse.ArgumentParser(prog="suha-core")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("doctor")
    serve = sub.add_parser("serve")
    serve.add_argument("--host", default="127.0.0.1")
    serve.add_argument("--port", type=int, default=8200)
    datasets = sub.add_parser("datasets")
    dataset_commands = datasets.add_subparsers(dest="dataset_command", required=True)
    validate = dataset_commands.add_parser("validate")
    validate.add_argument("path", type=Path)
    train = sub.add_parser("train-static")
    train.add_argument("dataset", type=Path)
    train.add_argument("output", type=Path)
    train.add_argument("--model-id", required=True)
    train.add_argument("--version", default="1.0.0")
    train.add_argument("--epochs", type=int, default=80)
    train_dynamic = sub.add_parser("train-dynamic")
    train_dynamic.add_argument("dataset", type=Path)
    train_dynamic.add_argument("output", type=Path)
    train_dynamic.add_argument("--model-id", required=True)
    train_dynamic.add_argument("--version", default="1.0.0")
    train_dynamic.add_argument("--epochs", type=int, default=80)
    train_ksl = sub.add_parser("train-ksl-baseline")
    train_ksl.add_argument("dataset", type=Path)
    train_ksl.add_argument("output", type=Path)
    train_ksl.add_argument("--model-id", required=True)
    train_ksl.add_argument("--version", default="1.0.0")
    train_ksl.add_argument("--epochs", type=int, default=80)
    args = parser.parse_args()
    if args.command == "doctor":
        raise SystemExit(doctor())
    if args.command == "datasets":
        result = validate_dataset(args.path)
        print(json.dumps(result.to_dict(), ensure_ascii=False, indent=2))
        raise SystemExit(0 if result.valid else 1)
    if args.command == "train-static":
        training_result = train_static_gesture_model(
            args.dataset,
            args.output,
            model_id=args.model_id,
            version=args.version,
            epochs=args.epochs,
        )
        print(json.dumps({"manifestPath": str(training_result.manifest_path.resolve())}, ensure_ascii=False, indent=2))
        return
    if args.command == "train-dynamic":
        dynamic_result = train_dynamic_gesture_model(
            args.dataset,
            args.output,
            model_id=args.model_id,
            version=args.version,
            epochs=args.epochs,
        )
        print(json.dumps({"manifestPath": str(dynamic_result.manifest_path.resolve())}, ensure_ascii=False, indent=2))
        return
    if args.command == "train-ksl-baseline":
        ksl_result = train_dynamic_gesture_model(
            args.dataset,
            args.output,
            model_id=args.model_id,
            version=args.version,
            epochs=args.epochs,
            task="SIGN_LANGUAGE_KSL",
        )
        print(json.dumps({"manifestPath": str(ksl_result.manifest_path.resolve())}, ensure_ascii=False, indent=2))
        return
    uvicorn.run("suha_server.main:app", host=args.host, port=args.port, reload=False)


if __name__ == "__main__":
    main()
