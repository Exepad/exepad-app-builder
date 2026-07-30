"""
Handler failure service — deterministic safe stub for a backend handler that
failed to generate (no artifact saved).

Mirrors the frontend ``webapp/services/component_failure_service.py`` placeholder
pattern. When ``BackendHandlerBuilder`` produces no ``handler_code:{name}.tsx``
artifact even after the one-shot retry, the generator writes this stub so the
artifact (and its compiled JS) exists at deploy time — upholding the ``1ybz1p4n``
guarantee — and the build continues to the frontend instead of aborting.

The stub returns an empty flat object (``{}``), matching the canonical handler
contract (a flat object keyed by the declared ``handler_plan.outputs``). Object
consumers (``data?.field`` → ``undefined``) and named-array consumers
(``data?.items ?? []``) both degrade to an empty state rather than breaking, so
a component bound to the missing handler renders empty.
"""

from __future__ import annotations

PLACEHOLDER_HANDLER_SENTINEL = "exepad:placeholder-handler"


def build_placeholder_handler_tsx(handler_name: str) -> str:
    """Return a minimal valid handler TSX that carries the placeholder sentinel.

    ``handler_name`` labels the placeholder in the sentinel comment so the stub
    is traceable to the handler it replaces (handler names are camelCase JS
    identifiers by contract, e.g. ``getUpcomingEvents``). The exported function
    itself is named ``handler`` per the canonical contract.
    """
    return (
        f"// {PLACEHOLDER_HANDLER_SENTINEL}: {handler_name}\n"
        'import { HandlerContext } from "@exepad/sdk";\n'
        "\n"
        "async function handler(ctx: HandlerContext) {\n"
        "  // Placeholder: the original handler failed to generate (no artifact\n"
        "  // saved). Returns an empty flat object so dependent components render\n"
        "  // an empty state instead of aborting the whole build. Re-prompt to\n"
        "  // regenerate this handler.\n"
        "  return {};\n"
        "}\n"
        "\n"
        "export default handler;\n"
    )


def is_placeholder_handler_tsx(source: str | None) -> bool:
    """True if *source* is a handler placeholder (carries the sentinel)."""
    return bool(source) and PLACEHOLDER_HANDLER_SENTINEL in source
