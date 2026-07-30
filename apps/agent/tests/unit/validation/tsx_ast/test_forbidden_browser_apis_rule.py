"""Tests for ``handler.forbidden.browser_api`` — Workers-runtime gate.

Distinct from ``handler.forbidden.api``: that rule is the catch-all for
client-side idioms that leak into handler code (eval, cn, fetch with
whitelist, console.log, addEventListener whitelist, window.location
mutation, etc.). THIS rule is narrower — it walks ``document.*`` /
``window.*`` member access and the ``alert`` / ``confirm`` / ``prompt``
and ``setTimeout`` / ``setInterval`` direct calls. The two rules
sometimes both fire on the same source (e.g. ``window.addEventListener``
will trigger both this rule and the addEventListener branch in the
catch-all rule); that's by design.
"""

from __future__ import annotations

import pytest

from main_agent.services.validation.tsx_ast import (
    AstContext,
    parse_tsx,
    run_rules,
    source_bytes,
)
from main_agent.services.validation.tsx_ast.rules.forbidden_browser_apis import (
    ForbiddenBrowserApiRule,
)

pytestmark = [pytest.mark.unit]


def _run(tsx: str) -> list[str]:
    tree = parse_tsx(tsx)
    ctx = AstContext(tsx=tsx, source_buf=source_bytes(tsx), tree=tree, models=[])
    return [f.message for f in run_rules(ctx, [ForbiddenBrowserApiRule()]) if f.severity == "error"]


class TestDocumentMemberAccess:
    def test_document_property_read_flagged(self):
        errors = _run("const t = document.title;")
        assert any("document.* is unavailable in Workers runtime" in e for e in errors)

    def test_document_method_call_flagged(self):
        errors = _run('document.getElementById("x");')
        assert any("document.* is unavailable in Workers runtime" in e for e in errors)

    def test_document_in_string_literal_not_flagged(self):
        # Identifier nodes only — the substring must appear as code, not text.
        assert _run('const note = "see document.getElementById docs";') == []


class TestWindowMemberAccess:
    def test_window_property_read_flagged(self):
        errors = _run("const w = window.innerWidth;")
        assert any("window.* is unavailable in Workers runtime" in e for e in errors)

    def test_window_method_call_flagged(self):
        errors = _run("window.scrollTo(0, 0);")
        assert any("window.* is unavailable in Workers runtime" in e for e in errors)


class TestDialogCalls:
    def test_alert_flagged(self):
        errors = _run('alert("hi");')
        assert any("alert/confirm/prompt are browser-only APIs" in e for e in errors)

    def test_confirm_flagged(self):
        errors = _run('const ok = confirm("really?");')
        assert any("alert/confirm/prompt are browser-only APIs" in e for e in errors)

    def test_prompt_flagged(self):
        errors = _run('const v = prompt("name");')
        assert any("alert/confirm/prompt are browser-only APIs" in e for e in errors)

    def test_dialog_emits_only_once_per_run(self):
        """The rule de-dupes the dialog finding so a handler that uses
        alert + confirm in the same file gets ONE error, not three."""
        tsx = 'alert("a"); confirm("b"); prompt("c");'
        errors = _run(tsx)
        dialog_hits = [e for e in errors if "browser-only APIs" in e]
        assert len(dialog_hits) == 1


class TestTimerCalls:
    def test_setTimeout_flagged(self):
        errors = _run("setTimeout(() => doThing(), 100);")
        assert any("setTimeout/setInterval are discouraged in Workers" in e for e in errors)

    def test_setInterval_flagged(self):
        errors = _run("setInterval(() => poll(), 1000);")
        assert any("setTimeout/setInterval are discouraged in Workers" in e for e in errors)

    def test_method_call_setTimeout_not_flagged(self):
        # The rule only matches direct identifier calls; ``foo.setTimeout()``
        # would be a custom method, not the global timer.
        assert _run("obj.setTimeout(() => x(), 100);") == []
