from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

SPEAKERS = {"HEARING_USER", "KSL_USER"}
MESSAGE_SOURCES = {"STT", "KSL_TRANSLATION"}


@dataclass(frozen=True, slots=True)
class ConversationMessage:
    message_id: str
    speaker: str
    text: str
    source: str
    timestamp: str
    confidence: float | None = None
    client_message_id: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "messageId": self.message_id,
            "speaker": self.speaker,
            "text": self.text,
            "source": self.source,
            "timestamp": self.timestamp,
            "confidence": self.confidence,
            "clientMessageId": self.client_message_id,
        }


@dataclass(slots=True)
class ConversationTracker:
    max_messages: int = 100
    _messages: dict[str, list[ConversationMessage]] = field(default_factory=dict)

    def append(
        self,
        session_id: str,
        *,
        speaker: str,
        text: str,
        source: str,
        confidence: float | None = None,
        client_message_id: str | None = None,
    ) -> dict[str, Any]:
        if speaker not in SPEAKERS:
            raise ValueError(f"Unsupported conversation speaker: {speaker}")
        if source not in MESSAGE_SOURCES:
            raise ValueError(f"Unsupported conversation source: {source}")
        normalized = " ".join(text.split())
        if not normalized:
            raise ValueError("Conversation text is required")
        if confidence is not None and not 0 <= confidence <= 1:
            raise ValueError("Conversation confidence must be between 0 and 1")
        messages = self._messages.setdefault(session_id, [])
        if client_message_id:
            existing = next(
                (item for item in messages if item.client_message_id == client_message_id),
                None,
            )
            if existing is not None:
                return existing.to_dict()
        message = ConversationMessage(
            f"kslmsg_{uuid4().hex}",
            speaker,
            normalized,
            source,
            datetime.now(UTC).isoformat(),
            confidence,
            client_message_id,
        )
        messages.append(message)
        if len(messages) > self.max_messages:
            del messages[: len(messages) - self.max_messages]
        return message.to_dict()

    def snapshot(self, session_id: str) -> dict[str, Any]:
        messages = self._messages.get(session_id, [])
        return {
            "sessionId": session_id,
            "messages": [message.to_dict() for message in messages],
            "messageCount": len(messages),
            "privacy": "Conversation text remains in memory until the session is stopped or deleted.",
        }

    def clear(self, session_id: str) -> dict[str, Any]:
        self._messages.pop(session_id, None)
        return self.snapshot(session_id)
