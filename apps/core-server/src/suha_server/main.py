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

from fastapi import FastAPI, HTTPException, Query, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response, StreamingResponse
from prometheus_client import CONTENT_TYPE_LATEST, generate_latest
from pydantic import BaseModel, Field
from suha_core import __version__
from suha_core.config import load_config
from suha_core.domain import EventEnvelope
from suha_core.ksl import (
    CORE_EXPRESSIONS,
    EXPRESSION_BY_CODE,
    ConversationTracker,
    CorrectionFeedbackQueue,
    GlossRegistry,
    KoreanTranslationService,
    KslOfflineRuntime,
    KslTtsService,
    ProfessionalDictionary,
    ProfessionalQaStore,
    collection_status,
)
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


class GlossCreateRequest(BaseModel):
    code: str = Field(min_length=2, max_length=64)
    gloss: str = Field(min_length=1, max_length=200)
    korean_text: str = Field(alias="koreanText", min_length=1, max_length=500)
    domains: list[str] = Field(min_length=1)
    aliases: list[str] = Field(default_factory=list)
    emergency: bool = False
    status: str = "DRAFT"
    actor: str = Field("local-admin", min_length=1, max_length=100)


class GlossUpdateRequest(BaseModel):
    gloss: str | None = Field(None, min_length=1, max_length=200)
    korean_text: str | None = Field(None, alias="koreanText", min_length=1, max_length=500)
    domains: list[str] | None = None
    aliases: list[str] | None = None
    emergency: bool | None = None
    status: str | None = None
    actor: str = Field("local-admin", min_length=1, max_length=100)


class TranslationConfirmationRequest(BaseModel):
    action: Literal["CONFIRM", "CORRECT", "REJECT"]
    candidate_id: str | None = Field(None, alias="candidateId", max_length=100)
    corrected_text: str | None = Field(None, alias="correctedText", max_length=1000)
    reason: Literal[
        "HANDSHAPE_MISRECOGNITION",
        "WORD_ORDER",
        "NON_MANUAL_MISSING",
        "WORD_MISSING",
        "CONTEXT_ERROR",
        "DIFFERENT_EXPRESSION",
        "OTHER",
    ] | None = None
    consent_to_improve: bool = Field(False, alias="consentToImprove")
    consent_id: str | None = Field(None, alias="consentId", max_length=200)


class TtsSettingsRequest(BaseModel):
    voice_preference: Literal["SYSTEM_KOREAN", "FEMALE_PREFERRED", "MALE_PREFERRED"] = Field(
        "SYSTEM_KOREAN", alias="voicePreference"
    )
    rate: float = Field(1.0, ge=0.5, le=2.0)
    auto_play: bool = Field(False, alias="autoPlay")
    confirm_before_playback: bool = Field(True, alias="confirmBeforePlayback")


class TtsPlaybackRequest(BaseModel):
    mode: Literal["AUTO", "MANUAL"] = "MANUAL"
    candidate_id: str | None = Field(None, alias="candidateId", max_length=100)


class ConversationMessageRequest(BaseModel):
    speaker: Literal["HEARING_USER", "KSL_USER"]
    text: str = Field(min_length=1, max_length=2000)
    source: Literal["STT", "KSL_TRANSLATION"]
    confidence: float | None = Field(None, ge=0, le=1)
    client_message_id: str | None = Field(None, alias="clientMessageId", max_length=200)


class TranslationDomainRequest(BaseModel):
    domain: Literal["general", "public", "parking", "medical", "disaster", "transport", "finance"]


class ExpertReviewRequest(BaseModel):
    reviewer_id: str = Field(alias="reviewerId", min_length=1, max_length=200)
    reviewer_role: Literal[
        "DEAF_SIGNER",
        "KSL_INTERPRETER",
        "KSL_EDUCATOR",
        "DOMAIN_EXPERT",
        "ACCESSIBILITY_UX_EXPERT",
    ] = Field(alias="reviewerRole")
    decision: Literal["APPROVE", "REJECT"]
    meaning_preservation: int = Field(alias="meaningPreservation", ge=1, le=5)
    korean_naturalness: int = Field(alias="koreanNaturalness", ge=1, le=5)
    misrecognition_risk: int = Field(alias="misrecognitionRisk", ge=1, le=5)
    notes: str = Field("", max_length=2000)


class OfflineSettingsRequest(BaseModel):
    mode: Literal["OFFLINE_ONLY", "AUTO", "ONLINE_ALLOWED"] = "OFFLINE_ONLY"
    allow_online_enhancement: bool = Field(False, alias="allowOnlineEnhancement")


class ProfessionalQaResultRequest(BaseModel):
    scenario_id: str = Field(alias="scenarioId", min_length=1, max_length=100)
    source: Literal["SYNTHETIC_REGRESSION", "HUMAN_REVIEWED_RECORDING"]
    expected_code: str = Field(alias="expectedCode", min_length=1, max_length=100)
    observed_candidates: list[str] = Field(alias="observedCandidates", max_length=3)
    confidence: float = Field(ge=0, le=1)
    latency_ms: int = Field(alias="latencyMs", ge=0, le=60000)
    variant_tags: dict[str, str] = Field(alias="variantTags")
    expert_accepted: bool = Field(alias="expertAccepted")
    notes: str = Field("", max_length=2000)


class GeminiAnalyzeRequest(BaseModel):
    camera_id: str = Field("laptop-front", alias="cameraId")
    question: str | None = Field(None, max_length=500)
    previous_interaction_id: str | None = Field(None, alias="previousInteractionId", max_length=200)
    reason: Literal["auto", "question"]


class AppState:
    def __init__(self, capture_root: str | Path = "data/recordings", gemini: GeminiVisionAnalyzer | None = None) -> None:
        capture_path = Path(capture_root)
        self.capture_root = capture_path
        self.runtime = CoreRuntime(event_store_path=capture_path.parent / "suha-events.db")
        self.captures = CaptureManager(capture_path)
        self.glossary = GlossRegistry(capture_path.parent / "ksl")
        self.professional_dictionary = ProfessionalDictionary()
        self.translations = KoreanTranslationService(self._lookup_ksl_term)
        self.tts = KslTtsService()
        self.conversations = ConversationTracker()
        self.feedback = CorrectionFeedbackQueue(capture_path.parent / "ksl")
        self.offline = KslOfflineRuntime()
        self.professional_qa = ProfessionalQaStore(capture_path.parent / "ksl")
        self.runtime.gloss_sequences.add_clear_listener(self.translations.clear)
        self.runtime.gloss_sequences.add_clear_listener(self.tts.clear)
        self.runtime.gloss_sequences.add_clear_listener(self.offline.clear)
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

    def _lookup_ksl_term(self, code: str) -> dict[str, Any]:
        try:
            return self.glossary.get(code)
        except KeyError:
            return self.professional_dictionary.get(code)

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
        allow_methods=["GET", "POST", "PUT", "DELETE"],
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
        status = await asyncio.to_thread(state.runtime.stop, camera_id)
        state.conversations.clear(str(status["sessionId"]))
        return status

    @app.post("/v1/cameras/{camera_id}/reconnect")
    async def reconnect_camera(camera_id: str) -> dict[str, Any]:
        status = await asyncio.to_thread(state.runtime.stop, camera_id)
        state.conversations.clear(str(status["sessionId"]))
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

    @app.get("/v1/cameras/{camera_id}/sign-input")
    async def sign_input(camera_id: str) -> dict[str, Any]:
        return state.runtime.sign_input_diagnostics(camera_id)

    @app.get("/v1/sign/expressions")
    async def sign_expressions(domain: str | None = None) -> dict[str, Any]:
        expressions = [item for item in CORE_EXPRESSIONS if domain is None or domain in item.domains]
        return {
            "catalogVersion": "ksl-core-20-v1",
            "items": [item.to_dict() for item in expressions],
            "disclaimer": "Expressions require Deaf signer and professional KSL interpreter review before model training.",
        }

    @app.get("/v1/sign/collection-status")
    async def sign_collection_status() -> dict[str, Any]:
        return collection_status(state.capture_root)

    @app.post("/v1/sign/capture/sessions")
    async def create_sign_capture(request: CaptureRequest) -> dict[str, Any]:
        code = request.label.upper()
        expression = EXPRESSION_BY_CODE.get(code)
        if expression is None:
            raise ValueError(f"Unknown KSL core expression: {code}")
        metadata = {
            **request.metadata,
            "catalogVersion": "ksl-core-20-v1",
            "reviewStatus": "PENDING",
            "dataPurpose": "KSL_CORE_20",
            "requiresExpertReview": True,
        }
        capture = state.captures.create(
            label=code,
            target_samples=request.target_samples,
            save_video=request.save_video,
            save_landmarks=True,
            consent_id=request.consent_id,
            camera_id=request.camera_id,
            dataset_id=request.dataset_id,
            tester_alias=request.tester_alias,
            metadata=metadata,
        )
        return {**capture.public(), "expression": expression.to_dict()}

    @app.get("/v1/sign/glossary")
    async def gloss_entries(domain: str | None = None, status: str | None = None) -> dict[str, Any]:
        return {
            "schemaVersion": "1.0",
            "items": state.glossary.list_entries(domain=domain, status=status),
        }

    @app.get("/v1/sign/glossary/history")
    async def gloss_history(limit: int = 100) -> dict[str, Any]:
        return {"items": state.glossary.history(limit)}

    @app.get("/v1/sign/glossary/{code}")
    async def gloss_entry(code: str) -> dict[str, Any]:
        return state.glossary.get(code)

    @app.get("/v1/sign/professional-domains")
    async def professional_domains() -> dict[str, Any]:
        return {"items": state.professional_dictionary.domains()}

    @app.get("/v1/sign/professional-dictionary")
    async def professional_dictionary(domain: str | None = None) -> dict[str, Any]:
        return {"domain": domain, "items": state.professional_dictionary.list_terms(domain)}

    @app.post("/v1/sign/glossary")
    async def register_gloss(request: GlossCreateRequest) -> dict[str, Any]:
        return state.glossary.register(
            code=request.code,
            gloss=request.gloss,
            korean_text=request.korean_text,
            domains=request.domains,
            aliases=request.aliases,
            emergency=request.emergency,
            status=request.status,
            actor=request.actor,
        )

    @app.put("/v1/sign/glossary/{code}")
    async def update_gloss(code: str, request: GlossUpdateRequest) -> dict[str, Any]:
        return state.glossary.update(
            code,
            gloss=request.gloss,
            korean_text=request.korean_text,
            domains=request.domains,
            aliases=request.aliases,
            emergency=request.emergency,
            status=request.status,
            actor=request.actor,
        )

    @app.get("/v1/sign/sequences/{session_id}")
    async def gloss_sequence(session_id: str) -> dict[str, Any]:
        return state.runtime.gloss_sequence(session_id)

    @app.post("/v1/sign/sequences/{session_id}/clear")
    async def clear_gloss_sequence(session_id: str) -> dict[str, Any]:
        return state.runtime.clear_gloss_sequence(session_id)

    @app.post("/v1/sign/translations/{session_id}")
    async def translate_gloss_sequence(session_id: str) -> dict[str, Any]:
        sequence = state.runtime.gloss_sequence(session_id)
        return {
            **state.translations.translate(session_id, sequence),
            **state.offline.translation_metadata(session_id),
        }

    @app.get("/v1/sign/translations/{session_id}")
    async def latest_translation(session_id: str) -> dict[str, Any]:
        state.runtime.gloss_sequence(session_id)
        return {
            **state.translations.latest(session_id),
            **state.offline.translation_metadata(session_id),
        }

    @app.get("/v1/sign/offline/capabilities")
    async def offline_capabilities() -> dict[str, Any]:
        return state.offline.capabilities()

    @app.get("/v1/sign/offline/package")
    async def offline_package() -> dict[str, Any]:
        return state.offline.package()

    @app.get("/v1/sign/offline/{session_id}/settings")
    async def offline_settings(session_id: str) -> dict[str, Any]:
        state.runtime.gloss_sequence(session_id)
        return state.offline.settings(session_id)

    @app.put("/v1/sign/offline/{session_id}/settings")
    async def configure_offline(
        session_id: str, request: OfflineSettingsRequest
    ) -> dict[str, Any]:
        state.runtime.gloss_sequence(session_id)
        return state.offline.configure(
            session_id,
            mode=request.mode,
            allow_online_enhancement=request.allow_online_enhancement,
        )

    @app.post("/v1/sign/translations/{session_id}/confirm")
    async def confirm_translation(
        session_id: str, request: TranslationConfirmationRequest
    ) -> dict[str, Any]:
        state.runtime.gloss_sequence(session_id)
        previous = state.translations.latest(session_id)
        if request.action == "CORRECT" and request.reason is None:
            raise ValueError("A correction reason is required when action is CORRECT")
        if request.consent_to_improve and not request.consent_id:
            raise ValueError("consentId is required when consentToImprove is true")
        result = state.translations.confirm(
            session_id,
            action=request.action,
            candidate_id=request.candidate_id,
            corrected_text=request.corrected_text,
            reason=request.reason,
            consent_to_improve=request.consent_to_improve,
        )
        if request.action == "CORRECT" and request.consent_to_improve:
            candidates = previous.get("candidates", [])
            original_text = str(candidates[0]["text"]) if candidates else ""
            confirmation = result["confirmation"]
            feedback = state.feedback.enqueue(
                session_id=session_id,
                translation_id=str(result["translationId"]),
                original_text=original_text,
                corrected_text=str(confirmation["selectedText"]),
                reason=str(request.reason),
                domain=str(result.get("domain", "general")),
                gloss_sequence=[str(item) for item in result.get("glossSequence", [])],
                consent_id=str(request.consent_id),
            )
            confirmation["improvementDataStored"] = True
            confirmation["feedbackId"] = feedback["feedbackId"]
            confirmation["feedbackStatus"] = feedback["status"]
            confirmation["trainingEligible"] = False
        return result

    @app.get("/v1/sign/translations/{session_id}/domain")
    async def translation_domain(session_id: str) -> dict[str, Any]:
        state.runtime.gloss_sequence(session_id)
        return state.translations.domain(session_id)

    @app.put("/v1/sign/translations/{session_id}/domain")
    async def set_translation_domain(
        session_id: str, request: TranslationDomainRequest
    ) -> dict[str, Any]:
        state.runtime.gloss_sequence(session_id)
        return state.translations.set_domain(session_id, request.domain)

    @app.get("/v1/sign/tts/capabilities")
    async def tts_capabilities() -> dict[str, Any]:
        return state.tts.capabilities()

    @app.get("/v1/sign/tts/{session_id}/settings")
    async def tts_settings(session_id: str) -> dict[str, Any]:
        state.runtime.gloss_sequence(session_id)
        return state.tts.settings(session_id)

    @app.put("/v1/sign/tts/{session_id}/settings")
    async def configure_tts(session_id: str, request: TtsSettingsRequest) -> dict[str, Any]:
        state.runtime.gloss_sequence(session_id)
        return state.tts.configure(
            session_id,
            voice_preference=request.voice_preference,
            rate=request.rate,
            auto_play=request.auto_play,
            confirm_before_playback=request.confirm_before_playback,
        )

    @app.post("/v1/sign/tts/{session_id}/play")
    async def play_tts(session_id: str, request: TtsPlaybackRequest) -> dict[str, Any]:
        state.runtime.gloss_sequence(session_id)
        translation = state.translations.latest(session_id)
        return state.tts.prepare(
            session_id,
            translation,
            mode=request.mode,
            candidate_id=request.candidate_id,
        )

    @app.post("/v1/sign/tts/{session_id}/replay")
    async def replay_tts(session_id: str) -> dict[str, Any]:
        state.runtime.gloss_sequence(session_id)
        return state.tts.replay(session_id)

    @app.get("/v1/sign/conversations/{session_id}")
    async def conversation(session_id: str) -> dict[str, Any]:
        state.runtime.gloss_sequence(session_id)
        return state.conversations.snapshot(session_id)

    @app.post("/v1/sign/conversations/{session_id}/messages")
    async def append_conversation_message(
        session_id: str, request: ConversationMessageRequest
    ) -> dict[str, Any]:
        state.runtime.gloss_sequence(session_id)
        return state.conversations.append(
            session_id,
            speaker=request.speaker,
            text=request.text,
            source=request.source,
            confidence=request.confidence,
            client_message_id=request.client_message_id,
        )

    @app.delete("/v1/sign/conversations/{session_id}")
    async def clear_conversation(session_id: str) -> dict[str, Any]:
        state.runtime.gloss_sequence(session_id)
        return state.conversations.clear(session_id)

    @app.get("/v1/sign/feedback")
    async def correction_feedback(
        session_id: str = Query(alias="sessionId"),
    ) -> dict[str, Any]:
        state.runtime.gloss_sequence(session_id)
        return {"items": state.feedback.list_entries(session_id)}

    @app.delete("/v1/sign/feedback/{feedback_id}")
    async def delete_correction_feedback(
        feedback_id: str, session_id: str = Query(alias="sessionId")
    ) -> dict[str, Any]:
        state.runtime.gloss_sequence(session_id)
        return state.feedback.delete(feedback_id, session_id=session_id)

    @app.delete("/v1/sign/feedback")
    async def clear_correction_feedback(
        session_id: str = Query(alias="sessionId"),
    ) -> dict[str, Any]:
        state.runtime.gloss_sequence(session_id)
        return state.feedback.clear(session_id=session_id)

    @app.get("/v1/admin/sign/reviews/summary")
    async def expert_review_summary() -> dict[str, Any]:
        return {**state.feedback.summary(), "authorization": "LOCAL_ADMIN_ONLY"}

    @app.get("/v1/admin/sign/training-candidates")
    async def approved_training_candidates() -> dict[str, Any]:
        items = state.feedback.training_candidates()
        return {
            "items": items,
            "count": len(items),
            "policy": "Only multi-role APPROVED feedback is training eligible.",
            "authorization": "LOCAL_ADMIN_ONLY",
        }

    @app.get("/v1/admin/sign/reviews")
    async def expert_reviews(
        status: str | None = None, domain: str | None = None
    ) -> dict[str, Any]:
        items = state.feedback.list_entries()
        filtered = [
            item
            for item in items
            if (status is None or item.get("status") == status)
            and (domain is None or item.get("domain") == domain)
        ]
        return {"items": filtered, "count": len(filtered), "authorization": "LOCAL_ADMIN_ONLY"}

    @app.get("/v1/admin/sign/reviews/{feedback_id}/history")
    async def expert_review_history(feedback_id: str) -> dict[str, Any]:
        return {"items": state.feedback.review_history(feedback_id)}

    @app.post("/v1/admin/sign/reviews/{feedback_id}")
    async def review_feedback(feedback_id: str, request: ExpertReviewRequest) -> dict[str, Any]:
        return state.feedback.review(
            feedback_id,
            reviewer_id=request.reviewer_id,
            reviewer_role=request.reviewer_role,
            decision=request.decision,
            meaning_preservation=request.meaning_preservation,
            korean_naturalness=request.korean_naturalness,
            misrecognition_risk=request.misrecognition_risk,
            notes=request.notes,
        )

    @app.get("/v1/admin/sign/qa/scenarios")
    async def professional_qa_scenarios() -> dict[str, Any]:
        items = state.professional_qa.scenarios()
        return {"items": items, "count": len(items), "authorization": "LOCAL_ADMIN_ONLY"}

    @app.get("/v1/admin/sign/qa/results")
    async def professional_qa_results(source: str | None = None) -> dict[str, Any]:
        items = state.professional_qa.results(source=source)
        return {"items": items, "count": len(items), "authorization": "LOCAL_ADMIN_ONLY"}

    @app.post("/v1/admin/sign/qa/results")
    async def record_professional_qa(request: ProfessionalQaResultRequest) -> dict[str, Any]:
        return state.professional_qa.record(
            scenario_id=request.scenario_id,
            source=request.source,
            expected_code=request.expected_code,
            observed_candidates=request.observed_candidates,
            confidence=request.confidence,
            latency_ms=request.latency_ms,
            variant_tags=request.variant_tags,
            expert_accepted=request.expert_accepted,
            notes=request.notes,
        )

    @app.get("/v1/admin/sign/qa/summary")
    async def professional_qa_summary() -> dict[str, Any]:
        return {**state.professional_qa.summary(), "authorization": "LOCAL_ADMIN_ONLY"}

    @app.delete("/v1/admin/sign/qa/results")
    async def clear_professional_qa() -> dict[str, int]:
        return state.professional_qa.clear()

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
