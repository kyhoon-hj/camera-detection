from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml


class IntentMapper:
    def __init__(self, path: str | Path, profile: str = "default") -> None:
        with Path(path).open(encoding="utf-8") as handle:
            config = yaml.safe_load(handle)
        self.profiles: dict[str, dict[str, Any]] = config["profiles"]
        self.profile = profile

    def set_profile(self, profile: str) -> None:
        if profile not in self.profiles:
            raise ValueError(f"Unknown intent profile: {profile}")
        self.profile = profile

    def _mappings(self, profile: str) -> dict[str, dict[str, Any]]:
        current = self.profiles[profile]
        parent = current.get("inherits")
        inherited = self._mappings(parent) if parent else {}
        return {**inherited, **current.get("mappings", {})}

    def map(self, code: str, confidence: float, mode: str = "GENERIC_GESTURE") -> str:
        if mode != "GENERIC_GESTURE":
            return "NONE"
        mapping = self._mappings(self.profile).get(code)
        if mapping is None or confidence < float(mapping.get("min_confidence", 0.0)):
            return "NONE"
        return str(mapping["intent"])
