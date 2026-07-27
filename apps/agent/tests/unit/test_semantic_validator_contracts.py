"""Contract tests for semantic-layer invariants.

Migrated checks (export-name, imports, sdk-import-completeness, forbidden
APIs, model/handler/state/icon/navigate refs, shadow-container usage,
raw-img tags) are exercised through ``run_semantic_checks``, which now
dispatches AST rules for the migrated set and regex for the rest. Tests
that still directly call a regex check function target only the checks
that have not been migrated.
"""

import pytest

from main_agent.services.validation.semantic_validator import (
    check_broken_optional_chain,
    check_exepad_image_duplicate_keywords,
    check_exepad_image_props,
    check_low_opacity_bg,
    check_placeholder_divs,
    check_status_style_map_case,
    run_semantic_checks,
)
from main_agent.services.validation.tsx_ast import AstContext, parse_tsx, source_bytes
from main_agent.services.validation.tsx_ast.rules.component_m3_colors import (
    InverseSurfaceTextPairingRule,
    LightSurfaceInverseTextRule,
)

pytestmark = [pytest.mark.unit]


def _run_rule(rule, tsx: str) -> list[str]:
    tree = parse_tsx(tsx)
    ctx = AstContext(tsx=tsx, source_buf=source_bytes(tsx), tree=tree)
    return [f.message for f in rule.check(ctx)]


def _run_m3_rule(rule, tsx: str) -> list[str]:
    return _run_rule(rule, tsx)


def check_inverse_surface_text_pairing(tsx: str) -> list[str]:
    return _run_m3_rule(InverseSurfaceTextPairingRule(), tsx)


def check_light_surface_inverse_text(tsx: str) -> list[str]:
    return _run_m3_rule(LightSurfaceInverseTextRule(), tsx)


# ---------------------------------------------------------------------------
# Migrated checks exercised via run_semantic_checks (AST dispatch path).
# ---------------------------------------------------------------------------


def test_export_name_mismatch_reported_via_run_semantic_checks():
    tsx = "export default function MainHeader() { return null; }"
    result = run_semantic_checks(tsx, [], {}, [], expected_component_name="HomeContent")
    assert any("'MainHeader'" in e and "'HomeContent'" in e for e in result.errors)


def test_forbidden_import_source_reported():
    tsx = "import axios from 'axios';\nimport { React } from '@exepad/sdk';\n"
    result = run_semantic_checks(tsx, [], {}, [])
    assert any("Forbidden import: 'axios'" in e for e in result.errors)


def test_sdk_symbol_missing_from_import_reported():
    tsx = """
import { React, DialogContent } from '@exepad/sdk';
function BrandBadge() { return <span />; }
export default function Modal() {
  return (
    <DialogContent>
      <DialogDescription>More detail</DialogDescription>
      <BrandBadge />
    </DialogContent>
  );
}
"""
    result = run_semantic_checks(tsx, [], {}, [])
    assert any("<DialogDescription>" in e and "not imported" in e for e in result.errors)


def test_forbidden_apis_respects_whitelists_and_flags_real_violations():
    safe_tsx = """
import { React } from '@exepad/sdk';
window.addEventListener("keydown", handleKey);
await fetch("https://r2.exepad.com/assets/logo.svg");
"""
    unsafe_tsx = """
import { React } from '@exepad/sdk';
window.location.href = "/dashboard";
window.addEventListener("mousemove", handleMove);
await fetch("https://api.example.com/users");
"""
    safe_result = run_semantic_checks(safe_tsx, [], {}, [])
    unsafe_result = run_semantic_checks(unsafe_tsx, [], {}, [])

    for expected in ("window.location mutation", "addEventListener", "fetch()"):
        assert not any(expected in e for e in safe_result.errors), expected
    assert any("window.location mutation" in e for e in unsafe_result.errors)
    assert any("addEventListener" in e for e in unsafe_result.errors)
    assert any("fetch()" in e for e in unsafe_result.errors)


def test_icon_close_match_suggestion():
    # Phase 4 (severity policy): unknown_icon is now an error.
    # Hallucinated icons render as ``undefined`` and crash the page with
    # React #130. See docs/validation/severity-policy.md.
    tsx = "const icon = <Icons.Houes />;"
    result = run_semantic_checks(tsx, [], {}, [])
    assert any(
        "Icons.Houes" in e and 'did you mean "Icons.House"' in e
        for e in result.errors
    )


def test_raw_img_tag_warning():
    tsx = '<img src="__PLACEHOLDER__" alt="hero" />'
    result = run_semantic_checks(tsx, [], {}, [])
    assert any("raw <img>" in w for w in result.warnings)


# ---------------------------------------------------------------------------
# Non-migrated checks (still regex) called directly.
# ---------------------------------------------------------------------------


def test_broken_optional_chain_detection():
    tsx = """
const rows = users?.[0].toUpperCase();
"""
    warnings = check_broken_optional_chain(tsx)
    assert warnings and "Broken optional chain" in warnings[0]


def test_header_and_surface_pairing_warnings_cover_low_opacity_cases():
    # Header-bg logic is owned by HeaderBgLowOpacityRule (AST).
    inverse_tsx = '<section className="bg-inverse-surface text-on-surface-variant" />'
    light_surface_tsx = '<div className="bg-surface text-inverse-on-surface">Readable?</div>'
    safe_inverse_tsx = (
        '<div className="bg-inverse-surface/80 text-inverse-on-surface">Readable</div>'
    )

    assert check_inverse_surface_text_pairing(inverse_tsx)
    assert check_light_surface_inverse_text(light_surface_tsx)
    assert check_light_surface_inverse_text(safe_inverse_tsx) == []


def test_low_opacity_background_warning():
    tsx = '<div className="bg-primary/10">Hello</div>'

    assert check_low_opacity_bg(tsx) == [
        "Near-invisible background: bg-primary/10 — background opacity /10 is effectively invisible. Use minimum /30 for tinted backgrounds"
    ]


def test_check_low_opacity_bg_ignores_string_literals_and_svg():
    """Issue #2b regression: ``bg-foo/N`` mentions in toast strings,
    JSDoc comments, and SVG ``fill-opacity`` strings must NOT trigger
    low-opacity warnings. Only static className text counts."""
    tsx = """
const SVG_ICON = `<svg><rect fill-opacity="0.1" /></svg>`;
const errorMsg = "Try the bg-secondary/10 fallback if hover fails";
// JSDoc: avoid bg-primary/5 — it's near-invisible
<div className="bg-primary text-white" dangerouslySetInnerHTML={{__html: SVG_ICON}} />
"""

    # The only static className is "bg-primary text-white" — no bg-*/N in it.
    assert check_low_opacity_bg(tsx) == []


def test_placeholder_and_image_checks_cover_required_props_and_duplicates():
    placeholder_tsx = """
<div className="bg-gray-100 flex items-center justify-center rounded-xl p-10">
  <span className="text-gray-400">Illustrated dashboard placeholder</span>
</div>
"""
    image_tsx = """
<ExepadImage keywords="modern office" />
<ExepadImage keywords="modern office" importance={7} />
"""

    placeholder_errors = check_placeholder_divs(placeholder_tsx)
    image_errors = check_exepad_image_props(image_tsx)
    duplicate_warnings = check_exepad_image_duplicate_keywords(image_tsx)

    assert placeholder_errors and "placeholder div" in placeholder_errors[0]
    assert any("keywords has only 2 word(s)" in error for error in image_errors)
    assert any("missing required `importance`" in error for error in image_errors)
    assert duplicate_warnings


def test_status_maps_and_dialog_description_checks_cover_common_regressions():
    status_map_tsx = '{ Paid: "bg-green-500", Pending: "bg-amber-500" }'
    dialog_tsx = "<DialogContent><p>Missing description</p></DialogContent>"

    assert check_status_style_map_case(status_map_tsx)
    # Dialog description coverage is now owned by component.a11y.dialog_description,
    # exercised through run_semantic_checks (AST dispatch path).
    dialog_result = run_semantic_checks(dialog_tsx, [], {}, [])
    assert any("DialogDescription" in w for w in dialog_result.warnings)
