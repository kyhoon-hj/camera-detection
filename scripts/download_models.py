from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from urllib.request import urlopen


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("url")
    parser.add_argument("target", type=Path)
    parser.add_argument("--sha256", required=True)
    args = parser.parse_args()
    args.target.parent.mkdir(parents=True, exist_ok=True)
    digest = hashlib.sha256()
    with urlopen(args.url) as source, args.target.open("wb") as target:  # noqa: S310
        while chunk := source.read(1024 * 1024):
            target.write(chunk)
            digest.update(chunk)
    if digest.hexdigest() != args.sha256.lower():
        args.target.unlink(missing_ok=True)
        raise SystemExit("SUHA-MODEL-002 MODEL_CHECKSUM_FAILED")
    print(json.dumps({"file": str(args.target), "sha256": digest.hexdigest(), "source": args.url}))


if __name__ == "__main__":
    main()
