from __future__ import annotations


class SuhaError(Exception):
    """Base SDK error."""


class SuhaConnectionError(SuhaError):
    """The local core could not be reached."""


class SuhaTimeoutError(SuhaError):
    """An SDK operation exceeded its configured timeout."""


class SuhaSchemaError(SuhaError):
    """A response uses an unsupported or malformed schema."""


class SuhaApiError(SuhaError):
    def __init__(self, status_code: int, message: str, code: str | None = None, trace_id: str | None = None) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.trace_id = trace_id
