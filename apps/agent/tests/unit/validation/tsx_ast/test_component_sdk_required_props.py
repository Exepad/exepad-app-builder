"""Unit tests for the SDK required-prop AST rule + companion fixer.

Both pieces co-evolve: the fixer auto-corrects the most common
hallucination (``<AnimatedCounter value=...>`` → ``to=...``); the rule
catches anything the fixer can't (no recognisable prop at all, weird
prop names) and fails the save loud.
"""

from __future__ import annotations

from main_agent.services.validation.fixers._context import FixContext
from main_agent.services.validation.fixers.component_sdk_prop_renames import (
    apply_component_sdk_prop_renames_fixes,
)
from main_agent.services.validation.tsx_ast import (
    AstContext,
    parse_tsx,
    run_rules,
    source_bytes,
)
from main_agent.services.validation.tsx_ast.rules.component_sdk_required_props import (
    SdkRequiredPropsRule,
)


def _run_rule(tsx: str):
    tree = parse_tsx(tsx)
    ctx = AstContext(tsx=tsx, source_buf=source_bytes(tsx), tree=tree)
    return list(run_rules(ctx, [SdkRequiredPropsRule()]))


def _run_fixer(tsx: str):
    fixes: list[str] = []
    out = apply_component_sdk_prop_renames_fixes(tsx, FixContext(), fixes)
    return out, fixes


# ---------------------------------------------------------------------------
# Rule: SdkRequiredPropsRule
# ---------------------------------------------------------------------------


class TestSdkRequiredPropsRule:
    def test_animated_counter_with_to_passes(self):
        tsx = "<AnimatedCounter to={1500} duration={2} />"
        assert _run_rule(tsx) == []

    def test_animated_counter_with_to_string_value_passes(self):
        tsx = '<AnimatedCounter to="100"/>'
        assert _run_rule(tsx) == []

    def test_animated_counter_with_value_only_flagged(self):
        # ``value=`` is not a real prop on AnimatedCounter (SDK declares
        # ``to: number`` — see motion.tsx:196). Without companion fixer,
        # this rule errors loud.
        tsx = "<AnimatedCounter value={stat.value} duration={2} />"
        findings = _run_rule(tsx)
        assert len(findings) == 1
        f = findings[0]
        assert f.rule_id == "component.sdk.required_prop_missing"
        assert f.severity == "error"
        assert "AnimatedCounter" in f.message
        assert "to" in f.message

    def test_animated_counter_no_props_flagged(self):
        tsx = "<AnimatedCounter/>"
        findings = _run_rule(tsx)
        assert len(findings) == 1
        assert "to" in findings[0].message

    def test_unrelated_jsx_not_flagged(self):
        # Only SDK components in the allowlist are checked.
        tsx = "<div value={x}><span>hi</span></div>"
        assert _run_rule(tsx) == []

    def test_nested_animated_counter_inside_card_flagged(self):
        # Walker should find JSX even when nested.
        tsx = (
            "<Card><CardContent>"
            "<AnimatedCounter from={0}/>"  # missing ``to``
            "</CardContent></Card>"
        )
        findings = _run_rule(tsx)
        assert len(findings) == 1


# ---------------------------------------------------------------------------
# Fixer: apply_component_sdk_prop_renames_fixes
# ---------------------------------------------------------------------------


class TestSdkPropRenamesFixer:
    def test_value_to_to_expression(self):
        tsx = "<AnimatedCounter value={stat.value} duration={2} />"
        out, fixes = _run_fixer(tsx)
        assert "to={stat.value}" in out
        assert "value=" not in out
        assert len(fixes) == 1
        assert "AnimatedCounter" in fixes[0]
        assert "value=" in fixes[0]

    def test_value_to_to_string_literal(self):
        tsx = '<AnimatedCounter value="100" />'
        out, fixes = _run_fixer(tsx)
        assert 'to="100"' in out
        assert "value=" not in out

    def test_skips_when_to_already_present(self):
        # User had both ``to=`` and ``value=`` — let the AST rule
        # surface the collision rather than silently drop a prop.
        tsx = "<AnimatedCounter to={5} value={6} />"
        out, fixes = _run_fixer(tsx)
        assert out == tsx
        assert fixes == []

    def test_no_op_on_correct_usage(self):
        tsx = "<AnimatedCounter to={1500} duration={2} />"
        out, fixes = _run_fixer(tsx)
        assert out == tsx
        assert fixes == []

    def test_no_op_when_no_animated_counter(self):
        tsx = "<div value={x}>hi</div>"
        out, fixes = _run_fixer(tsx)
        assert out == tsx
        assert fixes == []

    def test_multiple_animated_counters_all_rewritten(self):
        tsx = (
            "<>"
            "<AnimatedCounter value={a} />"
            "<AnimatedCounter value={b} />"
            "</>"
        )
        out, fixes = _run_fixer(tsx)
        assert "to={a}" in out
        assert "to={b}" in out
        assert "value=" not in out
        assert len(fixes) == 2

    def test_only_first_value_in_one_tag_rewritten(self):
        # Defensive — JSX shouldn't have two ``value=`` on one tag, but
        # if it does, only the first is rewritten so we don't create
        # ``to=A to=B`` collisions.
        tsx = "<AnimatedCounter value={a} value={b} />"
        out, fixes = _run_fixer(tsx)
        # First value= becomes to=; second value= is left untouched.
        assert out.count("to=") == 1
        # The second `value=` survives — the AST rule will then flag
        # the resulting JSX (still missing required ``to`` from an
        # invariant LLM perspective is impossible since we set it, but
        # the duplicate-prop smell is now a separate concern).
        assert "value={b}" in out

    def test_fixer_then_rule_clean(self):
        # End-to-end: fixer corrects, rule should now pass.
        tsx_bad = "<AnimatedCounter value={x} />"
        tsx_fixed, _ = _run_fixer(tsx_bad)
        findings = _run_rule(tsx_fixed)
        assert findings == []
