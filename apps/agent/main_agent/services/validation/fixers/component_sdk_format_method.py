"""SDK ``format.currency(N)`` → ``Intl.NumberFormat(...).format(N)`` fixer.

Pairs with ``component_sdk_format_method.py`` (AST rule). When the LLM
emits ``format.currency(stats.totalRevenue)``, this fixer rewrites it
to the canonical browser API call before the rule sees the TSX.

SDK ``format`` is ``date-fns.format``, NOT an object with method
properties. The LLM hits this hallucination regularly because Intl
APIs in many style libs expose ``format.currency`` and the SDK chose to
re-export the date-fns callable directly.

Current allowlist:

- ``format.currency(X)`` → ``new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(X)``

Hallucinations the fixer does NOT auto-rewrite (rule will fail loud so
the LLM regenerates):

- ``format.number(X)``, ``format.percent(X)``, ``format.date(X)``,
  ``format.time(X)`` — these mean different things in different libs
  and there's no single safe rewrite. The AST rule flags them as
  errors; LLM gets a clear regen signal.
"""

from __future__ import annotations

import re

from main_agent.services.validation.fixers._context import FixContext


# Match ``format.currency(<expr>)`` with a paren-balanced argument.
# The non-greedy ``[^()]*`` rules out nested parens but covers every
# real-world usage we've seen (``format.currency(stats?.totalRevenue ?? 0)``,
# ``format.currency(product.price)``). Anchoring on ``format.currency(``
# avoids matching ``foo.format.currency(`` (chained access on some other
# object whose property is named ``format``).
_FORMAT_CURRENCY_CALL = re.compile(
    r"(?<![\w.])format\.currency\(([^()]+)\)",
)

_REPLACEMENT_TEMPLATE = (
    'new Intl.NumberFormat("en-US", '
    '{{ style: "currency", currency: "USD" }}).format({arg})'
)


def apply_component_sdk_format_method_fixes(
    tsx: str,
    ctx: FixContext,
    fixes_applied: list[str],
) -> str:
    """Rewrite ``format.currency(N)`` calls to the canonical Intl API.

    Conforms to the fixer signature used by ``fixers.dispatcher``:
    returns the rewritten ``tsx`` string and mutates ``fixes_applied``
    in place. ``ctx`` is unused — rewrites are pure-syntactic.
    """
    _ = ctx  # unused

    def _rewrite(match: re.Match[str]) -> str:
        arg = match.group(1).strip()
        fixes_applied.append(
            "Rewrote format.currency(...) → "
            "Intl.NumberFormat(...).format(...) "
            "(SDK `format` is date-fns; .currency is not a real method)"
        )
        return _REPLACEMENT_TEMPLATE.format(arg=arg)

    return _FORMAT_CURRENCY_CALL.sub(_rewrite, tsx)
