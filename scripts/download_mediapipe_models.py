from __future__ import annotations

import hashlib
import json
from pathlib import Path
from urllib.request import urlopen

MODELS = {
    "hand_landmarker.task": "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task",
    "pose_landmarker_lite.task": "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task",
    "face_landmarker.task": "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task",
}


def main() -> None:
    target = Path("models/mediapipe")
    target.mkdir(parents=True, exist_ok=True)
    manifest = []
    for name, url in MODELS.items():
        path = target / name
        digest = hashlib.sha256()
        with urlopen(url) as source, path.open("wb") as output:  # noqa: S310
            while chunk := source.read(1024 * 1024):
                output.write(chunk)
                digest.update(chunk)
        manifest.append(
            {
                "file": name,
                "url": url,
                "sha256": digest.hexdigest(),
                "license": "Apache-2.0",
            }
        )
    (target / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(json.dumps(manifest, indent=2))


if __name__ == "__main__":
    main()
