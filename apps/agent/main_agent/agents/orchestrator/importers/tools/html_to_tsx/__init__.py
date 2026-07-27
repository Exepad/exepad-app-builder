"""Mechanical HTML→TSX transformer for design imports.

Replaces the LLM translation hop in the design-import flow with a
deterministic Python pipeline. The transformer reads a cleaned HTML
artifact (already byte-faithful from the decomposition runner), emits a
TSX skeleton with Tailwind classnames preserved verbatim, and returns
sidecar JS/CSS bodies plus an augmented building_plan for ComponentBuilder
to consume in edit mode.

Pipeline (Phase 1 covers Pass 1 only; passes 2–5 land in later phases):

    Pass 1  HTML → TSX skeleton
    Pass 2  Wiring (forms / links / images / material symbols / imports)
    Pass 3  JS → mechanical hooks (useRef, useEffect, JSX onXxx)
    Pass 4  Mobile-nav scaffold (header components)
    Pass 5  Building-plan augmentation (behavioral residuals + wiring intentions)

Entry point: :func:`transform_html_to_tsx`.
"""

from .transformer import TransformResult, transform_html_to_tsx

__all__ = ["TransformResult", "transform_html_to_tsx"]
