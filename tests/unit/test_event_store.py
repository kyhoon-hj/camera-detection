from pathlib import Path

from suha_core.domain import EventEnvelope
from suha_core.events import EventStore


def test_sqlite_event_persistence_and_retention(tmp_path: Path) -> None:
    store = EventStore(tmp_path / "events.db", retention_days=0)
    event = EventEnvelope("cam", "session", "GESTURE_STATIC", "THUMB_UP", "HOLD", 0.9, 500)
    store.append(event)
    assert store.latest(1)[0]["eventId"] == event.event_id
    assert store.prune(now=10**12) == 1
