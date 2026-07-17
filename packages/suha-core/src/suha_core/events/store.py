from __future__ import annotations

import json
import sqlite3
import time
from pathlib import Path
from typing import Any

from suha_core.domain import EventEnvelope


class EventStore:
    def __init__(self, path: str | Path = "data/suha-events.db", retention_days: int = 7) -> None:
        self.path = str(path)
        self.retention_days = retention_days
        Path(self.path).parent.mkdir(parents=True, exist_ok=True)
        with self._connect() as connection:
            connection.execute("CREATE TABLE IF NOT EXISTS events (event_id TEXT PRIMARY KEY, created_at REAL NOT NULL, payload TEXT NOT NULL)")
            connection.execute("CREATE INDEX IF NOT EXISTS idx_events_created_at ON events(created_at)")

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.path, timeout=0.25)
        connection.execute("PRAGMA journal_mode=WAL")
        connection.execute("PRAGMA busy_timeout=250")
        return connection

    def append(self, event: EventEnvelope) -> None:
        with self._connect() as connection:
            connection.execute(
                "INSERT OR REPLACE INTO events(event_id, created_at, payload) VALUES (?, ?, ?)",
                (event.event_id, time.time(), json.dumps(event.to_dict())),
            )

    def latest(self, limit: int = 100) -> list[dict[str, Any]]:
        with self._connect() as connection:
            rows = connection.execute("SELECT payload FROM events ORDER BY created_at DESC LIMIT ?", (limit,)).fetchall()
        return [json.loads(row[0]) for row in reversed(rows)]

    def prune(self, now: float | None = None) -> int:
        cutoff = (now if now is not None else time.time()) - self.retention_days * 86400
        with self._connect() as connection:
            cursor = connection.execute("DELETE FROM events WHERE created_at < ?", (cutoff,))
            return int(cursor.rowcount)
