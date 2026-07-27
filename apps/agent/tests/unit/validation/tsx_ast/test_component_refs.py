"""Unit tests for component cross-reference rules.

Most rules in ``component_refs.py`` were superseded by the tsc Stage-1.5
gate (see ``tests/unit/validation/tsc_validator/test_runner.py``).
Only ``IconsUnknownRule`` survives — Icons stay AST-checked because the
gate types ``Icons`` as ``any``.
"""

from __future__ import annotations

from main_agent.services.validation.tsx_ast import (
    AstContext,
    parse_tsx,
    run_rules,
    source_bytes,
)
from main_agent.services.validation.tsx_ast.rules.component_refs import IconsUnknownRule


def _run(rule, tsx: str, **ctx_kwargs):
    tree = parse_tsx(tsx)
    ctx = AstContext(tsx=tsx, source_buf=source_bytes(tsx), tree=tree, **ctx_kwargs)
    return [f.message for f in run_rules(ctx, [rule])]


class TestIconsUnknownRule:
    def test_happy_path(self):
        # ``Menu`` is a real lucide icon — no finding.
        assert _run(IconsUnknownRule(), "<Icons.Menu />") == []

    def test_unknown_icon_flagged(self):
        findings = _run(IconsUnknownRule(), "<Icons.NotARealIcon />")
        assert len(findings) == 1
        assert "Icons.NotARealIcon" in findings[0]

    def test_duplicate_flagged_once(self):
        tsx = "<><Icons.NotARealIcon /><Icons.NotARealIcon /></>"
        findings = _run(IconsUnknownRule(), tsx)
        assert len(findings) == 1

    def test_lowercase_chained_access_flagged_with_swap_hint(self):
        # Loop-variable confusion: author wrote ``Icons.stat.icon`` when
        # they meant the destructured loop variable's ``.icon`` field.
        tsx = "items.map((stat, i) => <div key={i}><Icons.stat.icon " "className='h-4 w-4'/></div>)"
        findings = _run(IconsUnknownRule(), tsx)
        assert len(findings) == 1
        assert "Icons.stat" in findings[0]
        assert "looks like a local variable" in findings[0]
        assert "<stat.icon" in findings[0]

    def test_lowercase_bare_access_flagged_without_swap_hint(self):
        # Bare ``Icons.foo`` (no chained access) — no local-var hint, just
        # the invalid-access error.
        findings = _run(IconsUnknownRule(), "<Icons.foo />")
        assert len(findings) == 1
        assert "Icons.foo" in findings[0]
        assert "looks like a local variable" not in findings[0]

    def test_chained_access_on_valid_icon_flagged(self):
        # App ``mr5czdwj`` regression: ``Icons.X.Pinterest`` blanked the
        # footer. The inner ``Icons.Menu`` resolves to a valid icon, so the
        # single-segment check passes — the chained ``.Pinterest`` must be
        # caught by the dedicated chained-access branch (crash-class).
        findings = _run(IconsUnknownRule(), "<Icons.Menu.Pinterest />")
        assert len(findings) == 1
        assert "chained icon access" in findings[0].lower()
        assert "Icons.Menu.Pinterest" in findings[0]

    def test_chained_access_deduped(self):
        tsx = "<><Icons.Menu.Pinterest /><Icons.Menu.Pinterest /></>"
        findings = _run(IconsUnknownRule(), tsx)
        assert len(findings) == 1

    def test_valid_single_segment_icon_not_flagged(self):
        # The fix must not regress plain valid single-segment usage.
        assert _run(IconsUnknownRule(), "<Icons.Menu />") == []

    def test_lowercase_chain_not_double_flagged(self):
        # ``Icons.stat.icon`` is handled by the lowercase single-segment
        # branch; the new chained branch must NOT add a second finding.
        tsx = "items.map((stat) => <Icons.stat.icon className='h-4 w-4'/>)"
        findings = _run(IconsUnknownRule(), tsx)
        assert len(findings) == 1
