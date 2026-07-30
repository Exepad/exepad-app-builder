"""``component.jsx.inline_style_tag`` — forbid raw ``<style>`` JSX
elements in component source.

The bug this catches
--------------------

App ``r3hfcgx5`` (2026-05-14): MainSidebar emitted a raw inline
``<style>`` element to declare scrollbar pseudo-element rules:

::

    <style>{`
      .custom-scrollbar::-webkit-scrollbar { width: 4px; }
      .custom-scrollbar::-webkit-scrollbar-thumb {
        background: rgba(255, 255, 255, 0.05);
      }
      ...
    `}</style>

Code Focus components render into the **light DOM** with the
compiled Tailwind CSS scoped via ``@layer exepad-app``. A raw
``<style>`` element bypasses that scope — its selectors apply
globally and can collide with sibling components or the runtime
shell. The pattern is fragile (selector specificity wars), bloats
the rendered DOM, and re-mounts the styles on every component
remount.

Severity
--------

Warning. The pattern usually works for genuine one-off needs
(custom scrollbars, fine-grained pseudo-element overrides), so we
don't block save. The warning steers the LLM toward Tailwind
arbitrary-value classes for the common cases.

Allowed: ``style={{...}}`` attributes
-------------------------------------

We only flag the ``<style>`` ELEMENT — not the ``style={{...}}``
attribute on regular JSX elements. The attribute form is the
intended React idiom for one-off inline styles and is heavily
used (and validated separately by the layout-policy rule for
the animation-duration variant).

Allowed: dangerouslySetInnerHTML
--------------------------------

We do NOT walk template-literal CSS embedded inside
``dangerouslySetInnerHTML`` (e.g. inside a ``<script>`` body for a
3D canvas). The pattern is rare and orthogonal; chasing it would
risk false positives on legitimate SSR-style HTML injection.
"""

from __future__ import annotations

import re
from typing import Iterator

from .base import AstContext, Finding


_RULE_ID = "component.jsx.inline_style_tag"


# Match a JSX opening ``<style ...>`` tag. The ``(?<![\w])`` prefix
# avoids matching identifiers like ``<MyStyle>`` (PascalCase React
# component) or ``<styled.div>`` (styled-components syntax). We also
# require the next character to be whitespace, ``>``, or ``/`` so
# things like ``<style-x>`` (CSS-in-JS pseudo-element) don't match.
_INLINE_STYLE_TAG_RE = re.compile(r"(?<![\w])<style(?=[\s>/])")


class InlineStyleTagRule:
    """Warn on raw ``<style>...</style>`` JSX elements in components.

    Code Focus components render in the light DOM. A raw ``<style>``
    element bypasses the ``@layer exepad-app`` scope, applying its
    selectors globally and risking cross-component collisions.
    """

    id = _RULE_ID
    severity = "warning"

    def check(self, ctx: AstContext) -> Iterator[Finding]:
        tsx = ctx.tsx
        for m in _INLINE_STYLE_TAG_RE.finditer(tsx):
            line = tsx[: m.start()].count("\n") + 1
            yield Finding(
                rule_id=_RULE_ID,
                severity="warning",
                line=line,
                col=0,
                message=(
                    "Raw `<style>` JSX element bypasses the @layer "
                    "exepad-app scope and applies its selectors "
                    "globally — risks collisions with sibling "
                    "components and the runtime shell. Prefer Tailwind "
                    "arbitrary-value classes for one-off styling, or "
                    "extend `theme.css` for design-system-wide rules."
                ),
                fix_hint=(
                    "Replace the `<style>` element with Tailwind "
                    "arbitrary classes (e.g. "
                    "`[&::-webkit-scrollbar]:w-1 "
                    "[&::-webkit-scrollbar-thumb]:bg-white/5`). For "
                    "design-system-wide rules, add them to "
                    "`theme.css` under `@layer exepad-app`."
                ),
            )
