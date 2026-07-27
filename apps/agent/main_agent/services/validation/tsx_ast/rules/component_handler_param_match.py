"""``component.handler.params_mismatch`` — ``useHandler('X', { params })``
keys must be read by handler ``X`` via ``ctx.params``.

The bug this catches
--------------------

App ``eiu7xj0v`` (2026-05-14): ``DashboardContent.tsx`` calls
``useHandler('getDashboardStats', { params: { timeRange } })`` to drive
its Today/Week/Month tabs, but ``getDashboardStats.tsx`` declares no
inputs and its strict Zod input wrapper rejects unknown keys with
``VALIDATION_ERROR: Unrecognized key(s) in object: 'timeRange'``.
Result: the dashboard never receives any data. Live screenshot evidence
caught this; the existing handler-output rule (``ChartFieldMismatchRule``)
is one-directional (handler→component) and didn't help.

Same defect class regardless of failure surface:

* Handler returns 0 / NaN because it ignores a param the consumer sent
  (silent bug — tabs appear inert).
* Handler's input validator rejects the whole request (hard failure —
  page never loads).

Either way the contract between producer and consumer is broken at the
``params`` boundary.

Fail-open contract
------------------

The rule depends on ``ctx.handler_sources`` — a ``{handler_name: tsx}``
map populated when validation runs after source rehydration. If
``handler_sources`` is missing OR the relevant handler isn't present
OR no consumer ``useHandler('X', { params: {...} })`` is found,
the rule yields no findings. We'd rather miss a bug than block a
save on a missing dependency the validator couldn't fetch.

What the rule covers
--------------------

For each ``useHandler('NAME', { params: { K1, K2, ... } })`` call in the
component:

1. Statically extract the params object's literal keys (``K1``, ``K2``).
   Spread elements, computed keys, and shorthand non-identifier keys
   are skipped — the rule is conservative and only flags clearly
   wrong static literals.
2. Look up ``ctx.handler_sources[NAME]``.
3. Scan the handler source for ``ctx.params`` reads:
   - Member access: ``ctx.params.X`` (incl. optional chains
     ``ctx.params?.X``).
   - Destructure: ``const { X, Y } = ctx.params`` (or a ``ctx.params as ...``
     type-asserted form).
4. If a consumer-supplied key isn't in the union of handler-read keys,
   emit a finding listing both sets.

Severity
--------

Warning at first ship (see plan ``_fix_plan.md``); escalate to error
once replay confirms no false positives. The auto-fix is not automatic:
the user can either teach the handler to accept the param (preferred) or
drop the unused param from the consumer call.
"""

from __future__ import annotations

import re
from typing import Iterator, Optional

from tree_sitter import Node

from ..walker import walk
from .base import AstContext, Finding


_RULE_ID = "component.handler.params_mismatch"


class HandlerParamsMismatchRule:
    """Consumer-passed ``params`` keys must be read by the handler."""

    id = _RULE_ID
    severity = "warning"

    def check(self, ctx: AstContext) -> Iterator[Finding]:
        if not ctx.handler_sources:
            return  # fail open — no producer source to cross-check

        # Collect every (handler_name, params_keys, line, col) triple
        # from useHandler('X', { params: { ... } }) calls in the component.
        consumer_sites = list(_iter_use_handler_sites(ctx.tree.root_node, ctx.source_buf))
        if not consumer_sites:
            return

        # Cache: handler_name -> set of keys actually read from ctx.params.
        handler_param_reads: dict[str, set[str]] = {}

        def _reads_for(handler_name: str) -> Optional[set[str]]:
            cached = handler_param_reads.get(handler_name)
            if cached is not None:
                return cached
            assert ctx.handler_sources is not None  # checked above
            src = ctx.handler_sources.get(handler_name)
            if src is None:
                return None  # no source available — fail open per site
            reads = _infer_ctx_params_reads(src)
            handler_param_reads[handler_name] = reads
            return reads

        for site in consumer_sites:
            handler_name = site.handler_name
            valid = _reads_for(handler_name)
            if valid is None:
                continue  # handler source not available — fail open
            # If handler reads NOTHING from ctx.params (no member access,
            # no destructure), we can't tell whether it spreads the whole
            # object or genuinely ignores it. Fail open to avoid noise.
            if not valid and not _handler_uses_strict_params_marker(
                ctx.handler_sources.get(handler_name, "")
            ):
                continue
            unknown = sorted(site.params_keys - valid)
            if not unknown:
                continue
            yield Finding(
                rule_id=_RULE_ID,
                severity="warning",
                message=(
                    f"useHandler('{handler_name}', {{ params: {{ "
                    f"{', '.join(sorted(site.params_keys))} }} }}) sends "
                    f"param(s) {unknown} that handler '{handler_name}' "
                    f"does not read via ctx.params. Handler reads: "
                    f"{sorted(valid) if valid else '<none>'}. The handler's "
                    f"strict input validator will reject the request with "
                    f"VALIDATION_ERROR — either teach the handler to accept "
                    f"the param(s), or drop them from this useHandler call."
                ),
                line=site.line,
                col=site.col,
                fix_hint=(
                    f"declare {unknown} in handler '{handler_name}' (read "
                    f"via ctx.params.<key>), or remove from the useHandler "
                    f"params object"
                ),
            )


# ── consumer side: useHandler('X', { params: { ... } }) ──────────────


class _ConsumerSite:
    __slots__ = ("handler_name", "params_keys", "line", "col")

    def __init__(
        self, handler_name: str, params_keys: set[str], line: int, col: int
    ) -> None:
        self.handler_name = handler_name
        self.params_keys = params_keys
        self.line = line
        self.col = col


def _iter_use_handler_sites(root: Node, buf: bytes) -> Iterator[_ConsumerSite]:
    """Yield every ``useHandler('X', { params: { K1, K2 } })`` call.

    We walk every ``call_expression`` whose callee is ``useHandler``. The
    second argument's ``params`` property is inspected for literal keys.
    Spread / computed keys / non-static names → skipped (rule is
    conservative). Calls with no second arg, or no ``params`` property,
    are also skipped — there's nothing to validate.
    """
    for node in walk(root):
        if node.type != "call_expression":
            continue
        callee = node.child_by_field_name("function")
        if callee is None or callee.type != "identifier":
            continue
        if buf[callee.start_byte : callee.end_byte].decode("utf-8") != "useHandler":
            continue
        args_node = node.child_by_field_name("arguments")
        if args_node is None:
            continue
        named = [c for c in args_node.named_children if c.type != "comment"]
        if len(named) < 2:
            continue
        first, second = named[0], named[1]
        handler_name = _string_arg_value(first, buf)
        if handler_name is None:
            continue
        if second.type != "object":
            continue
        params_obj = _named_property_value(second, "params", buf)
        if params_obj is None or params_obj.type != "object":
            continue
        keys = _literal_keys_of_object(params_obj, buf)
        if not keys:
            continue  # spread-only or dynamic — nothing static to check
        yield _ConsumerSite(
            handler_name=handler_name,
            params_keys=keys,
            line=node.start_point[0] + 1,
            col=node.start_point[1],
        )


def _string_arg_value(node: Node, buf: bytes) -> Optional[str]:
    """Return the static string value of ``node``, or ``None`` if it's
    not a plain string literal (template literals etc. are skipped)."""
    if node.type != "string":
        return None
    s = buf[node.start_byte : node.end_byte].decode("utf-8")
    if len(s) >= 2 and s[0] in "'\"" and s[-1] in "'\"":
        return s[1:-1]
    return s


def _named_property_value(obj_node: Node, name: str, buf: bytes) -> Optional[Node]:
    """In an ``object`` node, return the value node of the first property
    whose key is the bare identifier ``name`` (or string literal of the
    same). Used to find the ``params`` property.
    """
    for child in obj_node.named_children:
        if child.type != "pair":
            continue
        key = child.child_by_field_name("key")
        if key is None:
            continue
        key_name = _key_name_string(key, buf)
        if key_name == name:
            return child.child_by_field_name("value")
    return None


def _literal_keys_of_object(obj_node: Node, buf: bytes) -> set[str]:
    """Return the set of static identifier keys in an object literal.

    For ``{ a: 1, b, ...rest, [k]: 2 }`` returns ``{"a", "b"}``. Spread
    elements and computed keys are skipped; the rule never accuses a
    handler of missing a key it couldn't statically know about.
    """
    out: set[str] = set()
    for child in obj_node.named_children:
        if child.type == "pair":
            key = child.child_by_field_name("key")
            if key is None:
                continue
            name = _key_name_string(key, buf)
            if name is not None:
                out.add(name)
        elif child.type == "shorthand_property_identifier":
            out.add(buf[child.start_byte : child.end_byte].decode("utf-8"))
    return out


def _key_name_string(key_node: Node, buf: bytes) -> Optional[str]:
    """Return the string form of an object-literal key node.

    Skips ``computed_property_name`` (``[expr]: ...``) — those are
    dynamic and we can't statically know the key.
    """
    t = key_node.type
    if t in ("property_identifier", "identifier"):
        return buf[key_node.start_byte : key_node.end_byte].decode("utf-8")
    if t == "string":
        raw = buf[key_node.start_byte : key_node.end_byte].decode("utf-8")
        if len(raw) >= 2 and raw[0] in "'\"" and raw[-1] in "'\"":
            return raw[1:-1]
        return raw
    return None


# ── producer side: scan handler TSX for ctx.params reads ─────────────


# Match `ctx.params.<KEY>` (optionally `ctx.params?.<KEY>`) — captures KEY.
_CTX_PARAMS_MEMBER_RE = re.compile(r"\bctx\s*\.\s*params\s*\??\s*\.\s*([A-Za-z_]\w*)")

# Match `... = ctx.params` or `... = ctx.params as ...` after a destructure.
# We match the destructure pattern and the equals-ctx.params clause separately
# because tree-sitter could parse this but a regex is simpler + robust enough
# for the well-formed shapes the agent emits.
_DESTRUCTURE_CTX_PARAMS_RE = re.compile(
    r"(?:const|let|var)\s*"
    r"\{([^{}]*)\}"
    r"\s*=\s*ctx\s*\.\s*params"
    r"(?:\s+as\b[^;\n]*)?"
)

# Optional opt-in marker for handler authors to make the rule extra strict:
# any comment of the form ``// @exepad-strict-params: KEY1, KEY2`` (rare).
_STRICT_MARKER_RE = re.compile(r"@exepad-strict-params\s*:\s*([A-Za-z_, \t\w]+)")


def _infer_ctx_params_reads(handler_tsx: str) -> set[str]:
    """Return the set of keys the handler reads from ``ctx.params``.

    Covers two shapes that account for >95% of agent-emitted handlers:

    1. Member access: ``const x = ctx.params.foo`` or
       ``(ctx.params.bar as number) || 0``.
    2. Destructure: ``const { a, b } = ctx.params`` or
       ``const { a, b } = ctx.params as { a: string; b: number }``.

    The result is the union of keys seen in either shape. If the
    handler does e.g. ``const all = ctx.params; doSomething(all.x)`` —
    we miss it (rare; fail open at the call site).
    """
    reads: set[str] = set()
    for m in _CTX_PARAMS_MEMBER_RE.finditer(handler_tsx):
        reads.add(m.group(1))
    for m in _DESTRUCTURE_CTX_PARAMS_RE.finditer(handler_tsx):
        inner = m.group(1)
        for part in inner.split(","):
            # Strip whitespace, default values (`= X`), and renames (`a: b`).
            # For `{ a: alias }` the destructured key is `a`, NOT `alias`,
            # because the handler reads the value at key `a`.
            tok = part.strip()
            if not tok:
                continue
            # Drop default-value clause: `a = 1` → `a`.
            tok = tok.split("=", 1)[0].strip()
            # Drop rename clause: `a: alias` → `a`.
            tok = tok.split(":", 1)[0].strip()
            if tok.startswith("..."):
                # `...rest` — handler accepts arbitrary extras; mark as
                # wildcard by returning an empty set to fail open.
                return set()
            if re.fullmatch(r"[A-Za-z_]\w*", tok):
                reads.add(tok)
    return reads


def _handler_uses_strict_params_marker(handler_tsx: str) -> bool:
    """True if the handler declares an explicit ``@exepad-strict-params``
    marker — opt-in escape hatch to force the rule to fire even when no
    ``ctx.params`` reads are detected.

    The default is fail-open when no reads are found (handler body might
    spread ctx.params unobserved), but a handler author who knows the
    handler accepts a closed set can declare it explicitly.
    """
    return bool(_STRICT_MARKER_RE.search(handler_tsx))
