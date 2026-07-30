"""Helpers for normalized validation failure classification."""

from __future__ import annotations

import re

_JSX_TAG_RE = re.compile(r"</?([^\s>/]+)")

# Distinctive shape of a structured-output schema delimiter leaking into TSX:
# a closing quote, a comma, and a snake_case property key followed by ``:``
# (e.g. ``,component_name:``, ``,tsx_content:``). Real TSX rarely contains
# this exact byte sequence — the snake_case-then-colon-without-quotes form
# is the giveaway, since JS object literal keys with underscores are
# typically quoted or accessed via string indexers, and JSX attribute
# values use camelCase. False positives on legitimate inline objects
# (``{ snake_case: value }``) are acceptable: classification only fires
# when esbuild *also* reports a syntax error, so this is a refinement
# of an already-failing build, not a primary gate.
_SCHEMA_BLEED_RE = re.compile(r'"\s*,\s*[a-z]+(?:_[a-z0-9]+)+\s*:')


def contains_non_ascii_jsx_identifier(source: str) -> bool:
    """Return True when a JSX tag identifier contains non-ASCII characters."""
    for match in _JSX_TAG_RE.finditer(source or ""):
        tag_name = match.group(1)
        if not tag_name or not tag_name[:1].isalpha():
            continue
        if any(ord(ch) > 127 for ch in tag_name):
            return True
    return False


def contains_schema_bleed(source: str) -> bool:
    """Return True when the source contains a structured-output schema delimiter
    that has leaked into the TSX body (LLM emitted the response envelope
    boundary instead of clean code).
    """
    return bool(_SCHEMA_BLEED_RE.search(source or ""))


def classify_validation_failure(errors: list[str], source: str = "") -> str:
    """Map raw validation errors to a normalized failure class."""
    if contains_non_ascii_jsx_identifier(source):
        return "jsx_tag_corruption"

    joined = " ".join(errors or []).lower()

    # Schema-bleed precedence: when a syntax error coincides with a
    # structured-output delimiter shape (``"\s*,\s*key_name:``), flag it
    # as ``schema_bleed`` so the retry instruction can be specific instead
    # of the generic "Unterminated string literal" hint. Requires both
    # an error AND the source signature to avoid false-positive on
    # legitimate code that just happens to contain the pattern.
    if "unterminated" in joined and contains_schema_bleed(source):
        return "schema_bleed"

    if any(
        token in joined
        for token in (
            "direct document access",
            "document.getelementbyid",
            "document.queryselector",
            "document.createelement",
        )
    ):
        return "forbidden_document_api"

    if any(
        token in joined
        for token in (
            "low measured contrast",
            "contrast fail",
            "contrast 1.00:1",
            "text-on-primary",
            "text-inverse-on-surface",
            "inherited background",
        )
    ):
        return "contrast_token_mismatch"

    if any(token in joined for token in ("expected", "unexpected", "unterminated")):
        return "jsx_syntax_error"

    return "validation_failed"


def build_failure_detail(errors: list[str], source: str = "") -> dict[str, str]:
    """Build a normalized failure detail payload."""
    normalized_errors = [str(error).strip() for error in errors if str(error).strip()]
    return {
        "failure_class": classify_validation_failure(normalized_errors, source),
        "first_error": normalized_errors[0] if normalized_errors else "",
    }
