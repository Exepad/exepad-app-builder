"""Deterministic decomposition pass for the DesignImporter.

The DesignImporter LLM produces a small ``DecompositionPlan`` JSON describing
slug mappings, header/footer roles, theme token mappings, and backend intent.
This package then deterministically:

  * Loads the original ``bundle:*`` artifacts.
  * Strips ``<head>``-scoped chrome and HTML comments via BeautifulSoup.
  * Lifts ``<style>`` blocks (and shared ``styles.css``) into
    ``codefocus_style:theme.css`` ``@layer exepad-app``.
  * Transforms Claude Design ``.ph`` placeholders into ``<img>`` tags using the
    inline ``PH``/``MAP`` script data.
  * Emits ``content:<slug>:page.html`` and ``content:main:{header,footer,
    sidebar}.html`` artifacts byte-for-body-faithful from the source.
  * Synthesizes a Creator-compatible plan whose ``ComponentPlan`` entries
    reference the deterministically-emitted artifacts.

Body-level ``<script>`` tags are PRESERVED in the cleaned HTML so the
ComponentBuilder can translate their behavior into TSX. Only ``<head>``
scripts and the consumed ``.ph`` loader are removed.

Submodules:
  * ``plan`` — Pydantic schema (``DecompositionPlan`` and friends).
  * ``html_cleaner`` — body extraction.
  * ``style_lifter`` — CSS preservation.
  * ``ph_transformer`` — Claude Design placeholder → ``<img>``.
  * ``handlers`` — format-specific dispatch.
  * ``runner`` — pipeline entry point.
"""
