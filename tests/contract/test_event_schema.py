from suha_core.domain import EventEnvelope


def test_event_envelope_has_public_camel_case_contract() -> None:
    event = EventEnvelope("cam", "session", "GESTURE_STATIC", "THUMB_UP", "HOLD", 0.9, 500, "CONFIRM")
    payload = event.to_dict()
    required = {
        "schemaVersion",
        "eventId",
        "traceId",
        "cameraId",
        "sessionId",
        "timestamp",
        "category",
        "eventCode",
        "phase",
        "intent",
        "confidence",
        "durationMs",
    }
    assert required <= payload.keys()
    assert payload["schemaVersion"] == "1.0"
