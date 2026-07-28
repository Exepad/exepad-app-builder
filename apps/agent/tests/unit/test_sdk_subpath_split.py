"""Unit tests for the additive SDK import-splitting feature.

The ``component_sdk_subpaths`` fixer rewrites a generated component's bare
``import { ... } from '@exepad/sdk'`` into per-subpath imports
(``/core``, ``/charts``, ``/motion``, ``/forms``, ``/overlays``, ``/icons``)
so a core-only page never downloads/parses the monolithic SDK bundle.

These tests pin:
- the fixer's partitioning, alias/type handling, unknown-symbol safety,
  idempotency, and the kill-switch / missing-table no-ops;
- that the import-completeness AST helpers treat subpath imports as "the SDK"
  (so splitting doesn't blind the missing-import rules).
"""

from __future__ import annotations

import pytest

from main_agent.services.validation.fixers._context import FixContext
from main_agent.services.validation.fixers import component_sdk_subpaths
from main_agent.services.validation.fixers.component_sdk_subpaths import (
    apply_component_sdk_subpath_fixes,
)
from main_agent.services.validation.tsx_ast.parser import parse_tsx, source_bytes
from main_agent.services.validation.tsx_ast.rules.base import AstContext
from main_agent.services.validation.tsx_ast.rules.component_imports import (
    SdkImportCompletenessRule,
    _has_sdk_import,
    _sdk_import_names,
)

pytestmark = [pytest.mark.unit]


# A small, stable routing table so the tests don't depend on the live
# sdk-subpaths.json (which the SDK build regenerates).
_FAKE_TABLE = {
    "Button": "@exepad/sdk/core",
    "Card": "@exepad/sdk/core",
    "useModel": "@exepad/sdk/core",
    "useApp": "@exepad/sdk/core",
    "cn": "@exepad/sdk/core",
    "Charts": "@exepad/sdk/charts",
    "ChartContainer": "@exepad/sdk/charts",
    "motion": "@exepad/sdk/motion",
    "Motion": "@exepad/sdk/motion",
    "Carousel": "@exepad/sdk/forms",
    "CarouselApi": "@exepad/sdk/forms",
    "Dialog": "@exepad/sdk/overlays",
    "DialogContent": "@exepad/sdk/overlays",
    "Icons": "@exepad/sdk/icons",
    "LinkProps": "@exepad/sdk/core",
}


@pytest.fixture()
def patched_table(monkeypatch):
    """Force the fixer to use the fixed table above and enable the split."""
    monkeypatch.setattr(component_sdk_subpaths, "load_sdk_subpaths", lambda: dict(_FAKE_TABLE))
    monkeypatch.setenv("EXEPAD_SDK_SPLIT_IMPORTS", "1")


def _ctx() -> FixContext:
    return FixContext(
        expected_component_name="",
        models=[],
        handlers=None,
        state_keys={},
        page_slugs=None,
        theme_palette=None,
        stock_provider_configured=True,
    )


def _run(tsx: str) -> tuple[str, list[str]]:
    fixes: list[str] = []
    out = apply_component_sdk_subpath_fixes(tsx, _ctx(), fixes)
    return out, fixes


def _import_lines(tsx: str) -> list[str]:
    return [ln.strip() for ln in tsx.splitlines() if ln.lstrip().startswith("import ")]


# ---------------------------------------------------------------------------
# Fixer — partitioning
# ---------------------------------------------------------------------------


def test_core_only_drops_bare_barrel(patched_table):
    """A page using only cheap UI must NOT keep a bare @exepad/sdk import.

    This is the whole point: no bare barrel → the global import map never
    resolves the monolith, so the page parses only the small /core chunk.
    """
    src = "import { Button, Card, useModel } from '@exepad/sdk';\nexport default function P(){return <Card/>;}"
    out, fixes = _run(src)
    assert "from '@exepad/sdk/core'" in out
    assert "from '@exepad/sdk'" not in out  # no residual barrel
    assert any("Split @exepad/sdk" in f for f in fixes)


def test_mixed_partitions_across_subpaths(patched_table):
    src = (
        "import { Card, useModel, Charts, ChartContainer, motion, Dialog, Icons } "
        "from '@exepad/sdk';\nexport default function D(){return null;}"
    )
    out, _ = _run(src)
    lines = _import_lines(out)
    assert "import { Card, useModel } from '@exepad/sdk/core';" in lines
    assert "import { ChartContainer, Charts } from '@exepad/sdk/charts';" in lines
    assert "import { motion } from '@exepad/sdk/motion';" in lines
    assert "import { Dialog } from '@exepad/sdk/overlays';" in lines
    assert "import { Icons } from '@exepad/sdk/icons';" in lines


def test_core_emitted_first(patched_table):
    """Deterministic order: core import precedes the heavy ones."""
    src = "import { Charts, Button } from '@exepad/sdk';\nexport default function D(){return null;}"
    out, _ = _run(src)
    lines = _import_lines(out)
    assert lines.index("import { Button } from '@exepad/sdk/core';") < lines.index(
        "import { Charts } from '@exepad/sdk/charts';"
    )


# ---------------------------------------------------------------------------
# Fixer — aliases & type specifiers
# ---------------------------------------------------------------------------


def test_alias_routes_by_source_name_and_preserves_binding(patched_table):
    src = "import { motion as M } from '@exepad/sdk';\nexport default function D(){return null;}"
    out, _ = _run(src)
    assert "import { motion as M } from '@exepad/sdk/motion';" in _import_lines(out)


def test_inline_type_specifier_preserved(patched_table):
    src = "import { Carousel, type CarouselApi } from '@exepad/sdk';\nexport default function D(){return null;}"
    out, _ = _run(src)
    assert "import { Carousel, type CarouselApi } from '@exepad/sdk/forms';" in _import_lines(out)


def test_whole_statement_type_only_becomes_inline_type(patched_table):
    src = "import type { LinkProps } from '@exepad/sdk';\nexport default function D(){return null;}"
    out, _ = _run(src)
    assert "import { type LinkProps } from '@exepad/sdk/core';" in _import_lines(out)


# ---------------------------------------------------------------------------
# Fixer — safety / no-op paths
# ---------------------------------------------------------------------------


def test_unknown_symbol_stays_on_bare_barrel(patched_table):
    """A name the table doesn't know is left on the barrel (safe — identical
    to today's behaviour; the monolith still resolves it)."""
    src = "import { Button, mysteryHook } from '@exepad/sdk';\nexport default function D(){return null;}"
    out, _ = _run(src)
    lines = _import_lines(out)
    assert "import { Button } from '@exepad/sdk/core';" in lines
    assert "import { mysteryHook } from '@exepad/sdk';" in lines


def test_all_unknown_is_full_noop(patched_table):
    src = "import { mysteryHook } from '@exepad/sdk';\nexport default function D(){return null;}"
    out, fixes = _run(src)
    assert out == src
    assert fixes == []


def test_already_split_is_idempotent(patched_table):
    src = (
        "import { Button } from '@exepad/sdk/core';\n"
        "import { Charts } from '@exepad/sdk/charts';\n"
        "export default function D(){return null;}"
    )
    out, fixes = _run(src)
    assert out == src
    assert fixes == []


def test_kill_switch_disables_split(patched_table, monkeypatch):
    monkeypatch.setenv("EXEPAD_SDK_SPLIT_IMPORTS", "0")
    src = "import { Button } from '@exepad/sdk';\nexport default function D(){return null;}"
    out, fixes = _run(src)
    assert out == src
    assert fixes == []


def test_missing_table_is_noop(monkeypatch):
    monkeypatch.setattr(component_sdk_subpaths, "load_sdk_subpaths", lambda: {})
    monkeypatch.setenv("EXEPAD_SDK_SPLIT_IMPORTS", "1")
    src = "import { Button } from '@exepad/sdk';\nexport default function D(){return null;}"
    out, fixes = _run(src)
    assert out == src
    assert fixes == []


def test_no_sdk_import_is_noop(patched_table):
    src = "import { useState } from 'react';\nexport default function D(){return null;}"
    out, fixes = _run(src)
    assert out == src
    assert fixes == []


# ---------------------------------------------------------------------------
# AST import-collection — subpath awareness
# ---------------------------------------------------------------------------


def _ast(tsx: str) -> AstContext:
    return AstContext(tsx=tsx, source_buf=source_bytes(tsx), tree=parse_tsx(tsx))


def test_sdk_import_names_collects_across_subpaths():
    tsx = (
        "import { Button, useModel } from '@exepad/sdk/core';\n"
        "import { Charts } from '@exepad/sdk/charts';\n"
        "import { Icons } from '@exepad/sdk/icons';\n"
        "export default function D(){return null;}"
    )
    ctx = _ast(tsx)
    names = _sdk_import_names(ctx.tree.root_node, ctx.source_buf)
    assert {"Button", "useModel", "Charts", "Icons"} <= names
    assert _has_sdk_import(ctx.tree.root_node, ctx.source_buf) is True


def test_completeness_rule_satisfied_by_subpath_import():
    """A JSX SDK component imported via a subpath is NOT flagged as missing."""
    tsx = (
        "import { Dialog, DialogContent } from '@exepad/sdk/overlays';\n"
        "export default function D(){return <Dialog><DialogContent/></Dialog>;}"
    )
    findings = list(SdkImportCompletenessRule().check(_ast(tsx)))
    # Dialog/DialogContent are both imported via the subpath → no missing-import error.
    assert [f for f in findings if "Dialog" in f.message] == []


def test_completeness_rule_still_flags_missing_after_split():
    """Splitting must not blind the rule: a known SDK tag used but imported
    from NO subpath is still flagged."""
    # Card is a known SDK export; here it's used in JSX but never imported.
    tsx = (
        "import { Button } from '@exepad/sdk/core';\n"
        "export default function D(){return <Card><Button/></Card>;}"
    )
    findings = list(SdkImportCompletenessRule().check(_ast(tsx)))
    assert any("Card" in f.message for f in findings)
