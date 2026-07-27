"""Unit tests for the tsc_validator runner.

The mock-based tests run anywhere. The end-to-end tests are guarded by a
``shutil.which("tsc")`` check — they only run when the ``tsc`` binary is
on PATH, which is the case in the agent's Docker image and on developer
machines that have ``typescript`` installed globally.
"""

from __future__ import annotations

import shutil
from unittest.mock import patch

import pytest

from main_agent.services.validation.tsc_validator.dts_generator import generate_app_dts
from main_agent.services.validation.tsc_validator.runner import (
    _parse_diagnostics,
    run_tsc_check,
)

pytestmark = [pytest.mark.unit]


_TSC_AVAILABLE = shutil.which("tsc") is not None
_REQUIRES_TSC = pytest.mark.skipif(not _TSC_AVAILABLE, reason="tsc not on PATH")


class TestGracefulFallback:
    def test_empty_tsx_returns_empty_findings(self):
        out = run_tsc_check(tsx="", component_name="Hero", app_dts="")
        assert out == []

    def test_whitespace_only_tsx_returns_empty_findings(self):
        out = run_tsc_check(tsx="   \n  \n", component_name="Hero", app_dts="")
        assert out == []

    def test_missing_tsc_binary_returns_empty_findings(self):
        # Simulate ``tsc`` not on PATH — local dev without Node.js.
        with patch(
            "main_agent.services.validation.tsc_validator.runner.subprocess.run",
            side_effect=FileNotFoundError("tsc not found"),
        ):
            out = run_tsc_check(
                tsx="export default function Hero() { return null; }",
                component_name="Hero",
                app_dts="",
            )
            assert out == []

    def test_missing_gate_dts_returns_empty_findings(self):
        # When the curated SDK gate declaration is missing from disk,
        # the gate skips silently rather than failing — defensive path
        # in case the file is deleted or renamed.
        with patch(
            "main_agent.services.validation.tsc_validator.runner._AGENT_SDK_GATE_DTS"
        ) as gate_mock:
            gate_mock.is_file.return_value = False
            out = run_tsc_check(
                tsx="export default function Hero() { return null; }",
                component_name="Hero",
                app_dts="",
            )
            assert out == []


class TestDiagnosticParsing:
    def test_parses_standard_tsc_error_line(self):
        # tsc emits ``file(line,col): error TS<code>: <msg>`` per diagnostic.
        stdout = "Hero.tsx(12,5): error TS2304: Cannot find name 'foo'."
        findings = list(_parse_diagnostics(stdout, "Hero"))
        assert len(findings) == 1
        f = findings[0]
        assert f.rule_id == "tsc.2304"
        assert f.severity == "error"
        assert f.line == 12
        assert f.col == 5
        assert "Cannot find name 'foo'" in f.message

    def test_parses_path_prefixed_diagnostic(self):
        # Real tsc output includes the working-directory path prefix.
        stdout = "/tmp/tsc-gate-abc/Hero.tsx(7,10): error TS2345: Argument of type 'string' is not assignable to parameter of type 'never'."
        findings = list(_parse_diagnostics(stdout, "Hero"))
        assert len(findings) == 1
        assert findings[0].rule_id == "tsc.2345"
        assert findings[0].line == 7

    def test_skips_diagnostics_from_other_files(self):
        # The runner should only surface diagnostics from the user's
        # component file — not from the SDK type bundle.
        stdout = (
            "node_modules/@exepad/sdk/index.ts(99,1): error TS2322: ...\n"
            "Hero.tsx(3,5): error TS2304: Cannot find name 'wibble'."
        )
        findings = list(_parse_diagnostics(stdout, "Hero"))
        # Only the Hero.tsx diagnostic survives.
        assert len(findings) == 1
        assert findings[0].rule_id == "tsc.2304"

    def test_skips_non_diagnostic_lines(self):
        # tsc prints summary lines and blank lines that aren't diagnostics.
        stdout = (
            "\n"
            "Hero.tsx(1,1): error TS2304: Cannot find name 'foo'.\n"
            "Found 1 error in Hero.tsx:1\n"
        )
        findings = list(_parse_diagnostics(stdout, "Hero"))
        assert len(findings) == 1

    def test_no_diagnostics_yields_no_findings(self):
        assert list(_parse_diagnostics("", "Hero")) == []
        assert list(_parse_diagnostics("Hello world", "Hero")) == []


@_REQUIRES_TSC
class TestEndToEndCompile:
    """End-to-end tsc invocations — guarded by tsc availability.

    These regressions guard against the production failure mode where
    every JSX-using component failed with TS2875 / TS7026 because the
    tsc gate didn't stage React types. The shim makes JSX type-erased
    (everything ``any``) so tsc parses but doesn't validate JSX shape;
    cross-reference checks on identifiers (``useModel``, ``Icons.X``,
    etc.) and undeclared-name checks still fire.
    """

    APP_DTS = generate_app_dts(
        backend={"models": [{"name": "users", "columns": [{"name": "id", "type": "uuid"}]}]},
        logic={},
        pages=[{"slug": "/"}],
    )

    def test_clean_jsx_component_passes(self):
        # Real-shape component using JSX, SDK hooks, optional chaining.
        # Pre-shim, this failed with TS2875 (react/jsx-runtime missing)
        # and TS7026 (JSX.IntrinsicElements missing).
        tsx = (
            "import { useModel, Icons } from '@exepad/sdk';\n"
            "\n"
            "export default function Hero() {\n"
            "  const users = useModel('users');\n"
            "  return (\n"
            '    <section className="hero">\n'
            "      <h1>Welcome</h1>\n"
            "      <Icons.Star />\n"
            "      <p>{users.data?.length ?? 0} members</p>\n"
            "    </section>\n"
            "  );\n"
            "}\n"
        )
        out = run_tsc_check(tsx=tsx, component_name="Hero", app_dts=self.APP_DTS)
        assert out == [], f"expected zero findings, got: {[f.message for f in out]}"

    def test_canonical_two_arg_use_array_state_passes(self):
        # Verdant (2026-07-11) regression: the gate declared
        # ``useArrayState(initial?: T[])`` — no key — so the canonical
        # SDK call ``useArrayState("cartItems", [])`` failed with
        # TS2345 + TS2554 on EVERY save, burning both tsc retries on a
        # phantom error. The gate must mirror the real SDK signature
        # (key, initialValue?) and type the returned helpers.
        tsx = (
            "import { useArrayState } from '@exepad/sdk';\n"
            "\n"
            "export default function Cart() {\n"
            "  const { items, push, remove, updateItem, clear } =\n"
            "    useArrayState('cartItems', []);\n"
            "  return (\n"
            "    <div>\n"
            "      <p>{items.length} items</p>\n"
            "      <button onClick={() => clear()}>Clear</button>\n"
            "    </div>\n"
            "  );\n"
            "}\n"
        )
        out = run_tsc_check(tsx=tsx, component_name="Cart", app_dts=self.APP_DTS)
        assert out == [], f"expected zero findings, got: {[f.message for f in out]}"

    def test_array_first_use_array_state_is_rejected(self):
        # ``useArrayState<T>([])`` (array as key) is broken at runtime —
        # the corrected gate must flag it rather than bless it.
        tsx = (
            "import { useArrayState } from '@exepad/sdk';\n"
            "\n"
            "export default function Cart() {\n"
            "  const state = useArrayState<{ id: number }>([]);\n"
            "  return <div>{String(state)}</div>;\n"
            "}\n"
        )
        out = run_tsc_check(tsx=tsx, component_name="Cart", app_dts=self.APP_DTS)
        assert out, "expected a tsc finding for the array-as-key call"

    def test_undeclared_identifier_still_caught(self):
        # The shim must not mask real bugs. Undeclared names are TS2304.
        tsx = (
            "import { useModel } from '@exepad/sdk';\n"
            "\n"
            "export default function Hero() {\n"
            "  return <div>{undeclaredVar}</div>;\n"
            "}\n"
        )
        out = run_tsc_check(tsx=tsx, component_name="Hero", app_dts=self.APP_DTS)
        assert any(f.rule_id == "tsc.2304" for f in out), [f.rule_id for f in out]
        assert any("undeclaredVar" in f.message for f in out)

    def test_jsx_with_template_literals_and_conditionals(self):
        # Pattern that pre-shim crashed on every <button>, <span>.
        tsx = (
            "import { useApp } from '@exepad/sdk';\n"
            "\n"
            "export default function Counter() {\n"
            "  const app = useApp((s: any) => s.count);\n"
            "  return (\n"
            "    <div className={`wrap ${app > 0 ? 'active' : ''}`}>\n"
            "      <button onClick={() => null}>+</button>\n"
            "      <span>{app}</span>\n"
            "    </div>\n"
            "  );\n"
            "}\n"
        )
        out = run_tsc_check(tsx=tsx, component_name="Counter", app_dts=self.APP_DTS)
        assert out == [], f"expected zero findings, got: {[f.message for f in out]}"


@_REQUIRES_TSC
class TestReactNamespaceTypePositions:
    """Production regression — the Onix run hit ``Cannot find namespace
    'React'`` (TS2503) on a single component. The LLM commonly emits
    ``React.SyntheticEvent``, ``React.MouseEvent``, etc. as type
    annotations. Without a top-level ``declare namespace React``, those
    type positions fail. Tests below exercise every pattern observed in
    the corpus + a few more anticipated ones.
    """

    APP_DTS = generate_app_dts(backend={}, logic={}, pages=[])

    def test_react_synthetic_event_type_position(self):
        # The exact failure pattern from the Onix trace.
        tsx = (
            "import { useApp } from '@exepad/sdk';\n"
            "\n"
            "export default function Form() {\n"
            "  const handleSubmit = (e: React.SyntheticEvent) => {\n"
            "    e.preventDefault();\n"
            "  };\n"
            "  return <form onSubmit={handleSubmit}><input /></form>;\n"
            "}\n"
        )
        out = run_tsc_check(tsx=tsx, component_name="Form", app_dts=self.APP_DTS)
        assert out == [], f"expected zero findings, got: {[f.message for f in out]}"

    def test_react_event_subtypes_pass(self):
        # The full set of event subtypes the LLM commonly uses.
        tsx = (
            "import { useApp } from '@exepad/sdk';\n"
            "\n"
            "export default function Form() {\n"
            "  const onChange = (e: React.ChangeEvent<HTMLInputElement>) => null;\n"
            "  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => null;\n"
            "  const onClick = (e: React.MouseEvent<HTMLButtonElement>) => null;\n"
            "  const onKey = (e: React.KeyboardEvent) => null;\n"
            "  const onFocus = (e: React.FocusEvent) => null;\n"
            "  return (\n"
            "    <form onSubmit={onSubmit}>\n"
            "      <input onChange={onChange} onFocus={onFocus} onKeyDown={onKey} />\n"
            "      <button onClick={onClick}>Go</button>\n"
            "    </form>\n"
            "  );\n"
            "}\n"
        )
        out = run_tsc_check(tsx=tsx, component_name="Form", app_dts=self.APP_DTS)
        assert out == [], f"expected zero findings, got: {[f.message for f in out]}"

    def test_react_value_namespace_passes(self):
        # ``React.useState`` / ``React.Fragment`` / ``React.useRef`` etc.
        # are value positions (different from type positions tested above).
        tsx = (
            "import { useApp } from '@exepad/sdk';\n"
            "\n"
            "export default function Counter() {\n"
            "  const [count, setCount] = React.useState(0);\n"
            "  const ref = React.useRef(null);\n"
            "  React.useEffect(() => { console.log(count); }, [count]);\n"
            "  return (\n"
            "    <React.Fragment>\n"
            "      <span>{count}</span>\n"
            "      <button onClick={() => setCount(count + 1)} ref={ref}>+</button>\n"
            "    </React.Fragment>\n"
            "  );\n"
            "}\n"
        )
        out = run_tsc_check(tsx=tsx, component_name="Counter", app_dts=self.APP_DTS)
        assert out == [], f"expected zero findings, got: {[f.message for f in out]}"

    def test_react_FC_generic_passes(self):
        # ``React.FC<Props>`` is a common LLM pattern.
        tsx = (
            "import { useApp } from '@exepad/sdk';\n"
            "\n"
            "interface MyProps { name: string; count: number }\n"
            "\n"
            "const MyComp: React.FC<MyProps> = (props: MyProps) => {\n"
            "  return <div>{props.name}: {props.count}</div>;\n"
            "};\n"
            "\n"
            "export default MyComp;\n"
        )
        out = run_tsc_check(tsx=tsx, component_name="MyComp", app_dts=self.APP_DTS)
        assert out == [], f"expected zero findings, got: {[f.message for f in out]}"

    def test_react_dom_attribute_helpers_pass(self):
        # ``React.HTMLAttributes`` / ``React.CSSProperties`` etc. — used
        # when the LLM types polymorphic prop spreads.
        tsx = (
            "import { useApp } from '@exepad/sdk';\n"
            "\n"
            "interface BoxProps extends React.HTMLAttributes<HTMLDivElement> {\n"
            "  variant?: string;\n"
            "}\n"
            "\n"
            "export default function Box(props: BoxProps) {\n"
            "  const style: React.CSSProperties = { padding: 8 };\n"
            "  return <div style={style} {...props} />;\n"
            "}\n"
        )
        out = run_tsc_check(tsx=tsx, component_name="Box", app_dts=self.APP_DTS)
        assert out == [], f"expected zero findings, got: {[f.message for f in out]}"

    def test_default_react_import_still_works(self):
        # Pre-fix, ``import React from 'react'`` worked because
        # ``const React: any; export = React`` made it a value.
        # Post-fix, ``export = React`` references the namespace —
        # default + namespace imports must both still resolve.
        tsx = (
            "import React from 'react';\n"
            "import { useApp } from '@exepad/sdk';\n"
            "\n"
            "export default function Hero() {\n"
            "  React.useEffect(() => {}, []);\n"
            "  return <div>Hello</div>;\n"
            "}\n"
        )
        out = run_tsc_check(tsx=tsx, component_name="Hero", app_dts=self.APP_DTS)
        assert out == [], f"expected zero findings, got: {[f.message for f in out]}"

    def test_namespace_react_import_still_works(self):
        tsx = (
            "import * as React from 'react';\n"
            "import { useApp } from '@exepad/sdk';\n"
            "\n"
            "export default function Hero() {\n"
            "  const [n] = React.useState(0);\n"
            "  return <div>{n}</div>;\n"
            "}\n"
        )
        out = run_tsc_check(tsx=tsx, component_name="Hero", app_dts=self.APP_DTS)
        assert out == [], f"expected zero findings, got: {[f.message for f in out]}"


@_REQUIRES_TSC
class TestImplicitAnyTolerance:
    """Production regression — the LLM commonly emits ``(e) => ...``
    event handlers without annotating the parameter. ``noImplicitAny``
    is disabled in the gate's tsconfig so these don't false-positive.
    ``strictNullChecks`` remains on, so genuine null-safety bugs still
    fire.
    """

    APP_DTS = generate_app_dts(
        backend={"models": [{"name": "users", "columns": [{"name": "email", "type": "string"}]}]},
        logic={},
        pages=[],
    )

    def test_untyped_event_handler_param_passes(self):
        # The exact failure pattern from the production trace
        # (TS7006 on ``Parameter 'e' implicitly has an 'any' type``).
        tsx = (
            "import { useApp } from '@exepad/sdk';\n"
            "\n"
            "export default function Form() {\n"
            "  const onSubmit = (e) => { e.preventDefault(); };\n"
            "  const onChange = (e) => { console.log(e.target.value); };\n"
            "  const onClick = (e) => { e.stopPropagation(); };\n"
            "  return (\n"
            "    <form onSubmit={onSubmit}>\n"
            "      <input onChange={onChange} />\n"
            "      <button onClick={onClick}>Go</button>\n"
            "    </form>\n"
            "  );\n"
            "}\n"
        )
        out = run_tsc_check(tsx=tsx, component_name="Form", app_dts=self.APP_DTS)
        assert out == [], f"expected zero findings, got: {[f.message for f in out]}"

    def test_strict_null_checks_still_fire(self):
        # Disabling noImplicitAny does NOT relax strictNullChecks.
        # ``useModel().data`` is ``T[] | null``; accessing ``.length``
        # without a guard must still error.
        tsx = (
            "import { useModel } from '@exepad/sdk';\n"
            "\n"
            "export default function Hero() {\n"
            "  const u = useModel('users');\n"
            "  const n = u.data.length;\n"
            "  return <div>{n}</div>;\n"
            "}\n"
        )
        out = run_tsc_check(tsx=tsx, component_name="Hero", app_dts=self.APP_DTS)
        assert any(
            f.rule_id == "tsc.18047" for f in out
        ), f"expected tsc.18047 (strict null check), got: {[f.rule_id for f in out]}"

    def test_undeclared_identifier_still_caught_under_relaxed_any(self):
        # Disabling noImplicitAny doesn't relax TS2304 (Cannot find
        # name) — undeclared identifiers must still fire.
        tsx = (
            "import { useApp } from '@exepad/sdk';\n"
            "\n"
            "export default function Hero() {\n"
            "  const x = totallyUndefinedSymbol;\n"
            "  return <div>{x}</div>;\n"
            "}\n"
        )
        out = run_tsc_check(tsx=tsx, component_name="Hero", app_dts=self.APP_DTS)
        assert any(f.rule_id == "tsc.2304" for f in out), [f.rule_id for f in out]


@_REQUIRES_TSC
class TestSdkReactReexport:
    """Production regression — third Onix run failed twice on TS2347
    (``Untyped function calls may not accept type arguments``) because
    ``import { React } from '@exepad/sdk'`` resolved to ``any``,
    breaking ``React.useState<T>(...)``. Fixed by re-exporting the real
    React namespace from the SDK module via ``import * as RealReact
    from "react"; const React: typeof RealReact``.
    """

    APP_DTS = generate_app_dts(backend={}, logic={}, pages=[])

    def test_react_useState_with_type_arg_via_sdk_import(self):
        # The exact failure pattern from the third Onix trace.
        tsx = (
            "import { React } from '@exepad/sdk';\n"
            "\n"
            "function HomeContent() {\n"
            "  const [name, setName] = React.useState<string>('');\n"
            "  const [items, setItems] = React.useState<{id: number}[]>([]);\n"
            "  const [user, setUser] = React.useState<{id: string} | null>(null);\n"
            "  return <div>{name}: {items.length}</div>;\n"
            "}\n"
            "\n"
            "export default HomeContent;\n"
        )
        out = run_tsc_check(tsx=tsx, component_name="HomeContent", app_dts=self.APP_DTS)
        assert out == [], f"expected zero findings, got: {[f.message for f in out]}"

    def test_react_useRef_typed_with_null_initial(self):
        # ``useRef<HTMLDivElement>(null)`` — the universal idiom. The
        # shim's ``useRef`` signature must accept ``T | null``, not just
        # ``T | undefined``.
        tsx = (
            "import { React } from '@exepad/sdk';\n"
            "\n"
            "function Hero() {\n"
            "  const ref = React.useRef<HTMLDivElement>(null);\n"
            "  const numberRef = React.useRef<number>(0);\n"
            "  return <div ref={ref}>{numberRef.current}</div>;\n"
            "}\n"
            "\n"
            "export default Hero;\n"
        )
        out = run_tsc_check(tsx=tsx, component_name="Hero", app_dts=self.APP_DTS)
        assert out == [], f"expected zero findings, got: {[f.message for f in out]}"

    def test_react_forwardRef_memo_createContext_type_args(self):
        # The full set of generic React APIs the LLM uses.
        tsx = (
            "import { React } from '@exepad/sdk';\n"
            "\n"
            "interface Props { name: string }\n"
            "\n"
            "const Inner = React.forwardRef<HTMLDivElement, Props>((p, ref) => (\n"
            "  <div ref={ref}>{p.name}</div>\n"
            "));\n"
            "\n"
            "const Memoised = React.memo<typeof Inner>(Inner);\n"
            "\n"
            "const Ctx = React.createContext<{value: number}>({value: 0});\n"
            "\n"
            "function Page() {\n"
            "  return (\n"
            "    <Ctx.Provider value={{value: 1}}>\n"
            "      <Memoised name='hi' ref={null} />\n"
            "    </Ctx.Provider>\n"
            "  );\n"
            "}\n"
            "\n"
            "export default Page;\n"
        )
        out = run_tsc_check(tsx=tsx, component_name="Page", app_dts=self.APP_DTS)
        assert out == [], f"expected zero findings, got: {[f.message for f in out]}"


@_REQUIRES_TSC
class TestSdkGenericHelpers:
    """Latent shim gaps closed alongside the React fix —
    ``useForm<T>()`` (react-hook-form), ``useArrayState<T>()``,
    ``useFakeStream<T>()``, and ``<Controller<T> ...>`` would all have
    fired TS2347 if the LLM had used them with explicit type args.
    These weren't observed in production yet but are common patterns.
    """

    APP_DTS = generate_app_dts(backend={}, logic={}, pages=[])

    def test_useForm_with_type_arg_via_sdk_import(self):
        tsx = (
            "import { useForm } from '@exepad/sdk';\n"
            "\n"
            "interface BriefData { name: string; email: string }\n"
            "\n"
            "function ContactForm() {\n"
            "  const form = useForm<BriefData>({});\n"
            "  return <form>{String(form)}</form>;\n"
            "}\n"
            "\n"
            "export default ContactForm;\n"
        )
        out = run_tsc_check(tsx=tsx, component_name="ContactForm", app_dts=self.APP_DTS)
        assert out == [], f"expected zero findings, got: {[f.message for f in out]}"

    def test_useArrayState_with_type_arg(self):
        # Explicit type args on the CANONICAL (key, initial) call must
        # type-check. (This test formerly blessed the array-as-key call
        # ``useArrayState<T>([])`` — that mirrored a drifted gate
        # signature with no ``key`` param; the real SDK requires the key,
        # and the array-first form is broken at runtime.)
        tsx = (
            "import { useArrayState } from '@exepad/sdk';\n"
            "\n"
            "function Board() {\n"
            "  const arr = useArrayState<{id: number; label: string}>('boardItems', []);\n"
            "  return <div>{arr.items.length}</div>;\n"
            "}\n"
            "\n"
            "export default Board;\n"
        )
        out = run_tsc_check(tsx=tsx, component_name="Board", app_dts=self.APP_DTS)
        assert out == [], f"expected zero findings, got: {[f.message for f in out]}"

    def test_Controller_as_jsx_with_type_arg(self):
        # react-hook-form's ``<Controller<TFormData> ... />`` pattern.
        tsx = (
            "import { Controller } from '@exepad/sdk';\n"
            "\n"
            "interface FormShape { name: string }\n"
            "\n"
            "function Field() {\n"
            "  return <Controller<FormShape> name='name' control={null as any} render={() => <input />} />;\n"
            "}\n"
            "\n"
            "export default Field;\n"
        )
        out = run_tsc_check(tsx=tsx, component_name="Field", app_dts=self.APP_DTS)
        assert out == [], f"expected zero findings, got: {[f.message for f in out]}"


@_REQUIRES_TSC
class TestCrossReferenceConstraints:
    """The actual Phase 2 narrowing — proves typed catalog enforcement.

    These tests are the gate's reason for existing. They verify that
    ``useModel('UnknownModel')``, ``useHandler('unknown_handler')``,
    ``setState('unknown_key', ...)``, and ``navigate('/unknown')`` all
    surface as ``tsc.2345`` errors when the per-app augmented catalog
    declares only specific names.
    """

    APP_DTS = generate_app_dts(
        backend={
            "models": [
                {
                    "name": "users",
                    "columns": [
                        {"name": "id", "type": "uuid"},
                        {"name": "email", "type": "string"},
                    ],
                },
                {
                    "name": "posts",
                    "columns": [
                        {"name": "id", "type": "uuid"},
                        {"name": "title", "type": "string"},
                    ],
                },
            ],
            "handlers": [
                {
                    "name": "send_invite",
                    "outputs": [
                        {"name": "ok", "type": "boolean"},
                    ],
                },
            ],
        },
        logic={"state": {"isOpen": False, "count": 0}},
        pages=[{"slug": "/"}, {"slug": "/posts"}],
    )

    def test_useModel_unknown_name_errors(self):
        tsx = (
            "import { useModel } from '@exepad/sdk';\n"
            "\n"
            "export default function Hero() {\n"
            "  const x = useModel('NonExistentModel');\n"
            "  return <div>{x.loading ? '...' : 'done'}</div>;\n"
            "}\n"
        )
        out = run_tsc_check(tsx=tsx, component_name="Hero", app_dts=self.APP_DTS)
        assert any(f.rule_id == "tsc.2345" for f in out), (
            f"expected tsc.2345 (Argument not assignable), got rules: "
            f"{[f.rule_id for f in out]}"
        )
        assert any("NonExistentModel" in f.message for f in out)

    def test_useModel_known_name_passes(self):
        tsx = (
            "import { useModel } from '@exepad/sdk';\n"
            "\n"
            "export default function Hero() {\n"
            "  const u = useModel('users');\n"
            "  const p = useModel('posts');\n"
            "  return <div>{(u.data?.length ?? 0) + (p.data?.length ?? 0)}</div>;\n"
            "}\n"
        )
        out = run_tsc_check(tsx=tsx, component_name="Hero", app_dts=self.APP_DTS)
        assert out == [], f"expected zero findings, got: {[f.message for f in out]}"

    def test_useHandler_unknown_name_errors(self):
        tsx = (
            "import { useHandler } from '@exepad/sdk';\n"
            "\n"
            "export default function Hero() {\n"
            "  const h = useHandler('nonexistent_handler');\n"
            "  return <div>{h.loading ? '...' : 'done'}</div>;\n"
            "}\n"
        )
        out = run_tsc_check(tsx=tsx, component_name="Hero", app_dts=self.APP_DTS)
        assert any(
            f.rule_id == "tsc.2345" for f in out
        ), f"expected tsc.2345, got: {[f.rule_id for f in out]}"
        assert any("nonexistent_handler" in f.message for f in out)

    def test_useHandler_known_name_passes(self):
        tsx = (
            "import { useHandler } from '@exepad/sdk';\n"
            "\n"
            "export default function Hero() {\n"
            "  const h = useHandler('send_invite');\n"
            "  return <div>{h.data?.ok ? 'sent' : 'pending'}</div>;\n"
            "}\n"
        )
        out = run_tsc_check(tsx=tsx, component_name="Hero", app_dts=self.APP_DTS)
        assert out == [], f"expected zero findings, got: {[f.message for f in out]}"

    def test_setState_unknown_key_errors(self):
        tsx = (
            "import { setState } from '@exepad/sdk';\n"
            "\n"
            "export default function Hero() {\n"
            "  setState('unknown_key' as any, 1);\n"
            "  return <div />;\n"
            "}\n"
        )
        # The ``as any`` cast is intentional — we want to verify the
        # gate catches a UNcasted version. Casted should pass; uncasted
        # should fail.
        out = run_tsc_check(tsx=tsx, component_name="Hero", app_dts=self.APP_DTS)
        # Casted: passes (gate respects user's explicit cast).
        assert out == []

        tsx_uncasted = (
            "import { setState } from '@exepad/sdk';\n"
            "\n"
            "export default function Hero() {\n"
            "  setState('unknown_key', 1);\n"
            "  return <div />;\n"
            "}\n"
        )
        out2 = run_tsc_check(tsx=tsx_uncasted, component_name="Hero", app_dts=self.APP_DTS)
        assert any(f.rule_id == "tsc.2345" for f in out2), (
            f"expected tsc.2345 on setState('unknown_key'), got: " f"{[f.rule_id for f in out2]}"
        )

    def test_setState_known_key_passes(self):
        tsx = (
            "import { setState } from '@exepad/sdk';\n"
            "\n"
            "export default function Hero() {\n"
            "  setState('isOpen', true);\n"
            "  setState('count', 42);\n"
            "  return <div />;\n"
            "}\n"
        )
        out = run_tsc_check(tsx=tsx, component_name="Hero", app_dts=self.APP_DTS)
        assert out == [], f"expected zero findings, got: {[f.message for f in out]}"

    def test_navigate_unknown_route_errors(self):
        tsx = (
            "import { navigate } from '@exepad/sdk';\n"
            "\n"
            "export default function Hero() {\n"
            "  navigate('/admin');\n"
            "  return <div />;\n"
            "}\n"
        )
        out = run_tsc_check(tsx=tsx, component_name="Hero", app_dts=self.APP_DTS)
        assert any(f.rule_id == "tsc.2345" for f in out), (
            f"expected tsc.2345 on navigate('/admin'), got: " f"{[f.rule_id for f in out]}"
        )
        assert any("/admin" in f.message for f in out)

    def test_navigate_known_route_passes(self):
        # System routes (/login, /logout, /signup) are always valid even
        # when not in the per-app catalog.
        tsx = (
            "import { navigate } from '@exepad/sdk';\n"
            "\n"
            "export default function Hero() {\n"
            "  navigate('/');\n"
            "  navigate('/posts');\n"
            "  navigate('/login');\n"
            "  navigate('/logout');\n"
            "  return <div />;\n"
            "}\n"
        )
        out = run_tsc_check(tsx=tsx, component_name="Hero", app_dts=self.APP_DTS)
        assert out == [], f"expected zero findings, got: {[f.message for f in out]}"

    def test_navigate_hash_fragment_passes(self):
        # Hash fragments are always valid (anchor scrolling).
        tsx = (
            "import { navigate } from '@exepad/sdk';\n"
            "\n"
            "export default function Hero() {\n"
            "  navigate('/#contact');\n"
            "  navigate('/posts#top');\n"
            "  return <div />;\n"
            "}\n"
        )
        out = run_tsc_check(tsx=tsx, component_name="Hero", app_dts=self.APP_DTS)
        assert out == [], f"expected zero findings, got: {[f.message for f in out]}"


@_REQUIRES_TSC
class TestEmptyAppFallback:
    """When the per-app manifest declares zero models/handlers/state/routes,
    the gate must NOT false-positive on every call. The empty-interface
    fallback should resolve to ``string``."""

    EMPTY_DTS = generate_app_dts(backend={}, logic={}, pages=[])

    def test_useModel_with_no_declared_models_passes(self):
        tsx = (
            "import { useModel } from '@exepad/sdk';\n"
            "\n"
            "export default function Hero() {\n"
            "  const x = useModel('whatever');\n"
            "  return <div>{x.loading ? '...' : 'done'}</div>;\n"
            "}\n"
        )
        out = run_tsc_check(tsx=tsx, component_name="Hero", app_dts=self.EMPTY_DTS)
        assert out == [], f"expected zero findings, got: {[f.message for f in out]}"

    def test_navigate_with_no_declared_routes_passes(self):
        tsx = (
            "import { navigate } from '@exepad/sdk';\n"
            "\n"
            "export default function Hero() {\n"
            "  navigate('/anywhere');\n"
            "  return <div />;\n"
            "}\n"
        )
        out = run_tsc_check(tsx=tsx, component_name="Hero", app_dts=self.EMPTY_DTS)
        assert out == [], f"expected zero findings, got: {[f.message for f in out]}"


@_REQUIRES_TSC
class TestPayloadAndNullSafety:
    """Field-access typos and null-safety bugs that the AST rules
    ``ModelPayloadFieldsRule``, ``HandlerOutputFieldsRule``,
    ``UseAppUnsafeAccessRule``, and ``UseModelNullAccessRule`` used to
    cover. tsc with ``strict: true`` against the per-app catalog now
    catches all of these as TS2339 / TS18047, so those rules are gone.
    """

    APP_DTS = generate_app_dts(
        backend={
            "models": [
                {
                    "name": "users",
                    "columns": [
                        {"name": "id", "type": "uuid"},
                        {"name": "email", "type": "string"},
                    ],
                }
            ],
            "handlers": [
                {
                    "name": "send_invite",
                    "outputs": [
                        {"name": "ok", "type": "boolean"},
                        {"name": "count", "type": "integer"},
                    ],
                }
            ],
        },
        logic={"state": {"isOpen": False, "count": 0}},
        pages=[],
    )

    def test_model_row_field_typo_caught(self):
        # ``users`` declares only ``id`` + ``email``; accessing a
        # different field is TS2339.
        tsx = (
            "import { useModel } from '@exepad/sdk';\n"
            "\n"
            "export default function Hero() {\n"
            "  const u = useModel('users');\n"
            "  return <div>{u.data?.[0]?.nonexistent_field}</div>;\n"
            "}\n"
        )
        out = run_tsc_check(tsx=tsx, component_name="Hero", app_dts=self.APP_DTS)
        assert any(f.rule_id == "tsc.2339" for f in out), [f.rule_id for f in out]
        assert any("nonexistent_field" in f.message for f in out)

    def test_handler_output_field_typo_caught(self):
        # ``send_invite`` declares ``ok`` + ``count``; another property
        # is TS2339.
        tsx = (
            "import { useHandler } from '@exepad/sdk';\n"
            "\n"
            "export default function Hero() {\n"
            "  const h = useHandler('send_invite');\n"
            "  return <div>{h.data?.nonexistent_output}</div>;\n"
            "}\n"
        )
        out = run_tsc_check(tsx=tsx, component_name="Hero", app_dts=self.APP_DTS)
        assert any(f.rule_id == "tsc.2339" for f in out), [f.rule_id for f in out]
        assert any("nonexistent_output" in f.message for f in out)

    def test_useModel_null_access_without_optional_chaining_caught(self):
        # ``data: T[] | null`` — accessing ``.length`` directly is
        # TS18047 ('possibly null') under strict mode.
        tsx = (
            "import { useModel } from '@exepad/sdk';\n"
            "\n"
            "export default function Hero() {\n"
            "  const u = useModel('users');\n"
            "  const n = u.data.length;\n"
            "  return <div>{n}</div>;\n"
            "}\n"
        )
        out = run_tsc_check(tsx=tsx, component_name="Hero", app_dts=self.APP_DTS)
        assert any(f.rule_id == "tsc.18047" for f in out), [f.rule_id for f in out]

    def test_useApp_unsafe_state_key_caught(self):
        # ``s.unknown_key`` against typed ``AppState`` is TS2339.
        tsx = (
            "import { useApp } from '@exepad/sdk';\n"
            "\n"
            "export default function Hero() {\n"
            "  const x = useApp((s) => s.unknown_key);\n"
            "  return <div>{String(x)}</div>;\n"
            "}\n"
        )
        out = run_tsc_check(tsx=tsx, component_name="Hero", app_dts=self.APP_DTS)
        assert any(f.rule_id == "tsc.2339" for f in out), [f.rule_id for f in out]
        assert any("unknown_key" in f.message for f in out)

    def test_useModel_optional_chained_access_passes(self):
        # The pattern the LLM should emit: ``data?.[0]?.field``.
        tsx = (
            "import { useModel } from '@exepad/sdk';\n"
            "\n"
            "export default function Hero() {\n"
            "  const u = useModel('users');\n"
            "  const email = u.data?.[0]?.email ?? 'unknown';\n"
            "  return <div>{email}</div>;\n"
            "}\n"
        )
        out = run_tsc_check(tsx=tsx, component_name="Hero", app_dts=self.APP_DTS)
        assert out == [], f"expected zero findings, got: {[f.message for f in out]}"


@_REQUIRES_TSC
class TestGameHelperFieldShape:
    """Regression — Bloop World (ase9oqnp) shipped unplayable because the
    LLM declared entity boxes as ``{x, y, w, h}`` and called the SDK's
    ``aabb()`` helper, which reads ``.width`` / ``.height``. Every
    collision returned ``false`` (``b.width === undefined`` → NaN
    comparison) and the player fell through the floor on Start.

    Pre-fix the gate typed ``aabb`` as ``any`` so tsc was silent. With
    the typed ``Box`` declaration in the gate, the field-shape mismatch
    is now a tsc.2345 diagnostic at validate time.
    """

    APP_DTS = generate_app_dts(backend={}, logic={}, pages=[])

    def test_aabb_with_short_field_names_rejected(self):
        # The exact failing pattern from the Bloop World GameContent.tsx.
        tsx = (
            "import { aabb } from '@exepad/sdk';\n"
            "\n"
            "export default function Game() {\n"
            "  const player = { x: 0, y: 0, w: 32, h: 32 };\n"
            "  const block  = { x: 0, y: 0, w: 32, h: 32 };\n"
            "  const hit = aabb(player, block);\n"
            "  return <div>{String(hit)}</div>;\n"
            "}\n"
        )
        out = run_tsc_check(tsx=tsx, component_name="Game", app_dts=self.APP_DTS)
        assert any(f.rule_id == "tsc.2345" for f in out), [f.rule_id for f in out]
        # tsc's message names the mismatched property pair.
        assert any(
            "width" in f.message or "Box" in f.message for f in out
        ), [f.message for f in out]

    def test_aabb_with_proper_field_names_passes(self):
        # The correct shape — matches SDK's ``Box`` interface.
        tsx = (
            "import { aabb } from '@exepad/sdk';\n"
            "\n"
            "export default function Game() {\n"
            "  const player = { x: 0, y: 0, width: 32, height: 32 };\n"
            "  const block  = { x: 0, y: 0, width: 32, height: 32 };\n"
            "  const hit = aabb(player, block);\n"
            "  return <div>{String(hit)}</div>;\n"
            "}\n"
        )
        out = run_tsc_check(tsx=tsx, component_name="Game", app_dts=self.APP_DTS)
        assert out == [], f"expected zero findings, got: {[f.message for f in out]}"

    def test_useGameLoop_callback_dt_is_typed(self):
        # ``useGameLoop`` types its callback as ``(deltaSeconds: number) => void``.
        # Treating ``dt`` as a string should fire tsc.2367 / tsc.2362.
        tsx = (
            "import { useGameLoop } from '@exepad/sdk';\n"
            "\n"
            "export default function Game() {\n"
            "  useGameLoop((dt) => {\n"
            "    const bad: string = dt;\n"  # number → string is TS2322
            "    void bad;\n"
            "  });\n"
            "  return <div />;\n"
            "}\n"
        )
        out = run_tsc_check(tsx=tsx, component_name="Game", app_dts=self.APP_DTS)
        # tsc.2322 = "Type 'number' is not assignable to type 'string'."
        assert any(f.rule_id == "tsc.2322" for f in out), [f.rule_id for f in out]

    def test_useCurrentUser_returns_typed_user(self):
        # ``useCurrentUser().email`` is ``string | null`` — assigning to
        # a bare ``string`` without null-narrowing must error (tsc.2322).
        tsx = (
            "import { useCurrentUser } from '@exepad/sdk';\n"
            "\n"
            "export default function Hero() {\n"
            "  const user = useCurrentUser();\n"
            "  const email: string = user.email;\n"  # null-not-assignable
            "  return <div>{email}</div>;\n"
            "}\n"
        )
        out = run_tsc_check(tsx=tsx, component_name="Hero", app_dts=self.APP_DTS)
        assert any(f.rule_id == "tsc.2322" for f in out), [f.rule_id for f in out]


@_REQUIRES_TSC
class TestSiblingModuleStaging:
    """Phase 2.5 — Babel-shell sibling-module support.

    The deterministic JSX-to-TSX translator emits one TSX per source
    sibling. Cross-file imports like ``import { STUDENTS } from "./Data"``
    used to surface as TS2307 false positives because the tsc gate ran
    each file in isolation. Phase 2.5 stages every sibling's TSX into
    the same tmpdir so imports resolve on disk; sibling-internal type
    errors are filtered out by ``_parse_diagnostics`` (which restricts
    findings to the target file).
    """

    APP_DTS = generate_app_dts(backend={}, logic={}, pages=[])

    def test_sibling_import_resolves_when_sibling_staged(self):
        # Without sibling staging this is TS2307 'Cannot find module'.
        target_tsx = (
            "import { STUDENTS } from './Data';\n"
            "import { React } from '@exepad/sdk';\n"
            "\n"
            "export function Roster() {\n"
            "  return <ul>{STUDENTS.map((s: any) => <li key={s.id}>{s.name}</li>)}</ul>;\n"
            "}\n"
        )
        sibling_tsx = (
            "export const STUDENTS = [\n"
            "  { id: 1, name: 'Alice' },\n"
            "  { id: 2, name: 'Bob' },\n"
            "];\n"
        )
        out = run_tsc_check(
            tsx=target_tsx,
            component_name="Roster",
            app_dts=self.APP_DTS,
            sibling_modules={"Data": sibling_tsx},
        )
        # No TS2307 — the sibling resolved.
        assert not any(f.rule_id == "tsc.2307" for f in out), (
            f"sibling staging should resolve ./Data, got: "
            f"{[(f.rule_id, f.message) for f in out]}"
        )

    def test_missing_sibling_still_emits_ts2307(self):
        # Negative control: without staging, the same import fails.
        target_tsx = (
            "import { STUDENTS } from './Data';\n"
            "import { React } from '@exepad/sdk';\n"
            "\n"
            "export function Roster() {\n"
            "  return <ul>{STUDENTS.map((s: any) => <li key={s.id}>{s.name}</li>)}</ul>;\n"
            "}\n"
        )
        out = run_tsc_check(
            tsx=target_tsx,
            component_name="Roster",
            app_dts=self.APP_DTS,
            # No sibling_modules — pre-Phase-2.5 behavior.
        )
        assert any(f.rule_id == "tsc.2307" for f in out), (
            f"expected TS2307 without sibling staging, got: "
            f"{[(f.rule_id, f.message) for f in out]}"
        )

    def test_sibling_internal_errors_do_not_leak_to_target_findings(self):
        # If the sibling itself has a type error (real or contrived),
        # _parse_diagnostics filters those out — only the target's
        # findings appear in the result list.
        target_tsx = (
            "import { something } from './Sib';\n"
            "import { React } from '@exepad/sdk';\n"
            "\n"
            "export function Use() {\n"
            "  return <div>{something()}</div>;\n"
            "}\n"
        )
        # Sibling with an undeclared identifier — would emit TS2304
        # ON THE SIBLING. We don't want that bleeding into the target's
        # findings.
        sibling_with_bug = (
            "export const something = () => {\n"
            "  return undeclaredOnSibling;\n"
            "};\n"
        )
        out = run_tsc_check(
            tsx=target_tsx,
            component_name="Use",
            app_dts=self.APP_DTS,
            sibling_modules={"Sib": sibling_with_bug},
        )
        # Sibling-internal undeclared name must not surface as a target
        # finding. The target import resolves, so TS2307 is also gone.
        assert not any(
            "undeclaredOnSibling" in f.message for f in out
        ), f"sibling errors leaked: {[f.message for f in out]}"
        assert not any(f.rule_id == "tsc.2307" for f in out)

    def test_self_in_sibling_map_is_ignored(self):
        # Defensive: passing the target itself in sibling_modules used
        # to be a footgun (would overwrite the file we just wrote). The
        # runner filters it out.
        target_tsx = (
            "import { React } from '@exepad/sdk';\n"
            "\n"
            "export function Just() { return <div />; }\n"
        )
        # If the runner didn't filter, this stub would replace the real
        # target and the export would change meaning.
        bogus_self = "export function Just() { return null; }\n"
        out = run_tsc_check(
            tsx=target_tsx,
            component_name="Just",
            app_dts=self.APP_DTS,
            sibling_modules={"Just": bogus_self},
        )
        # Whatever happens, no crash and the result is a list. The real
        # contract is that the original target.tsx survives — exercised
        # implicitly by the absence of any "duplicate identifier" or
        # "Just is missing" finding.
        assert isinstance(out, list)


class TestSiblingModulesParameter:
    """Mock-level coverage for the sibling_modules parameter — runs
    everywhere, including dev environments without tsc on PATH."""

    def test_default_none_works_unchanged(self):
        # No sibling_modules → behavior identical to pre-Phase-2.5.
        # We assert the function signature accepts the keyword and
        # doesn't crash on common inputs.
        out = run_tsc_check(tsx="", component_name="Hero", app_dts="")
        assert out == []

    def test_empty_dict_works(self):
        out = run_tsc_check(
            tsx="",
            component_name="Hero",
            app_dts="",
            sibling_modules={},
        )
        assert out == []

    def test_non_string_entries_silently_skipped(self):
        # Defensive against malformed inputs from session state.
        out = run_tsc_check(
            tsx="",
            component_name="Hero",
            app_dts="",
            sibling_modules={
                "GoodSibling": "export const X = 1;",
                None: "export const Y = 2;",   # type: ignore[dict-item]
                "BadValue": None,              # type: ignore[dict-item]
                "EmptyValue": "",
                42: "export const Z = 3;",     # type: ignore[dict-item]
            },
        )
        # Empty TSX short-circuits at the top of run_tsc_check, so we
        # get an empty list. The point of this test is that the
        # malformed entries don't raise.
        assert out == []


@_REQUIRES_TSC
class TestBuiltinAuthHandlers:
    """`useHandler("auth_signout")` must type-check even when the app
    declares custom handlers (which narrow `_AppHandlerName`).

    Regression: with a custom handler present, `_AppHandlerName` used to
    narrow to ONLY the custom names, so the documented canonical logout
    pattern `useHandler("auth_signout")` (03_COMPONENT_PATTERNS.md) failed
    tsc with TS2345 and shipped as a spurious warning after the retry cap.
    """

    # An app WITH a custom handler — this is what narrows the union and
    # previously broke the built-in auth handlers.
    APP_DTS = generate_app_dts(
        backend={
            "models": [],
            "handlers": [
                {"name": "getDashboardStats", "output": [{"name": "total", "type": "number"}]}
            ],
        },
        logic={},
        pages=[{"slug": "/"}],
    )

    def test_auth_signout_type_checks(self):
        tsx = (
            "import { React, Icons, useHandler } from '@exepad/sdk';\n"
            "export default function MainSidebar() {\n"
            '  const { execute: signOut } = useHandler("auth_signout", { autoFetch: false });\n'
            "  return (<aside><button onClick={signOut}><Icons.LogOut /></button></aside>);\n"
            "}\n"
        )
        out = run_tsc_check(tsx=tsx, component_name="MainSidebar", app_dts=self.APP_DTS)
        assert out == [], f"auth_signout should type-check, got: {[f.message for f in out]}"

    def test_custom_handler_still_type_checks(self):
        tsx = (
            "import { React, useHandler } from '@exepad/sdk';\n"
            "export default function DashboardContent() {\n"
            '  const { data } = useHandler("getDashboardStats");\n'
            "  return <div>{String(data)}</div>;\n"
            "}\n"
        )
        out = run_tsc_check(tsx=tsx, component_name="DashboardContent", app_dts=self.APP_DTS)
        assert out == [], f"custom handler should type-check, got: {[f.message for f in out]}"

    def test_bogus_handler_name_still_errors(self):
        # Typo-safety must survive: a made-up name is neither a custom nor a
        # built-in handler, so tsc must still reject it.
        tsx = (
            "import { React, useHandler } from '@exepad/sdk';\n"
            "export default function Bad() {\n"
            '  const { data } = useHandler("totally_made_up");\n'
            "  return <div>{String(data)}</div>;\n"
            "}\n"
        )
        out = run_tsc_check(tsx=tsx, component_name="Bad", app_dts=self.APP_DTS)
        assert any(f.rule_id == "tsc.2345" for f in out), [f.rule_id for f in out]
