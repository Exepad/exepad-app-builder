"""Lever B — deterministic content salvage from ``content_source`` (2026-06-27).

When a ``role == "content"`` page's body was eager-inlined into
``content_source`` at dispatch but the weak model STILL no-saved after Lever A's
independent re-rolls, the platform already holds the copy. The dominant residual
no-save is a long legal / policy page (~2.5 KB+ of body text is the single
hardest thing for a weak non-Gemini model to echo verbatim into one
``save_codefocus_component`` call). ``build_content_salvage_component_tsx``
renders that markdown into a real component;
``CreationWorkflow._salvage_unresolved_content_from_source`` swaps the
placeholder for it.

These tests pin the two pieces the fix hinges on:
- the markdown→TSX builder emits valid, non-placeholder TSX carrying the real
  copy, and is bulletproof against JSX-breaking body characters (the whole
  point of rendering every text run as a ``{"..."}`` JS-string expression); and
- the workflow salvage recovers a content slot, skips non-content + no-source
  slots, and mirrors ``_clear_if_recovered``'s UNRESOLVED / DETAILS / entry
  bookkeeping.

Repro: before the fix, ``LedgerLite``'s TermsContent (2571-byte body) shipped a
"needs attention" placeholder on deepseek-v4-flash even after two re-rolls.
"""

from __future__ import annotations

import asyncio
import base64
import json
import re
from types import SimpleNamespace

import pytest

from main_agent.agents.orchestrator.app_types.webapp.services.component_failure_service import (  # noqa: E501
    build_content_salvage_component_tsx,
    is_placeholder_tsx,
)
from main_agent.constants import StateKeys

pytestmark = [pytest.mark.unit]


_LEGAL_MD = """# Terms of Service

## 1. Acceptance of Terms
By accessing LedgerLite you agree to these Terms. If you do not agree, do not use the service.

## 2. Subscriptions & Billing
Paid plans renew automatically. You may cancel at any time.

- Free: up to 3 invoices/month
- Pro: unlimited invoices, $15/month
- Business: team seats, $39/month
"""


# ── build_content_salvage_component_tsx (pure) ───────────────────────────


def test_salvage_builder_renders_real_content_not_placeholder():
    tsx = build_content_salvage_component_tsx(
        "TermsContent", _LEGAL_MD, page_title="Terms of Service"
    )
    # A real component — never the "needs attention" placeholder card.
    assert is_placeholder_tsx(tsx) is False
    assert "needs your attention" not in tsx
    # Hard rules ComponentBuilder itself enforces.
    assert tsx.count("export default TermsContent") == 1
    assert 'from "@exepad/sdk"' in tsx
    assert "LightDOMContainer" in tsx
    assert "useState" not in tsx and "useEffect" not in tsx  # no hooks
    # The real copy survived (as JS-string payloads).
    assert "Acceptance of Terms" in tsx
    assert "unlimited invoices" in tsx
    assert "$15/month" in tsx
    # Block structure preserved: headings + list.
    assert "<h1" in tsx and "<h2" in tsx
    assert "<ul" in tsx and "<li" in tsx


def _text_payloads(tsx: str) -> list[str]:
    """Every ``{"..."}`` text payload, with its surrounding double quotes."""
    return re.findall(r"\{(\"(?:[^\"\\]|\\.)*\")\}", tsx)


def test_salvage_builder_is_jsx_safe_against_hostile_body():
    """Body characters that would break JSX (``< > { } " ` &`` and newlines)
    must be contained inside JS-string ``{"..."}`` payloads, never raw JSX."""
    hostile = (
        "# Privacy & Cookies <policy>\n\n"
        'We use "quotes", braces {like this}, tags <script>alert(1)</script>, '
        "backticks `code`, and an ampersand A & B.\n"
    )
    tsx = build_content_salvage_component_tsx("PrivacyContent", hostile)
    assert is_placeholder_tsx(tsx) is False
    # Every emitted text payload is a well-formed JS/JSON string literal
    # (json.loads validates the escape sequences are a legal string literal —
    # the same grammar a JS double-quoted literal uses for \\ and \").
    payloads = _text_payloads(tsx)
    assert payloads, 'expected at least one {"..."} text payload'
    decoded = " ".join(json.loads(p) for p in payloads)
    # The hostile text round-trips into the payloads (escaped), proving capture.
    assert "alert(1)" in decoded
    assert "{like this}" in decoded
    assert 'use "quotes"' in decoded
    # The hostile substrings exist ONLY inside string payloads — never as raw
    # JSX structure. Blank the payloads and the dangerous bits are gone: no
    # stray tag, no stray `{` expression-open, no unescaped quote.
    structure = re.sub(r"\{\"(?:[^\"\\]|\\.)*\"\}", "{TEXT}", tsx)
    assert "<script>" not in structure
    assert "<policy>" not in structure
    assert "{like this}" not in structure
    # No raw control characters anywhere in the generated source.
    assert not re.search(r"[\x00-\x08\x0b\x0c\x0e-\x1f]", tsx)


def test_salvage_builder_flattens_control_chars_in_body():
    """A raw control char in the body (the seed-JSON-parse-error failure class)
    must be flattened, not emitted into a `"..."` literal where it is illegal."""
    body = "# Title\n\nLine one\x01with a control char\tand a tab."
    tsx = build_content_salvage_component_tsx("X", body)
    for p in _text_payloads(tsx):
        json.loads(p)  # would raise if a raw control char survived
    assert "\x01" not in tsx


def test_salvage_builder_empty_returns_empty():
    assert build_content_salvage_component_tsx("X", "") == ""
    assert build_content_salvage_component_tsx("X", "   \n\n  ") == ""


def test_salvage_builder_titles_untitled_body():
    """A body with no heading of its own leads with the page_title as H1."""
    tsx = build_content_salvage_component_tsx(
        "AboutContent", "Just a paragraph of prose with no heading.", page_title="About Us"
    )
    assert "<h1" in tsx
    assert "About Us" in tsx


def test_salvage_builder_title_not_suppressed_by_heading_like_body_text():
    """A heading-less body that merely MENTIONS '<h1' in its prose must still
    get the page_title H1. The suppression probe is anchored to the block start,
    so an escaped '<h1' inside a {"..."} payload no longer false-suppresses it.
    (Review finding, 2026-06-27.)"""
    body = "Use the <h1> tag for the main page heading; lower levels for sub-sections."
    tsx = build_content_salvage_component_tsx("GuideContent", body, page_title="Heading Guide")
    # The page_title H1 is present (a real <h1 element at the block indent)...
    assert re.search(r"<h1\b", tsx)
    assert "Heading Guide" in tsx
    # ...and the body's literal '<h1>' lives only inside a JS-string payload,
    # never as raw JSX structure.
    structure = re.sub(r"\{\"(?:[^\"\\]|\\.)*\"\}", "{TEXT}", tsx)
    assert "<h1>" not in structure


# ── CreationWorkflow._salvage_unresolved_content_from_source ──────────────


def _ctx(state: dict, saved: dict) -> SimpleNamespace:
    async def save_artifact(*, session_id, user_id, app_name, filename, artifact):
        saved[filename] = artifact

    return SimpleNamespace(
        session=SimpleNamespace(id="s", user_id="u", app_name="a", state=state),
        artifact_service=SimpleNamespace(save_artifact=save_artifact),
    )


def _patch(monkeypatch, body):
    from main_agent.agents.orchestrator.app_types.webapp.workflows import (
        creation_workflow as cw,
    )

    async def fake_load(ctx, key):  # ArtifactManager.load_artifact_as_string
        return body

    async def fake_push(ctx, updates):  # push_session_state_update
        ctx.session.state.update(updates)

    monkeypatch.setattr(cw.ArtifactManager, "load_artifact_as_string", staticmethod(fake_load))
    monkeypatch.setattr(cw, "push_session_state_update", fake_push)
    return cw


def _decode_part(part) -> str:
    raw = part.inline_data.data
    if isinstance(raw, str):  # some google-genai builds store inline data b64
        raw = base64.b64decode(raw)
    return raw.decode("utf-8")


def test_workflow_salvages_content_slot(monkeypatch):
    """A still-unresolved content slot with an eager-loadable body is recovered:
    real TSX saved, dropped from UNRESOLVED + DETAILS, ComponentEntry appended."""
    cw = _patch(monkeypatch, _LEGAL_MD)
    saved: dict = {}
    state = {
        StateKeys.UNRESOLVED_COMPONENTS: {"TermsContent": "no save tool call"},
        StateKeys.COMPONENT_FAILURE_DETAILS: {"TermsContent": {"failure_class": "builder_no_save"}},
    }
    ctx = _ctx(state, saved)
    wf = cw.CreationWorkflow.__new__(cw.CreationWorkflow)
    entries: list = []
    plans = {
        "TermsContent": {
            "name": "TermsContent",
            "role": "content",
            "content_artifact": "content:terms:content.md",
            "page_title": "Terms of Service",
            "page_slug": "/terms",
        }
    }

    salvaged = asyncio.run(
        wf._salvage_unresolved_content_from_source(
            ctx, component_plans=list(plans.values()), component_entries=entries, agent_name="T"
        )
    )

    assert salvaged == ["TermsContent"]
    assert "TermsContent" not in ctx.session.state[StateKeys.UNRESOLVED_COMPONENTS]
    assert "TermsContent" not in ctx.session.state[StateKeys.COMPONENT_FAILURE_DETAILS]
    assert [e.name for e in entries] == ["TermsContent"]
    key = "codefocus_component:TermsContent.tsx"
    assert key in saved
    saved_tsx = _decode_part(saved[key])
    assert is_placeholder_tsx(saved_tsx) is False
    assert "Acceptance of Terms" in saved_tsx


def test_workflow_skips_non_content_slot(monkeypatch):
    """Header / footer / non-content slots are never content-salvaged."""
    cw = _patch(monkeypatch, _LEGAL_MD)
    saved: dict = {}
    state = {StateKeys.UNRESOLVED_COMPONENTS: {"MainHeader": "x"}}
    ctx = _ctx(state, saved)
    wf = cw.CreationWorkflow.__new__(cw.CreationWorkflow)
    plans = {
        "MainHeader": {
            "name": "MainHeader",
            "role": "header",
            "content_artifact": "content:home:content.md",
        }
    }

    salvaged = asyncio.run(
        wf._salvage_unresolved_content_from_source(
            ctx, component_plans=list(plans.values()), component_entries=[], agent_name="T"
        )
    )

    assert salvaged == []
    assert "MainHeader" in ctx.session.state[StateKeys.UNRESOLVED_COMPONENTS]
    assert saved == {}


def test_workflow_skips_content_without_source(monkeypatch):
    """A content slot with no eager-loadable body keeps its placeholder (the
    salvage never invents content)."""
    cw = _patch(monkeypatch, "")  # eager-load yields nothing
    saved: dict = {}
    state = {StateKeys.UNRESOLVED_COMPONENTS: {"DashboardContent": "x"}}
    ctx = _ctx(state, saved)
    wf = cw.CreationWorkflow.__new__(cw.CreationWorkflow)
    plans = {
        "DashboardContent": {
            "name": "DashboardContent",
            "role": "content",
            "content_artifact": "",
        }
    }

    salvaged = asyncio.run(
        wf._salvage_unresolved_content_from_source(
            ctx, component_plans=list(plans.values()), component_entries=[], agent_name="T"
        )
    )

    assert salvaged == []
    assert "DashboardContent" in ctx.session.state[StateKeys.UNRESOLVED_COMPONENTS]
    assert saved == {}


def test_workflow_skips_when_round_has_fatal(monkeypatch):
    """A fatal build aborts (SAVE_APP_CONFIG=False); never half-salvage a build
    that is about to fail — the gate lives inside the method."""
    cw = _patch(monkeypatch, _LEGAL_MD)
    saved: dict = {}
    state = {StateKeys.UNRESOLVED_COMPONENTS: {"TermsContent": "x"}}
    ctx = _ctx(state, saved)
    wf = cw.CreationWorkflow.__new__(cw.CreationWorkflow)
    plans = {
        "TermsContent": {
            "name": "TermsContent",
            "role": "content",
            "content_artifact": "content:terms:content.md",
        }
    }

    salvaged = asyncio.run(
        wf._salvage_unresolved_content_from_source(
            ctx,
            component_plans=list(plans.values()),
            component_entries=[],
            agent_name="T",
            round_has_fatal=True,
        )
    )

    assert salvaged == []
    assert "TermsContent" in ctx.session.state[StateKeys.UNRESOLVED_COMPONENTS]
    assert saved == {}
