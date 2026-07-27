"""Deterministic HTML / CSS parsing helpers used by DesignImporter readers.

These are pure-Python functions the LLM agent invokes via tool calls when
it needs precise JSON parsing, CSS variable resolution, or font-URL
extraction — work where LLM hallucination would be expensive.

Nothing in this module talks to the network, the DB, or the ADK runtime.
Testing is straightforward string-in, JSON-out.
"""

from __future__ import annotations

import json
import re
from typing import Iterable, Optional

from bs4 import BeautifulSoup

# ── Tailwind runtime config (Stitch) ───────────────────────────────────────


_TAILWIND_CONFIG_SCRIPT_RE = re.compile(
    r'<script\s+id\s*=\s*["\']tailwind-config["\'][^>]*>(.*?)</script>',
    re.DOTALL | re.IGNORECASE,
)

# Inside the script: `tailwind.config = {...}` or `window.tailwind = {...}`.
_TAILWIND_ASSIGN_RE = re.compile(
    r"tailwind\.config\s*=\s*(\{.*\})\s*$",
    re.DOTALL,
)


def parse_tailwind_config(html: str) -> Optional[dict]:
    """Extract the first `<script id="tailwind-config">` block and parse it.

    Stitch emits Tailwind config as a JS object literal, NOT strict JSON:

        tailwind.config = {
          darkMode: "class",
          theme: {
            extend: {
              colors: { "primary": "#7a5900", "secondary": "#47664b", ... },
              fontFamily: { headline: ["Noto Serif"], body: ["Plus Jakarta Sans"] },
              borderRadius: { DEFAULT: "0.25rem", lg: "1rem" },
            },
          },
        }

    This function:
      1. Finds the <script> block (first match wins).
      2. Extracts the object-literal after `tailwind.config =`.
      3. Lifts it to JSON-parseable text (quote unquoted keys, drop trailing
         commas) and parses it.

    Returns `None` when the script tag is absent or the body can't be
    coerced to JSON — callers fall back to an LLM inference path.
    """
    if not html:
        return None
    script_match = _TAILWIND_CONFIG_SCRIPT_RE.search(html)
    if script_match is None:
        return None
    body = script_match.group(1).strip()

    assign_match = _TAILWIND_ASSIGN_RE.search(body)
    if assign_match is None:
        return None
    object_literal = assign_match.group(1).strip()

    return _js_object_literal_to_dict(object_literal)


def _js_object_literal_to_dict(text: str) -> Optional[dict]:
    """Best-effort JS-object-literal → dict converter.

    Handles the Stitch export shape: unquoted alphanumeric keys, double-
    quoted string values, trailing commas, nested objects and arrays.
    Falls back to None on anything we don't recognize rather than guessing.
    """
    # Drop `//` single-line comments — Stitch's output is clean but be safe.
    text = re.sub(r"(?m)//[^\n]*$", "", text)
    # Quote unquoted alphanumeric keys: `{foo: "bar"}` → `{"foo": "bar"}`.
    text = re.sub(
        r"(?P<pre>[{,\s])([A-Za-z_][A-Za-z0-9_-]*)\s*:",
        lambda m: f'{m.group("pre")}"{m.group(2)}":',
        text,
    )
    # Drop trailing commas before `}` / `]`.
    text = re.sub(r",\s*(?P<close>[}\]])", r"\g<close>", text)
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return None


# ── Inline <style> blocks + :root variable map (Claude Design) ────────────


_STYLE_BLOCK_RE = re.compile(
    r"<style[^>]*>(.*?)</style>",
    re.DOTALL | re.IGNORECASE,
)
_ROOT_BLOCK_RE = re.compile(
    r":root\s*\{([^}]*)\}",
    re.DOTALL,
)
_CSS_VAR_DECL_RE = re.compile(
    r"(--[A-Za-z0-9_-]+)\s*:\s*([^;]+?)\s*;",
    re.DOTALL,
)
_VAR_REF_RE = re.compile(r"var\(\s*(--[A-Za-z0-9_-]+)(?:\s*,\s*([^)]+))?\s*\)")


def extract_style_blocks(html: str) -> list[str]:
    """Return the raw text of every inline `<style>` block in order."""
    if not html:
        return []
    return [m.group(1) for m in _STYLE_BLOCK_RE.finditer(html)]


def extract_root_vars(style_blocks: Iterable[str]) -> dict[str, str]:
    """Pull every `--var: value` declaration from `:root { ... }` blocks.

    Later blocks override earlier ones (standard CSS cascade).
    """
    variables: dict[str, str] = {}
    for block in style_blocks:
        for root_match in _ROOT_BLOCK_RE.finditer(block):
            body = root_match.group(1)
            for decl in _CSS_VAR_DECL_RE.finditer(body):
                name = decl.group(1)
                value = decl.group(2).strip()
                variables[name] = value
    return variables


_MAX_VAR_RESOLUTION_DEPTH = 8


def resolve_css_vars(value: str, root_vars: dict[str, str]) -> str:
    """Replace `var(--x)` / `var(--x, fallback)` with concrete values.

    Resolves chained references (e.g. `var(--x)` where `--x: var(--y)`)
    up to a small fixed depth to avoid pathological input cycles. When a
    referenced var is not in root_vars and no fallback is provided, the
    original `var(...)` expression is left untouched — callers decide
    whether to treat that as an error or pass through.
    """
    if not value or "var(" not in value:
        return value

    current = value
    for _ in range(_MAX_VAR_RESOLUTION_DEPTH):
        replaced = False

        def _sub(match: re.Match) -> str:
            nonlocal replaced
            name = match.group(1)
            fallback = (match.group(2) or "").strip() or None
            if name in root_vars:
                replaced = True
                return root_vars[name]
            if fallback is not None:
                replaced = True
                return fallback
            # Unknown var with no fallback — leave the expression alone.
            return match.group(0)

        new_value = _VAR_REF_RE.sub(_sub, current)
        if new_value == current or not replaced:
            return new_value
        current = new_value

    return current  # Exceeded depth — return best-effort partial resolution.


# ── Google Fonts <link> extraction ─────────────────────────────────────────


def extract_google_fonts_links(html: str) -> list[str]:
    """Return every `fonts.googleapis.com` stylesheet URL in the HTML.

    Handles both `<link rel="stylesheet" href="...">` and `<link href="...">`
    variants in either order. Deduplicates while preserving first-seen order.
    """
    if not html:
        return []
    soup = BeautifulSoup(html, "html.parser")
    seen: dict[str, None] = {}
    for tag in soup.find_all("link"):
        href = tag.get("href") or ""
        if not href:
            continue
        if "fonts.googleapis.com" not in href:
            continue
        if href not in seen:
            seen[href] = None
    return list(seen.keys())
