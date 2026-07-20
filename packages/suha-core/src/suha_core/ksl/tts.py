from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

VOICE_PREFERENCES = {"SYSTEM_KOREAN", "FEMALE_PREFERRED", "MALE_PREFERRED"}


@dataclass(slots=True)
class TtsSettings:
    voice_preference: str = "SYSTEM_KOREAN"
    rate: float = 1.0
    auto_play: bool = False
    confirm_before_playback: bool = True

    def to_dict(self) -> dict[str, Any]:
        return {
            "voicePreference": self.voice_preference,
            "rate": self.rate,
            "autoPlay": self.auto_play,
            "confirmBeforePlayback": self.confirm_before_playback,
        }


class KslTtsService:
    def __init__(self) -> None:
        self._settings: dict[str, TtsSettings] = {}
        self._last_utterance: dict[str, dict[str, Any]] = {}

    def settings(self, session_id: str) -> dict[str, Any]:
        return self._settings.setdefault(session_id, TtsSettings()).to_dict()

    def configure(
        self,
        session_id: str,
        *,
        voice_preference: str,
        rate: float,
        auto_play: bool,
        confirm_before_playback: bool,
    ) -> dict[str, Any]:
        if voice_preference not in VOICE_PREFERENCES:
            raise ValueError(f"Unsupported voice preference: {voice_preference}")
        if not 0.5 <= rate <= 2.0:
            raise ValueError("TTS rate must be between 0.5 and 2.0")
        settings = TtsSettings(voice_preference, rate, auto_play, confirm_before_playback)
        self._settings[session_id] = settings
        return settings.to_dict()

    def prepare(
        self,
        session_id: str,
        translation: dict[str, Any],
        *,
        mode: str,
        candidate_id: str | None = None,
    ) -> dict[str, Any]:
        if mode not in {"AUTO", "MANUAL"}:
            raise ValueError(f"Unsupported TTS playback mode: {mode}")
        settings = self._settings.setdefault(session_id, TtsSettings())
        if mode == "AUTO" and not settings.auto_play:
            raise ValueError("Automatic TTS playback is disabled for this session")
        if mode == "AUTO" and settings.confirm_before_playback and translation.get("status") not in {
            "CONFIRMED",
            "CORRECTED",
        }:
            raise ValueError("User confirmation is required before automatic TTS playback")
        text = self._select_text(translation, candidate_id)
        utterance = {
            "utteranceId": f"ksltts_{uuid4().hex}",
            "sessionId": session_id,
            "translationId": translation["translationId"],
            "text": text,
            "language": "ko-KR",
            "voicePreference": settings.voice_preference,
            "rate": settings.rate,
            "mode": mode,
            "replay": False,
            "replayCount": 0,
            "createdAt": datetime.now(UTC).isoformat(),
            "engine": "DEVICE_TTS",
            "networkRequired": False,
        }
        self._last_utterance[session_id] = utterance
        return dict(utterance)

    def replay(self, session_id: str) -> dict[str, Any]:
        try:
            previous = self._last_utterance[session_id]
        except KeyError as error:
            raise KeyError(f"TTS utterance not found for session: {session_id}") from error
        replayed = {
            **previous,
            "utteranceId": f"ksltts_{uuid4().hex}",
            "replay": True,
            "replayCount": int(previous["replayCount"]) + 1,
            "createdAt": datetime.now(UTC).isoformat(),
        }
        self._last_utterance[session_id] = replayed
        return dict(replayed)

    def clear(self, session_id: str) -> None:
        self._settings.pop(session_id, None)
        self._last_utterance.pop(session_id, None)

    @staticmethod
    def capabilities() -> dict[str, Any]:
        return {
            "engine": "DEVICE_TTS",
            "language": "ko-KR",
            "voicePreferences": sorted(VOICE_PREFERENCES),
            "minimumRate": 0.5,
            "maximumRate": 2.0,
            "offlineCapable": True,
            "audioStored": False,
        }

    @staticmethod
    def _select_text(translation: dict[str, Any], candidate_id: str | None) -> str:
        confirmation = translation.get("confirmation")
        if isinstance(confirmation, dict) and confirmation.get("selectedText"):
            return str(confirmation["selectedText"])
        candidates = translation.get("candidates", [])
        if candidate_id is not None:
            selected = next(
                (item for item in candidates if item.get("candidateId") == candidate_id),
                None,
            )
            if selected is None:
                raise ValueError("A valid candidateId is required for TTS playback")
            return str(selected["text"])
        if candidates:
            return str(candidates[0]["text"])
        raise ValueError("No Korean translation is available for TTS playback")
