"""Gap A regression — chrome components saved by ``translate_design_import_components``
must run through the ``apply_auto_fixes`` pipeline before being persisted.

Before this fix, ``jsx_to_tsx/dispatcher.py`` wrote chrome TSX
(MainHeader/MainFooter/MainSidebar) directly via
``ctx.artifact_service.save_artifact(...)``. The entire
``component_rules()`` AST + fixer chain (material_symbols_leak,
arbitrary_hex_color, component_imports, etc.) was silently inert for
chrome.

App ``9vvnqllg`` (chick-farm4017, 2026-05-16): MainFooter shipped with
three raw ``<span class="material-symbols-outlined">{glyph}</span>``
spans on every page. ``MaterialSymbolsLeakRule`` exists and was
registered, but the dispatcher never invoked the validator pipeline
on chrome, so neither the rule nor the auto-fixer saw the spans.
"""

from __future__ import annotations

import pytest

from main_agent.agents.orchestrator.importers.tools.jsx_to_tsx.dispatcher import (
    _run_auto_fixes_on_chrome,
)

pytestmark = [pytest.mark.unit]


class _StubSession:
    def __init__(self, state):
        self.state = state
        self.id = "s"
        self.user_id = "u"
        self.app_name = "a"


class _StubCtx:
    def __init__(self, state=None):
        self.session = _StubSession(state or {})


class TestRunAutoFixesOnChrome:
    def test_egg_glyph_rewritten_to_icons_egg(self):
        # Minimal MainFooter-shaped TSX with one mapped glyph.
        tsx = (
            'import { React, LightDOMContainer } from "@exepad/sdk";\n'
            "\n"
            "function MainFooter() {\n"
            "  return (\n"
            "    <LightDOMContainer>\n"
            '      <footer><span className="material-symbols-outlined">egg</span></footer>\n'
            "    </LightDOMContainer>\n"
            "  );\n"
            "}\n"
            "\n"
            "export default MainFooter;\n"
        )

        ctx = _StubCtx()
        fixed = _run_auto_fixes_on_chrome(ctx, tsx, "MainFooter")

        # The mapped glyph should be rewritten to <Icons.Egg/>.
        assert "<Icons.Egg" in fixed, (
            "auto-fix pipeline did not convert material-symbols-outlined egg → Icons.Egg; "
            "Gap A regression"
        )
        # `Icons` import should be auto-added by the imports fixer.
        assert (
            'Icons' in fixed.split('"@exepad/sdk"')[0]
        ), "Icons import not auto-added when glyph was rewritten"

    def test_returns_input_unchanged_when_no_fixes_apply(self):
        # Clean TSX — no material symbols, no auto-fix triggers. Imports are
        # already in subpath form so the @exepad/sdk barrel→subpath split is a
        # no-op too (also pins split idempotency on the chrome save path).
        tsx = (
            'import { LightDOMContainer, React } from "@exepad/sdk/core";\n'
            'import { Icons } from "@exepad/sdk/icons";\n'
            "\n"
            "function MainHeader() {\n"
            "  return (\n"
            "    <LightDOMContainer>\n"
            "      <header><Icons.Menu /></header>\n"
            "    </LightDOMContainer>\n"
            "  );\n"
            "}\n"
            "\n"
            "export default MainHeader;\n"
        )
        fixed = _run_auto_fixes_on_chrome(_StubCtx(), tsx, "MainHeader")
        assert fixed == tsx

    def test_chick_farm_footer_all_three_glyphs_rewritten(self):
        # End-to-end: the full chick-farm4017 MainFooter pattern goes
        # through the dispatcher's auto-fix wrapper. Without Gap A's
        # wiring, ``potted_plant``, ``egg``, ``grass`` shipped as plain
        # text on every page.
        tsx = (
            'import { React, LightDOMContainer } from "@exepad/sdk";\n'
            "\n"
            "function MainFooter() {\n"
            "  return (\n"
            "    <LightDOMContainer>\n"
            "      <footer>\n"
            '        <span className="material-symbols-outlined">potted_plant</span>\n'
            '        <span className="material-symbols-outlined">egg</span>\n'
            '        <span className="material-symbols-outlined">grass</span>\n'
            "      </footer>\n"
            "    </LightDOMContainer>\n"
            "  );\n"
            "}\n"
            "\n"
            "export default MainFooter;\n"
        )
        fixed = _run_auto_fixes_on_chrome(_StubCtx(), tsx, "MainFooter")
        # All three glyphs now have lucide equivalents.
        assert "potted_plant" not in fixed
        assert "egg</span>" not in fixed
        assert "grass</span>" not in fixed
        assert "<Icons.Sprout" in fixed
        assert "<Icons.Egg" in fixed
        # Icons import auto-added.
        assert "Icons" in fixed.split('"@exepad/sdk"')[0]

    def test_failure_returns_input_unchanged(self, monkeypatch):
        # If apply_auto_fixes raises, the helper must NEVER block translation —
        # contract: return the input TSX verbatim.
        import main_agent.services.validation.fixers as fixers_module

        def _boom(*a, **kw):
            raise RuntimeError("fixer crashed")

        monkeypatch.setattr(fixers_module, "apply_auto_fixes", _boom)
        tsx = "function X(){return null;}"
        assert _run_auto_fixes_on_chrome(_StubCtx(), tsx, "X") == tsx
