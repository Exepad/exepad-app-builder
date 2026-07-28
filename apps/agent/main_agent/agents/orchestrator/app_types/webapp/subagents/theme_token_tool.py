"""
add_theme_tokens — ComponentBuilder tool for adding design tokens to theme.css.

Idempotently splices ``--color-*`` / ``--font-*`` declarations into the
``@theme { }`` block of ``codefocus_style:theme.css``. ComponentBuilder
calls this when it writes TSX referencing a class outside the existing
token set, so the new declaration ships alongside the component.

The tool_context parameter is automatically injected by ADK.
"""

import re
import structlog
from google.adk.tools import FunctionTool
from google.adk.tools.tool_context import ToolContext
from google import genai

from main_agent.services.validation.style_coverage import splice_tokens_into_theme

logger = structlog.get_logger(__name__)

STYLE_ARTIFACT_PREFIX = "codefocus_style:"
THEME_FILENAME = f"{STYLE_ARTIFACT_PREFIX}theme.css"

# Token name shape: lowercase letters / digits / hyphens, must start with a letter.
# Matches existing M3 tokens like "color-tertiary-fixed", "font-display".
_TOKEN_NAME_RE = re.compile(r"^[a-z][a-z0-9-]*$")
# Acceptable values: hex (#rgb / #rrggbb / #rrggbbaa), `var(--name)`, or
# `hsl(...)` / `hsla(...)`. Reject arbitrary strings — keeps the LLM honest.
_HEX_RE = re.compile(r"^#[0-9a-fA-F]{3,8}$")
_VAR_REF_RE = re.compile(r"^var\(--[a-z][a-z0-9-]*\)$")
_HSL_RE = re.compile(r"^hsla?\([^)]+\)$")


def _is_valid_token_value(value: str) -> bool:
    if not isinstance(value, str):
        return False
    v = value.strip()
    return bool(_HEX_RE.match(v) or _VAR_REF_RE.match(v) or _HSL_RE.match(v))


# Backwards-compatible alias — the canonical implementation lives in
# `services/validation/style_coverage.py` so the auto_fix_missing_m3_colors
# pipeline and this tool share one splice algorithm.
_splice_tokens_into_theme = splice_tokens_into_theme


async def add_theme_tokens(
    tool_context: ToolContext,
    names: list[str],
    values: list[str],
    rationale: str = "",
) -> dict:
    """Add new design tokens to ``codefocus_style:theme.css``.

    Splices ``--<name>: <value>;`` declarations into the existing ``@theme``
    block. Idempotent — token names already defined are left as-is and
    reported under ``skipped_duplicates``.

    Pass two parallel lists:

      names  = ["color-tertiary-fixed", "color-accent"]
      values = ["#d6c4a3",              "#7fb069"]

    Names use lowercase letters / digits / hyphens, no leading "--".
    Values must be hex (e.g. ``#d6c4a3``), HSL (e.g. ``hsl(28 30% 75%)``),
    or a var reference (e.g. ``var(--color-primary)``).

    The optional ``rationale`` is logged for debugging — describe why these
    tokens are needed (e.g. ``"hero badge needs subtle accent beyond M3 base"``).

    Returns:
        ``{"success": bool, "added": [...], "skipped_duplicates": [...],
           "errors": [...], "version": int (only on save)}``
    """
    errors: list[str] = []

    if len(names) != len(values):
        return {
            "success": False,
            "added": [],
            "skipped_duplicates": [],
            "errors": [
                f"names ({len(names)}) and values ({len(values)}) must be the "
                f"same length — pass parallel arrays."
            ],
        }

    valid_pairs: dict[str, str] = {}
    for raw_name, raw_value in zip(names, values):
        name = (raw_name or "").strip().lstrip("-")
        value = (raw_value or "").strip()
        if not _TOKEN_NAME_RE.match(name):
            errors.append(
                f"Invalid token name '{raw_name}': use lowercase letters, "
                f"digits, hyphens (e.g. 'color-tertiary-fixed')."
            )
            continue
        if not _is_valid_token_value(value):
            errors.append(
                f"Invalid value for '{name}': '{raw_value}'. "
                f"Use hex (#rrggbb), hsl(h s% l%), or var(--token-name)."
            )
            continue
        valid_pairs[name] = value

    if errors and not valid_pairs:
        return {"success": False, "added": [], "skipped_duplicates": [], "errors": errors}

    if not valid_pairs:
        return {"success": True, "added": [], "skipped_duplicates": [], "errors": []}

    # ── Load current theme.css artifact ──────────────────────────────────
    artifact = await tool_context.load_artifact(filename=THEME_FILENAME)
    if artifact is None or not hasattr(artifact, "inline_data") or artifact.inline_data is None:
        return {
            "success": False,
            "added": [],
            "skipped_duplicates": [],
            "errors": [
                f"Could not load theme artifact '{THEME_FILENAME}'. "
                f"DesignSystemBuilder must save the theme before tokens can be added."
            ],
        }

    css_source = artifact.inline_data.data.decode("utf-8")

    if "@theme" not in css_source:
        return {
            "success": False,
            "added": [],
            "skipped_duplicates": [],
            "errors": [
                "theme.css has no @theme block — tokens cannot be spliced. "
                "DesignSystemBuilder must regenerate the theme."
            ],
        }

    new_css, added, skipped = _splice_tokens_into_theme(css_source, valid_pairs)

    if new_css == css_source:
        # Either every token was a duplicate, or splice failed silently.
        logger.info(
            "[add_theme_tokens] No new tokens spliced",
            requested=list(valid_pairs.keys()),
            skipped_duplicates=skipped,
            rationale=rationale,
        )
        return {
            "success": True,
            "added": [],
            "skipped_duplicates": skipped,
            "errors": errors,
        }

    # ── Save new theme.css artifact ──────────────────────────────────────
    #
    # No post-splice css_ast revalidation: the existing theme.css already
    # passed `theme_css_rules()` when DesignSystemBuilder saved it, and we
    # only append well-formed ``--name: value;`` declarations inside the
    # existing ``@theme { }`` block. Name and value shapes are pre-validated
    # above. Anything stricter (full SDK-variable structure, contrast pairs,
    # etc.) belongs to DesignSystemBuilder's own pre-save check, not here.
    css_bytes = new_css.encode("utf-8")
    artifact_part = genai.types.Part.from_bytes(data=css_bytes, mime_type="text/plain")
    version = await tool_context.save_artifact(filename=THEME_FILENAME, artifact=artifact_part)

    logger.info(
        "[add_theme_tokens] Added tokens to theme.css",
        added=added,
        skipped_duplicates=skipped,
        rationale=rationale,
        version=version,
        bytes=len(css_bytes),
    )

    return {
        "success": True,
        "added": added,
        "skipped_duplicates": skipped,
        "errors": errors,
        "version": version,
    }


# Register as FunctionTool — ComponentBuilder uses this
add_theme_tokens_tool = FunctionTool(add_theme_tokens)
