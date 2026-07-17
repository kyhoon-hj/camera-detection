from __future__ import annotations

import json
import time
from collections.abc import Callable, Iterator
from contextlib import AbstractContextManager
from typing import Any, Protocol

import httpx
from websockets.exceptions import WebSocketException
from websockets.sync.client import connect

from .errors import SuhaApiError, SuhaConnectionError, SuhaSchemaError, SuhaTimeoutError
from .models import CameraStatus, SuhaEvent


class WebSocketLike(Protocol):
    def send(self, message: str) -> None: ...

    def close(self) -> None: ...

    def __iter__(self) -> Iterator[str | bytes]: ...


ConnectFactory = Callable[[str, float], AbstractContextManager[WebSocketLike]]


def _connect(url: str, timeout: float) -> AbstractContextManager[WebSocketLike]:
    return connect(url, open_timeout=timeout, close_timeout=timeout)


class SuhaClient:
    def __init__(
        self,
        base_url: str = "http://127.0.0.1:8200",
        timeout: float = 10.0,
        *,
        transport: httpx.BaseTransport | None = None,
        connect_factory: ConnectFactory = _connect,
        sleep: Callable[[float], None] = time.sleep,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        self._http = httpx.Client(base_url=self.base_url, timeout=timeout, transport=transport)
        self._connect_factory = connect_factory
        self._sleep = sleep
        self._closed = False
        self._websocket: WebSocketLike | None = None

    def __enter__(self) -> SuhaClient:
        return self

    def __exit__(self, *_: object) -> None:
        self.close()

    def close(self) -> None:
        self._closed = True
        if self._websocket is not None:
            self._websocket.close()
        self._http.close()

    def cameras(self) -> list[CameraStatus]:
        payload = self._request("GET", "/v1/cameras")
        if not isinstance(payload, list):
            raise SuhaSchemaError("Camera response must be a list")
        if not all(isinstance(item, dict) for item in payload):
            raise SuhaSchemaError("Every camera response item must be an object")
        return [CameraStatus.from_dict(item) for item in payload]

    def start_camera(self, camera_id: str) -> CameraStatus:
        payload = self._request("POST", f"/v1/cameras/{camera_id}/start")
        if not isinstance(payload, dict):
            raise SuhaSchemaError("Camera response must be an object")
        return CameraStatus.from_dict(payload)

    def stop_camera(self, camera_id: str) -> CameraStatus:
        payload = self._request("POST", f"/v1/cameras/{camera_id}/stop")
        if not isinstance(payload, dict):
            raise SuhaSchemaError("Camera response must be an object")
        return CameraStatus.from_dict(payload)

    def events(
        self,
        categories: list[str] | None = None,
        camera_ids: list[str] | None = None,
        *,
        reconnect: bool = True,
        max_retries: int | None = None,
        initial_backoff: float = 0.25,
        max_backoff: float = 5.0,
    ) -> Iterator[SuhaEvent]:
        websocket_url = self.base_url.replace("http://", "ws://", 1).replace("https://", "wss://", 1)
        retries = 0
        while not self._closed:
            try:
                with self._connect_factory(f"{websocket_url}/v1/events/stream", self.timeout) as websocket:
                    self._websocket = websocket
                    websocket.send(
                        json.dumps({"action": "SUBSCRIBE", "categories": categories or [], "cameraIds": camera_ids or []})
                    )
                    retries = 0
                    for message in websocket:
                        try:
                            raw = json.loads(message)
                        except (json.JSONDecodeError, UnicodeDecodeError) as error:
                            raise SuhaSchemaError("Event payload is not valid JSON") from error
                        if not isinstance(raw, dict):
                            raise SuhaSchemaError("Event payload must be an object")
                        yield SuhaEvent.from_dict(raw)
                    self._websocket = None
                if not self._closed:
                    if not reconnect:
                        return
                    retries = self._retry(retries, max_retries, initial_backoff, max_backoff, RuntimeError("WebSocket closed"))
            except SuhaSchemaError:
                raise
            except TimeoutError as error:
                if not reconnect:
                    raise SuhaTimeoutError("WebSocket connection timed out") from error
                retries = self._retry(retries, max_retries, initial_backoff, max_backoff, error)
            except (OSError, RuntimeError, WebSocketException) as error:
                if not reconnect:
                    raise SuhaConnectionError(str(error)) from error
                retries = self._retry(retries, max_retries, initial_backoff, max_backoff, error)

    def _retry(self, retries: int, maximum: int | None, initial: float, maximum_backoff: float, error: Exception) -> int:
        next_retry = retries + 1
        if maximum is not None and next_retry > maximum:
            raise SuhaConnectionError(f"WebSocket reconnect limit exceeded: {error}") from error
        self._sleep(min(maximum_backoff, initial * (2**retries)))
        return next_retry

    def _request(self, method: str, path: str) -> Any:
        try:
            response = self._http.request(method, path)
        except httpx.TimeoutException as error:
            raise SuhaTimeoutError(f"{method} {path} timed out") from error
        except httpx.HTTPError as error:
            raise SuhaConnectionError(str(error)) from error
        if response.is_error:
            try:
                error_payload = response.json().get("error", response.json().get("detail", {}))
            except (json.JSONDecodeError, AttributeError):
                error_payload = {}
            if isinstance(error_payload, dict):
                message = str(error_payload.get("message", response.text or f"HTTP {response.status_code}"))
                code = str(error_payload["code"]) if error_payload.get("code") else None
                trace_id = str(error_payload["traceId"]) if error_payload.get("traceId") else None
            else:
                message, code, trace_id = str(error_payload), None, None
            raise SuhaApiError(response.status_code, message, code, trace_id)
        try:
            return response.json()
        except json.JSONDecodeError as error:
            raise SuhaSchemaError("Response is not valid JSON") from error
