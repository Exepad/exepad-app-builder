"""Unit tests for replay sanitization helpers."""

import pytest

from tests.replay.sanitizer import sanitize_replay_payload, sanitize_replay_string

pytestmark = [pytest.mark.unit]


def test_sanitize_replay_string_redacts_runtime_identifiers():
    text = (
        "Session Session_abc123 User User_deadbeef request_123e4567-e89b-12d3-a456-426614174000 "
        "contact me at founder@example.com and fetch gs://prod-bucket/builds/output.json"
    )

    sanitized = sanitize_replay_string(text)

    assert "Session_abc123" not in sanitized
    assert "User_deadbeef" not in sanitized
    assert "founder@example.com" not in sanitized
    assert "gs://prod-bucket/builds/output.json" not in sanitized
    assert "<session>" in sanitized
    assert "<user>" in sanitized
    assert "<email>" in sanitized
    assert "gs://<bucket>/<object>" in sanitized


def test_sanitize_replay_payload_recurses():
    payload = {
        "session": "Session_abc123",
        "items": [
            "User_deadbeef",
            {"trace": "request_123e4567-e89b-12d3-a456-426614174000"},
        ],
    }

    sanitized = sanitize_replay_payload(payload)

    assert sanitized["session"] == "<session>"
    assert sanitized["items"][0] == "<user>"
    assert sanitized["items"][1]["trace"] == "<request>"
