"""Helpers for sanitizing production-shaped replay fixtures."""

from __future__ import annotations

import re
from typing import Any

UUID_RE = re.compile(
    r"\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-"
    r"[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}\b"
)
SESSION_RE = re.compile(r"\bSession_[A-Za-z0-9]+\b")
USER_RE = re.compile(r"\bUser_[A-Za-z0-9]+\b")
REQUEST_RE = re.compile(r"\brequest_[A-Za-z0-9-]+\b")
GS_RE = re.compile(r"gs://[^\s\"']+")
EMAIL_RE = re.compile(r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b", re.IGNORECASE)


def sanitize_replay_string(text: str) -> str:
    """Replace obviously sensitive runtime identifiers with stable placeholders."""
    sanitized = UUID_RE.sub("<uuid>", text)
    sanitized = SESSION_RE.sub("<session>", sanitized)
    sanitized = USER_RE.sub("<user>", sanitized)
    sanitized = REQUEST_RE.sub("<request>", sanitized)
    sanitized = GS_RE.sub("gs://<bucket>/<object>", sanitized)
    sanitized = EMAIL_RE.sub("<email>", sanitized)
    return sanitized


def sanitize_replay_payload(value: Any) -> Any:
    """Recursively sanitize strings within dict/list replay payloads."""
    if isinstance(value, str):
        return sanitize_replay_string(value)
    if isinstance(value, list):
        return [sanitize_replay_payload(item) for item in value]
    if isinstance(value, dict):
        return {key: sanitize_replay_payload(item) for key, item in value.items()}
    return value
