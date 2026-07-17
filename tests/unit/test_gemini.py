from __future__ import annotations

import base64

from suha_server.gemini import build_interaction_payload, parse_interaction_response


def test_interaction_payload_keeps_credentials_out_of_the_body() -> None:
    payload = build_interaction_payload("gemini-3.5-flash", b"jpeg-bytes", "무슨 동작을 하고 있어?")

    assert payload["model"] == "gemini-3.5-flash"
    assert payload["input"][0] == {
        "type": "image",
        "mime_type": "image/jpeg",
        "data": base64.b64encode(b"jpeg-bytes").decode("ascii"),
    }
    assert "무슨 동작" in payload["input"][1]["text"]
    assert "api" not in " ".join(payload).lower()
    assert payload["response_format"]["mime_type"] == "application/json"
    assert "speech" in payload["response_format"]["schema"]["required"]


def test_parse_interaction_response_extracts_structured_model_output() -> None:
    result = parse_interaction_response(
        {
            "id": "int_test_123",
            "steps": [
                {
                    "type": "model_output",
                    "content": [
                        {
                            "type": "text",
                            "text": (
                                '{"speech":"웃고 있어요","gesture":"","expression":"SMILE",'
                                '"shape":"","confidence":0.94,"observations":["입꼬리가 올라감"]}'
                            ),
                        }
                    ],
                }
            ],
        }
    )

    assert result["speech"] == "웃고 있어요"
    assert result["expression"] == "SMILE"
    assert result["interactionId"] == "int_test_123"
