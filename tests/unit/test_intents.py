from suha_core.intents import IntentMapper


def test_mapping_profile_and_mode_filter() -> None:
    mapper = IntentMapper("config/intent-mapping.yaml")
    assert mapper.map("THUMB_UP", 0.9) == "CONFIRM"
    assert mapper.map("THUMB_UP", 0.5) == "NONE"
    assert mapper.map("THUMB_UP", 0.9, "SIGN_LANGUAGE_KSL") == "NONE"
    mapper.set_profile("gallery")
    assert mapper.map("SWIPE_LEFT", 0.9) == "GALLERY_NEXT"
