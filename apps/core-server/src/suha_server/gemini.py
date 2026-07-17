from __future__ import annotations

import base64
import json
import os
from typing import Any, Protocol

import httpx


class GeminiNotConfigured(RuntimeError):
    """Raised when Gemini is requested without a server-side API key."""


class GeminiUpstreamError(RuntimeError):
    """Raised when Gemini cannot return a usable analysis."""


class GeminiRateLimited(GeminiUpstreamError):
    def __init__(self, retry_after_seconds: int, limit_scope: str = "rate") -> None:
        super().__init__(f"Gemini returned HTTP 429 ({limit_scope} limit)")
        self.retry_after_seconds = retry_after_seconds
        self.limit_scope = limit_scope


class GeminiVisionAnalyzer(Protocol):
    @property
    def configured(self) -> bool: ...

    @property
    def model(self) -> str: ...

    async def analyze(
        self,
        image_jpeg: bytes,
        question: str | None = None,
        previous_interaction_id: str | None = None,
    ) -> dict[str, Any]: ...


class GeminiVisionClient:
    endpoint = "https://generativelanguage.googleapis.com/v1beta/interactions"

    def __init__(self, api_key: str | None, model: str = "gemini-3.5-flash", timeout_seconds: float = 45.0) -> None:
        self._api_key = (api_key or "").strip()
        self._model = model.strip() or "gemini-3.5-flash"
        self._timeout_seconds = timeout_seconds

    @classmethod
    def from_environment(cls) -> GeminiVisionClient:
        return cls(os.getenv("GEMINI_API_KEY"), os.getenv("GEMINI_MODEL", "gemini-3.5-flash"))

    @property
    def configured(self) -> bool:
        return bool(self._api_key)

    @property
    def model(self) -> str:
        return self._model

    async def analyze(
        self,
        image_jpeg: bytes,
        question: str | None = None,
        previous_interaction_id: str | None = None,
    ) -> dict[str, Any]:
        if not self.configured:
            raise GeminiNotConfigured("GEMINI_API_KEY is not configured on the server")
        if not image_jpeg:
            raise GeminiUpstreamError("The camera frame is empty")

        payload = build_interaction_payload(self.model, image_jpeg, question, previous_interaction_id)
        try:
            async with httpx.AsyncClient(timeout=self._timeout_seconds) as client:
                response = await client.post(
                    self.endpoint,
                    headers={"Content-Type": "application/json", "x-goog-api-key": self._api_key},
                    json=payload,
                )
            response.raise_for_status()
        except httpx.HTTPStatusError as error:
            if error.response.status_code == 429:
                retry_after, limit_scope = _rate_limit_details(error.response)
                raise GeminiRateLimited(retry_after, limit_scope) from error
            raise GeminiUpstreamError(f"Gemini returned HTTP {error.response.status_code}") from error
        except httpx.HTTPError as error:
            raise GeminiUpstreamError("Gemini could not be reached") from error

        try:
            result = parse_interaction_response(response.json())
        except (TypeError, ValueError, json.JSONDecodeError) as error:
            raise GeminiUpstreamError("Gemini returned an invalid structured response") from error
        result["model"] = self.model
        return result


def build_interaction_payload(
    model: str,
    image_jpeg: bytes,
    question: str | None = None,
    previous_interaction_id: str | None = None,
) -> dict[str, Any]:
    prompt = _focused_analysis_prompt(question)
    payload: dict[str, Any] = {
        "model": model,
        "input": [
            {
                "type": "image",
                "mime_type": "image/jpeg",
                "data": base64.b64encode(image_jpeg).decode("ascii"),
            },
            {"type": "text", "text": prompt},
        ],
        "response_format": {
            "type": "text",
            "mime_type": "application/json",
            "schema": {
                "type": "object",
                "properties": {
                    "speech": {"type": "string"},
                    "gesture": {"type": "string"},
                    "expression": {"type": "string"},
                    "shape": {"type": "string"},
                    "confidence": {"type": "number"},
                    "observations": {"type": "array", "items": {"type": "string"}},
                },
                "required": ["speech", "gesture", "expression", "shape", "confidence", "observations"],
            },
        },
    }
    if previous_interaction_id:
        payload["previous_interaction_id"] = previous_interaction_id
    return payload


def parse_interaction_response(payload: dict[str, Any]) -> dict[str, Any]:
    text = ""
    for step in payload.get("steps", []):
        if step.get("type") != "model_output":
            continue
        for block in step.get("content", []):
            if block.get("type") == "text" and isinstance(block.get("text"), str):
                text = block["text"]
    if not text:
        raise ValueError("No model output text")
    result = json.loads(text)
    if not isinstance(result, dict):
        raise TypeError("Structured response must be an object")
    expected = {"speech", "gesture", "expression", "shape", "confidence", "observations"}
    if not expected.issubset(result):
        raise ValueError("Structured response is missing required fields")
    result["interactionId"] = payload.get("id")
    return result


def _focused_analysis_prompt(question: str | None) -> str:
    scope = (
        "Analyze only the visible hand gesture, body action, shape made with fingers or hands, and facial expression. "
        "Do not identify the person or infer gender, age, ethnicity, occupation, health, emotion beyond the visible expression, or other personal attributes. "
        "Do not describe the background, location, clothing, appearance, or unrelated objects. "
        "Return gesture, expression, and shape as empty strings when they are absent or uncertain. "
        "Return confidence as a number from 0 to 1. Keep observations to at most three short pieces of evidence about the action or expression. "
    )
    if question:
        return (
            scope
            + f"The user asked in Korean: {question!r}. "
            "Answer only that question using what is visible in the current image. Put a concise natural Korean answer of one or two sentences in speech. "
            "Do not add unrelated scene details."
        )
    return (
        scope
        + "Only when an action, hand-made shape, or facial expression is clear, put a natural Korean announcement no longer than 30 characters in speech. "
        "Otherwise speech must be an empty string. For a hand-made triangle announce that a triangle was made; for a visible smile announce that the person is smiling. "
        "Do not invent motion from a single frame or repeat irrelevant scene descriptions."
    )


def _rate_limit_details(response: httpx.Response) -> tuple[int, str]:
    retry_after = 60
    header = response.headers.get("retry-after", "").strip()
    if header.isdigit():
        retry_after = int(header)
    message = ""
    try:
        error = response.json().get("error", {})
        message = str(error.get("message", ""))
        for detail in error.get("details", []):
            retry_delay = str(detail.get("retryDelay", ""))
            if retry_delay.endswith("s") and retry_delay[:-1].replace(".", "", 1).isdigit():
                retry_after = max(retry_after, int(float(retry_delay[:-1])) + 1)
    except (TypeError, ValueError, json.JSONDecodeError):
        pass
    limit_scope = "daily" if "PerDay" in message or "per day" in message.lower() else "rate"
    return min(max(retry_after, 1), 86400), limit_scope


def _legacy_analysis_prompt(question: str | None) -> str:
    privacy = (
        "사람의 신원은 추측하지 말고 민감한 속성도 추론하지 마세요. "
        "보이는 손, 몸동작, 손가락으로 만든 모양, 얼굴 표정만 설명하세요. "
        "gesture, expression, shape는 없거나 확실하지 않으면 빈 문자열로 반환하세요. "
        "confidence는 전체 판단의 확신도를 0과 1 사이 숫자로 반환하세요. "
    )
    if question:
        return (
            privacy
            + f"사용자의 질문은 다음과 같습니다: {question!r}. "
            "현재 이미지에서 확인할 수 있는 내용만 근거로 자연스러운 한국어 1~2문장으로 speech에 답하세요. "
            "관찰 근거는 observations에 짧게 적으세요."
        )
    return (
        privacy
        + "현재 동작이나 표정이 명확할 때만 speech에 30자 이내의 자연스러운 한국어 안내를 작성하세요. "
        "명확하지 않으면 speech는 빈 문자열이어야 합니다. "
        "예: 손가락으로 삼각형을 만들면 '손으로 세모를 만들었어요', 웃으면 '웃고 있어요'. "
        "카메라에 보인 장면을 과장하거나 이전 이미지의 상태를 지어내지 마세요."
    )
