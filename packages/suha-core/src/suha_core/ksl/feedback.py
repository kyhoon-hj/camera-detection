from __future__ import annotations

import hashlib
import json
import threading
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from uuid import uuid4

CORRECTION_REASONS = {
    "HANDSHAPE_MISRECOGNITION",
    "WORD_ORDER",
    "NON_MANUAL_MISSING",
    "WORD_MISSING",
    "CONTEXT_ERROR",
    "DIFFERENT_EXPRESSION",
    "OTHER",
}
REVIEWER_ROLES = {
    "DEAF_SIGNER",
    "KSL_INTERPRETER",
    "KSL_EDUCATOR",
    "DOMAIN_EXPERT",
    "ACCESSIBILITY_UX_EXPERT",
}
HIGH_STAKES_DOMAINS = {"medical", "finance", "disaster"}


def _now() -> str:
    return datetime.now(UTC).isoformat()


def _hash(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()[:24]


class CorrectionFeedbackQueue:
    def __init__(self, root: str | Path) -> None:
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)
        self._path = self.root / "correction-feedback.json"
        self._audit_path = self.root / "correction-feedback-audit.jsonl"
        self._entries: list[dict[str, Any]] = []
        self._lock = threading.RLock()
        self._load()

    def enqueue(
        self,
        *,
        session_id: str,
        translation_id: str,
        original_text: str,
        corrected_text: str,
        reason: str,
        domain: str,
        gloss_sequence: list[str],
        consent_id: str,
    ) -> dict[str, Any]:
        if reason not in CORRECTION_REASONS:
            raise ValueError(f"Unsupported correction reason: {reason}")
        if not consent_id.strip():
            raise ValueError("consentId is required to store improvement feedback")
        if not corrected_text.strip():
            raise ValueError("Corrected text is required")
        entry = {
            "feedbackId": f"kslfb_{uuid4().hex}",
            "translationId": translation_id,
            "sessionHash": _hash(session_id),
            "originalText": " ".join(original_text.split()),
            "correctedText": " ".join(corrected_text.split()),
            "reason": reason,
            "domain": domain,
            "glossSequence": list(gloss_sequence),
            "consentReference": _hash(consent_id.strip()),
            "consentedAt": _now(),
            "status": "PENDING_REVIEW",
            "trainingEligible": False,
            "containsVideo": False,
            "containsLandmarks": False,
            "reviewScope": "TEXT_GLOSS_CORRECTION",
            "unavailableCriteria": [
                "SIGN_NATURALNESS",
                "NON_MANUAL_COVERAGE",
                "REGIONAL_AGE_VARIATION",
            ],
        }
        with self._lock:
            self._entries.append(entry)
            self._persist()
            self._audit("ENQUEUED", str(entry["feedbackId"]), str(entry["sessionHash"]))
        return dict(entry)

    def list_entries(self, session_id: str | None = None) -> list[dict[str, Any]]:
        session_hash = _hash(session_id) if session_id else None
        return [
            dict(entry)
            for entry in self._entries
            if session_hash is None or entry["sessionHash"] == session_hash
        ]

    def delete(self, feedback_id: str, *, session_id: str | None = None) -> dict[str, Any]:
        session_hash = _hash(session_id) if session_id else None
        with self._lock:
            index = next(
                (
                    index
                    for index, entry in enumerate(self._entries)
                    if entry["feedbackId"] == feedback_id
                    and (session_hash is None or entry["sessionHash"] == session_hash)
                ),
                None,
            )
            if index is None:
                raise KeyError(f"Correction feedback not found: {feedback_id}")
            removed = self._entries.pop(index)
            self._persist()
            self._audit("DELETED", feedback_id, str(removed["sessionHash"]))
        return {"feedbackId": feedback_id, "deleted": True}

    def clear(self, *, session_id: str | None = None) -> dict[str, Any]:
        session_hash = _hash(session_id) if session_id else None
        with self._lock:
            before = len(self._entries)
            self._entries = [
                entry
                for entry in self._entries
                if session_hash is not None and entry["sessionHash"] != session_hash
            ]
            deleted = before - len(self._entries)
            self._persist()
            self._audit("CLEARED", "*", session_hash, deleted=deleted)
        return {"deletedCount": deleted, "remainingCount": len(self._entries)}

    def review(
        self,
        feedback_id: str,
        *,
        reviewer_id: str,
        reviewer_role: str,
        decision: str,
        meaning_preservation: int,
        korean_naturalness: int,
        misrecognition_risk: int,
        notes: str,
    ) -> dict[str, Any]:
        if reviewer_role not in REVIEWER_ROLES:
            raise ValueError(f"Unsupported reviewer role: {reviewer_role}")
        if decision not in {"APPROVE", "REJECT"}:
            raise ValueError(f"Unsupported review decision: {decision}")
        if not reviewer_id.strip():
            raise ValueError("reviewerId is required")
        if any(not 1 <= score <= 5 for score in (meaning_preservation, korean_naturalness, misrecognition_risk)):
            raise ValueError("Review scores must be between 1 and 5")
        if decision == "APPROVE" and (
            meaning_preservation < 4 or korean_naturalness < 4 or misrecognition_risk > 2
        ):
            raise ValueError("Approval requires meaning and Korean scores >= 4 and risk <= 2")
        if decision == "REJECT" and not notes.strip():
            raise ValueError("Reviewer notes are required when rejecting feedback")
        with self._lock:
            entry = self._find(feedback_id)
            if entry["status"] in {"APPROVED", "REJECTED"}:
                raise ValueError(f"Feedback review is already final: {entry['status']}")
            reviews = entry.setdefault("reviews", [])
            reviewer_reference = _hash(reviewer_id.strip())
            if any(review.get("reviewerReference") == reviewer_reference for review in reviews):
                raise ValueError("The same reviewer cannot review feedback twice")
            review = {
                "reviewId": f"kslrev_{uuid4().hex}",
                "reviewerReference": reviewer_reference,
                "reviewerRole": reviewer_role,
                "decision": decision,
                "scores": {
                    "meaningPreservation": meaning_preservation,
                    "koreanNaturalness": korean_naturalness,
                    "misrecognitionRisk": misrecognition_risk,
                },
                "notes": " ".join(notes.split()),
                "reviewedAt": _now(),
            }
            reviews.append(review)
            if decision == "REJECT":
                entry["status"] = "REJECTED"
                entry["trainingEligible"] = False
            elif self._approval_complete(entry):
                entry["status"] = "APPROVED"
                entry["trainingEligible"] = True
                entry["approvedAt"] = _now()
            else:
                entry["status"] = "IN_REVIEW"
                entry["trainingEligible"] = False
            self._persist()
            self._audit(
                "REVIEWED",
                feedback_id,
                str(entry["sessionHash"]),
                reviewId=review["reviewId"],
                reviewerRole=reviewer_role,
                decision=decision,
                resultingStatus=entry["status"],
            )
        return dict(entry)

    def review_history(self, feedback_id: str) -> list[dict[str, Any]]:
        entry = self._find(feedback_id)
        return [dict(review) for review in entry.get("reviews", [])]

    def training_candidates(self) -> list[dict[str, Any]]:
        return [
            {
                "feedbackId": entry["feedbackId"],
                "domain": entry["domain"],
                "glossSequence": entry["glossSequence"],
                "targetKoreanText": entry["correctedText"],
                "correctionReason": entry["reason"],
                "approvedAt": entry.get("approvedAt"),
                "status": entry["status"],
                "trainingEligible": entry["trainingEligible"],
                "reviewCount": len(entry.get("reviews", [])),
                "reviewScope": entry.get("reviewScope", "TEXT_GLOSS_CORRECTION"),
            }
            for entry in self._entries
            if entry["status"] == "APPROVED" and entry["trainingEligible"] is True
        ]

    def summary(self) -> dict[str, Any]:
        statuses = {status: 0 for status in ("PENDING_REVIEW", "IN_REVIEW", "APPROVED", "REJECTED")}
        for entry in self._entries:
            status = str(entry.get("status", "PENDING_REVIEW"))
            statuses[status] = statuses.get(status, 0) + 1
        return {
            "total": len(self._entries),
            "byStatus": statuses,
            "trainingEligible": sum(entry.get("trainingEligible") is True for entry in self._entries),
        }

    def _find(self, feedback_id: str) -> dict[str, Any]:
        try:
            return next(entry for entry in self._entries if entry["feedbackId"] == feedback_id)
        except StopIteration as error:
            raise KeyError(f"Correction feedback not found: {feedback_id}") from error

    @staticmethod
    def _approval_complete(entry: dict[str, Any]) -> bool:
        approved_roles = {
            str(review["reviewerRole"])
            for review in entry.get("reviews", [])
            if review.get("decision") == "APPROVE"
        }
        has_ksl_reviewer = bool(approved_roles & {"DEAF_SIGNER", "KSL_INTERPRETER"})
        if entry.get("domain") in HIGH_STAKES_DOMAINS:
            return has_ksl_reviewer and "DOMAIN_EXPERT" in approved_roles
        return has_ksl_reviewer and len(approved_roles) >= 2

    def _load(self) -> None:
        if not self._path.is_file():
            return
        raw: Any = json.loads(self._path.read_text(encoding="utf-8"))
        if not isinstance(raw, dict) or not isinstance(raw.get("items"), list):
            raise ValueError("Correction feedback queue must contain an items list")
        self._entries = [item for item in raw["items"] if isinstance(item, dict)]

    def _persist(self) -> None:
        payload = {"schemaVersion": "1.0", "items": self._entries, "updatedAt": _now()}
        temporary = self._path.with_suffix(".json.tmp")
        temporary.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        temporary.replace(self._path)

    def _audit(
        self, action: str, feedback_id: str, session_hash: str | None, **details: Any
    ) -> None:
        record = {
            "timestamp": _now(),
            "action": action,
            "feedbackId": feedback_id,
            "sessionHash": session_hash,
            **details,
        }
        with self._audit_path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(record, ensure_ascii=False) + "\n")
