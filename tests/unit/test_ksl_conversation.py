import pytest
from suha_core.ksl import ConversationTracker


def test_conversation_tracks_speakers_idempotently_and_in_time_order() -> None:
    tracker = ConversationTracker(max_messages=3)
    first = tracker.append(
        "session",
        speaker="HEARING_USER",
        text="  어디가   불편하세요? ",
        source="STT",
        confidence=0.92,
        client_message_id="stt-one",
    )
    duplicate = tracker.append(
        "session",
        speaker="HEARING_USER",
        text="다른 텍스트",
        source="STT",
        client_message_id="stt-one",
    )
    tracker.append(
        "session",
        speaker="KSL_USER",
        text="배가 아프고 어지럽습니다.",
        source="KSL_TRANSLATION",
    )

    snapshot = tracker.snapshot("session")
    assert first == duplicate
    assert [item["speaker"] for item in snapshot["messages"]] == ["HEARING_USER", "KSL_USER"]
    assert snapshot["messages"][0]["text"] == "어디가 불편하세요?"
    assert snapshot["messageCount"] == 2


def test_conversation_is_bounded_validated_and_clearable() -> None:
    tracker = ConversationTracker(max_messages=2)
    for index in range(3):
        tracker.append(
            "session",
            speaker="HEARING_USER",
            text=f"문장 {index}",
            source="STT",
        )
    assert [item["text"] for item in tracker.snapshot("session")["messages"]] == ["문장 1", "문장 2"]
    assert tracker.clear("session")["messages"] == []
    with pytest.raises(ValueError, match="speaker"):
        tracker.append("session", speaker="UNKNOWN", text="문장", source="STT")
    with pytest.raises(ValueError, match="required"):
        tracker.append("session", speaker="HEARING_USER", text=" ", source="STT")
