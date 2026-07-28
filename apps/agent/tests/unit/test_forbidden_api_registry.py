"""Invariants for ``services/validation/forbidden_api_registry``.

The registry is the single source of truth for the per-rule error
message and Pattern A retry guidance. These tests pin two invariants:

1. Every entry MUST declare ``has_auto_fix=True`` OR ``retry_guidance``.
   The dataclass enforces this at construction time; this test is a
   loud regression guard so adding a new entry without a recovery path
   fails CI rather than silently shipping.

2. The set of registered ``api_id`` keys MUST stay in sync with the
   ``emit()`` keys used by ``forbidden_apis.py``. If someone adds a
   new emit key in the AST rule without a registry entry,
   ``forbidden_apis._msg`` would silently fall back to its inline
   string and Pattern A's retry-guidance lookup would miss it.
"""

from __future__ import annotations

import pytest

from main_agent.services.validation import forbidden_api_registry as registry

pytestmark = [pytest.mark.unit]


# Keys that the AST rule actually emits (mirrors the emit() call sites in
# main_agent/services/validation/tsx_ast/rules/forbidden_apis.py). Update
# both sides when adding a new forbidden-API rule.
EXPECTED_EMIT_KEYS = frozenset(
    {
        "addEventListener",
        "console_log",
        "dom_access",
        "fetch",
        "cn",
        "call:eval",
        "new:Function",
        "new:XMLHttpRequest",
        "ident:localStorage",
        "ident:sessionStorage",
        "window_location",
        "innerhtml",
        "body_style_mutation",
        "url_create_object_url",
    }
)


def test_every_entry_has_auto_fix_or_retry_guidance():
    for api in registry.all_apis():
        assert api.has_auto_fix or api.retry_guidance, (
            f"ForbiddenApi {api.api_id!r} declares neither has_auto_fix=True "
            f"nor retry_guidance — every forbidden rule MUST give the LLM a "
            f"recovery path. Add a deterministic auto_fix in fixers/ OR "
            f"a retry_guidance string here."
        )


def test_construction_rejects_entries_with_neither_recovery_path():
    with pytest.raises(ValueError, match="must declare either"):
        registry.ForbiddenApi(
            api_id="bogus_test_only",
            error_message="never reached",
            has_auto_fix=False,
            retry_guidance=None,
        )


def test_registered_keys_match_ast_emit_keys():
    registered = {api.api_id for api in registry.all_apis()}
    missing = EXPECTED_EMIT_KEYS - registered
    extra = registered - EXPECTED_EMIT_KEYS
    assert not missing, (
        f"AST rule emits these keys but registry has no entry: {sorted(missing)}. "
        f"Pattern A's retry guidance won't fire for missing keys."
    )
    assert not extra, (
        f"Registry has entries that no AST rule emits: {sorted(extra)}. "
        f"Either delete the entry or add the corresponding emit() in "
        f"forbidden_apis.py."
    )


def test_get_returns_entry_or_none():
    assert registry.get("addEventListener") is not None
    assert registry.get("nonexistent_xxx") is None


def test_addEventListener_retry_guidance_includes_useEffect_pattern():
    """The Onix Studio HomeContent failure was specifically the
    ``addEventListener`` rule with no actionable retry guidance. Pin
    that the guidance contains the recommended useEffect+ref pattern.
    """
    entry = registry.get("addEventListener")
    assert entry is not None
    assert entry.retry_guidance is not None
    text = entry.retry_guidance
    assert "useEffect" in text
    assert "ref.current" in text
    assert "removeEventListener" in text  # cleanup function
    # And the React-prop alternative for events that DO have synthetics:
    assert "onX" in text or "onClick" in text


def test_console_log_advertises_auto_fix():
    """The auto-fix lives in component_forbidden_apis.py. The registry
    flag is the policy advertisement consumed by Pattern A's retry
    builder (no need to send retry_guidance for fixes that succeed
    deterministically — the user never sees the failure)."""
    entry = registry.get("console_log")
    assert entry is not None
    assert entry.has_auto_fix is True


def test_duplicate_registration_rejected():
    """Defensive: re-registering the same api_id at module load would
    silently overwrite the previous entry. _register guards against
    that."""
    existing = registry.get("addEventListener")
    assert existing is not None
    with pytest.raises(ValueError, match="Duplicate ForbiddenApi"):
        registry._register(  # type: ignore[attr-defined]
            registry.ForbiddenApi(
                api_id="addEventListener",
                error_message="x",
                retry_guidance="y",
            )
        )
