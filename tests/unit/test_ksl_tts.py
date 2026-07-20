import pytest
from suha_core.ksl import KslTtsService


def _translation(status: str = "PENDING_USER_CONFIRMATION") -> dict[str, object]:
    return {
        "translationId": "translation-one",
        "status": status,
        "candidates": [
            {"candidateId": "candidate-1", "text": "병원 위치를 알려주세요."},
            {"candidateId": "candidate-2", "text": "병원에 가는 길을 알려주세요."},
        ],
        "confirmation": (
            {"selectedText": "병원 위치를 안내해 주세요."} if status == "CORRECTED" else None
        ),
    }


def test_tts_settings_manual_play_and_replay() -> None:
    service = KslTtsService()
    settings = service.configure(
        "session",
        voice_preference="FEMALE_PREFERRED",
        rate=0.8,
        auto_play=False,
        confirm_before_playback=True,
    )
    played = service.prepare(
        "session", _translation(), mode="MANUAL", candidate_id="candidate-2"
    )
    replayed = service.replay("session")

    assert settings["rate"] == 0.8
    assert played["text"] == "병원에 가는 길을 알려주세요."
    assert played["voicePreference"] == "FEMALE_PREFERRED"
    assert played["engine"] == "DEVICE_TTS"
    assert played["networkRequired"] is False
    assert replayed["replay"] is True
    assert replayed["replayCount"] == 1
    assert replayed["utteranceId"] != played["utteranceId"]


def test_automatic_tts_requires_setting_and_optional_confirmation() -> None:
    service = KslTtsService()
    with pytest.raises(ValueError, match="disabled"):
        service.prepare("session", _translation(), mode="AUTO")

    service.configure(
        "session",
        voice_preference="SYSTEM_KOREAN",
        rate=1.2,
        auto_play=True,
        confirm_before_playback=True,
    )
    with pytest.raises(ValueError, match="confirmation"):
        service.prepare("session", _translation(), mode="AUTO")
    assert service.prepare("session", _translation("CORRECTED"), mode="AUTO")["text"] == (
        "병원 위치를 안내해 주세요."
    )


def test_tts_validates_settings_and_clears_private_session_state() -> None:
    service = KslTtsService()
    with pytest.raises(ValueError, match="voice preference"):
        service.configure(
            "session",
            voice_preference="CLOUD_ONLY",
            rate=1.0,
            auto_play=False,
            confirm_before_playback=True,
        )
    with pytest.raises(ValueError, match="between"):
        service.configure(
            "session",
            voice_preference="SYSTEM_KOREAN",
            rate=2.1,
            auto_play=False,
            confirm_before_playback=True,
        )
    service.prepare("session", _translation(), mode="MANUAL")
    service.clear("session")
    with pytest.raises(KeyError, match="utterance not found"):
        service.replay("session")
