"""Unit tests for safety_telemetry — passive forbidden-term detector."""

import pytest
from structlog.testing import capture_logs

from main_agent.agents.utils.safety_telemetry import (
    detect_forbidden_terms,
    log_chat_emission,
)

# =============================================================================
# detect_forbidden_terms
# =============================================================================


@pytest.mark.unit
def test_clean_text_returns_empty_list():
    assert detect_forbidden_terms("I added a contact form to the home page.") == []


@pytest.mark.unit
def test_empty_text_returns_empty_list():
    assert detect_forbidden_terms("") == []
    assert detect_forbidden_terms(None) == []  # type: ignore[arg-type]


@pytest.mark.unit
def test_detects_layer_b_term():
    """Hosting / infra disclosure (the original screenshot leak)."""
    hits = detect_forbidden_terms("Your app is hosted on Cloudflare's edge")
    assert "Cloudflare" in hits


@pytest.mark.unit
def test_case_insensitive():
    hits = detect_forbidden_terms("uses cloudflare and CLOUDFLARE workers")
    # Both 'cloudflare' and 'CLOUDFLARE' should match (preserving case).
    cloudflare_hits = [h for h in hits if h.lower() == "cloudflare"]
    assert len(cloudflare_hits) == 2


@pytest.mark.unit
def test_word_boundaries_no_substring_false_positives():
    """`KV`/`D1`/`R2` must not match inside other words."""
    # 'skvwer' contains 'kv'; 'identifier1' has no D1; 'r2d2' has both R2 and D1
    # as standalone-ish words by ASCII boundaries — but 'skvwer' is the
    # critical false-positive case to guard against.
    assert "KV" not in detect_forbidden_terms("the skvwer command")
    assert "D1" not in detect_forbidden_terms("the identifier1 system")


@pytest.mark.unit
def test_claude_design_whitelist():
    """`Claude Design` is an allowed vendor product per safety doc § 4."""
    assert detect_forbidden_terms("Drop a Claude Design export here") == []
    assert detect_forbidden_terms("Stitch or Claude Design exports work") == []
    # Bare "Claude" (the model provider) is still flagged.
    assert "Claude" in detect_forbidden_terms("Claude is the model")


@pytest.mark.unit
def test_detects_layer_d_model_provider():
    """The 'what model are you' leak class."""
    hits = detect_forbidden_terms("I'm powered by Anthropic's Claude")
    assert "Anthropic" in hits
    assert "Claude" in hits


@pytest.mark.unit
def test_detects_layer_g_protocol_internals():
    hits = detect_forbidden_terms("Call sys_create on the RPC endpoint")
    assert "sys_create" in hits
    assert "RPC" in hits


# =============================================================================
# log_chat_emission
# =============================================================================


@pytest.mark.unit
def test_log_chat_emission_clean_text_is_silent():
    """No leak detected → no log event."""
    with capture_logs() as cap:
        log_chat_emission(
            "Page added to your app.",
            source_agent="chat_response_writer",
            session_id="s-123",
            user_prompt="add a page",
        )
    leak_events = [e for e in cap if e.get("event") == "chat_safety_leak"]
    assert leak_events == []


@pytest.mark.unit
def test_log_chat_emission_dirty_text_emits_event():
    """Leak detected → exactly one WARNING with the structured payload."""
    with capture_logs() as cap:
        log_chat_emission(
            "Hosted on Cloudflare's edge",
            source_agent="app_help_desk",
            session_id="s-456",
            user_prompt="where are you deployed?",
        )
    leak_events = [e for e in cap if e.get("event") == "chat_safety_leak"]
    assert len(leak_events) == 1
    event = leak_events[0]
    assert event["log_level"] == "warning"
    assert "Cloudflare" in event["terms_detected"]
    assert event["source_agent"] == "app_help_desk"
    assert event["session_id"] == "s-456"
    assert event["user_prompt"] == "where are you deployed?"


@pytest.mark.unit
def test_log_chat_emission_does_not_raise():
    """Telemetry must never break the chat path — covers all weird inputs."""
    # Various odd inputs; none should raise.
    log_chat_emission("", source_agent="x")  # type: ignore[arg-type]
    log_chat_emission(None, source_agent="x")  # type: ignore[arg-type]
    log_chat_emission(
        "Cloudflare " * 1000,
        source_agent="chat_response_writer",
        session_id=None,
        user_prompt=None,
    )


@pytest.mark.unit
def test_log_chat_emission_returns_none():
    """The function must never return anything (it's a side-effect-only logger)."""
    result = log_chat_emission(
        "Cloudflare", source_agent="app_help_desk", session_id="s", user_prompt="p"
    )
    assert result is None
