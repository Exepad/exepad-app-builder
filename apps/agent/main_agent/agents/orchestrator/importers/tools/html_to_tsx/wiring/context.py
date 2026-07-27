"""Shared state for the Phase-2 wiring pass.

The walker creates one ``WiringContext`` per :func:`walk` call. Each
wiring rule (`images`, `links`, `forms`) consumes
inputs from the context (page slugs, form IDs, component role) and
writes outputs (SDK-import set, function-body preamble code).

The transformer reads the populated context to:

* Compose the final ``import { ... } from "@exepad/sdk";`` line by
  merging the wiring's ``sdk_imports`` set with the base imports.
* Inject the function-body preamble (e.g. ``handleSubmit`` definitions
  for forms) at the top of the generated function — between the
  function declaration and the ``return (...)``.

Two-way state separation:

* **Inputs** (read-only after construction): ``page_slugs``,
  ``form_ids``, ``component_role``.
* **Outputs** (mutated by wiring rules during walk): ``sdk_imports``,
  ``function_preamble``, ``warnings``.
"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class WiringContext:
    """Per-walk state passed to every wiring rule."""

    # Inputs --------------------------------------------------------------
    page_slugs: tuple[str, ...] = ()
    """Internal page slugs from ``app_context.pages`` for the link
    rewrite rule. Format: lowercase, leading slash. Empty tuple means
    the link rule never rewrites — it leaves every ``<a href>`` as-is."""

    page_routes: tuple[tuple[str, str], ...] = ()
    """``(slug, title)`` pairs for the chrome-nav fuzzy match in
    ``links.py``. When ``component_role`` is ``sidebar``/``header``/
    ``footer`` and an ``<a href="#">`` placeholder's inner text matches
    a page title (exact, whole-word, or token overlap), the link is
    rewritten to ``<Link to="{slug}">``. Empty tuple disables the
    rewrite (preserves the pass-through behavior for ``<a href="#">``).

    First wired 2026-05-15 to fix design-import sidebars where every
    nav item shipped as ``<a href="#">`` and clicking did nothing."""

    form_ids: tuple[str, ...] = ()
    """Deprecated/unused. The platform forms service was removed; no
    wiring rule reads this field. Retained for signature stability."""

    component_role: str = "content"
    """``content`` | ``header`` | ``footer`` | ``sidebar``. Phase 2
    uses this only as informational context — Phase 4 will key the
    mobile-nav scaffold off ``"header"``."""

    # Outputs (mutated during walk) --------------------------------------
    sdk_imports: set[str] = field(default_factory=set)
    """SDK members the wiring layer needs imported. Final import line
    composition adds ``React`` and ``LightDOMContainer`` unconditionally."""

    function_preamble: list[str] = field(default_factory=list)
    """Code blocks to splice into the generated function body, between
    the function declaration and the ``return (...)`` statement. One
    item per logical block (``handleSubmit`` definition, ``useState``
    declarations, etc.). The transformer joins them with double
    newlines."""

    warnings: list[str] = field(default_factory=list)
    """Non-fatal issues from wiring rules — e.g. ``"<picture> collapsed
    to inner <img>"``."""

    # Internal bookkeeping ------------------------------------------------
    _form_handler_emitted: bool = False
    """True once a ``handleSubmit`` definition has been added to
    ``function_preamble`` for this component. Subsequent forms in the
    same component reuse the single handler."""
