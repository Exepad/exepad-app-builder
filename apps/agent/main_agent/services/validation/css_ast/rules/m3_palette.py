"""The M3 ``@theme`` palette must actually resolve — write-time enforcement.

This rule exists because of a real terminal failure. A model wrote a 7 KB
theme.css that passed every structural check and was saved as "validated"; four
minutes later the deploy step parsed the same file, found **zero** of the 30
required M3 colour tokens, and killed the workflow with:

    Theme palette resolution failed: theme.css is missing required resolved
    color tokens: background, error, error-container, ..., and 24 more

Nothing caught it earlier. The only rule that read the palette was
``M3ContrastPairsRule``, and it delegates to ``validate_contrast_pairs``, which
opens with ``if color_values:`` — so an EMPTY palette produced no findings and
passed. The one case that guarantees a downstream failure was the one case
write-time validation was blind to.

Checking here is what makes it recoverable: ``save_style_artifact`` feeds rule
errors back to the LLM and lets it retry (``_MAX_STYLE_SEMANTIC_RETRIES``), so a
palette in the wrong notation becomes "fix this and resubmit" instead of a dead
build. Severity is ``error`` for exactly that reason.
"""

from __future__ import annotations

from typing import Iterator

from main_agent.services.validation.style_coverage import (
    format_missing_palette_tokens,
    resolve_m3_palette,
)

from .base import CssContext, Finding


class M3PaletteCompleteRule:
    id = "style.m3.palette_incomplete"
    severity = "error"

    def check(self, ctx: CssContext) -> Iterator[Finding]:
        palette, missing = resolve_m3_palette(ctx.css)
        if not missing:
            return

        # Distinguish "no palette at all" from "a few tokens short". They have
        # completely different fixes, and the generic message sent the model
        # hunting for individual tokens when the real problem was that every
        # value was in a notation nothing could read.
        if not palette:
            detail = (
                "No colour tokens could be read from the @theme block at all. "
                "Every value must be a literal hex colour, e.g. "
                "`--color-primary: #1B5E20;`. Check that the @theme block exists "
                "and that values are not var() references."
            )
        else:
            detail = (
                f"Missing: {format_missing_palette_tokens(missing)}. "
                f"Add each as `--color-<token>: #hex;` inside @theme."
            )

        yield Finding(
            rule_id=self.id,
            severity="error",
            message=(
                f"@theme is missing {len(missing)} required Material 3 colour "
                f"token(s); the app cannot be deployed without them. {detail}"
            ),
            line=1,
            col=0,
        )
