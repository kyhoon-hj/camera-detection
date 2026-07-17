import json
import shutil
import time
from pathlib import Path
from typing import Any

from fastapi.testclient import TestClient
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
