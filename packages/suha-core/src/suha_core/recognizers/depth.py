from __future__ import annotations

from typing import Any, Protocol

from suha_core.domain import FeatureFrame, FramePacket, RecognitionCandidate


class DepthRecognizerPlugin(Protocol):
    plugin_id: str
    plugin_version: str

    def warmup(self) -> None: ...
    def process(self, frame: FramePacket, features: FeatureFrame) -> list[RecognitionCandidate]: ...
    def reset(self, session_id: str | None = None) -> None: ...
    def health(self) -> dict[str, Any]: ...
