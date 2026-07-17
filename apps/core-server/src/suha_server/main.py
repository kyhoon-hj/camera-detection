from __future__ import annotations

import asyncio
import json
import math
import time
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, Literal
from uuid import uuid4

from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response, StreamingResponse
from prometheus_client import CONTENT_TYPE_LATEST, generate_latest
from pydantic import BaseModel, Field
from suha_core import __version__
from suha_core.config import load_config
from suha_core.domain import EventEnvelope
from suha_core.models import ModelRegistry
from suha_core.pipeline import CoreRuntime
from suha_core.recording import CaptureManager

from suha_server.gemini import GeminiNotConfigured, GeminiRateLimited, GeminiUpstreamError, GeminiVisionAnalyzer, GeminiVisionClient


class ModeRequest(BaseModel):
    mode: str
    profile: str = "default"


class CameraRegistration(BaseModel):
    camera_id: str = Field(alias="cameraId")
    adapter: str
    source: int | str = 0
    width: int = 1280
    height: int = 720
    mirror: bool = True


class CaptureRequest(BaseModel):
    label: str
    target_samples: int = Field(alias="targetSamples", ge=1, le=1000)
    save_video: bool = Field(False, alias="saveVideo")
    save_landmarks: bool = Field(True, alias="saveLandmarks")
    consent_id: str | None = Field(None, alias="consentId")
    camera_id: str = Field("synthetic-front", alias="cameraId")
    dataset_id: str = Field("local-captures-v1", alias="datasetId")
    tester_alias: str = Field("anonymous", alias="testerAlias")
    metadata: dict[str, Any] = Field(default_factory=dict)


class ModelRegistration(BaseModel):
    manifest_path: str = Field(alias="manifestPath")


class ModelQuarantine(BaseModel):
    reason: str = Field(min_length=1, max_length=500)


class GeminiAnalyzeRequest(BaseModel):
    camera_id: str = Field("laptop-front", alias="cameraId")
    question: str | None = Field(None, max_length=500)
    previous_interaction_id: str | None = Field(None, alias="previousInteractionId", max_length=200)
    reason: Literal["auto", "question"]


class AppState:
    def __init__(self, capture_root: str | Path = "data/recordings", gemini: GeminiVisionAnalyzer | None = None) -> None:
        capture_path = Path(capture_root)
        self.runtime = CoreRuntime(event_store_path=capture_path.parent / "suha-events.db")
        self.captures = CaptureManager(capture_path)
        self.models = ModelRegistry(capture_path.parent / "models" / "registry", self.runtime.set_model, self._model_changed)
        self.gemini = gemini or GeminiVisionClient.from_environment()
        self.gemini_lock = asyncio.Lock()
        self.gemini_auto_interval_seconds = 60
        self.gemini_last_auto_at = 0.0
        self.gemini_cooldown_until = 0.0
        self.gemini_api_requests = 0
        self.gemini_upstream_requests = 0
        self.gemini_successes = 0
        self.gemini_rate_limits = 0

    def _model_changed(self, model_id: str, previous: str | None) -> None:
        self.runtime.events.publish(
            EventEnvelope(
                "system",
                "model-registry",
                "MODEL",
                "MODEL_ACTIVATED",
                "END",
                1.0,
                0,
                metadata={"modelId": model_id, "previousModelId": previous},
            )
        )


def create_app(capture_root: str | Path = "data/recordings", gemini: GeminiVisionAnalyzer | None = None) -> FastAPI:
    state = AppState(capture_root, gemini)

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        state.runtime.events.bind_loop(asyncio.get_running_loop())
        yield
        state.runtime.shutdown()

    app = FastAPI(title="SuhaAI Core", version=__version__, lifespan=lifespan)
    app.state.suha = state
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://127.0.0.1:5173", "http://localhost:5173"],
        allow_methods=["GET", "POST", "PUT"],
        allow_headers=["*"],
    )

    @app.exception_handler(KeyError)
    async def key_error(_: Request, error: KeyError) -> JSONResponse:
        return _error(404, "SUHA-CAMERA-001", str(error))

    @app.exception_handler(ValueError)
    async def value_error(_: Request, error: ValueError) -> JSONResponse:
        return _error(400, "SUHA-API-003", str(error))

    @app.get("/v1/health")
    async def health() -> dict[str, Any]:
        return {"status": "ok", "version": __version__}

    @app.get("/v1/ready")
    async def ready() -> dict[str, Any]:
        return {"ready": True, "cameras": len(state.runtime.cameras)}

    @app.get("/v1/version")
    async def version() -> dict[str, str]:
        return {"name": "suha-ai-core", "version": __version__, "schemaVersion": "1.0"}

    @app.get("/v1/config/effective")
    async def effective_config() -> dict[str, Any]:
        return load_config()

    @app.get("/v1/metrics")
    async def metrics() -> Response:
        return Response(generate_latest(), media_type=CONTENT_TYPE_LATEST)

    @app.get("/v1/cameras")
    async def cameras() -> list[dict[str, Any]]:
        return state.runtime.list_cameras()

    @app.get("/v1/capabilities")
    async def capabilities() -> dict[str, Any]:
        return {item["cameraId"]: item["capabilities"] for item in state.runtime.list_cameras()}

    @app.get("/v1/cameras/{camera_id}")
    async def camera(camera_id: str) -> dict[str, Any]:
        return state.runtime.status(camera_id)

    @app.get("/v1/cameras/{camera_id}/capabilities")
    async def camera_capabilities(camera_id: str) -> dict[str, Any]:
        status = state.runtime.status(camera_id)
        return {"cameraId": camera_id, "capabilities": status["capabilities"], "calibration": status["calibration"]}

    @app.post("/v1/cameras/{camera_id}/start")
    async def start_camera(camera_id: str) -> dict[str, Any]:
        try:
            return await asyncio.to_thread(state.runtime.start, camera_id)
        except RuntimeError as error:
            raise HTTPException(status_code=503, detail=str(error)) from error

    @app.post("/v1/cameras/{camera_id}/stop")
    async def stop_camera(camera_id: str) -> dict[str, Any]:
        return await asyncio.to_thread(state.runtime.stop, camera_id)

    @app.post("/v1/cameras/{camera_id}/reconnect")
    async def reconnect_camera(camera_id: str) -> dict[str, Any]:
        await asyncio.to_thread(state.runtime.stop, camera_id)
        return await asyncio.to_thread(state.runtime.start, camera_id)

    @app.get("/v1/cameras/{camera_id}/snapshot")
    async def snapshot(camera_id: str) -> Response:
        image = state.runtime.snapshot_jpeg(camera_id)
        if image is None:
            raise HTTPException(status_code=409, detail="Camera has no frame yet")
        return Response(image, media_type="image/jpeg")

    @app.get("/v1/cameras/{camera_id}/stream.mjpeg")
    async def mjpeg(camera_id: str) -> StreamingResponse:
        async def frames() -> AsyncIterator[bytes]:
            while True:
                image = state.runtime.snapshot_jpeg(camera_id)
                if image:
                    yield b"--frame\r\nContent-Type: image/jpeg\r\n\r\n" + image + b"\r\n"
                await asyncio.sleep(1 / 15)

        return StreamingResponse(frames(), media_type="multipart/x-mixed-replace; boundary=frame")

    @app.get("/v1/cameras/{camera_id}/diagnostics")
    async def diagnostics(camera_id: str) -> dict[str, Any]:
        return state.runtime.diagnostics(camera_id)

    @app.post("/v1/cameras/{camera_id}/posture/recalibrate")
    async def recalibrate_posture(camera_id: str) -> dict[str, object]:
        return state.runtime.recalibrate_posture(camera_id)

    @app.get("/v1/ai/gemini/status")
    async def gemini_status() -> dict[str, Any]:
        now = time.monotonic()
        return {
            "configured": state.gemini.configured,
            "model": state.gemini.model,
            "privacy": "A camera frame is sent to Google only while Gemini voice guidance is enabled or for a voice question.",
            "usage": {
                "apiRequests": state.gemini_api_requests,
                "upstreamRequests": state.gemini_upstream_requests,
                "successes": state.gemini_successes,
                "rateLimits": state.gemini_rate_limits,
                "cooldownSeconds": max(0, math.ceil(state.gemini_cooldown_until - now)),
                "autoMinimumIntervalSeconds": state.gemini_auto_interval_seconds,
            },
        }

    @app.post("/v1/ai/gemini/analyze")
    async def gemini_analyze(request: GeminiAnalyzeRequest) -> Any:
        state.gemini_api_requests += 1
        if not state.gemini.configured:
            return _error(503, "SUHA-AI-001", "GEMINI_API_KEY is not configured on the server")
        if request.reason == "question" and not request.question:
            return _error(400, "SUHA-AI-003", "A voice question requires question text")
        if request.reason == "auto" and request.question:
            return _error(400, "SUHA-AI-003", "Automatic analysis must not include a question")
        image = state.runtime.snapshot_jpeg(request.camera_id, overlay=False)
        if image is None:
            return _error(409, "SUHA-CAMERA-002", "Camera has no frame yet")
        async with state.gemini_lock:
            now = time.monotonic()
            if now < state.gemini_cooldown_until:
                cooldown_retry_after = math.ceil(state.gemini_cooldown_until - now)
                return _error(429, "SUHA-AI-005", f"Gemini HTTP 429 cooldown is active; retry after {cooldown_retry_after} seconds")
            if request.reason == "auto" and state.gemini_last_auto_at:
                auto_retry_after = state.gemini_auto_interval_seconds - (now - state.gemini_last_auto_at)
                if auto_retry_after > 0:
                    return _error(429, "SUHA-AI-004", f"Automatic Gemini analysis is limited to one request every 60 seconds; retry after {math.ceil(auto_retry_after)} seconds")
            if request.reason == "auto":
                state.gemini_last_auto_at = now
            state.gemini_upstream_requests += 1
            try:
                result = await state.gemini.analyze(image, request.question, request.previous_interaction_id)
                state.gemini_successes += 1
                return result
            except GeminiRateLimited as error:
                state.gemini_rate_limits += 1
                state.gemini_cooldown_until = time.monotonic() + error.retry_after_seconds
                return _error(429, "SUHA-AI-005", f"Gemini HTTP 429 {error.limit_scope} limit; retry after {error.retry_after_seconds} seconds")
            except GeminiNotConfigured as error:
                return _error(503, "SUHA-AI-001", str(error))
            except GeminiUpstreamError as error:
                return _error(502, "SUHA-AI-002", str(error))

    @app.post("/v1/sessions")
    async def create_session() -> dict[str, str]:
        return {"sessionId": f"ses_{uuid4().hex}", "mode": "GENERIC_GESTURE"}

    @app.get("/v1/sessions/{session_id}")
    async def get_session(session_id: str) -> dict[str, Any]:
        matches = [item for item in state.runtime.list_cameras() if item["sessionId"] == session_id]
        if not matches:
            raise HTTPException(status_code=404, detail="Session not found")
        return matches[0]

    @app.post("/v1/sessions/{session_id}/end")
    async def end_session(session_id: str) -> dict[str, bool]:
        for camera_state in state.runtime.list_cameras():
            if camera_state["sessionId"] == session_id and camera_state["running"]:
                await asyncio.to_thread(state.runtime.stop, camera_state["cameraId"])
                return {"ended": True}
        return {"ended": False}

    @app.put("/v1/sessions/{session_id}/mode")
    async def set_mode(session_id: str, request: ModeRequest) -> dict[str, Any]:
        for camera_state in state.runtime.list_cameras():
            if camera_state["sessionId"] == session_id:
                return state.runtime.set_mode(camera_state["cameraId"], request.mode, request.profile)
        raise HTTPException(status_code=404, detail="Session not found")

    @app.get("/v1/events/latest")
    async def latest_events(limit: int = 50) -> list[dict[str, Any]]:
        return [event.to_dict() for event in list(state.runtime.events.history)[-limit:]]

    @app.get("/v1/events")
    async def events(category: str | None = None, limit: int = 100) -> list[dict[str, Any]]:
        values = list(state.runtime.events.history)
        if category:
            values = [event for event in values if event.category == category]
        return [event.to_dict() for event in values[-limit:]]

    @app.websocket("/v1/events/stream")
    async def event_stream(websocket: WebSocket) -> None:
        await websocket.accept()
        queue = state.runtime.events.subscribe()
        categories: set[str] = set()
        camera_ids: set[str] = set()
        try:
            try:
                message = await asyncio.wait_for(websocket.receive_json(), timeout=0.5)
                categories = set(message.get("categories", []))
                camera_ids = set(message.get("cameraIds", []))
            except TimeoutError:
                pass
            while True:
                event = await queue.get()
                if categories and event.category not in categories:
                    continue
                if camera_ids and event.camera_id not in camera_ids:
                    continue
                await websocket.send_json(event.to_dict())
        except WebSocketDisconnect:
            pass
        finally:
            state.runtime.events.unsubscribe(queue)

    @app.post("/v1/capture/sessions")
    async def create_capture(request: CaptureRequest) -> dict[str, Any]:
        try:
            capture = state.captures.create(
                label=request.label,
                target_samples=request.target_samples,
                save_video=request.save_video,
                save_landmarks=request.save_landmarks,
                consent_id=request.consent_id,
                camera_id=request.camera_id,
                dataset_id=request.dataset_id,
                tester_alias=request.tester_alias,
                metadata=request.metadata,
            )
        except ValueError as error:
            raise HTTPException(status_code=400, detail=str(error)) from error
        return capture.public()

    @app.post("/v1/capture/sessions/{capture_id}/start")
    async def start_capture(capture_id: str) -> dict[str, Any]:
        capture = state.captures.get(capture_id)
        camera_runtime = state.runtime.cameras[capture.camera_id]
        if camera_runtime.last_features is None:
            raise HTTPException(status_code=409, detail="No landmarks available")
        state.runtime.set_mode(capture.camera_id, "DATA_CAPTURE")
        return state.captures.start(capture_id).public()

    @app.post("/v1/capture/sessions/{capture_id}/mark")
    async def mark_capture(capture_id: str) -> dict[str, Any]:
        capture = state.captures.get(capture_id)
        camera_runtime = state.runtime.cameras[capture.camera_id]
        if camera_runtime.last_features is None:
            raise HTTPException(status_code=409, detail="No landmarks available")
        try:
            updated = state.captures.mark(capture_id, camera_runtime.last_features, camera_runtime.last_frame)
        except ValueError as error:
            raise HTTPException(status_code=409, detail=str(error)) from error
        if updated.status == "COMPLETE":
            state.runtime.set_mode(capture.camera_id, "GENERIC_GESTURE")
        return updated.public()

    @app.post("/v1/capture/sessions/{capture_id}/stop")
    async def stop_capture(capture_id: str) -> dict[str, Any]:
        capture = state.captures.stop(capture_id)
        state.runtime.set_mode(capture.camera_id, "GENERIC_GESTURE")
        return capture.public()

    @app.get("/v1/capture/sessions/{capture_id}")
    async def get_capture(capture_id: str) -> dict[str, Any]:
        return state.captures.get(capture_id).public()

    @app.get("/v1/models")
    async def models() -> list[dict[str, Any]]:
        built_in_status = "ACTIVE" if state.runtime.custom_static is None else "COMBINED"
        return [{"modelId": "landmark-rule-static", "version": "0.1.0", "status": built_in_status}, *state.models.list()]

    @app.get("/v1/models/runtime/providers")
    async def model_runtime_providers() -> dict[str, Any]:
        return state.models.providers()

    @app.get("/v1/models/{model_id}")
    async def get_model(model_id: str) -> dict[str, Any]:
        try:
            return state.models.get(model_id)
        except KeyError as error:
            raise HTTPException(status_code=404, detail=str(error)) from error

    @app.post("/v1/models")
    async def register_model(request: ModelRegistration) -> dict[str, Any]:
        try:
            return state.models.register(request.manifest_path)
        except (OSError, ValueError, KeyError, json.JSONDecodeError) as error:
            raise HTTPException(status_code=400, detail=str(error)) from error

    @app.post("/v1/models/{model_id}/validate")
    async def validate_model(model_id: str) -> dict[str, Any]:
        try:
            return await asyncio.to_thread(state.models.validate, model_id)
        except (OSError, ValueError, KeyError) as error:
            raise HTTPException(status_code=400, detail=str(error)) from error

    @app.post("/v1/models/{model_id}/activate")
    async def activate_model(model_id: str) -> dict[str, Any]:
        try:
            return await asyncio.to_thread(state.models.activate, model_id)
        except (OSError, ValueError, KeyError) as error:
            raise HTTPException(status_code=400, detail=str(error)) from error

    @app.post("/v1/models/{model_id}/quarantine")
    async def quarantine_model(model_id: str, request: ModelQuarantine) -> dict[str, Any]:
        try:
            return state.models.quarantine(model_id, request.reason)
        except (ValueError, KeyError) as error:
            raise HTTPException(status_code=400, detail=str(error)) from error

    @app.post("/v1/models/rollback")
    async def rollback_model() -> dict[str, Any]:
        return await asyncio.to_thread(state.models.rollback)

    return app


def _error(status: int, code: str, message: str) -> JSONResponse:
    return JSONResponse(
        status_code=status,
        content={"error": {"code": code, "message": message, "traceId": f"trc_{uuid4().hex}"}},
    )


app = create_app()
