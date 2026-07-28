"""Unit tests for ``DeadActionButtonRule`` — action/CTA buttons with no handler.

Regression target: amukkmasq ``PricingContent`` (2026-06-27) shipped
``<Button>{tier.cta}</Button>`` with no ``onClick`` on every pricing tier — the
conversion page's whole purpose — and the rule missed it on TWO gaps:
  1. VERB gap — the action-verb list had no conversion verbs, so "Choose Plan"
     / "Get Started" / "Subscribe" matched nothing.
  2. EXPRESSION-LABEL gap — the visible-text pass collects only ``jsx_text`` and
     skips JSX expressions, so the data-driven label ``{tier.cta}`` read as empty.
Both gaps are closed here.
"""

from __future__ import annotations

from main_agent.services.validation.tsx_ast.parser import parse_tsx, source_bytes
from main_agent.services.validation.tsx_ast.rules.base import AstContext
from main_agent.services.validation.tsx_ast.rules.component_dead_action_button import (
    DeadActionButtonRule,
)


def _findings(tsx: str) -> list:
    ctx = AstContext(tsx=tsx, source_buf=source_bytes(tsx), tree=parse_tsx(tsx))
    return list(DeadActionButtonRule().check(ctx))


# ── verb-gap closures (conversion CTAs) ──────────────────────────────────


def test_choose_plan_static_text_flagged():
    tsx = "function C(){ return <Button>Choose Plan</Button>; }"
    assert len(_findings(tsx)) == 1


def test_conversion_verbs_flagged():
    for label in (
        "Subscribe",
        "Get Started",
        "Upgrade",
        "Start free trial",
        "Contact sales",
        "Buy now",
    ):
        tsx = f"function C(){{ return <Button>{label}</Button>; }}"
        assert len(_findings(tsx)) == 1, label


# ── expression-label gap ({tier.cta}) ────────────────────────────────────


def test_data_driven_cta_expression_flagged():
    tsx = 'function C(){ const tier={cta:"Choose"}; return <Button>{tier.cta}</Button>; }'
    assert len(_findings(tsx)) == 1


def test_data_driven_label_expression_flagged():
    tsx = 'function C(){ const p={label:"X"}; return <Button>{p.label}</Button>; }'
    assert len(_findings(tsx)) == 1


# ── no false positives ───────────────────────────────────────────────────


def test_wired_cta_passes():
    tsx = 'function C(){ return <Button onClick={() => navigate("/signup")}>Choose Plan</Button>; }'
    assert _findings(tsx) == []


def test_data_driven_cta_with_handler_passes():
    tsx = 'function C(){ const t={cta:"Go"}; return <Button onClick={t.go}>{t.cta}</Button>; }'
    assert _findings(tsx) == []


def test_non_cta_expression_label_not_flagged():
    # ``{count}`` is not a CTA-ish prop name → not a dead-CTA candidate.
    tsx = "function C(){ const count=3; return <Button>{count}</Button>; }"
    assert _findings(tsx) == []


def test_classname_expression_is_not_a_label():
    # ``className={cn(...)}`` lives in the opening tag, not a content child, so
    # it is never mistaken for the button's CTA label.
    tsx = 'function C(){ return <Button className={cn("x")}>OK</Button>; }'
    assert _findings(tsx) == []


# ── pre-existing behaviour preserved ─────────────────────────────────────


def test_existing_save_verb_still_flagged():
    tsx = "function C(){ return <Button>Save</Button>; }"
    assert len(_findings(tsx)) == 1


def test_radix_close_slot_still_skipped():
    tsx = "function C(){ return <DialogClose><Button>Save</Button></DialogClose>; }"
    assert _findings(tsx) == []
