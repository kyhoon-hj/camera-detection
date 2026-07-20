from pathlib import Path

import pytest
from suha_core.ksl import CorrectionFeedbackQueue


def test_consented_feedback_is_anonymized_persistent_and_not_training_eligible(tmp_path: Path) -> None:
    queue = CorrectionFeedbackQueue(tmp_path)
    created = queue.enqueue(
        session_id="private-session-id",
        translation_id="translation-one",
        original_text="병원 어디에 있나요?",
        corrected_text="병원 위치를 안내해 주세요.",
        reason="WORD_ORDER",
        domain="medical",
        gloss_sequence=["병원", "어디"],
        consent_id="explicit-consent-001",
    )

    assert created["sessionHash"] != "private-session-id"
    assert created["consentReference"] != "explicit-consent-001"
    assert created["status"] == "PENDING_REVIEW"
    assert created["trainingEligible"] is False
    assert created["containsVideo"] is False
    assert created["containsLandmarks"] is False
    assert CorrectionFeedbackQueue(tmp_path).list_entries("private-session-id")[0]["feedbackId"] == (
        created["feedbackId"]
    )


def test_feedback_queue_validates_reason_and_supports_individual_and_session_delete(
    tmp_path: Path,
) -> None:
    queue = CorrectionFeedbackQueue(tmp_path)
    with pytest.raises(ValueError, match="reason"):
        queue.enqueue(
            session_id="session",
            translation_id="translation",
            original_text="원문",
            corrected_text="수정",
            reason="UNSUPPORTED",
            domain="general",
            gloss_sequence=[],
            consent_id="consent",
        )
    entries = [
        queue.enqueue(
            session_id="session",
            translation_id=f"translation-{index}",
            original_text="원문",
            corrected_text=f"수정 {index}",
            reason="OTHER",
            domain="general",
            gloss_sequence=[],
            consent_id="consent",
        )
        for index in range(2)
    ]
    assert queue.delete(entries[0]["feedbackId"], session_id="session")["deleted"] is True
    assert len(queue.list_entries("session")) == 1
    assert queue.clear(session_id="session") == {"deletedCount": 1, "remainingCount": 0}


def test_general_feedback_requires_two_distinct_expert_roles_before_training(tmp_path: Path) -> None:
    queue = CorrectionFeedbackQueue(tmp_path)
    feedback = queue.enqueue(
        session_id="session",
        translation_id="translation",
        original_text="원문",
        corrected_text="자연스러운 수정문입니다.",
        reason="WORD_ORDER",
        domain="public",
        gloss_sequence=["서류", "발급"],
        consent_id="consent",
    )
    first = queue.review(
        feedback["feedbackId"],
        reviewer_id="ksl-interpreter-1",
        reviewer_role="KSL_INTERPRETER",
        decision="APPROVE",
        meaning_preservation=5,
        korean_naturalness=5,
        misrecognition_risk=1,
        notes="의미와 문장이 적절합니다.",
    )
    assert first["status"] == "IN_REVIEW"
    assert first["trainingEligible"] is False
    approved = queue.review(
        feedback["feedbackId"],
        reviewer_id="accessibility-expert-1",
        reviewer_role="ACCESSIBILITY_UX_EXPERT",
        decision="APPROVE",
        meaning_preservation=4,
        korean_naturalness=5,
        misrecognition_risk=2,
        notes="화면 문장으로 명확합니다.",
    )
    assert approved["status"] == "APPROVED"
    assert approved["trainingEligible"] is True
    assert queue.training_candidates()[0]["targetKoreanText"] == "자연스러운 수정문입니다."
    assert len(queue.review_history(feedback["feedbackId"])) == 2


def test_high_stakes_feedback_requires_domain_expert_and_rejection_is_final(tmp_path: Path) -> None:
    queue = CorrectionFeedbackQueue(tmp_path)
    medical = queue.enqueue(
        session_id="session",
        translation_id="medical-translation",
        original_text="아프다.",
        corrected_text="통증이 매우 심합니다.",
        reason="CONTEXT_ERROR",
        domain="medical",
        gloss_sequence=["통증", "심하다"],
        consent_id="consent",
    )
    queue.review(
        medical["feedbackId"],
        reviewer_id="deaf-reviewer",
        reviewer_role="DEAF_SIGNER",
        decision="APPROVE",
        meaning_preservation=5,
        korean_naturalness=4,
        misrecognition_risk=2,
        notes="수어 의미가 보존됩니다.",
    )
    approved = queue.review(
        medical["feedbackId"],
        reviewer_id="medical-reviewer",
        reviewer_role="DOMAIN_EXPERT",
        decision="APPROVE",
        meaning_preservation=5,
        korean_naturalness=5,
        misrecognition_risk=1,
        notes="의료 맥락에 적절합니다.",
    )
    assert approved["status"] == "APPROVED"

    rejected = queue.enqueue(
        session_id="session",
        translation_id="rejected-translation",
        original_text="원문",
        corrected_text="부정확한 수정",
        reason="OTHER",
        domain="general",
        gloss_sequence=[],
        consent_id="consent",
    )
    result = queue.review(
        rejected["feedbackId"],
        reviewer_id="reviewer",
        reviewer_role="KSL_EDUCATOR",
        decision="REJECT",
        meaning_preservation=2,
        korean_naturalness=2,
        misrecognition_risk=5,
        notes="의미가 달라 반려합니다.",
    )
    assert result["status"] == "REJECTED"
    assert result["trainingEligible"] is False
    with pytest.raises(ValueError, match="already final"):
        queue.review(
            rejected["feedbackId"],
            reviewer_id="other-reviewer",
            reviewer_role="KSL_INTERPRETER",
            decision="APPROVE",
            meaning_preservation=5,
            korean_naturalness=5,
            misrecognition_risk=1,
            notes="",
        )


def test_review_approval_thresholds_and_duplicate_reviewer_are_enforced(tmp_path: Path) -> None:
    queue = CorrectionFeedbackQueue(tmp_path)
    feedback = queue.enqueue(
        session_id="session",
        translation_id="translation",
        original_text="원문",
        corrected_text="수정문",
        reason="OTHER",
        domain="general",
        gloss_sequence=[],
        consent_id="consent",
    )
    with pytest.raises(ValueError, match="Approval requires"):
        queue.review(
            feedback["feedbackId"],
            reviewer_id="reviewer",
            reviewer_role="KSL_INTERPRETER",
            decision="APPROVE",
            meaning_preservation=3,
            korean_naturalness=5,
            misrecognition_risk=1,
            notes="",
        )
    queue.review(
        feedback["feedbackId"],
        reviewer_id="reviewer",
        reviewer_role="KSL_INTERPRETER",
        decision="APPROVE",
        meaning_preservation=5,
        korean_naturalness=5,
        misrecognition_risk=1,
        notes="",
    )
    with pytest.raises(ValueError, match="same reviewer"):
        queue.review(
            feedback["feedbackId"],
            reviewer_id="reviewer",
            reviewer_role="KSL_INTERPRETER",
            decision="APPROVE",
            meaning_preservation=5,
            korean_naturalness=5,
            misrecognition_risk=1,
            notes="",
        )
