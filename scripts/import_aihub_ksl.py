from __future__ import annotations

import argparse
import json
from pathlib import Path

from suha_core.ksl import KslImportOptions, import_ksl_dataset, validate_ksl_source


def main() -> None:
    parser = argparse.ArgumentParser(description="Validate or import a user-downloaded Korean Sign Language dataset")
    parser.add_argument("--dataset-type", required=True, choices=["aihub-sign-video", "aihub-disaster-safety", "nikl-parallel"])
    parser.add_argument("--source", required=True, type=Path)
    parser.add_argument("--target", type=Path)
    parser.add_argument("--validate-only", action="store_true")
    parser.add_argument("--extract-landmarks", action="store_true")
    parser.add_argument("--anonymize-metadata", action="store_true")
    parser.add_argument("--license-confirmed", action="store_true")
    parser.add_argument("--license-reference", default="USER_CONFIRMED_SOURCE_TERMS")
    args = parser.parse_args()
    if args.validate_only:
        result, _ = validate_ksl_source(args.dataset_type, args.source)
    else:
        if args.target is None:
            parser.error("--target is required unless --validate-only is used")
        result = import_ksl_dataset(
            KslImportOptions(
                args.dataset_type,
                args.source,
                args.target,
                args.license_confirmed,
                args.anonymize_metadata,
                args.extract_landmarks,
                args.license_reference,
            )
        )
    print(json.dumps(result.to_dict(), ensure_ascii=False, indent=2))
    raise SystemExit(0 if result.valid else 1)


if __name__ == "__main__":
    main()
