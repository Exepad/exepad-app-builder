"""``component.codegen.hardcoded_overrides_usemodel`` — flag hardcoded data
arrays whose columns shadow a ``useModel(...)`` call in the same component.

Catches the i9bm2ti4 failure mode (2026-05-16) — Stitch design import
produced PlansContent and BillingContent that imported ``useModel`` for
show but rendered hardcoded mock arrays beside it. BillingContent even
left an explicit comment ("Mock invoice data ... to satisfy the 'no
hardcoded data' rule") admitting the evasion. Prompt rules alone don't
fix this; the agent has demonstrated meta-awareness of the policy.

The pattern this rule blocks::

    function PlansContent() {
      const { data: members } = useModel("members");
      const plans = [
        { name: "Part-time", price: 199, features: [...] },
        { name: "Dedicated Desk", price: 499, features: [...] },
        { name: "Private Office", price: 1200, features: [...] },
      ];
      return ...;  // renders `plans`, not `members.plans`
    }

Logic:

1. Collect every ``useModel(STRING_LITERAL)`` call; resolve to a model in
   ``ctx.models``. Skip unresolvable names.
2. Collect every ``variable_declarator`` whose initializer is an array of
   at least 3 object literals.
3. For each (model, array) pair, compute Jaccard similarity between the
   model's column names and the union of keys in the first 3 array
   elements. Emit a failure when similarity ≥ 0.50.

The 3-entry minimum + 0.50 Jaccard threshold avoid false positives on
cosmetic constants (``weekDays``, ``timeSlots``, single-item fallbacks)
or unrelated lookup tables. Severity is ``error`` — the pattern is
deliberate evasion, not careless polish; a re-plan is required.
"""

from __future__ import annotations

from typing import Iterator

from ..walker import find_by_type, find_calls, string_literal_value
from .base import AstContext, Finding

_RULE_ID = "component.codegen.hardcoded_overrides_usemodel"
_MIN_ENTRIES = 3
_MIN_JACCARD = 0.50


class HardcodedOverridesUseModelRule:
    id = _RULE_ID
    severity = "error"

    def check(self, ctx: AstContext) -> Iterator[Finding]:
        if not ctx.models:
            return

        # 1. Collect useModel('X') target names, mapped to the model's columns.
        used_models = _collect_usemodel_names(ctx)
        if not used_models:
            return

        model_columns = _columns_by_model(ctx.models)

        # 2. Walk top-level-ish variable declarators with array-of-objects values.
        emitted_keys: set[int] = set()
        for declarator in find_by_type(ctx.tree.root_node, "variable_declarator"):
            name_node = declarator.child_by_field_name("name")
            value_node = declarator.child_by_field_name("value")
            if name_node is None or value_node is None:
                continue
            if name_node.type != "identifier":
                continue  # destructuring patterns aren't candidates
            if value_node.type != "array":
                continue
            object_entries = [
                c for c in value_node.named_children if c.type == "object"
            ]
            if len(object_entries) < _MIN_ENTRIES:
                continue

            var_name = ctx.source_buf[
                name_node.start_byte : name_node.end_byte
            ].decode("utf-8")

            # Union of keys across the first N entries.
            sample_keys: set[str] = set()
            for obj in object_entries[:_MIN_ENTRIES]:
                sample_keys.update(_object_keys(obj, ctx.source_buf))
            if not sample_keys:
                continue

            # 3. Compare against each useModel target.
            for model_name in used_models:
                cols = model_columns.get(model_name)
                if not cols:
                    continue
                overlap = sample_keys & cols
                union = sample_keys | cols
                if not union:
                    continue
                similarity = len(overlap) / len(union)
                if similarity < _MIN_JACCARD:
                    continue
                if declarator.start_byte in emitted_keys:
                    continue
                emitted_keys.add(declarator.start_byte)
                overlap_str = ", ".join(sorted(overlap))
                yield Finding(
                    rule_id=_RULE_ID,
                    severity="error",
                    message=(
                        f"Hardcoded data array `{var_name}` shadows "
                        f"`useModel('{model_name}')` — render rows from "
                        f"`useModel('{model_name}').data` instead of a "
                        f"hardcoded mock list. Overlapping keys: "
                        f"{overlap_str}. (Jaccard "
                        f"{similarity:.2f} >= {_MIN_JACCARD:.2f}; "
                        f"{len(object_entries)} entries.)"
                    ),
                    line=declarator.start_point[0] + 1,
                    col=declarator.start_point[1],
                    fix_hint=(
                        f"delete the hardcoded array and read from "
                        f"useModel('{model_name}').data"
                    ),
                )
                break  # one finding per array — don't double-report against multiple models


def _collect_usemodel_names(ctx: AstContext) -> list[str]:
    """Return the list of model names called via ``useModel(NAME, ...)``.

    Only string-literal first arguments are resolved. Dynamic identifiers
    or template strings are out of scope (rare in practice; the LLM
    consistently writes string literals).
    """
    names: list[str] = []
    seen: set[str] = set()
    for call in find_calls(ctx.tree.root_node):
        callee = call.child_by_field_name("function")
        if callee is None or callee.type != "identifier":
            continue
        if ctx.source_buf[callee.start_byte : callee.end_byte] != b"useModel":
            continue
        args = call.child_by_field_name("arguments")
        if args is None or args.named_child_count < 1:
            continue
        first = args.named_children[0]
        if first.type != "string":
            continue
        name = string_literal_value(first, ctx.source_buf)
        if not name or name in seen:
            continue
        seen.add(name)
        names.append(name)
    return names


def _columns_by_model(models) -> dict[str, set[str]]:
    """Index ``models`` as ``{model_name: {column_name, ...}}``. ID columns
    and FK ``_id`` columns count — the LLM often shadows them in its
    mock arrays too."""
    out: dict[str, set[str]] = {}
    for model in models or []:
        if not isinstance(model, dict):
            continue
        name = model.get("name") or ""
        if not name:
            continue
        cols: set[str] = set()
        for col in model.get("columns", []) or []:
            if not isinstance(col, dict):
                continue
            col_name = col.get("name")
            if col_name:
                cols.add(str(col_name))
        if cols:
            out[name] = cols
    return out


def _object_keys(obj_node, source_buf: bytes) -> set[str]:
    """Return the set of key names in an object literal. Identifier and
    string keys both supported; computed keys ignored."""
    keys: set[str] = set()
    for child in obj_node.named_children:
        if child.type != "pair":
            continue
        key = child.child_by_field_name("key")
        if key is None:
            continue
        if key.type == "property_identifier":
            keys.add(source_buf[key.start_byte : key.end_byte].decode("utf-8"))
        elif key.type == "string":
            value = string_literal_value(key, source_buf)
            if value:
                keys.add(value)
    return keys
