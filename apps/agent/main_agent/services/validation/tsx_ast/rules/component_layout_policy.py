"""Component layout-policy rules.

Two small policy checks consolidated into one module:

- ``OverflowHiddenOnRootRule`` — ``overflow-hidden`` on the immediate
  child of ``<LightDOMContainer>``, which clips page scrolling.
- ``AnimateInBareDurationRule`` — ``animate-in`` paired with bare
  ``duration-N`` (causes implicit ``transition: all`` and a visible
  layout shift on first paint).
"""

from __future__ import annotations

import re
from typing import Iterator

from .base import AstContext, Finding

# ---------------------------------------------------------------------------
# Overflow-hidden on root
# ---------------------------------------------------------------------------


_OVERFLOW_ROOT_RE = re.compile(
    r"<LightDOMContainer\s*>\s*<\w+\s[^>]*?className=[\"']([^\"']+)[\"']",
    re.DOTALL,
)


class OverflowHiddenOnRootRule:
    """Warn when the root child of LightDOMContainer uses ``overflow-hidden``.

    Clips page scrolling — content below the fold becomes unreachable.
    The companion auto-fixer rewrites the root token to ``overflow-x-clip``
    (preserves horizontal clipping for canvases / sprite containers without
    breaking vertical page scroll), so this warning only ships when the
    fixer can't reach (e.g., dynamic className).
    """

    id = "component.layout.overflow_hidden_on_root"
    severity = "warning"

    def check(self, ctx: AstContext) -> Iterator[Finding]:
        m = _OVERFLOW_ROOT_RE.search(ctx.tsx)
        if not m:
            return
        if "overflow-hidden" not in m.group(1).split():
            return
        yield Finding(
            rule_id=self.id,
            severity="warning",
            message=(
                "Root element uses overflow-hidden — this clips page scrolling. "
                "The auto-fixer rewrites it to overflow-x-clip when reachable; "
                "if you see this warning, the className is dynamic — rewrite by hand."
            ),
            line=ctx.tsx[: m.start()].count("\n") + 1,
            col=0,
        )


# ---------------------------------------------------------------------------
# animate-in + bare duration-N
# ---------------------------------------------------------------------------


_BARE_DURATION_RE = re.compile(r"\bduration-(\d+|\[[^\]]+\])(?![\w-])")
_ANIMATE_IN_OUT_RE = re.compile(r"\banimate-(?:in|out)\b")
_TRANSITION_PROP_RE = re.compile(
    r"\btransition(?:-(?:all|colors|opacity|transform|shadow|none))?\b"
)
_DATA_STATE_GATE_RE = re.compile(r"data-\[state=[^\]]+\]:duration-\d")
_CLASSNAME_RE = re.compile(r'className=(?:"([^"]*)"|\{`([^`]*)`\})')


class AnimateInBareDurationRule:
    """Warn on ``animate-in`` + bare ``duration-N`` without a transition gate.

    Tailwind v4's ``.duration-N`` emits ``transition-duration: Ns``; CSS
    defaults ``transition-property`` to ``all`` when only duration is
    set, which makes EVERY computed-style change transition over N ms —
    including padding/margin/width when React mutates className between
    conditional render branches. Visible layout shift on first paint.

    Wrappers gating the duration with ``data-[state=...]:`` (shadcn
    Dialog / Sheet / Popover) are SAFE — duration only applies during
    state transitions, not on initial mount.

    Canonical pattern: replace ``duration-N`` with
    ``style={{ animationDuration: 'var(--animation-duration)' }}``.
    """

    id = "component.layout.animate_in_bare_duration"
    severity = "warning"

    def check(self, ctx: AstContext) -> Iterator[Finding]:
        tsx = ctx.tsx
        for m in _CLASSNAME_RE.finditer(tsx):
            classes = m.group(1) or m.group(2) or ""
            if not _ANIMATE_IN_OUT_RE.search(classes):
                continue
            if not _BARE_DURATION_RE.search(classes):
                continue
            ungated = _DATA_STATE_GATE_RE.sub("", classes)
            if not _BARE_DURATION_RE.search(ungated):
                continue
            if _TRANSITION_PROP_RE.search(classes):
                continue
            yield Finding(
                rule_id=self.id,
                severity="warning",
                message=(
                    f"`animate-in` paired with bare `duration-N` "
                    f"(in '{classes[:80]}…'): this implicitly enables "
                    f"`transition: all` because Tailwind v4's `duration-N` sets "
                    f"`transition-duration` without `transition-property`. On "
                    f"loading→loaded re-renders, padding/margin/width interpolate "
                    f"over N ms causing a visible layout shift on first paint. "
                    f'Replace with: `className="... animate-in fade-in-0" '
                    f"style={{{{ animationDuration: 'var(--animation-duration)' }}}}` "
                    f"— see agent_docs/frontend/component_builder/docs/10_COLOR_AND_LAYOUT.md."
                ),
                line=tsx[: m.start()].count("\n") + 1,
                col=0,
            )
