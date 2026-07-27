"""Tests for ``handler.forbidden.api`` — the catch-all forbidden-API AST rule.

The rule covers a wide surface (eval, cn, fetch with whitelist, console.log,
document method access, addEventListener with event-name whitelist, new
Function / new XMLHttpRequest, localStorage / sessionStorage, window.location
mutation, innerHTML assignment). This file exercises each branch in
isolation so a regression in any single branch is named directly instead
of being absorbed into a bundled phase test.

Error messages are sourced from ``forbidden_api_registry`` — assertions
reference those canonical strings, not local prose.
"""

from __future__ import annotations

import pytest

from main_agent.services.validation import forbidden_api_registry as _registry
from main_agent.services.validation.tsx_ast import (
    AstContext,
    parse_tsx,
    run_rules,
    source_bytes,
)
from main_agent.services.validation.tsx_ast.rules.forbidden_apis import ForbiddenApiRule

pytestmark = [pytest.mark.unit]


def _run(tsx: str) -> list[str]:
    tree = parse_tsx(tsx)
    ctx = AstContext(tsx=tsx, source_buf=source_bytes(tsx), tree=tree, models=[])
    return [f.message for f in run_rules(ctx, [ForbiddenApiRule()]) if f.severity == "error"]


def _run_all_severities(tsx: str) -> list[str]:
    """Variant of :func:`_run` that returns warnings AND errors.

    Most forbidden-API findings are errors, but a few (``body_style_mutation``,
    pending a future strict bump) are emitted as warnings during their
    migration grace period. Tests that care about those use this helper.
    """
    tree = parse_tsx(tsx)
    ctx = AstContext(tsx=tsx, source_buf=source_bytes(tsx), tree=tree, models=[])
    return [f.message for f in run_rules(ctx, [ForbiddenApiRule()])]


def _run_component(tsx: str) -> list[str]:
    """Run the rule with the component-context exemption switched on.

    Mirrors the wiring in ``default_set.component_rules()`` so the unit
    test sees the same configuration that ships in production component
    validation.
    """
    tree = parse_tsx(tsx)
    ctx = AstContext(tsx=tsx, source_buf=source_bytes(tsx), tree=tree, models=[])
    rule = ForbiddenApiRule(useeffect_dom_exempt=True)
    return [f.message for f in run_rules(ctx, [rule]) if f.severity == "error"]


def _run_component_all_severities(tsx: str) -> list[str]:
    """Variant of :func:`_run_component` that returns warnings AND errors."""
    tree = parse_tsx(tsx)
    ctx = AstContext(tsx=tsx, source_buf=source_bytes(tsx), tree=tree, models=[])
    rule = ForbiddenApiRule(useeffect_dom_exempt=True)
    return [f.message for f in run_rules(ctx, [rule])]


def _msg(api_id: str) -> str:
    entry = _registry.get(api_id)
    assert entry is not None, f"registry missing api_id={api_id!r}"
    return entry.error_message


class TestCallExpressions:
    def test_eval_call_flagged(self):
        errors = _run("const x = eval('1 + 1');")
        assert any(_msg("call:eval") in e for e in errors)

    def test_evaluator_custom_function_not_flagged(self):
        # ``evaluator()`` is not ``eval()`` — substring match would be wrong.
        assert _run("const x = evaluator('1 + 1');") == []

    def test_eval_inside_string_literal_not_flagged(self):
        assert _run('const note = "use eval() carefully";') == []

    def test_console_log_call_flagged(self):
        errors = _run("function f() { console.log('hi'); }")
        assert any(_msg("console_log") in e for e in errors)

    def test_console_warn_not_flagged_at_rule_level(self):
        # The rule only catches console.log; the *fixer* strips warn/error/info/debug.
        # This test pins the rule's documented narrow scope so a future widening
        # is a deliberate change.
        assert _run("function f() { console.warn('hi'); }") == []

    def test_cn_call_flagged(self):
        errors = _run("const c = cn('a', 'b');")
        assert any(_msg("cn") in e for e in errors)

    def test_fetch_to_arbitrary_url_flagged(self):
        errors = _run('const r = fetch("https://evil.example.com/api");')
        assert any(_msg("fetch") in e for e in errors)

    def test_fetch_to_whitelisted_r2_url_not_flagged(self):
        assert _run('const r = fetch("https://r2.exepad.com/upload");') == []

    def test_fetch_to_internal_form_url_not_flagged(self):
        # `/_forms/submit` is a real, runtime-supported internal endpoint the
        # ComponentBuilder prompt tells agents to POST forms to, so it is
        # whitelisted (a non-whitelisted host still gets rejected, above).
        assert _run('const r = fetch("/_forms/submit");') == []

    def test_fetch_to_internal_form_url_in_template_literal_not_flagged(self):
        # Template-literal URL with the whitelisted path as a static fragment.
        assert _run("const r = fetch(`/_forms/submit?token=${t}`);") == []

    def test_external_host_with_forms_path_still_flagged(self):
        # The '/_forms/submit' whitelist entry is a same-origin RELATIVE prefix
        # (anchored startswith), NOT an anywhere-substring — so an attacker host
        # that merely contains the path must still be rejected.
        errors = _run('const r = fetch("https://evil.example.com/_forms/submit");')
        assert any(_msg("fetch") in e for e in errors)

    def test_fetch_to_whitelisted_apps_url_not_flagged(self):
        # Third whitelist entry — full coverage of _FETCH_WHITELISTED_SUBSTRINGS.
        assert _run('const r = fetch("https://exepad.com/apps/list");') == []

    def test_fetch_with_whitelisted_url_in_template_literal_not_flagged(self):
        # The rule walks template_string fragments via _iter_static_strings,
        # so a whitelisted substring in a STATIC fragment of a template
        # string is enough to clear the check.
        assert _run("const r = fetch(`https://r2.exepad.com/${path}`);") == []


class TestDocumentMethodAccess:
    def test_document_getElementById_flagged(self):
        errors = _run('const el = document.getElementById("root");')
        assert any(_msg("dom_access") in e for e in errors)

    def test_document_querySelector_flagged(self):
        errors = _run('const el = document.querySelector(".btn");')
        assert any(_msg("dom_access") in e for e in errors)

    def test_document_createElement_flagged(self):
        errors = _run('const el = document.createElement("div");')
        assert any(_msg("dom_access") in e for e in errors)


class TestAddEventListener:
    def test_window_addEventListener_click_flagged(self):
        errors = _run('window.addEventListener("click", () => {});')
        # Look for the registry message's stable prefix.
        assert any("addEventListener" in e and "synthetic events" in e for e in errors)

    def test_window_addEventListener_scroll_whitelisted(self):
        assert _run('window.addEventListener("scroll", () => {});') == []

    def test_window_addEventListener_keydown_whitelisted(self):
        assert _run('window.addEventListener("keydown", () => {});') == []

    def test_document_addEventListener_resize_whitelisted(self):
        assert _run('document.addEventListener("resize", () => {});') == []


class TestNewExpressions:
    def test_new_Function_flagged(self):
        errors = _run('const f = new Function("return 1");')
        assert any(_msg("new:Function") in e for e in errors)

    def test_new_XMLHttpRequest_flagged(self):
        errors = _run("const xhr = new XMLHttpRequest();")
        assert any(_msg("new:XMLHttpRequest") in e for e in errors)


class TestForbiddenIdentifiers:
    def test_localStorage_flagged(self):
        errors = _run('const v = localStorage.getItem("k");')
        assert any(_msg("ident:localStorage") in e for e in errors)

    def test_sessionStorage_flagged(self):
        errors = _run('sessionStorage.setItem("k", "v");')
        assert any(_msg("ident:sessionStorage") in e for e in errors)

    def test_localStorage_as_property_name_not_flagged(self):
        # The rule excludes ``foo.localStorage`` style property access — the
        # forbidden identifier must appear as a real reference, not as the
        # ``property`` of a member_expression.
        assert _run("const x = obj.localStorage;") == []


class TestAssignmentMutations:
    def test_window_location_href_assignment_flagged(self):
        errors = _run('function go() { window.location.href = "/x"; }')
        assert any(_msg("window_location") in e for e in errors)

    def test_window_location_bare_assignment_flagged(self):
        errors = _run('function go() { window.location = "/x"; }')
        assert any(_msg("window_location") in e for e in errors)

    def test_window_location_assign_method_call_flagged(self):
        # ``.assign()`` / ``.replace()`` / ``.reload()`` are method-call
        # mutations of window.location. The rule walks both the
        # assignment branch (`window.location.href = X`) AND the
        # member-expression call branch — both forms are equally bad.
        errors = _run('function go() { window.location.assign("/x"); }')
        assert any(_msg("window_location") in e for e in errors)

    def test_window_location_replace_method_call_flagged(self):
        errors = _run('function go() { window.location.replace("/x"); }')
        assert any(_msg("window_location") in e for e in errors)

    def test_window_location_reload_method_call_flagged(self):
        # The original gap that surfaced on app 6upae87b: a contact form
        # reset via ``window.location.reload()`` was unguarded by the rule
        # because reload is a method call, not an assignment.
        errors = _run("function go() { window.location.reload(); }")
        assert any(_msg("window_location") in e for e in errors)

    def test_innerHTML_assignment_flagged(self):
        errors = _run("function f(el) { el.innerHTML = '<p>x</p>'; }")
        assert any(_msg("innerhtml") in e for e in errors)

    def test_body_style_overflow_assignment_flagged(self):
        # Regression: coje33ih MainSidebar set
        # ``document.body.style.overflow = isMobileOpen ? 'hidden' : ''``
        # inside a useEffect for mobile sidebar scroll lock. The bug is
        # the ad-hoc body mutation, not the location — direct body.style.*
        # leaks state across components if cleanup is missed. The
        # sanctioned alternative is the SDK's ``useBodyScrollLock(active)``.
        # Emitted as a warning during the migration grace period; use
        # the all-severities helper.
        msgs = _run_all_severities("function f() { document.body.style.overflow = 'hidden'; }")
        assert any(_msg("body_style_mutation") in m for m in msgs)

    def test_body_style_paddingRight_assignment_flagged(self):
        # Any property under document.body.style.* is forbidden, not just
        # overflow — the rule covers the whole subtree.
        msgs = _run_all_severities("function f() { document.body.style.paddingRight = '12px'; }")
        assert any(_msg("body_style_mutation") in m for m in msgs)

    def test_body_style_mutation_fires_inside_useeffect_too(self):
        # Unlike ``dom_access`` (querySelector/etc.), this rule MUST fire
        # even inside useEffect: the entire point is that the SDK hook
        # exists precisely to wrap the useEffect+cleanup boilerplate
        # safely. Allowing the bare form inside useEffect would defeat
        # the purpose.
        tsx = (
            "function C() {\n"
            "  React.useEffect(() => {\n"
            "    document.body.style.overflow = 'hidden';\n"
            "  }, []);\n"
            "  return null;\n"
            "}\n"
        )
        msgs = _run_component_all_severities(tsx)
        assert any(_msg("body_style_mutation") in m for m in msgs)

    def test_other_element_style_unflagged(self):
        # ``el.style.X = Y`` on a non-body element is fine — the agent
        # might tweak a ref'd DOM node's style. Only the global body
        # mutation is forbidden.
        assert _run_all_severities("function f(el) { el.style.color = 'red'; }") == []

    def test_url_createObjectURL_flagged(self):
        # The Blob-URL half of the download antipattern. Sanctioned
        # alternative is downloadFile() / downloadCsv() from @exepad/sdk.
        msgs = _run_all_severities("function f(b) { const u = URL.createObjectURL(b); return u; }")
        assert any(_msg("url_create_object_url") in m for m in msgs)


class TestUseEffectExemption:
    """Component context: DOM patterns inside useEffect callbacks pass.

    Pinned by the design-import mechanical pipeline — it wraps source
    ``<script>`` bodies in a single ``React.useEffect`` block, and the
    rule's own error message tells the LLM to "use useEffect with refs",
    so the rule must not block what its message recommends.
    """

    def test_document_querySelector_inside_useeffect_allowed(self):
        tsx = (
            "function C() {\n"
            "  React.useEffect(() => {\n"
            "    const el = document.querySelector('.btn');\n"
            "  }, []);\n"
            "  return null;\n"
            "}\n"
        )
        assert _run_component(tsx) == []

    def test_document_getElementById_inside_useeffect_allowed(self):
        tsx = (
            "function C() {\n"
            "  React.useEffect(() => {\n"
            "    const el = document.getElementById('root');\n"
            "  }, []);\n"
            "  return null;\n"
            "}\n"
        )
        assert _run_component(tsx) == []

    def test_document_addEventListener_click_inside_useeffect_allowed(self):
        # ``click`` is NOT in the addEventListener whitelist — it fails
        # at the top level. Inside useEffect, the exemption applies.
        tsx = (
            "function C() {\n"
            "  React.useEffect(() => {\n"
            "    document.addEventListener('click', (e) => {});\n"
            "  }, []);\n"
            "  return null;\n"
            "}\n"
        )
        assert _run_component(tsx) == []

    def test_document_addEventListener_mousemove_inside_useeffect_allowed(self):
        # The exact pattern Onix Studio uses for its magnetic-CTA effect.
        tsx = (
            "function C() {\n"
            "  React.useEffect(() => {\n"
            "    document.addEventListener('mousemove', handler);\n"
            "  }, []);\n"
            "  return null;\n"
            "}\n"
        )
        assert _run_component(tsx) == []

    def test_innerHTML_assignment_inside_useeffect_allowed(self):
        tsx = (
            "function C() {\n"
            "  React.useEffect(() => {\n"
            "    success.innerHTML = '<p>Sent</p>';\n"
            "  }, []);\n"
            "  return null;\n"
            "}\n"
        )
        assert _run_component(tsx) == []

    def test_document_addEventListener_inside_bare_useeffect_allowed(self):
        # ``useEffect`` (not ``React.useEffect``) — the destructured form
        # the LLM emits when it imports the hook directly. Must also
        # qualify for the exemption.
        tsx = (
            "function C() {\n"
            "  useEffect(() => {\n"
            "    document.addEventListener('click', handler);\n"
            "  }, []);\n"
            "  return null;\n"
            "}\n"
        )
        assert _run_component(tsx) == []

    def test_document_querySelector_inside_uselayouteffect_allowed(self):
        # useLayoutEffect has the same DOM-mutation semantics as useEffect.
        tsx = (
            "function C() {\n"
            "  React.useLayoutEffect(() => {\n"
            "    const el = document.querySelector('.x');\n"
            "  }, []);\n"
            "  return null;\n"
            "}\n"
        )
        assert _run_component(tsx) == []

    def test_dom_access_outside_useeffect_still_flagged_in_component(self):
        # Top-level DOM access — even with the exemption — is still wrong
        # (it'd run on every render). The exemption is strictly scoped
        # to useEffect callbacks.
        tsx = (
            "function C() {\n"
            "  const el = document.querySelector('.btn');\n"
            "  return null;\n"
            "}\n"
        )
        errors = _run_component(tsx)
        assert any(_msg("dom_access") in e for e in errors)

    def test_eval_inside_useeffect_still_flagged(self):
        # The exemption covers DOM patterns ONLY. Hard rules (eval, cn,
        # raw fetch, console.log, localStorage, window.location mutation,
        # new Function/XMLHttpRequest) remain in force inside useEffect.
        tsx = (
            "function C() {\n"
            "  React.useEffect(() => {\n"
            "    eval('1 + 1');\n"
            "  }, []);\n"
            "  return null;\n"
            "}\n"
        )
        errors = _run_component(tsx)
        assert any(_msg("call:eval") in e for e in errors)

    def test_console_log_inside_useeffect_still_flagged(self):
        tsx = (
            "function C() {\n"
            "  React.useEffect(() => {\n"
            "    console.log('debug');\n"
            "  }, []);\n"
            "  return null;\n"
            "}\n"
        )
        errors = _run_component(tsx)
        assert any(_msg("console_log") in e for e in errors)

    def test_window_location_mutation_inside_useeffect_still_flagged(self):
        tsx = (
            "function C() {\n"
            "  React.useEffect(() => {\n"
            "    window.location.href = '/x';\n"
            "  }, []);\n"
            "  return null;\n"
            "}\n"
        )
        errors = _run_component(tsx)
        assert any(_msg("window_location") in e for e in errors)

    def test_localStorage_inside_useeffect_still_flagged(self):
        tsx = (
            "function C() {\n"
            "  React.useEffect(() => {\n"
            "    const v = localStorage.getItem('k');\n"
            "  }, []);\n"
            "  return null;\n"
            "}\n"
        )
        errors = _run_component(tsx)
        assert any(_msg("ident:localStorage") in e for e in errors)

    def test_handler_context_strict_even_inside_useeffect(self):
        # A handler that somehow contains a useEffect call (LLM
        # hallucination) must STILL be flagged for DOM access — the
        # exemption is component-only.
        tsx = (
            "function C() {\n"
            "  React.useEffect(() => {\n"
            "    document.querySelector('.x');\n"
            "  }, []);\n"
            "  return null;\n"
            "}\n"
        )
        errors = _run(tsx)  # default: useeffect_dom_exempt=False
        assert any(_msg("dom_access") in e for e in errors)


class TestDeduplication:
    def test_repeated_violations_emit_once_per_kind(self):
        # Two console.log calls + two eval calls → one finding each, not four.
        tsx = (
            "function f() {\n"
            "  console.log('a');\n"
            "  console.log('b');\n"
            "  eval('1');\n"
            "  eval('2');\n"
            "}\n"
        )
        errors = _run(tsx)
        # One console_log and one call:eval finding (the rule's emit() guards
        # against per-kind duplication).
        console_hits = [e for e in errors if _msg("console_log") in e]
        eval_hits = [e for e in errors if _msg("call:eval") in e]
        assert len(console_hits) == 1
        assert len(eval_hits) == 1
