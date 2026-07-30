"""Phase 2 AST rule tests.

Every rule in this file was part of the initial port from the regex
implementation. Each test exercises the rule directly through the
``AstContext`` harness.
"""

from __future__ import annotations

from main_agent.services.validation.tsx_ast import (
    AstContext,
    parse_tsx,
    run_rules,
    source_bytes,
)
from main_agent.services.validation.tsx_ast.rules.default_set import (
    component_rules,
    handler_rules,
    shared_tsx_rules,
)
from main_agent.services.validation.tsx_ast.rules.fail_loudly import PlanFailLoudlyRule
from main_agent.services.validation.tsx_ast.rules.forbidden_apis import ForbiddenApiRule
from main_agent.services.validation.tsx_ast.rules.forbidden_browser_apis import (
    ForbiddenBrowserApiRule,
)
from main_agent.services.validation.tsx_ast.rules.handler_export import (
    HandlerExportRule,
    HandlerSignatureRule,
)
from main_agent.services.validation.tsx_ast.rules.imports import ImportsNonSdkRule
from main_agent.services.validation.tsx_ast.rules.return_fields import (
    check_return_fields_ast,
)
from main_agent.services.validation.tsx_ast.rules.sql_parameterization import (
    SqlParamInjectionRule,
)


def _run(rule, tsx: str, **ctx_kwargs):
    tree = parse_tsx(tsx)
    ctx = AstContext(tsx=tsx, source_buf=source_bytes(tsx), tree=tree, **ctx_kwargs)
    if ctx.models is None:
        ctx.models = []
    return [f.formatted_message() for f in run_rules(ctx, [rule])]


def _errors_only(rule, tsx: str, **kwargs):
    tree = parse_tsx(tsx)
    ctx = AstContext(tsx=tsx, source_buf=source_bytes(tsx), tree=tree, **kwargs)
    if ctx.models is None:
        ctx.models = []
    return [f.message for f in run_rules(ctx, [rule]) if f.severity == "error"]


class TestForbiddenBrowserApis:
    def test_happy_path(self):
        assert (
            _run(ForbiddenBrowserApiRule(), "export default async function f(ctx){ return {}; }")
            == []
        )

    def test_document_access(self):
        errs = _run(
            ForbiddenBrowserApiRule(),
            'export default async function f(ctx){ document.title = "x"; return {}; }',
        )
        assert any("document.*" in e for e in errs)

    def test_window_access(self):
        errs = _run(
            ForbiddenBrowserApiRule(),
            "export default async function f(ctx){ const u = window.location.href; return {u}; }",
        )
        assert any("window.*" in e for e in errs)

    def test_alert_call(self):
        errs = _run(
            ForbiddenBrowserApiRule(),
            'export default async function f(ctx){ alert("x"); return {}; }',
        )
        assert any("alert/confirm/prompt" in e for e in errs)

    def test_setTimeout_call(self):
        errs = _run(
            ForbiddenBrowserApiRule(),
            "export default async function f(ctx){ setTimeout(() => {}, 10); return {}; }",
        )
        assert any("setTimeout/setInterval" in e for e in errs)

    def test_string_literal_mention_not_flagged(self):
        """String literals containing ``window.`` must not trip the rule —
        the AST version sees real member_expression nodes, not source text."""
        assert (
            _run(
                ForbiddenBrowserApiRule(),
                'export default async function f(ctx){ const s = "window.x"; return {s}; }',
            )
            == []
        )

    def test_dedupes_multiple_document_hits(self):
        errs = _run(
            ForbiddenBrowserApiRule(),
            "export default async function f(ctx){ document.a; document.b; document.c; return {}; }",
        )
        # Should be one finding per category, deduped by object name.
        assert len(errs) == 1


class TestForbiddenBrowserApiIsHandlerOnly:
    """Guards against the regression where ForbiddenBrowserApiRule was wired
    into ``shared_tsx_rules()`` and fired on component TSX. Components render
    in the browser — ``window.*`` / ``document.*`` / ``setTimeout`` / ``alert``
    are legitimate there. See rule module docstring: "handlers run on
    Cloudflare Workers, not in a browser"."""

    def test_rule_is_registered_for_handlers(self):
        assert any(isinstance(r, ForbiddenBrowserApiRule) for r in handler_rules())

    def test_rule_is_not_registered_for_components(self):
        assert not any(isinstance(r, ForbiddenBrowserApiRule) for r in component_rules())

    def test_rule_is_not_in_shared_set(self):
        """Double-check via the shared factory directly, in case someone adds
        a duplicate registration later."""
        assert not any(isinstance(r, ForbiddenBrowserApiRule) for r in shared_tsx_rules())

    def test_component_tsx_can_use_browser_apis(self):
        """A realistic sticky-header component pattern (the MainHeader case
        from the 2026-04-21 KOSGEB build that shipped as a placeholder)
        must not emit any ``handler.forbidden.browser_api`` findings when
        checked against the component rule set."""
        tsx = (
            "export function MainHeader() {\n"
            "    useEffect(() => {\n"
            "        const onScroll = () => {};\n"
            "        window.addEventListener('scroll', onScroll);\n"
            "        const root = document.documentElement;\n"
            "        const t = setTimeout(() => {}, 500);\n"
            "        return () => {\n"
            "            window.removeEventListener('scroll', onScroll);\n"
            "            clearTimeout(t);\n"
            "        };\n"
            "    }, []);\n"
            "    return <header />;\n"
            "}\n"
        )
        tree = parse_tsx(tsx)
        ctx = AstContext(tsx=tsx, source_buf=source_bytes(tsx), tree=tree)
        ctx.models = []
        findings = run_rules(ctx, component_rules())
        offenders = [f for f in findings if f.rule_id == "handler.forbidden.browser_api"]
        assert offenders == [], (
            "component rule set must not fire handler.forbidden.browser_api; "
            f"got: {[f.message for f in offenders]}"
        )


class TestSqlParamInjection:
    def test_literal_ok(self):
        assert (
            _run(
                SqlParamInjectionRule(),
                'export default async function f(ctx){ return ctx.db.prepare("SELECT 1").all(); }',
            )
            == []
        )

    def test_template_literal_injection_flagged(self):
        errs = _run(
            SqlParamInjectionRule(),
            "export default async function f(ctx){ return ctx.db.prepare(`SELECT ${id}`).all(); }",
        )
        assert len(errs) == 1
        assert "SQL injection risk" in errs[0]
        assert "${id}" in errs[0]

    def test_multiple_interpolations_listed(self):
        errs = _run(
            SqlParamInjectionRule(),
            "export default async function f(ctx){ "
            "return ctx.db.prepare(`SELECT * FROM ${table} WHERE id = ${id}`).all(); }",
        )
        assert len(errs) == 1
        assert "table" in errs[0]
        assert "id" in errs[0]

    def test_static_template_ok(self):
        assert (
            _run(
                SqlParamInjectionRule(),
                "export default async function f(ctx){ return ctx.db.prepare(`SELECT 1`).all(); }",
            )
            == []
        )


class TestHandlerExport:
    def test_inline_export_default_ok(self):
        assert _run(HandlerExportRule(), "export default async function h(ctx){ return {}; }") == []

    def test_export_default_identifier_ok(self):
        """``async function h(ctx){} export default h;`` — the bare-identifier form."""
        tsx = "async function h(ctx){ return {}; }\nexport default h;"
        assert _run(HandlerExportRule(), tsx) == []

    def test_missing_default_flagged(self):
        errs = _run(HandlerExportRule(), "export function h(ctx){ return {}; }")
        assert len(errs) == 1
        assert "Missing 'export default'" in errs[0]

    def test_no_export_at_all_flagged(self):
        errs = _run(HandlerExportRule(), "async function h(ctx){ return {}; }")
        assert len(errs) == 1


class TestHandlerSignature:
    def test_ctx_param_ok(self):
        warnings = _run(
            HandlerSignatureRule(),
            "export default async function h(ctx: HandlerContext){ return {}; }",
        )
        assert warnings == []

    def test_no_params_warns(self):
        warnings = _run(
            HandlerSignatureRule(),
            "export default async function h(){ return {}; }",
        )
        assert len(warnings) == 1
        assert "no parameters" in warnings[0]

    def test_wrong_name_warns(self):
        warnings = _run(
            HandlerSignatureRule(),
            "export default async function h(req: Request){ return {}; }",
        )
        assert len(warnings) == 1
        assert "is not 'ctx'" in warnings[0]

    def test_context_not_a_valid_ctx(self):
        """``context`` does not contain the substring ``ctx`` (c-o-n-t-e-x-t
        vs c-t-x) so the rule flags it."""
        warnings = _run(
            HandlerSignatureRule(),
            "export default async function h(context: HandlerContext){ return {}; }",
        )
        assert len(warnings) == 1

    def test_arrow_function_not_walked(self):
        """Arrow-function exports are outside the rule's scope."""
        assert _run(HandlerSignatureRule(), "export default (ctx) => ({});") == []


class TestImportsNonSdk:
    def test_sdk_import_ok(self):
        assert (
            _run(
                ImportsNonSdkRule(),
                'import { HandlerContext } from "@exepad/sdk";\n'
                "export default async function h(ctx){ return {}; }",
            )
            == []
        )

    def test_relative_import_ok(self):
        assert (
            _run(
                ImportsNonSdkRule(),
                'import { helper } from "./helper";\n'
                "export default async function h(ctx){ return {}; }",
            )
            == []
        )

    def test_forbidden_import_flagged(self):
        errs = _run(
            ImportsNonSdkRule(),
            'import { motion } from "framer-motion";\n'
            "export default async function h(ctx){ return {}; }",
        )
        assert any("framer-motion" in e for e in errs)

    def test_dedupes_same_source_twice(self):
        tsx = (
            'import { a } from "some-pkg";\n'
            'import { b } from "some-pkg";\n'
            "export default async function h(ctx){ return {}; }"
        )
        errs = _run(ImportsNonSdkRule(), tsx)
        assert len(errs) == 1
        assert "some-pkg" in errs[0]

    # --- extension allow-list (components only) --------------------------
    _EXT_TSX = (
        'import { React } from "@exepad/sdk";\n'
        'import * as THREE from "@exepad/ext-three";\n'
        "export default function Game(){ return null; }"
    )

    def test_ext_three_blocked_without_allowance(self):
        # Default (handler parity) — extensions are NOT admitted.
        errs = _run(ImportsNonSdkRule(), self._EXT_TSX)
        assert any("@exepad/ext-three" in e for e in errs)

    def test_ext_three_allowed_when_passed(self):
        from main_agent.services.validation.tsx_ast.catalog import (
            ALLOWED_EXTENSION_IMPORTS,
        )

        errs = _run(
            ImportsNonSdkRule(allowed_exact=ALLOWED_EXTENSION_IMPORTS),
            self._EXT_TSX,
        )
        assert errs == []

    def test_ext_subpath_still_blocked(self):
        # Exact match only — addons/subpaths don't resolve at runtime, so they
        # must still be rejected even with the extension allowance.
        from main_agent.services.validation.tsx_ast.catalog import (
            ALLOWED_EXTENSION_IMPORTS,
        )

        tsx = (
            "import { OrbitControls } from "
            '"@exepad/ext-three/examples/jsm/controls/OrbitControls";\n'
            "export default function Game(){ return null; }"
        )
        errs = _run(ImportsNonSdkRule(allowed_exact=ALLOWED_EXTENSION_IMPORTS), tsx)
        assert any("@exepad/ext-three/examples" in e for e in errs)

    def test_component_rules_admit_ext_handler_rules_do_not(self):
        # Wiring check: the extension allowance is scoped to component_rules().
        def _msgs(rules):
            tree = parse_tsx(self._EXT_TSX)
            ctx = AstContext(tsx=self._EXT_TSX, source_buf=source_bytes(self._EXT_TSX), tree=tree)
            ctx.models = []
            return [
                f.message
                for f in run_rules(ctx, rules)
                if "Forbidden import" in f.message and "ext-three" in f.message
            ]

        assert _msgs(component_rules()) == []  # components: allowed
        assert _msgs(handler_rules())  # handlers: still forbidden


class TestForbiddenApis:
    def test_eval_flagged(self):
        errs = _errors_only(
            ForbiddenApiRule(),
            "export default async function h(ctx){ eval('1+1'); return {}; }",
        )
        assert any("eval()" in e for e in errs)

    def test_console_log_flagged(self):
        errs = _errors_only(
            ForbiddenApiRule(),
            "export default async function h(ctx){ console.log('x'); return {}; }",
        )
        assert any("console.log()" in e for e in errs)

    def test_localStorage_flagged(self):
        errs = _errors_only(
            ForbiddenApiRule(),
            "export default async function h(ctx){ localStorage.setItem('a','b'); return {}; }",
        )
        assert any("localStorage" in e for e in errs)

    def test_xmlhttprequest_flagged(self):
        errs = _errors_only(
            ForbiddenApiRule(),
            "export default async function h(ctx){ const r = new XMLHttpRequest(); return {r}; }",
        )
        assert any("XMLHttpRequest" in e for e in errs)

    def test_clean_handler_no_errors(self):
        tsx = (
            'import { HandlerContext } from "@exepad/sdk";\n'
            "export default async function h(ctx){ return {a:1}; }"
        )
        assert _errors_only(ForbiddenApiRule(), tsx) == []

    def test_fetch_whitelisted_domain_ok(self):
        tsx = (
            "export default async function h(ctx){ "
            "const r = await fetch('https://r2.exepad.com/file.bin'); return {r}; }"
        )
        assert _errors_only(ForbiddenApiRule(), tsx) == []

    def test_fetch_other_domain_flagged(self):
        tsx = (
            "export default async function h(ctx){ "
            "const r = await fetch('https://evil.com/x'); return {r}; }"
        )
        errs = _errors_only(ForbiddenApiRule(), tsx)
        assert any("fetch()" in e for e in errs)

    def test_session_storage_flagged(self):
        errs = _errors_only(
            ForbiddenApiRule(),
            "export default async function h(ctx){ sessionStorage.setItem('a','b'); return {}; }",
        )
        assert any("sessionStorage" in e for e in errs)

    def test_new_function_flagged(self):
        errs = _errors_only(
            ForbiddenApiRule(),
            "export default async function h(ctx){ const f = new Function('return 1'); return {f}; }",
        )
        assert any("new Function()" in e for e in errs)

    def test_document_getElementById_flagged(self):
        errs = _errors_only(
            ForbiddenApiRule(),
            "export default async function h(ctx){ document.getElementById('x'); return {}; }",
        )
        assert any("document access" in e.lower() for e in errs)

    def test_document_querySelector_flagged(self):
        errs = _errors_only(
            ForbiddenApiRule(),
            "export default async function h(ctx){ document.querySelector('.x'); return {}; }",
        )
        assert any("document access" in e.lower() for e in errs)

    def test_addEventListener_click_flagged(self):
        errs = _errors_only(
            ForbiddenApiRule(),
            "export default async function h(ctx){ "
            "window.addEventListener('click', () => {}); return {}; }",
        )
        assert any("addEventListener" in e for e in errs)

    def test_addEventListener_keydown_allowed(self):
        """Keyboard / scroll / resize events are whitelisted for global capture."""
        tsx = (
            "export default async function h(ctx){ "
            "window.addEventListener('keydown', handler); return {}; }"
        )
        assert _errors_only(ForbiddenApiRule(), tsx) == []

    def test_innerHTML_assignment_flagged(self):
        errs = _errors_only(
            ForbiddenApiRule(),
            "export default async function h(ctx){ el.innerHTML = '<b>x</b>'; return {}; }",
        )
        assert any("innerHTML" in e for e in errs)

    def test_window_location_mutation_flagged(self):
        errs = _errors_only(
            ForbiddenApiRule(),
            "export default async function h(ctx){ window.location.href = '/x'; return {}; }",
        )
        assert any("window.location" in e for e in errs)

    def test_cn_utility_flagged(self):
        errs = _errors_only(
            ForbiddenApiRule(),
            "export default async function h(ctx){ const c = cn('a', 'b'); return {c}; }",
        )
        assert any("cn()" in e for e in errs)

    def test_dedupe_repeated_violations_collapse_to_one_per_kind(self):
        """Three ``localStorage`` references should produce one finding, not three."""
        tsx = (
            "export default async function h(ctx){ "
            "localStorage.getItem('a'); "
            "localStorage.setItem('b','c'); "
            "localStorage.removeItem('d'); "
            "return {}; }"
        )
        errs = _errors_only(ForbiddenApiRule(), tsx)
        assert sum("localStorage" in e for e in errs) == 1


class TestFailLoudly:
    def test_escalation_throw_flagged(self):
        errs = _run(
            PlanFailLoudlyRule(),
            "export default async function h(ctx){ "
            'throw new Error("handler_plan references undeclared tables: foo"); }',
        )
        assert any("Hard Rule #5 escalation" in e for e in errs)

    def test_normal_throw_ok(self):
        assert (
            _run(
                PlanFailLoudlyRule(),
                'export default async function h(ctx){ throw new Error("bad input"); }',
            )
            == []
        )

    def test_throw_in_try_catch_still_flagged(self):
        tsx = (
            "async function h(ctx){ try { "
            "throw new Error('handler_plan references undeclared tables: a, b'); "
            "} catch (e) { throw e; } }\nexport default h;"
        )
        errs = _run(PlanFailLoudlyRule(), tsx)
        assert len(errs) >= 1


class TestReturnMissingField:
    def test_all_fields_present(self):
        tsx = "export default async function h(ctx){ return { a: 1, b: 2 }; }"
        assert check_return_fields_ast(tsx, [{"name": "a"}, {"name": "b"}]) == []

    def test_missing_field(self):
        tsx = "export default async function h(ctx){ return { a: 1 }; }"
        errs = check_return_fields_ast(tsx, [{"name": "a"}, {"name": "b"}])
        assert len(errs) == 1
        assert "missing return field 'b'" in errs[0]

    def test_close_match_suggestion(self):
        tsx = "export default async function h(ctx){ return { totalRevenue: 1 }; }"
        errs = check_return_fields_ast(tsx, [{"name": "totalRevnue"}])
        assert len(errs) == 1
        assert "totalRevenue" in errs[0]

    def test_shorthand_properties(self):
        tsx = "export default async function h(ctx){ const a = 1; const b = 2; return { a, b }; }"
        assert check_return_fields_ast(tsx, [{"name": "a"}, {"name": "b"}]) == []

    def test_spread_does_not_satisfy(self):
        tsx = "export default async function h(ctx){ const rest = {}; return { a: 1, ...rest }; }"
        errs = check_return_fields_ast(tsx, [{"name": "a"}, {"name": "b"}])
        assert any("'b'" in e for e in errs)

    def test_bare_identifier_return_skipped(self):
        """Legacy behavior: can't parse bare ``return r;`` — skip the check."""
        tsx = "export default async function h(ctx){ const r = {a: 1}; return r; }"
        assert check_return_fields_ast(tsx, [{"name": "a"}]) == []
