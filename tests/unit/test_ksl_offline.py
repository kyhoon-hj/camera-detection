import pytest
from suha_core.ksl import KslOfflineRuntime


def test_offline_runtime_exposes_emergency_basic_and_versioned_package() -> None:
    runtime = KslOfflineRuntime()
    capabilities = runtime.capabilities()
    package = runtime.package()
    assert capabilities["offlineReady"] is True
    assert capabilities["networkRequired"] is False
    assert capabilities["emergencyExpressionCount"] >= 6
    assert capabilities["basicSentenceCount"] >= 10
    assert package["version"] == capabilities["packageVersion"]
    assert package["status"] == "ACTIVE"
    assert package["updatePolicy"] == "MANUAL_EXPLICIT_CONSENT"


def test_offline_settings_default_safe_and_clear_with_session() -> None:
    runtime = KslOfflineRuntime()
    assert runtime.settings("session")["mode"] == "OFFLINE_ONLY"
    configured = runtime.configure(
        "session", mode="ONLINE_ALLOWED", allow_online_enhancement=True
    )
    assert configured["allowOnlineEnhancement"] is True
    assert runtime.translation_metadata("session")["networkUsed"] is False
    runtime.clear("session")
    assert runtime.settings("session")["mode"] == "OFFLINE_ONLY"
    with pytest.raises(ValueError, match="cannot be enabled"):
        runtime.configure("session", mode="OFFLINE_ONLY", allow_online_enhancement=True)
