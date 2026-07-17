from suha_core.config import deep_merge


def test_deep_merge_preserves_nested_defaults() -> None:
    assert deep_merge({"a": {"x": 1, "y": 2}}, {"a": {"y": 3}}) == {"a": {"x": 1, "y": 3}}
