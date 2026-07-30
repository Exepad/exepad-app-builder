"""Unit tests for ``SdkUndeclaredCallRule``.

Bug class motivation: a component calls a known SDK hook (e.g.
``useModel('orders')``) but the hook was never added to the
``@exepad/sdk`` import — runtime crashes with ``ReferenceError: useModel
is not defined`` and the ErrorBoundary fallback hides the section.

The existing ``SdkImportCompletenessRule`` walks JSX tags only — bare
call expressions sail past. This sibling rule covers the call-expression
shape so the missing-import case is caught at validation time even when
the auto-fixer's hardcoded list drifts from the SDK surface.
"""

from __future__ import annotations

import pytest

from main_agent.services.validation.tsx_ast.parser import parse_tsx, source_bytes
from main_agent.services.validation.tsx_ast.rules.base import AstContext
from main_agent.services.validation.tsx_ast.rules.sdk_undeclared_call import (
    SdkUndeclaredCallRule,
)

pytestmark = [pytest.mark.unit]


def _ctx(tsx: str) -> AstContext:
    return AstContext(
        tsx=tsx,
        source_buf=source_bytes(tsx),
        tree=parse_tsx(tsx),
    )


def _findings(tsx: str) -> list:
    return list(SdkUndeclaredCallRule().check(_ctx(tsx)))


# ---------------------------------------------------------------------------
# Happy path: hook called AND imported → no findings
# ---------------------------------------------------------------------------


def test_use_model_imported_and_called_clean() -> None:
    tsx = """
import { LightDOMContainer, React, useModel } from '@exepad/sdk';

export default function Contact() {
  const { data } = useModel('contacts');
  return <LightDOMContainer><div>OK</div></LightDOMContainer>;
}
"""
    assert _findings(tsx) == []


def test_navigate_imported_and_called_clean() -> None:
    tsx = """
import { LightDOMContainer, React, navigate } from '@exepad/sdk';

export default function Nav() {
  return <button onClick={() => navigate('/about')}>About</button>;
}
"""
    assert _findings(tsx) == []


# ---------------------------------------------------------------------------
# The failure mode: hook called, not imported → error
# ---------------------------------------------------------------------------


def test_hook_not_imported_errors() -> None:
    tsx = """
import { LightDOMContainer, Link, React } from '@exepad/sdk';

export default function OrdersContent() {
  const { data, loading } = useModel('orders');
  return (
    <LightDOMContainer>
      <div>{loading ? 'Loading' : data?.length}</div>
    </LightDOMContainer>
  );
}
"""
    findings = _findings(tsx)
    assert len(findings) == 1
    f = findings[0]
    assert f.rule_id == "component.sdk.call_not_imported"
    assert f.severity == "error"
    assert "useModel" in f.message
    assert "ReferenceError" in f.message


def test_navigate_called_not_imported_errors() -> None:
    tsx = """
import { LightDOMContainer, React } from '@exepad/sdk';

export default function Nav() {
  return <button onClick={() => navigate('/about')}>About</button>;
}
"""
    findings = _findings(tsx)
    assert len(findings) == 1
    assert findings[0].message.startswith("`navigate`")


# ---------------------------------------------------------------------------
# Distinct-identifier semantics: many calls of the same missing hook
# emit only ONE finding (no spam).
# ---------------------------------------------------------------------------


def test_repeated_call_of_missing_hook_emits_single_finding() -> None:
    tsx = """
import { React } from '@exepad/sdk';

export default function Multi() {
  const a = useModel('x');
  const b = useModel('y');
  const c = useModel('z');
  return null;
}
"""
    findings = _findings(tsx)
    assert len(findings) == 1


def test_two_distinct_missing_hooks_emit_two_findings() -> None:
    tsx = """
import { React } from '@exepad/sdk';

export default function Two() {
  const { data } = useModel('a');
  toast('hello');
  return null;
}
"""
    names = sorted(f.message.split("`")[1] for f in _findings(tsx))
    assert names == ["toast", "useModel"]


# ---------------------------------------------------------------------------
# Member expressions don't trigger — those belong to other rules.
# ---------------------------------------------------------------------------


def test_member_expression_call_skipped() -> None:
    # `format.currency(...)` is a member call — handled by SdkFormatMethodRule.
    tsx = """
import { React } from '@exepad/sdk';

export default function Price({ amount }) {
  return <div>{format.currency(amount)}</div>;
}
"""
    assert _findings(tsx) == []


def test_namespace_import_member_call_skipped() -> None:
    # `sdk.useModel(...)` — member access, not a bare identifier.
    tsx = """
import * as sdk from '@exepad/sdk';

export default function Contact() {
  const { data } = sdk.useModel('contacts');
  return null;
}
"""
    assert _findings(tsx) == []


# ---------------------------------------------------------------------------
# PascalCase JSX components are covered by SdkImportCompletenessRule —
# this rule should not double-emit for them.
# ---------------------------------------------------------------------------


def test_pascal_case_jsx_components_not_flagged_by_this_rule() -> None:
    # `LightDOMContainer` and `Link` are PascalCase SDK exports — when
    # missing as JSX tags they're caught by SdkImportCompletenessRule,
    # not this rule.
    tsx = """
import { React } from '@exepad/sdk';

export default function Page() {
  return <LightDOMContainer><Link to="/home">Home</Link></LightDOMContainer>;
}
"""
    # Even though Link / LightDOMContainer aren't imported, this rule
    # ignores them — they're JSX usages, not bare call expressions.
    assert _findings(tsx) == []


# ---------------------------------------------------------------------------
# Import-name harvesting respects aliases (`{ navigate as nav }`).
# ---------------------------------------------------------------------------


def test_aliased_import_is_respected() -> None:
    # `_sdk_import_names` collects the LOCAL binding (the alias). If the
    # source calls `nav(...)`, that's not in the watch set so no finding.
    # If it called `navigate(...)` the unaliased name would NOT be in
    # imported set, so it WOULD be flagged. Both cases below.
    tsx_uses_alias = """
import { React, navigate as nav } from '@exepad/sdk';

export default function Nav() {
  return <button onClick={() => nav('/home')}>Go</button>;
}
"""
    assert _findings(tsx_uses_alias) == []

    tsx_uses_original = """
import { React, navigate as nav } from '@exepad/sdk';

export default function Nav() {
  return <button onClick={() => navigate('/home')}>Go</button>;
}
"""
    findings = _findings(tsx_uses_original)
    assert len(findings) == 1
    assert "navigate" in findings[0].message


# ---------------------------------------------------------------------------
# Empty-catalog fail-open: the rule should not crash when the SDK catalog
# is unavailable (dev environments may lack the built sdk-exports.json).
# ---------------------------------------------------------------------------


def test_empty_catalog_emits_no_findings(monkeypatch) -> None:
    from main_agent.services.validation.tsx_ast.rules import sdk_undeclared_call as mod

    monkeypatch.setattr(mod, "_callable_sdk_exports", lambda: frozenset())
    # Build a fresh rule so __init__ picks up the patched empty set.
    tsx = """
import { React } from '@exepad/sdk';

export default function X() {
  const { data } = useModel('x');
  return null;
}
"""
    findings = list(mod.SdkUndeclaredCallRule().check(_ctx(tsx)))
    assert findings == []
