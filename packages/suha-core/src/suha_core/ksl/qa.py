from __future__ import annotations

import json
import threading
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from uuid import uuid4

QA_SCENARIOS: tuple[dict[str, Any], ...] = (
    {"scenarioId": "dominant-hand-left", "category": "LEFT_HANDED", "koreanName": "왼손잡이", "requiredTags": ["dominantHand"]},
    {"scenarioId": "signing-speed", "category": "SIGNING_SPEED", "koreanName": "빠르거나 느린 수어", "requiredTags": ["speed"]},
    {"scenarioId": "lighting-range", "category": "LIGHTING", "koreanName": "밝고 어두운 환경", "requiredTags": ["lighting"]},
    {"scenarioId": "complex-background", "category": "BACKGROUND", "koreanName": "복잡한 배경", "requiredTags": ["background"]},
    {"scenarioId": "hand-face-occlusion", "category": "OCCLUSION", "koreanName": "손·얼굴 가림", "requiredTags": ["occlusion"]},
    {"scenarioId": "regional-age-variation", "category": "REGIONAL_AGE", "koreanName": "지역·연령별 표현 차이", "requiredTags": ["region", "ageGroup"]},
    {"scenarioId": "emergency-recall", "category": "EMERGENCY", "koreanName": "긴급 표현 별도 검증", "requiredTags": ["emergencyExpression"]},
)
SCENARIO_BY_ID = {item["scenarioId"]: item for item in QA_SCENARIOS}


def _now() -> str:
    return datetime.now(UTC).isoformat()


class ProfessionalQaStore:
    def __init__(self, root: str | Path) -> None:
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)
        self._path = self.root / "professional-qa-results.json"
        self._results: list[dict[str, Any]] = []
        self._lock = threading.RLock()
        self._load()

    @staticmethod
    def scenarios() -> list[dict[str, Any]]:
        return [dict(item) for item in QA_SCENARIOS]

    def record(
        self,
        *,
        scenario_id: str,
        source: str,
        expected_code: str,
        observed_candidates: list[str],
        confidence: float,
        latency_ms: int,
        variant_tags: dict[str, str],
        expert_accepted: bool,
        notes: str,
    ) -> dict[str, Any]:
        if scenario_id not in SCENARIO_BY_ID:
            raise ValueError(f"Unsupported QA scenario: {scenario_id}")
        if source not in {"SYNTHETIC_REGRESSION", "HUMAN_REVIEWED_RECORDING"}:
            raise ValueError(f"Unsupported QA source: {source}")
        if not 0 <= confidence <= 1:
            raise ValueError("QA confidence must be between 0 and 1")
        if latency_ms < 0:
            raise ValueError("QA latency must not be negative")
        if not expected_code.strip():
            raise ValueError("expectedCode is required")
        scenario = SCENARIO_BY_ID[scenario_id]
        missing = [tag for tag in scenario["requiredTags"] if not variant_tags.get(tag, "").strip()]
        if missing:
            raise ValueError(f"Missing required variant tags: {', '.join(missing)}")
        normalized_candidates = [item.strip().upper() for item in observed_candidates if item.strip()][:3]
        expected = expected_code.strip().upper()
        rank = next((index for index, code in enumerate(normalized_candidates, 1) if code == expected), None)
        emergency = scenario["category"] == "EMERGENCY"
        allowed_rank = 1 if emergency else 3
        max_latency_ms = 1200 if emergency else 2000
        passed = bool(
            rank is not None
            and rank <= allowed_rank
            and confidence >= 0.6
            and latency_ms <= max_latency_ms
            and expert_accepted
        )
        result = {
            "qaResultId": f"kslqa_{uuid4().hex}",
            "scenarioId": scenario_id,
            "category": scenario["category"],
            "source": source,
            "expectedCode": expected,
            "observedCandidates": normalized_candidates,
            "correctRank": rank,
            "confidence": round(confidence, 4),
            "latencyMs": latency_ms,
            "variantTags": dict(variant_tags),
            "expertAccepted": expert_accepted,
            "notes": " ".join(notes.split()),
            "passed": passed,
            "recordedAt": _now(),
            "containsVideo": False,
            "containsLandmarks": False,
        }
        with self._lock:
            self._results.append(result)
            self._persist()
        return dict(result)

    def results(self, *, source: str | None = None) -> list[dict[str, Any]]:
        return [dict(item) for item in self._results if source is None or item["source"] == source]

    def summary(self) -> dict[str, Any]:
        human = [item for item in self._results if item["source"] == "HUMAN_REVIEWED_RECORDING"]
        covered = {item["category"] for item in human if item["passed"]}
        required = {item["category"] for item in QA_SCENARIOS}
        emergency = [item for item in human if item["category"] == "EMERGENCY"]
        emergency_recall = (
            sum(item["passed"] for item in emergency) / len(emergency) if emergency else None
        )
        passed = sum(item["passed"] for item in self._results)
        return {
            "totalResults": len(self._results),
            "passedResults": passed,
            "humanReviewedResults": len(human),
            "coveredCategories": sorted(covered),
            "missingCategories": sorted(required - covered),
            "emergencyRecall": round(emergency_recall, 4) if emergency_recall is not None else None,
            "emergencyRecallTarget": 0.95,
            "releaseReady": covered == required and emergency_recall is not None and emergency_recall >= 0.95,
            "releasePolicy": "All seven categories require passing human-reviewed evidence; emergency recall must be at least 0.95.",
        }

    def clear(self) -> dict[str, int]:
        with self._lock:
            deleted = len(self._results)
            self._results = []
            self._persist()
        return {"deletedCount": deleted}

    def _load(self) -> None:
        if not self._path.is_file():
            return
        raw: Any = json.loads(self._path.read_text(encoding="utf-8"))
        if isinstance(raw, dict) and isinstance(raw.get("items"), list):
            self._results = [item for item in raw["items"] if isinstance(item, dict)]

    def _persist(self) -> None:
        payload = {"schemaVersion": "1.0", "items": self._results, "updatedAt": _now()}
        temporary = self._path.with_suffix(".json.tmp")
        temporary.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        temporary.replace(self._path)
