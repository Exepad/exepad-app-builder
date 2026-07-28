"""Unit tests for the material-symbols leak rule + auto-fix.

Bug class motivation: app `rdzn62gx` (2026-05-16). Footer.tsx shipped
with three raw `<span className="material-symbols-outlined">…</span>`
spans (`potted_plant`, `egg`, `grass`). The runtime doesn't load the
Material Symbols webfont, so the literal glyph names rendered as plain
text in the footer alongside other components that correctly used
`<Icons.*/>`.
"""

from __future__ import annotations

import pytest

from main_agent.services.validation.fixers._context import FixContext
from main_agent.services.validation.fixers.component_icons import (
    apply_component_icons_fixes,
)
from main_agent.services.validation.tsx_ast.parser import parse_tsx, source_bytes
from main_agent.services.validation.tsx_ast.rules.base import AstContext
from main_agent.services.validation.tsx_ast.rules.material_symbols_leak import (
    MaterialSymbolsLeakRule,
)

pytestmark = [pytest.mark.unit]


def _ctx(component_tsx: str) -> AstContext:
    return AstContext(
        tsx=component_tsx,
        source_buf=source_bytes(component_tsx),
        tree=parse_tsx(component_tsx),
    )


def _findings(component_tsx: str) -> list:
    return list(MaterialSymbolsLeakRule().check(_ctx(component_tsx)))


# ---------------------------------------------------------------------------
# AST rule — severity is error when Icons is already imported, warning otherwise.
# ---------------------------------------------------------------------------


class TestMaterialSymbolsLeakRule:
    def test_error_severity_when_icons_already_imported(self):
        tsx = """
import { React, Icons } from "@exepad/sdk";
function Footer() {
  return (
    <footer>
      <Icons.ArrowRight />
      <span className="material-symbols-outlined">egg</span>
    </footer>
  );
}
"""
        findings = _findings(tsx)
        assert len(findings) == 1
        assert findings[0].severity == "error"
        assert "Mixed" in findings[0].message or "forbidden" in findings[0].message

    def test_error_severity_even_when_icons_not_imported(self):
        # Pre-9vvnqllg policy: severity was warning when `Icons` wasn't
        # imported. That policy was wrong — the runtime never loads the
        # Material Symbols webfont, so the glyph leaks regardless of
        # whether Icons is imported. Severity is now unconditional error.
        tsx = """
import { React } from "@exepad/sdk";
function X() {
  return <span className="material-symbols-outlined">menu</span>;
}
"""
        findings = _findings(tsx)
        assert len(findings) == 1
        assert findings[0].severity == "error"

    def test_multiple_spans_each_flagged(self):
        """rdzn62gx Footer.tsx pattern — three spans in a row."""
        tsx = """
import { React, Icons } from "@exepad/sdk";
function Footer() {
  return (
    <footer>
      <Icons.ArrowRight />
      <span className="material-symbols-outlined">potted_plant</span>
      <span className="material-symbols-outlined">egg</span>
      <span className="material-symbols-outlined">grass</span>
    </footer>
  );
}
"""
        findings = _findings(tsx)
        assert len(findings) == 3
        assert all(f.severity == "error" for f in findings)

    def test_no_findings_when_no_material_symbols(self):
        tsx = """
import { React, Icons } from "@exepad/sdk";
function X() {
  return <Icons.Egg />;
}
"""
        assert _findings(tsx) == []

    def test_material_symbols_with_extra_classes_still_flagged(self):
        """Span with sizing classes alongside the marker token."""
        tsx = """
import { Icons } from "@exepad/sdk";
function X() {
  return <span className="material-symbols-outlined text-2xl text-primary">home</span>;
}
"""
        findings = _findings(tsx)
        assert len(findings) == 1


# ---------------------------------------------------------------------------
# Auto-fixer — rewrites known glyphs, leaves unknown alone.
# ---------------------------------------------------------------------------


def _fix(tsx: str) -> tuple[str, list[str]]:
    ctx = FixContext(
        expected_component_name="",
        models=[],
        handlers=None,
        state_keys={},
        page_slugs=None,
        theme_palette=None,
    )
    fixes: list[str] = []
    out = apply_component_icons_fixes(tsx, ctx, fixes)
    return out, fixes


class TestIconAutoFixer:
    def test_known_glyph_rewritten_to_icons_component(self):
        tsx = """
import { Icons } from "@exepad/sdk";
function X() {
  return <span className="material-symbols-outlined">egg</span>;
}
"""
        out, fixes = _fix(tsx)
        assert "<Icons.Egg />" in out
        assert "material-symbols-outlined" not in out
        assert any("egg" in f for f in fixes)

    def test_rewrite_preserves_extra_classes_via_className_prop(self):
        # Color (text-primary) is preserved verbatim; the font-size class
        # (text-2xl) is translated to the equivalent w-/h- pair because
        # lucide SVGs ignore font-size. See R6 / test_lucide_sizing.py.
        tsx = """
import { Icons } from "@exepad/sdk";
function X() {
  return <span className="material-symbols-outlined text-2xl text-primary">home</span>;
}
"""
        out, _ = _fix(tsx)
        assert '<Icons.Home className="w-7 h-7 text-primary" />' in out
        assert "text-2xl" not in out

    def test_rewrite_with_no_extra_classes(self):
        tsx = """
import { Icons } from "@exepad/sdk";
function X() {
  return <span className="material-symbols-outlined">menu</span>;
}
"""
        out, _ = _fix(tsx)
        assert "<Icons.Menu />" in out

    def test_chick_farm_footer_rewrite_full_coverage(self):
        """Footer.tsx canonical case — three spans all rewritten.

        chick-farm4017 (9vvnqllg, 2026-05-16) shipped because
        ``potted_plant`` and ``grass`` weren't in the glyph map and the
        rule emitted warning-only severity (no ``Icons`` import gate).
        Both are now mapped to ``Sprout`` (the closest semantic match).
        """
        tsx = """
import { React, Icons } from "@exepad/sdk";
function Footer() {
  return (
    <footer>
      <span className="material-symbols-outlined">potted_plant</span>
      <span className="material-symbols-outlined">egg</span>
      <span className="material-symbols-outlined">grass</span>
    </footer>
  );
}
"""
        out, fixes = _fix(tsx)
        assert "<Icons.Egg />" in out
        assert "<Icons.Sprout />" in out
        assert "potted_plant" not in out
        assert "grass" not in out
        assert len(fixes) == 3

    def test_unknown_glyph_NOT_rewritten(self):
        tsx = """
import { Icons } from "@exepad/sdk";
function X() {
  return <span className="material-symbols-outlined">some_obscure_glyph_xyz</span>;
}
"""
        out, fixes = _fix(tsx)
        assert "some_obscure_glyph_xyz" in out
        assert fixes == []

    def test_no_op_when_file_has_no_material_symbols(self):
        tsx = """
import { Icons } from "@exepad/sdk";
function X() { return <Icons.Egg />; }
"""
        out, fixes = _fix(tsx)
        assert out == tsx
        assert fixes == []

    def test_icons_appended_to_sdk_import_when_missing(self):
        """When the SDK import line exists but lacks `Icons`, the fixer
        adds it so the rewritten JSX compiles."""
        tsx = """
import { React, Mail } from "@exepad/sdk";
function X() {
  return <span className="material-symbols-outlined">mail</span>;
}
"""
        out, _ = _fix(tsx)
        assert "Icons" in out
        # Original imports preserved
        assert "Mail" in out
        assert "<Icons.Mail />" in out

    def test_icons_NOT_double_added_when_already_imported(self):
        tsx = """
import { React, Icons } from "@exepad/sdk";
function X() {
  return <span className="material-symbols-outlined">mail</span>;
}
"""
        out, _ = _fix(tsx)
        # Only one Icons in the import line
        import_lines = [
            line for line in out.splitlines() if "@exepad/sdk" in line and "import" in line
        ]
        assert len(import_lines) == 1
        assert import_lines[0].count("Icons") == 1
