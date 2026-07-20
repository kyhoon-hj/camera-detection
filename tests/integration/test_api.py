import json
import shutil
import time
from pathlib import Path
from typing import Any

from fastapi.testclient import TestClient
from suha_core.domain import RecognitionCandidate
from suha_core.models.training import train_static_gesture_model
from suha_sdk import CameraStatus
from suha_server.main import create_app

from tests.unit.test_static_training import build_training_dataset


class FakeGeminiAnalyzer:
    def __init__(self, configured: bool = True) -> None:
        self.configured = configured
        self.model = "gemini-test"
        self.received_image = b""
        self.received_question: str | None = None
        self.call_count = 0

    async def analyze(
        self,
        image_jpeg: bytes,
        question: str | None = None,
        previous_interaction_id: str | None = None,
    ) -> dict[str, Any]:
        self.call_count += 1
        self.received_image = image_jpeg
        self.received_question = question
        return {
            "speech": "손으로 세모를 만들었어요",
            "gesture": "HANDS_TOGETHER",
            "expression": "",
            "shape": "TRIANGLE",
            "confidence": 0.91,
            "observations": ["세 손가락 선이 삼각형처럼 연결됨"],
            "interactionId": previous_interaction_id or "int_test",
            "model": self.model,
        }


class FakeKslRecognizer:
    def __init__(self) -> None:
        self.calls = 0

    def process(self, _: Any) -> list[Any]:
        self.calls += 1
        return []

    def reset(self, _: str) -> None:
        return


def test_health_and_camera_lifecycle() -> None:
    with TestClient(create_app()) as client:
        assert client.get("/v1/health").json()["status"] == "ok"
        assert CameraStatus.from_dict(client.get("/v1/cameras").json()[0]).camera_id == "synthetic-front"
        started = client.post("/v1/cameras/synthetic-front/start")
        assert started.status_code == 200
        assert started.json()["running"] is True
        stopped = client.post("/v1/cameras/synthetic-front/stop")
        assert stopped.status_code == 200
        assert stopped.json()["running"] is False


def test_camera_capabilities_expose_rgb_and_mock_depth() -> None:
    with TestClient(create_app()) as client:
        all_capabilities = client.get("/v1/capabilities")
        assert all_capabilities.status_code == 200
        assert all_capabilities.json()["synthetic-front"]["depth"] is False
        response = client.get("/v1/cameras/mock-depth-front/capabilities")
        assert response.status_code == 200
        payload = response.json()
        assert payload["capabilities"]["depth"] is True
        assert payload["capabilities"]["calibration"] is True
        assert payload["calibration"]["depthScaleMeters"] == 0.001


def test_synthetic_diagnostics_expose_normalized_index_pointer() -> None:
    with TestClient(create_app()) as client:
        assert client.post("/v1/cameras/synthetic-front/start").status_code == 200
        deadline = time.monotonic() + 2
        pointer = None
        while pointer is None and time.monotonic() < deadline:
            pointer = client.get("/v1/cameras/synthetic-front/diagnostics").json()["pointer"]
            time.sleep(0.02)
        assert pointer is not None
        assert 0 <= pointer["x"] <= 1
        assert 0 <= pointer["y"] <= 1
        assert pointer["handedness"] == "RIGHT"
        assert pointer["timestampMs"] > 0


def test_gemini_status_and_camera_analysis_use_a_raw_camera_frame(tmp_path: Path) -> None:
    gemini = FakeGeminiAnalyzer()
    with TestClient(create_app(tmp_path, gemini=gemini)) as client:
        status = client.get("/v1/ai/gemini/status")
        assert status.status_code == 200
        assert status.json()["configured"] is True
        assert status.json()["model"] == "gemini-test"

        assert client.post("/v1/cameras/synthetic-front/start").status_code == 200
        deadline = time.monotonic() + 2
        while time.monotonic() < deadline:
            if client.get("/v1/cameras/synthetic-front/diagnostics").json()["capturedFrames"]:
                break
            time.sleep(0.02)
        response = client.post(
            "/v1/ai/gemini/analyze",
            json={"cameraId": "synthetic-front", "question": "무슨 모양이야?", "reason": "question"},
        )
        assert response.status_code == 200
        assert response.json()["shape"] == "TRIANGLE"
        assert gemini.received_image.startswith(b"\xff\xd8")
        assert gemini.received_question == "무슨 모양이야?"


def test_gemini_analysis_is_disabled_without_a_server_key(tmp_path: Path) -> None:
    with TestClient(create_app(tmp_path, gemini=FakeGeminiAnalyzer(configured=False))) as client:
        response = client.post(
            "/v1/ai/gemini/analyze",
            json={"cameraId": "synthetic-front", "reason": "auto"},
        )
        assert response.status_code == 503
        assert response.json()["error"]["code"] == "SUHA-AI-001"


def test_gemini_auto_analysis_is_globally_limited_before_upstream(tmp_path: Path) -> None:
    gemini = FakeGeminiAnalyzer()
    with TestClient(create_app(tmp_path, gemini=gemini)) as client:
        assert client.post("/v1/cameras/synthetic-front/start").status_code == 200
        deadline = time.monotonic() + 2
        while time.monotonic() < deadline:
            if client.get("/v1/cameras/synthetic-front/diagnostics").json()["capturedFrames"]:
                break
            time.sleep(0.02)

        first = client.post(
            "/v1/ai/gemini/analyze",
            json={"cameraId": "synthetic-front", "reason": "auto"},
        )
        second = client.post(
            "/v1/ai/gemini/analyze",
            json={"cameraId": "synthetic-front", "reason": "auto"},
        )

        assert first.status_code == 200
        assert second.status_code == 429
        assert second.json()["error"]["code"] == "SUHA-AI-004"
        assert gemini.call_count == 1
        usage = client.get("/v1/ai/gemini/status").json()["usage"]
        assert usage["apiRequests"] == 2
        assert usage["upstreamRequests"] == 1
        assert usage["autoMinimumIntervalSeconds"] == 60


def test_old_gemini_client_is_rejected_before_upstream(tmp_path: Path) -> None:
    gemini = FakeGeminiAnalyzer()
    with TestClient(create_app(tmp_path, gemini=gemini)) as client:
        response = client.post(
            "/v1/ai/gemini/analyze",
            json={"cameraId": "synthetic-front"},
        )

        assert response.status_code == 422
        assert gemini.call_count == 0


def test_pen_mode_is_an_explicit_fast_runtime_mode() -> None:
    with TestClient(create_app()) as client:
        camera = next(item for item in client.get("/v1/cameras").json() if item["cameraId"] == "synthetic-front")
        response = client.put(
            f"/v1/sessions/{camera['sessionId']}/mode",
            json={"mode": "PEN_DRAW", "profile": "default"},
        )
        assert response.status_code == 200
        assert response.json()["mode"] == "PEN_DRAW"
        client.put(
            f"/v1/sessions/{camera['sessionId']}/mode",
            json={"mode": "GENERIC_GESTURE", "profile": "default"},
        )


def test_drowsiness_mode_exposes_local_monitoring_diagnostics() -> None:
    with TestClient(create_app()) as client:
        camera = next(item for item in client.get("/v1/cameras").json() if item["cameraId"] == "synthetic-front")
        response = client.put(
            f"/v1/sessions/{camera['sessionId']}/mode",
            json={"mode": "DROWSINESS_MONITOR", "profile": "default"},
        )
        assert response.status_code == 200
        assert response.json()["mode"] == "DROWSINESS_MONITOR"
        assert client.post("/v1/cameras/synthetic-front/start").status_code == 200
        deadline = time.monotonic() + 2
        diagnostics: dict[str, Any] = {}
        while time.monotonic() < deadline:
            diagnostics = client.get("/v1/cameras/synthetic-front/diagnostics").json()
            if diagnostics.get("drowsiness"):
                break
            time.sleep(0.02)
        assert diagnostics["drowsiness"]["status"] == "NO_FACE"
        assert diagnostics["drowsiness"]["faceVisible"] is False
        recalibrated = client.post("/v1/cameras/synthetic-front/posture/recalibrate")
        assert recalibrated.status_code == 200
        assert recalibrated.json()["recalibrated"] is True


def test_openapi_and_privacy_contract() -> None:
    with TestClient(create_app()) as client:
        assert "/v1/events/stream" not in client.get("/openapi.json").json()["paths"]
        privacy = client.get("/v1/config/effective").json()["privacy"]
        assert privacy["save_raw_video"] is False


def test_ksl_mode_is_explicitly_disabled_without_active_model(tmp_path: Path) -> None:
    with TestClient(create_app(tmp_path)) as client:
        camera = client.get("/v1/cameras/synthetic-front").json()
        response = client.put(
            f"/v1/sessions/{camera['sessionId']}/mode",
            json={"mode": "SIGN_LANGUAGE_KSL", "profile": "default"},
        )
        assert response.status_code == 400
        assert "KSL_MODEL_NOT_ACTIVE" in response.text
        assert client.get("/v1/health").json()["status"] == "ok"


def test_sign_input_diagnostics_are_inactive_outside_ksl_mode(tmp_path: Path) -> None:
    with TestClient(create_app(tmp_path)) as client:
        response = client.get("/v1/cameras/synthetic-front/sign-input")
        assert response.status_code == 200
        assert response.json() == {
            "available": False,
            "cameraId": "synthetic-front",
            "mode": "GENERIC_GESTURE",
            "reason": "SIGN_INPUT_NOT_ACTIVE",
        }


def test_sign_expression_catalog_and_collection_readiness_are_explicit(tmp_path: Path) -> None:
    with TestClient(create_app(tmp_path)) as client:
        catalog = client.get("/v1/sign/expressions")
        assert catalog.status_code == 200
        assert catalog.json()["catalogVersion"] == "ksl-core-20-v1"
        assert len(catalog.json()["items"]) == 20
        assert all(item["requiresExpertReview"] for item in catalog.json()["items"])
        parking = client.get("/v1/sign/expressions", params={"domain": "parking"}).json()["items"]
        assert parking
        assert all("parking" in item["domains"] for item in parking)
        readiness = client.get("/v1/sign/collection-status").json()
        assert readiness["expressionCount"] == 20
        assert readiness["readyExpressionCount"] == 0
        assert readiness["trainingReady"] is False


def test_sign_capture_accepts_only_catalog_expression_and_requires_consent(tmp_path: Path) -> None:
    with TestClient(create_app(tmp_path)) as client:
        created = client.post(
            "/v1/sign/capture/sessions",
            json={
                "label": "help_needed",
                "targetSamples": 30,
                "saveVideo": False,
                "saveLandmarks": False,
                "consentId": "ksl-loop-2-consent",
                "cameraId": "synthetic-front",
                "datasetId": "ksl-core-20",
                "testerAlias": "anonymous-signer",
            },
        )
        assert created.status_code == 200
        payload = created.json()
        assert payload["label"] == "HELP_NEEDED"
        assert payload["saveLandmarks"] is True
        assert payload["metadata"]["reviewStatus"] == "PENDING"
        assert payload["metadata"]["requiresExpertReview"] is True
        assert payload["expression"]["code"] == "HELP_NEEDED"
        unknown = client.post(
            "/v1/sign/capture/sessions",
            json={"label": "NOT_A_SIGN", "targetSamples": 30, "consentId": "consent"},
        )
        assert unknown.status_code == 400
        no_consent = client.post(
            "/v1/sign/capture/sessions",
            json={"label": "HELP_NEEDED", "targetSamples": 30},
        )
        assert no_consent.status_code == 400


def test_gloss_admin_api_persists_revision_and_history(tmp_path: Path) -> None:
    capture_root = tmp_path / "recordings"
    with TestClient(create_app(capture_root)) as client:
        seeded = client.get("/v1/sign/glossary")
        assert seeded.status_code == 200
        assert len(seeded.json()["items"]) == 20
        created = client.post(
            "/v1/sign/glossary",
            json={
                "code": "CHILD_MISSING",
                "gloss": "아이 없어지다",
                "koreanText": "아이가 없어졌어요.",
                "domains": ["emergency"],
                "emergency": True,
                "actor": "admin-test",
            },
        )
        assert created.status_code == 200
        updated = client.put(
            "/v1/sign/glossary/CHILD_MISSING",
            json={"status": "PENDING_REVIEW", "aliases": ["아이 잃어버리다"], "actor": "reviewer-test"},
        )
        assert updated.status_code == 200
        assert updated.json()["revision"] == 2
        assert client.get("/v1/sign/glossary/CHILD_MISSING").json()["aliases"] == ["아이 잃어버리다"]
        history = client.get("/v1/sign/glossary/history").json()["items"]
        assert [item["action"] for item in history] == ["REGISTERED", "UPDATED"]

    with TestClient(create_app(capture_root)) as client:
        assert client.get("/v1/sign/glossary/CHILD_MISSING").json()["revision"] == 2


def test_gloss_sequence_api_is_session_scoped_and_clearable(tmp_path: Path) -> None:
    with TestClient(create_app(tmp_path / "recordings")) as client:
        camera = client.get("/v1/cameras/synthetic-front").json()
        sequence = client.get(f"/v1/sign/sequences/{camera['sessionId']}")
        assert sequence.status_code == 200
        assert sequence.json()["glossSequence"] == []
        cleared = client.post(f"/v1/sign/sequences/{camera['sessionId']}/clear")
        assert cleared.status_code == 200
        assert cleared.json()["tokenCount"] == 0
        assert client.get("/v1/sign/sequences/unknown").status_code == 404


def test_conversation_api_separates_speakers_and_deletes_all_text(tmp_path: Path) -> None:
    with TestClient(create_app(tmp_path / "recordings")) as client:
        camera = client.get("/v1/cameras/synthetic-front").json()
        session_id = camera["sessionId"]
        hearing = client.post(
            f"/v1/sign/conversations/{session_id}/messages",
            json={
                "speaker": "HEARING_USER",
                "text": "어디가 불편하세요?",
                "source": "STT",
                "confidence": 0.91,
                "clientMessageId": "browser-stt-one",
            },
        )
        signed = client.post(
            f"/v1/sign/conversations/{session_id}/messages",
            json={
                "speaker": "KSL_USER",
                "text": "배가 아프고 어지럽습니다.",
                "source": "KSL_TRANSLATION",
            },
        )
        assert hearing.status_code == signed.status_code == 200
        conversation = client.get(f"/v1/sign/conversations/{session_id}").json()
        assert [item["speaker"] for item in conversation["messages"]] == [
            "HEARING_USER",
            "KSL_USER",
        ]
        deleted = client.delete(f"/v1/sign/conversations/{session_id}")
        assert deleted.status_code == 200
        assert deleted.json()["messageCount"] == 0

        client.post(
            f"/v1/sign/conversations/{session_id}/messages",
            json={"speaker": "HEARING_USER", "text": "다시 말합니다.", "source": "STT"},
        )
        assert client.post("/v1/cameras/synthetic-front/stop").status_code == 200
        assert client.get(f"/v1/sign/conversations/{session_id}").json()["messageCount"] == 0


def test_professional_dictionary_and_domain_priority_api(tmp_path: Path) -> None:
    app = create_app(tmp_path / "recordings")
    with TestClient(app) as client:
        domains = client.get("/v1/sign/professional-domains").json()["items"]
        assert {item["code"] for item in domains} >= {
            "public",
            "parking",
            "medical",
            "disaster",
            "transport",
            "finance",
        }
        medical_terms = client.get(
            "/v1/sign/professional-dictionary", params={"domain": "medical"}
        ).json()["items"]
        assert {item["code"] for item in medical_terms} >= {"ALLERGY", "MEDICATION"}

        camera = client.get("/v1/cameras/synthetic-front").json()
        session_id = camera["sessionId"]
        for index, code in enumerate(("PAYMENT", "ERROR"), 1):
            app.state.suha.runtime.gloss_sequences.append(
                session_id,
                RecognitionCandidate(
                    "SIGN_LANGUAGE",
                    f"KSL_{code}",
                    0.9,
                    "person",
                    None,
                    index * 1000 - 500,
                    index * 1000,
                    "integration-model",
                    metadata={"recognizedText": code, "segmentId": f"domain-segment-{index}"},
                ),
            )
        assert client.put(
            f"/v1/sign/translations/{session_id}/domain", json={"domain": "parking"}
        ).status_code == 200
        parking = client.post(f"/v1/sign/translations/{session_id}").json()
        assert parking["candidates"][0]["text"] == "주차 요금 결제 중 오류가 발생했습니다."

        finance_domain = client.put(
            f"/v1/sign/translations/{session_id}/domain", json={"domain": "finance"}
        )
        assert finance_domain.status_code == 200
        finance = client.post(f"/v1/sign/translations/{session_id}").json()
        assert finance["candidates"][0]["text"] == "결제 오류를 확인해 주세요."
        assert finance["domainRisk"] == "HIGH_STAKES"
        assert finance["safetyNotice"]


def test_translation_correction_requires_consent_before_feedback_storage(tmp_path: Path) -> None:
    app = create_app(tmp_path / "recordings")
    with TestClient(app) as client:
        camera = client.get("/v1/cameras/synthetic-front").json()
        session_id = camera["sessionId"]
        app.state.suha.runtime.gloss_sequences.append(
            session_id,
            RecognitionCandidate(
                "SIGN_LANGUAGE",
                "KSL_HOSPITAL",
                0.9,
                "person",
                None,
                500,
                1000,
                "integration-model",
                metadata={"recognizedText": "병원", "segmentId": "feedback-segment"},
            ),
        )
        assert client.post(f"/v1/sign/translations/{session_id}").status_code == 200
        missing_reason = client.post(
            f"/v1/sign/translations/{session_id}/confirm",
            json={"action": "CORRECT", "correctedText": "병원 위치를 알려주세요."},
        )
        assert missing_reason.status_code == 400
        missing_consent_id = client.post(
            f"/v1/sign/translations/{session_id}/confirm",
            json={
                "action": "CORRECT",
                "correctedText": "병원 위치를 알려주세요.",
                "reason": "WORD_ORDER",
                "consentToImprove": True,
            },
        )
        assert missing_consent_id.status_code == 400

        local_only = client.post(
            f"/v1/sign/translations/{session_id}/confirm",
            json={
                "action": "CORRECT",
                "correctedText": "병원 위치를 알려주세요.",
                "reason": "WORD_ORDER",
                "consentToImprove": False,
            },
        )
        assert local_only.status_code == 200
        assert local_only.json()["confirmation"]["improvementDataStored"] is False
        assert client.get(
            "/v1/sign/feedback", params={"sessionId": session_id}
        ).json()["items"] == []

        consented = client.post(
            f"/v1/sign/translations/{session_id}/confirm",
            json={
                "action": "CORRECT",
                "correctedText": "가까운 병원 위치를 안내해 주세요.",
                "reason": "CONTEXT_ERROR",
                "consentToImprove": True,
                "consentId": "integration-explicit-consent",
            },
        )
        assert consented.status_code == 200
        confirmation = consented.json()["confirmation"]
        assert confirmation["improvementDataStored"] is True
        assert confirmation["trainingEligible"] is False
        feedback = client.get(
            "/v1/sign/feedback", params={"sessionId": session_id}
        ).json()["items"]
        assert len(feedback) == 1
        assert feedback[0]["consentReference"] != "integration-explicit-consent"
        deleted = client.delete(
            f"/v1/sign/feedback/{feedback[0]['feedbackId']}",
            params={"sessionId": session_id},
        )
        assert deleted.status_code == 200
        assert client.get(
            "/v1/sign/feedback", params={"sessionId": session_id}
        ).json()["items"] == []


def test_expert_review_api_only_exports_multi_role_approved_training_candidates(
    tmp_path: Path,
) -> None:
    app = create_app(tmp_path / "recordings")
    feedback = app.state.suha.feedback.enqueue(
        session_id="review-session",
        translation_id="translation-review",
        original_text="서류 발급 원함.",
        corrected_text="서류를 발급받고 싶습니다.",
        reason="WORD_ORDER",
        domain="public",
        gloss_sequence=["서류", "발급"],
        consent_id="review-consent",
    )
    with TestClient(app) as client:
        pending = client.get("/v1/admin/sign/reviews", params={"status": "PENDING_REVIEW"})
        assert pending.status_code == 200
        assert pending.json()["count"] == 1
        first = client.post(
            f"/v1/admin/sign/reviews/{feedback['feedbackId']}",
            json={
                "reviewerId": "interpreter-one",
                "reviewerRole": "KSL_INTERPRETER",
                "decision": "APPROVE",
                "meaningPreservation": 5,
                "koreanNaturalness": 5,
                "misrecognitionRisk": 1,
                "notes": "의미가 보존됩니다.",
            },
        )
        assert first.status_code == 200
        assert first.json()["status"] == "IN_REVIEW"
        assert client.get("/v1/admin/sign/training-candidates").json()["count"] == 0
        second = client.post(
            f"/v1/admin/sign/reviews/{feedback['feedbackId']}",
            json={
                "reviewerId": "ux-expert-one",
                "reviewerRole": "ACCESSIBILITY_UX_EXPERT",
                "decision": "APPROVE",
                "meaningPreservation": 4,
                "koreanNaturalness": 5,
                "misrecognitionRisk": 2,
                "notes": "접근성 문장으로 적합합니다.",
            },
        )
        assert second.status_code == 200
        assert second.json()["status"] == "APPROVED"
        candidates = client.get("/v1/admin/sign/training-candidates").json()
        assert candidates["count"] == 1
        assert candidates["items"][0]["trainingEligible"] is True
        history = client.get(
            f"/v1/admin/sign/reviews/{feedback['feedbackId']}/history"
        ).json()["items"]
        assert [item["reviewerRole"] for item in history] == [
            "KSL_INTERPRETER",
            "ACCESSIBILITY_UX_EXPERT",
        ]
        summary = client.get("/v1/admin/sign/reviews/summary").json()
        assert summary["byStatus"]["APPROVED"] == 1


def test_offline_package_settings_and_translation_metadata(tmp_path: Path) -> None:
    app = create_app(tmp_path / "recordings")
    with TestClient(app) as client:
        camera = client.get("/v1/cameras/synthetic-front").json()
        session_id = camera["sessionId"]
        capabilities = client.get("/v1/sign/offline/capabilities").json()
        package = client.get("/v1/sign/offline/package").json()
        assert capabilities["offlineReady"] is True
        assert capabilities["networkRequired"] is False
        assert package["version"] == capabilities["packageVersion"]
        defaults = client.get(f"/v1/sign/offline/{session_id}/settings").json()
        assert defaults["mode"] == "OFFLINE_ONLY"
        invalid = client.put(
            f"/v1/sign/offline/{session_id}/settings",
            json={"mode": "OFFLINE_ONLY", "allowOnlineEnhancement": True},
        )
        assert invalid.status_code == 400
        translated = client.post(f"/v1/sign/translations/{session_id}").json()
        assert translated["processingMode"] == "OFFLINE"
        assert translated["networkUsed"] is False
        assert translated["offlinePackageVersion"] == package["version"]


def test_professional_qa_api_keeps_human_release_gate_explicit(tmp_path: Path) -> None:
    app = create_app(tmp_path / "recordings")
    with TestClient(app) as client:
        scenarios = client.get("/v1/admin/sign/qa/scenarios").json()
        assert scenarios["count"] == 7
        recorded = client.post(
            "/v1/admin/sign/qa/results",
            json={
                "scenarioId": "lighting-range",
                "source": "SYNTHETIC_REGRESSION",
                "expectedCode": "HELP_NEEDED",
                "observedCandidates": ["HELP_NEEDED"],
                "confidence": 0.9,
                "latencyMs": 300,
                "variantTags": {"lighting": "LOW_LIGHT"},
                "expertAccepted": True,
                "notes": "synthetic fixture",
            },
        )
        assert recorded.status_code == 200
        assert recorded.json()["passed"] is True
        summary = client.get("/v1/admin/sign/qa/summary").json()
        assert summary["releaseReady"] is False
        assert summary["humanReviewedResults"] == 0
        assert client.get("/v1/admin/sign/qa/results").json()["count"] == 1
        assert client.delete("/v1/admin/sign/qa/results").json()["deletedCount"] == 1

def test_gloss_translation_api_supports_candidates_confirmation_and_clear(tmp_path: Path) -> None:
    app = create_app(tmp_path / "recordings")
    with TestClient(app) as client:
        camera = client.get("/v1/cameras/synthetic-front").json()
        session_id = camera["sessionId"]
        for index, (code, gloss) in enumerate(
            (("HOSPITAL", "병원"), ("WHERE", "어디"), ("PLEASE", "부탁")), 1
        ):
            app.state.suha.runtime.gloss_sequences.append(
                session_id,
                RecognitionCandidate(
                    "SIGN_LANGUAGE",
                    f"KSL_{code}",
                    0.9,
                    "person",
                    None,
                    index * 1000 - 500,
                    index * 1000,
                    "integration-model",
                    metadata={"recognizedText": gloss, "segmentId": f"segment-{index}"},
                ),
            )

        translated = client.post(f"/v1/sign/translations/{session_id}")
        assert translated.status_code == 200
        assert translated.json()["candidates"][0]["text"] == "병원이 어디에 있는지 알려주세요."
        confirmed = client.post(
            f"/v1/sign/translations/{session_id}/confirm",
            json={"action": "CONFIRM", "candidateId": "candidate-1"},
        )
        assert confirmed.status_code == 200
        assert confirmed.json()["status"] == "CONFIRMED"
        assert client.get(f"/v1/sign/translations/{session_id}").status_code == 200

        capabilities = client.get("/v1/sign/tts/capabilities")
        assert capabilities.status_code == 200
        assert capabilities.json()["offlineCapable"] is True
        settings = client.put(
            f"/v1/sign/tts/{session_id}/settings",
            json={
                "voicePreference": "FEMALE_PREFERRED",
                "rate": 0.9,
                "autoPlay": True,
                "confirmBeforePlayback": True,
            },
        )
        assert settings.status_code == 200
        played = client.post(f"/v1/sign/tts/{session_id}/play", json={"mode": "AUTO"})
        assert played.status_code == 200
        assert played.json()["text"] == "병원이 어디에 있는지 알려주세요."
        assert played.json()["engine"] == "DEVICE_TTS"
        replayed = client.post(f"/v1/sign/tts/{session_id}/replay")
        assert replayed.status_code == 200
        assert replayed.json()["replayCount"] == 1

        assert client.post(f"/v1/sign/sequences/{session_id}/clear").status_code == 200
        assert client.get(f"/v1/sign/translations/{session_id}").status_code == 404
        assert client.post(f"/v1/sign/tts/{session_id}/replay").status_code == 404


def test_ksl_quality_gate_blocks_incomplete_synchronized_input(tmp_path: Path) -> None:
    app = create_app(tmp_path)
    recognizer = FakeKslRecognizer()
    runtime = app.state.suha.runtime
    runtime.custom_ksl = recognizer
    runtime.ksl_enabled = True
    with TestClient(app) as client:
        camera = client.get("/v1/cameras/synthetic-front").json()
        changed = client.put(
            f"/v1/sessions/{camera['sessionId']}/mode",
            json={"mode": "SIGN_LANGUAGE_KSL", "profile": "default"},
        )
        assert changed.status_code == 200
        assert client.post("/v1/cameras/synthetic-front/start").status_code == 200
        payload: dict[str, Any] = {}
        deadline = time.monotonic() + 2
        while time.monotonic() < deadline:
            payload = client.get("/v1/cameras/synthetic-front/sign-input").json()
            if payload.get("available"):
                break
            time.sleep(0.02)
        assert payload["quality"]["readyForRecognition"] is False
        assert "LEFT_HAND_MISSING" in payload["quality"]["issues"]
        assert payload["segment"]["state"] == "IDLE"
        assert payload["segment"]["acceptFrame"] is False
        assert recognizer.calls == 0


def test_capture_api_collects_twenty_samples_without_video(tmp_path: Path) -> None:
    with TestClient(create_app(tmp_path)) as client:
        assert client.post("/v1/cameras/synthetic-front/start").status_code == 200
        deadline = time.monotonic() + 2
        while time.monotonic() < deadline:
            info = client.get("/v1/cameras/synthetic-front/diagnostics").json()
            if info["inferredFrames"]:
                break
            time.sleep(0.03)
        created = client.post(
            "/v1/capture/sessions",
            json={
                "label": "HAND_WAVE",
                "targetSamples": 20,
                "saveVideo": False,
                "saveLandmarks": True,
                "consentId": "integration-consent",
                "cameraId": "synthetic-front",
            },
        )
        assert created.status_code == 200
        capture_id = created.json()["captureId"]
        assert client.post(f"/v1/capture/sessions/{capture_id}/start").status_code == 200
        samples = 0
        deadline = time.monotonic() + 5
        while samples < 20 and time.monotonic() < deadline:
            response = client.post(f"/v1/capture/sessions/{capture_id}/mark")
            if response.status_code == 200:
                samples = response.json()["samples"]
            time.sleep(0.04)
        result = client.get(f"/v1/capture/sessions/{capture_id}").json()
        assert result["status"] == "COMPLETE"
        assert result["samples"] == 20
        assert not list(tmp_path.rglob("*.mp4"))


def test_model_register_validate_activate_and_rollback(tmp_path: Path) -> None:
    dataset = build_training_dataset(tmp_path)
    trained = train_static_gesture_model(dataset, tmp_path / "bundle", model_id="api-custom-static", epochs=10)
    capture_root = tmp_path / "api-recordings"
    with TestClient(create_app(capture_root)) as client:
        registered = client.post("/v1/models", json={"manifestPath": str(trained.manifest_path)})
        assert registered.status_code == 200
        validated = client.post("/v1/models/api-custom-static/validate")
        assert validated.json()["status"] == "VALIDATED"
        activated = client.post("/v1/models/api-custom-static/activate")
        assert activated.json()["status"] == "ACTIVE"
        models = client.get("/v1/models").json()
        built_in = next(model for model in models if model["modelId"] == "landmark-rule-static")
        assert built_in["status"] == "COMBINED"
        assert client.get("/v1/models/runtime/providers").json()["default"] == "CPUExecutionProvider"
        assert any(event["eventCode"] == "MODEL_ACTIVATED" for event in client.get("/v1/events").json())

        damaged_bundle = tmp_path / "damaged-bundle"
        shutil.copytree(trained.manifest_path.parent, damaged_bundle)
        damaged_manifest_path = damaged_bundle / "manifest.json"
        damaged_manifest = json.loads(damaged_manifest_path.read_text(encoding="utf-8"))
        damaged_manifest["modelId"] = "damaged-static"
        damaged_manifest_path.write_text(json.dumps(damaged_manifest), encoding="utf-8")
        assert client.post("/v1/models", json={"manifestPath": str(damaged_manifest_path)}).status_code == 200
        assert client.post("/v1/models/damaged-static/validate").status_code == 200
        with (damaged_bundle / "model.onnx").open("ab") as handle:
            handle.write(b"corruption")
        failed_activation = client.post("/v1/models/damaged-static/activate")
        assert failed_activation.status_code == 400
        assert client.get("/v1/models/damaged-static").json()["status"] == "QUARANTINED"
        assert client.get("/v1/models/api-custom-static").json()["status"] == "ACTIVE"

        incompatible_bundle = tmp_path / "incompatible-bundle"
        shutil.copytree(trained.manifest_path.parent, incompatible_bundle)
        incompatible_path = incompatible_bundle / "manifest.json"
        incompatible = json.loads(incompatible_path.read_text(encoding="utf-8"))
        incompatible["modelId"] = "incompatible-static"
        incompatible["input"]["shape"] = [None, 64]
        incompatible_path.write_text(json.dumps(incompatible), encoding="utf-8")
        client.post("/v1/models", json={"manifestPath": str(incompatible_path)})
        assert client.post("/v1/models/incompatible-static/validate").status_code == 400
        assert client.get("/v1/models/incompatible-static").json()["status"] == "QUARANTINED"
        assert (tmp_path / "models" / "registry" / "active.json").is_file()

    with TestClient(create_app(capture_root)) as restarted:
        assert restarted.get("/v1/models/api-custom-static").json()["status"] == "ACTIVE"
        rolled_back = restarted.post("/v1/models/rollback")
        assert rolled_back.json()["modelId"] == "landmark-rule-static"
