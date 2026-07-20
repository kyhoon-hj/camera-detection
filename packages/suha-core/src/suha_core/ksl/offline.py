from __future__ import annotations

from dataclasses import dataclass
from typing import Any

OFFLINE_PACKAGE_VERSION = "1.0.0"
OFFLINE_MODEL_VERSION = "ksl-rule-lite-1.0.0"
EMERGENCY_CODES = ("HELP_NEEDED", "AMBULANCE", "FIRE", "DANGER", "POLICE", "EXIT")
BASIC_SENTENCES = (
    "도와주세요.",
    "병원이 어디에 있는지 알려주세요.",
    "경찰을 불러주세요.",
    "구급차를 불러주세요.",
    "가장 가까운 비상구를 알려주세요.",
    "화재가 발생했습니다.",
    "위험합니다.",
    "감사합니다.",
    "네.",
    "아니요.",
)


@dataclass(frozen=True, slots=True)
class OfflineSettings:
    mode: str = "OFFLINE_ONLY"
    allow_online_enhancement: bool = False

    def to_dict(self) -> dict[str, Any]:
        return {
            "mode": self.mode,
            "allowOnlineEnhancement": self.allow_online_enhancement,
            "effectiveMode": "OFFLINE",
            "networkRequired": False,
        }


class KslOfflineRuntime:
    def __init__(self) -> None:
        self._settings: dict[str, OfflineSettings] = {}

    def capabilities(self) -> dict[str, Any]:
        return {
            "offlineReady": True,
            "defaultMode": "OFFLINE_ONLY",
            "networkRequired": False,
            "translationEngine": "DETERMINISTIC_LOCAL_RULES",
            "ttsEngine": "DEVICE_TTS",
            "lightweightModel": {
                "modelId": "ksl-rule-lite",
                "version": OFFLINE_MODEL_VERSION,
                "format": "BUILT_IN_RULES",
                "installed": True,
            },
            "packageVersion": OFFLINE_PACKAGE_VERSION,
            "emergencyExpressionCount": len(EMERGENCY_CODES),
            "basicSentenceCount": len(BASIC_SENTENCES),
            "supportedDomains": ["general", "public", "parking", "medical", "disaster"],
        }

    def package(self) -> dict[str, Any]:
        return {
            "packageId": "suha-ksl-offline-core",
            "version": OFFLINE_PACKAGE_VERSION,
            "status": "ACTIVE",
            "modelVersion": OFFLINE_MODEL_VERSION,
            "emergencyExpressions": list(EMERGENCY_CODES),
            "basicSentences": list(BASIC_SENTENCES),
            "updatePolicy": "MANUAL_EXPLICIT_CONSENT",
            "rollbackVersion": None,
        }

    def settings(self, session_id: str) -> dict[str, Any]:
        return self._settings.setdefault(session_id, OfflineSettings()).to_dict()

    def configure(
        self, session_id: str, *, mode: str, allow_online_enhancement: bool
    ) -> dict[str, Any]:
        if mode not in {"OFFLINE_ONLY", "AUTO", "ONLINE_ALLOWED"}:
            raise ValueError(f"Unsupported connectivity mode: {mode}")
        if mode == "OFFLINE_ONLY" and allow_online_enhancement:
            raise ValueError("Online enhancement cannot be enabled in OFFLINE_ONLY mode")
        settings = OfflineSettings(mode, allow_online_enhancement)
        self._settings[session_id] = settings
        return settings.to_dict()

    def translation_metadata(self, session_id: str) -> dict[str, Any]:
        settings = self._settings.setdefault(session_id, OfflineSettings())
        return {
            "processingMode": "OFFLINE",
            "networkUsed": False,
            "offlinePackageVersion": OFFLINE_PACKAGE_VERSION,
            "modelVersion": OFFLINE_MODEL_VERSION,
            "requestedConnectivityMode": settings.mode,
        }

    def clear(self, session_id: str) -> None:
        self._settings.pop(session_id, None)
