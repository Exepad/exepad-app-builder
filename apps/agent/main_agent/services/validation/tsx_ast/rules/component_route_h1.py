"""Per-route H1 rule.

Route-level page components must contain at least one ``<h1>`` heading
in their JSX tree. SEO crawlers and screen readers rely on a single
top-level heading per route to identify the page's primary purpose.

Detection heuristic — "route component" means a TSX file whose component
name (resolved from ``ctx.expected_export_name``, which the orchestrator
sets to the file's declared default export) ends with ``Content`` or
``Page``. This matches the codebase convention used across every
generated app: pages config maps ``/menu`` → ``MenuContent``,
``/about`` → ``AboutContent``, ``/`` → ``HomeContent``, etc.

The rule does NOT fire on:
- Inner UI components (``Card``, ``Section``, ``Hero``, ``Dialog`` …) —
  those legitimately use ``<h2>``..``<h6>`` even when they contain
  prominent text.
- Header / footer / sidebar components (handled by their own naming
  conventions and a11y role rules).
- Files where ``expected_export_name`` is unset — defensive fail-open.

No auto-fix. The H1 text must match the page's content; mechanical
synthesis would either pick a generic placeholder or leak template
literals into shipped code. Warning-only ships in the SSE response so
the LLM can promote a heading on the next edit pass.

Regression source: in app ``6z5k25jk`` (L'Anima di Roma), only the home
route ``/`` shipped an ``<h1>``. The other 5 routes (``/menu``,
``/gallery``, ``/about``, ``/contact``, ``/reservations``) all started
with ``<h2>`` — SEO and a11y impact across the whole app.
"""

from __future__ import annotations

from typing import Iterator

from .base import AstContext, Finding
from .component_jsx import _iter_jsx_opening_elements, _jsx_tag_name


_ROUTE_COMPONENT_SUFFIXES = ("Content", "Page")


class PerRouteH1Rule:
    """Warn when a route-level component has no ``<h1>`` heading."""

    id = "component.a11y.per_route_h1"
    severity = "warning"

    def check(self, ctx: AstContext) -> Iterator[Finding]:
        name = ctx.expected_export_name or ""
        if not name:
            return
        if not any(name.endswith(suffix) for suffix in _ROUTE_COMPONENT_SUFFIXES):
            return

        for el in _iter_jsx_opening_elements(ctx.tree.root_node):
            if _jsx_tag_name(el, ctx.source_buf) == "h1":
                return  # found one — rule satisfied

        yield Finding(
            rule_id=self.id,
            severity="warning",
            message=(
                f'Route component "{name}" has no <h1> heading. Each page '
                f"must carry one top-level heading for SEO and a11y — "
                f"promote the most prominent <h2> on this page to <h1>, "
                f"and demote other headings if needed to keep heading order."
            ),
            line=1,
            col=0,
        )
