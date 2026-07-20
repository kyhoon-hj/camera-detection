from __future__ import annotations

import json
import re
import threading
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from .catalog import CORE_EXPRESSIONS

GLOSS_CODE = re.compile(r"^[A-Z][A-Z0-9_]{1,63}$")
GLOSS_STATUSES = {"DRAFT", "PENDING_REVIEW", "APPROVED", "RETIRED"}


def _now() -> str:
    return datetime.now(UTC).isoformat()


@dataclass(frozen=True, slots=True)
class GlossEntry:
    code: str
    gloss: str
    korean_text: str
    domains: list[str]
    aliases: list[str]
    emergency: bool
    status: str
    revision: int
    source: str
    updated_at: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "code": self.code,
            "gloss": self.gloss,
            "koreanText": self.korean_text,
            "domains": self.domains,
            "aliases": self.aliases,
            "emergency": self.emergency,
            "status": self.status,
            "revision": self.revision,
            "source": self.source,
            "updatedAt": self.updated_at,
        }


class GlossRegistry:
    def __init__(self, root: str | Path) -> None:
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)
        self._registry_path = self.root / "glossary.json"
        self._audit_path = self.root / "glossary-audit.jsonl"
        self._entries: dict[str, GlossEntry] = {}
        self._lock = threading.RLock()
        self._load_or_seed()

    def list_entries(
        self, *, domain: str | None = None, status: str | None = None
    ) -> list[dict[str, Any]]:
        entries = sorted(self._entries.values(), key=lambda entry: entry.code)
        return [
            entry.to_dict()
            for entry in entries
            if (domain is None or domain in entry.domains) and (status is None or status == entry.status)
        ]

    def get(self, code: str) -> dict[str, Any]:
        return self._get(code.upper()).to_dict()

    def register(
        self,
        *,
        code: str,
        gloss: str,
        korean_text: str,
        domains: list[str],
        aliases: list[str] | None = None,
        emergency: bool = False,
        status: str = "DRAFT",
        actor: str = "local-admin",
    ) -> dict[str, Any]:
        normalized = code.upper()
        self._validate(normalized, gloss, korean_text, domains, status)
        with self._lock:
            if normalized in self._entries:
                raise ValueError(f"Gloss already exists: {normalized}")
            entry = GlossEntry(
                normalized,
                gloss.strip(),
                korean_text.strip(),
                sorted(set(domains)),
                sorted(set(aliases or [])),
                emergency,
                status,
                1,
                "ADMIN",
                _now(),
            )
            self._entries[normalized] = entry
            self._persist()
            self._audit("REGISTERED", entry, actor)
        return entry.to_dict()

    def update(
        self,
        code: str,
        *,
        gloss: str | None = None,
        korean_text: str | None = None,
        domains: list[str] | None = None,
        aliases: list[str] | None = None,
        emergency: bool | None = None,
        status: str | None = None,
        actor: str = "local-admin",
    ) -> dict[str, Any]:
        normalized = code.upper()
        with self._lock:
            current = self._get(normalized)
            next_gloss = gloss.strip() if gloss is not None else current.gloss
            next_korean = korean_text.strip() if korean_text is not None else current.korean_text
            next_domains = sorted(set(domains)) if domains is not None else current.domains
            next_status = status if status is not None else current.status
            self._validate(normalized, next_gloss, next_korean, next_domains, next_status)
            entry = GlossEntry(
                normalized,
                next_gloss,
                next_korean,
                next_domains,
                sorted(set(aliases)) if aliases is not None else current.aliases,
                emergency if emergency is not None else current.emergency,
                next_status,
                current.revision + 1,
                current.source,
                _now(),
            )
            self._entries[normalized] = entry
            self._persist()
            self._audit("UPDATED", entry, actor, previousRevision=current.revision)
        return entry.to_dict()

    def history(self, limit: int = 100) -> list[dict[str, Any]]:
        if not self._audit_path.is_file():
            return []
        records: list[dict[str, Any]] = []
        for line in self._audit_path.read_text(encoding="utf-8").splitlines():
            try:
                value: Any = json.loads(line)
            except json.JSONDecodeError:
                continue
            if isinstance(value, dict):
                records.append(value)
        return records[-max(0, min(limit, 1000)) :]

    def _get(self, code: str) -> GlossEntry:
        try:
            return self._entries[code]
        except KeyError as error:
            raise KeyError(f"Gloss not found: {code}") from error

    def _load_or_seed(self) -> None:
        if self._registry_path.is_file():
            raw: Any = json.loads(self._registry_path.read_text(encoding="utf-8"))
            if not isinstance(raw, dict):
                raise ValueError("Gloss registry root must be an object")
            entries = raw.get("entries", [])
            if not isinstance(entries, list):
                raise ValueError("Gloss registry entries must be a list")
            for item in entries:
                if isinstance(item, dict):
                    entry = self._from_dict(item)
                    self._entries[entry.code] = entry
            return
        now = _now()
        self._entries = {
            item.code: GlossEntry(
                item.code,
                item.gloss,
                item.korean_text,
                list(item.domains),
                [],
                item.emergency,
                "PENDING_REVIEW",
                1,
                "CORE_CATALOG",
                now,
            )
            for item in CORE_EXPRESSIONS
        }
        self._persist()

    @staticmethod
    def _from_dict(value: dict[str, Any]) -> GlossEntry:
        return GlossEntry(
            str(value["code"]),
            str(value["gloss"]),
            str(value["koreanText"]),
            [str(item) for item in value.get("domains", [])],
            [str(item) for item in value.get("aliases", [])],
            bool(value.get("emergency", False)),
            str(value["status"]),
            int(value["revision"]),
            str(value.get("source", "ADMIN")),
            str(value["updatedAt"]),
        )

    @staticmethod
    def _validate(code: str, gloss: str, korean_text: str, domains: list[str], status: str) -> None:
        if not GLOSS_CODE.fullmatch(code):
            raise ValueError("Gloss code must use uppercase letters, digits and underscores")
        if not gloss.strip() or not korean_text.strip():
            raise ValueError("Gloss and Korean text are required")
        if not domains or any(not item.strip() for item in domains):
            raise ValueError("At least one non-empty domain is required")
        if status not in GLOSS_STATUSES:
            raise ValueError(f"Unsupported Gloss status: {status}")

    def _persist(self) -> None:
        payload = {
            "schemaVersion": "1.0",
            "entries": self.list_entries(),
            "updatedAt": _now(),
        }
        temporary = self._registry_path.with_suffix(".json.tmp")
        temporary.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        temporary.replace(self._registry_path)

    def _audit(self, action: str, entry: GlossEntry, actor: str, **details: Any) -> None:
        record = {
            "timestamp": _now(),
            "action": action,
            "code": entry.code,
            "revision": entry.revision,
            "actor": actor,
            "entry": entry.to_dict(),
            **details,
        }
        with self._audit_path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(record, ensure_ascii=False) + "\n")
