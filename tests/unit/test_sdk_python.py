from __future__ import annotations

import json
from collections.abc import Iterator
from contextlib import AbstractContextManager
from typing import Any

import httpx
import pytest
from suha_sdk import SuhaApiError, SuhaClient, SuhaEvent, SuhaSchemaError, SuhaTimeoutError


def _event() -> dict[str, Any]:
    return {
        "schemaVersion": "1.0",
        "eventId": "evt_test",
        "traceId": "trc_test",
        "cameraId": "synthetic-front",
        "sessionId": "ses_test",
        "personId": None,
        "timestamp": "2026-07-16T00:00:00+00:00",
        "category": "GESTURE_DYNAMIC",
        "eventCode": "HAND_WAVE",
        "phase": "END",
        "intent": "WAKE_UP",
        "confidence": 0.9,
        "durationMs": 500,
        "source": {},
        "quality": {},
        "metadata": {},
    }


def test_python_sdk_typed_http_and_api_error() -> None:
    camera = {
        "cameraId": "synthetic-front",
        "running": False,
        "sessionId": "ses_test",
        "mode": "GENERIC_GESTURE",
        "profile": "default",
        "captureFps": 0,
        "inferenceFps": 0,
        "droppedFrames": 0,
        "error": None,
    }

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/v1/cameras":
            return httpx.Response(200, json=[camera])
        return httpx.Response(400, json={"error": {"code": "SUHA-TEST", "message": "bad request", "traceId": "trc_1"}})

    with SuhaClient(transport=httpx.MockTransport(handler)) as client:
        assert client.cameras()[0].camera_id == "synthetic-front"
        with pytest.raises(SuhaApiError) as captured:
            client.start_camera("missing")
        assert captured.value.code == "SUHA-TEST"


def test_python_sdk_timeout_and_schema_validation() -> None:
    def timeout(_: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("late")

    with SuhaClient(transport=httpx.MockTransport(timeout)) as client, pytest.raises(SuhaTimeoutError):
        client.cameras()
    invalid = _event()
    invalid["schemaVersion"] = "2.0"
    with pytest.raises(SuhaSchemaError):
        SuhaEvent.from_dict(invalid)


class FakeSocket(AbstractContextManager["FakeSocket"]):
    def __init__(self, messages: list[str]) -> None:
        self.messages = messages
        self.subscription = ""

    def __enter__(self) -> FakeSocket:
        return self

    def __exit__(self, *_: object) -> None:
        return None

    def send(self, message: str) -> None:
        self.subscription = message

    def close(self) -> None:
        return None

    def __iter__(self) -> Iterator[str | bytes]:
        return iter(self.messages)


def test_python_sdk_websocket_reconnects_and_returns_typed_event() -> None:
    calls = 0
    socket = FakeSocket([json.dumps(_event())])

    def connector(_: str, __: float) -> AbstractContextManager[FakeSocket]:
        nonlocal calls
        calls += 1
        if calls == 1:
            raise OSError("temporary disconnect")
        return socket

    delays: list[float] = []
    client = SuhaClient(connect_factory=connector, sleep=delays.append)
    event = next(client.events(categories=["GESTURE_DYNAMIC"], max_retries=2))
    client.close()
    assert event.event_code == "HAND_WAVE"
    assert calls == 2
    assert delays == [0.25]
    assert json.loads(socket.subscription)["categories"] == ["GESTURE_DYNAMIC"]
