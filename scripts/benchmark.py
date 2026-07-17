from __future__ import annotations

import argparse
import json
import time

from suha_core.pipeline import CoreRuntime


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--duration", type=float, default=10)
    args = parser.parse_args()
    runtime = CoreRuntime()
    runtime.start("synthetic-front")
    time.sleep(args.duration)
    report = runtime.status("synthetic-front")
    runtime.shutdown()
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
