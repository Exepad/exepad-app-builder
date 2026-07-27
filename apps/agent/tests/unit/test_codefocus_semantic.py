"""Unit tests for CodeFocus semantic validator — React anti-pattern checks."""

import pytest

from main_agent.services.validation.fixers import apply_auto_fixes
from main_agent.services.validation.fixers.component_urls_images import (
    _fix_raw_img_to_exepad_image,
)
from main_agent.services.validation.semantic_validator import (
    check_hallucinated_image_urls,
    check_duplicate_image_urls,
    check_low_opacity_bg,
    check_exepad_image_props,
    check_exepad_image_dimensions,
    check_exepad_image_duplicate_keywords,
    run_semantic_checks,
    EXEPAD_IMAGE_FALLBACK_KEYWORDS,
    check_broken_optional_chain,
)
from main_agent.services.validation.tsx_ast import AstContext, parse_tsx, source_bytes
from main_agent.services.validation.tsx_ast.rules.component_hero_contrast import (
    HeroImageContrastRule,
)
from main_agent.services.validation.tsx_ast.rules.component_layout_policy import (
    AnimateInBareDurationRule,
    OverflowHiddenOnRootRule,
)
from main_agent.services.validation.tsx_ast.rules.component_m3_colors import (
    DarkSurfaceLightTextRule,
    InverseSurfaceTextPairingRule,
    LightSurfaceInverseTextRule,
)


def _run_m3_rule(rule, tsx: str) -> list[str]:
    tree = parse_tsx(tsx)
    ctx = AstContext(tsx=tsx, source_buf=source_bytes(tsx), tree=tree)
    return [f.message for f in rule.check(ctx)]


def check_dark_surface_light_text(tsx: str) -> list[str]:
    return _run_m3_rule(DarkSurfaceLightTextRule(), tsx)


def check_inverse_surface_text_pairing(tsx: str) -> list[str]:
    return _run_m3_rule(InverseSurfaceTextPairingRule(), tsx)


def check_light_surface_inverse_text(tsx: str) -> list[str]:
    return _run_m3_rule(LightSurfaceInverseTextRule(), tsx)


# Phase-4 ports: the regex-shaped helpers that used to live in
# semantic_validator.py now run through AST rules. These thin wrappers
# preserve the old call shape so existing tests don't need rewriting.
def check_overflow_hidden_on_root(tsx: str) -> list[str]:
    return _run_m3_rule(OverflowHiddenOnRootRule(), tsx)


def check_animate_in_with_bare_duration(tsx: str) -> list[str]:
    return _run_m3_rule(AnimateInBareDurationRule(), tsx)


def check_hero_image_contrast(tsx: str) -> list[str]:
    return _run_m3_rule(HeroImageContrastRule(), tsx)


from main_agent.services.validation.style_coverage import (
    extract_custom_color_refs,
    validate_style_coverage,
)


class TestAutoFixInlineSelector:
    """Tests for the useApp inline object auto-fix in apply_auto_fixes()."""

    @pytest.mark.unit
    def test_simple_inline_rewritten(self):
        tsx = "const { isOpen, dispatch } = useApp(s => ({ isOpen: s.isOpen, dispatch: s.dispatch }));"
        fixed, fixes = apply_auto_fixes(tsx, [], {}, {})
        assert "const isOpen = useApp(s => s.isOpen);" in fixed
        assert "const dispatch = useApp(s => s.dispatch);" in fixed
        assert any("Rewrote useApp" in f for f in fixes)

    @pytest.mark.unit
    def test_parenthesized_param_rewritten(self):
        tsx = "const { count, setState } = useApp((state) => ({ count: state.count, setState: state.setState }));"
        fixed, fixes = apply_auto_fixes(tsx, [], {}, {})
        assert "const count = useApp(s => s.count);" in fixed
        assert "const setState = useApp(s => s.setState);" in fixed

    @pytest.mark.unit
    def test_computed_expression_not_rewritten(self):
        """Selectors with computed values should be left for the fixer agent."""
        tsx = "const { total } = useApp(s => ({ total: s.price * s.quantity }));"
        fixed, fixes = apply_auto_fixes(tsx, [], {}, {})
        # Should not be rewritten because 's.price * s.quantity' is not a simple key access
        assert "useApp(s =>" in fixed or "total: s.price" in fixed

    @pytest.mark.unit
    def test_no_inline_selector_unchanged(self):
        tsx = "const count = useApp(s => s.count);"
        fixed, fixes = apply_auto_fixes(tsx, [], {}, {})
        assert fixed.strip() == tsx.strip()


class TestDialogDescriptionAutoFix:
    """Tests for the DialogDescription import auto-fix (Issue 1 regression guard).

    The earlier implementation did naive text append ``old + ", DialogDescription"``
    which produced ``AlertDialogTitle,\\n  , DialogDescription}`` for multi-line
    imports ending in a trailing comma — a ``SyntaxError`` at module load.
    The new ``_add_sdk_import`` helper rebuilds the whole statement cleanly.
    """

    @pytest.mark.unit
    def test_multiline_import_case1_no_double_comma(self):
        """DialogContent without DialogDescription — inject element + import."""
        tsx = """import {
  Button,
  Dialog,
  DialogContent,
  DialogTrigger,
  AlertDialogTitle,
} from '@exepad/sdk';

export default function StagesContent() {
  return (
    <Dialog>
      <DialogContent>
        <p>hello</p>
      </DialogContent>
    </Dialog>
  );
}
"""
        fixed, fixes = apply_auto_fixes(tsx, [], {}, {})
        # Never produces a double-comma syntax error
        assert ",," not in fixed.replace("\n", "")
        assert ", ," not in fixed.replace("\n", "")
        # DialogDescription is now in the import list
        import re as _re

        sdk_import = _re.search(r"import\s+\{([^}]+)\}\s+from\s+['\"]@exepad/sdk['\"]", fixed)
        assert sdk_import is not None
        imported = {t.strip() for t in sdk_import.group(1).split(",") if t.strip()}
        assert "DialogDescription" in imported
        # No empty tokens (which would indicate a stray comma)
        assert "" not in imported
        assert any("DialogDescription" in f for f in fixes)

    @pytest.mark.unit
    def test_multiline_import_case2_usage_without_import(self):
        """<DialogDescription> used in JSX but missing from import — add import only."""
        tsx = """import {
  Dialog,
  DialogContent,
  AlertDialogTitle,
} from '@exepad/sdk';

export default function Foo() {
  return (
    <Dialog>
      <DialogContent>
        <DialogDescription>Hi</DialogDescription>
      </DialogContent>
    </Dialog>
  );
}
"""
        fixed, fixes = apply_auto_fixes(tsx, [], {}, {})
        assert ",," not in fixed.replace("\n", "")
        import re as _re

        sdk_import = _re.search(r"import\s+\{([^}]+)\}\s+from\s+['\"]@exepad/sdk['\"]", fixed)
        assert sdk_import is not None
        imported = {t.strip() for t in sdk_import.group(1).split(",") if t.strip()}
        assert "DialogDescription" in imported
        assert "" not in imported

    @pytest.mark.unit
    def test_already_imported_noop(self):
        tsx = """import { Dialog, DialogContent, DialogDescription } from '@exepad/sdk';

export default function Foo() {
  return (
    <Dialog>
      <DialogContent>
        <DialogDescription>Hi</DialogDescription>
      </DialogContent>
    </Dialog>
  );
}
"""
        fixed, fixes = apply_auto_fixes(tsx, [], {}, {})
        # DialogDescription should still appear exactly once in the import
        import re as _re

        sdk_import = _re.search(r"import\s+\{([^}]+)\}\s+from\s+['\"]@exepad/sdk['\"]", fixed)
        assert sdk_import is not None
        imported = [t.strip() for t in sdk_import.group(1).split(",") if t.strip()]
        assert imported.count("DialogDescription") == 1


class TestTriggerAsChildMixedButtonChildrenFix:
    """Tests for Issue 2 regression — wrap mixed icon+text Button children
    under *Trigger asChild in a single <span> so Radix Slot only ever
    receives one element child.
    """

    @pytest.mark.unit
    def test_dialogtrigger_icon_plus_text_is_wrapped(self):
        tsx = """
import { React, LightDOMContainer, Dialog, DialogTrigger, Button, Icons } from "@exepad/sdk";
export default function Foo() {
  return (
    <LightDOMContainer>
      <Dialog>
        <DialogTrigger asChild>
          <Button className="btn">
            <Icons.UserPlus className="mr-2 h-5 w-5" />
            Add Team Member
          </Button>
        </DialogTrigger>
      </Dialog>
    </LightDOMContainer>
  );
}
"""
        fixed, fixes = apply_auto_fixes(tsx, [], {}, {})
        assert any("Wrapped mixed icon+text children" in f for f in fixes)
        assert "inline-flex items-center gap-2" in fixed
        # Button has exactly one top-level element child (the span)
        assert fixed.count('<span className="inline-flex items-center gap-2">') == 1

    @pytest.mark.unit
    def test_dropdownmenutrigger_icon_only_untouched(self):
        """Icon-only buttons are the working pattern — must not be wrapped."""
        tsx = """
import { React, LightDOMContainer, DropdownMenu, DropdownMenuTrigger, Button, Icons } from "@exepad/sdk";
export default function Foo() {
  return (
    <LightDOMContainer>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon">
            <Icons.MoreVertical className="w-4 h-4" />
          </Button>
        </DropdownMenuTrigger>
      </DropdownMenu>
    </LightDOMContainer>
  );
}
"""
        fixed, fixes = apply_auto_fixes(tsx, [], {}, {})
        assert not any("Wrapped mixed icon+text children" in f for f in fixes)
        assert "inline-flex items-center gap-2" not in fixed

    @pytest.mark.unit
    def test_already_wrapped_is_idempotent(self):
        tsx = """
import { React, LightDOMContainer, Dialog, DialogTrigger, Button, Icons } from "@exepad/sdk";
export default function Foo() {
  return (
    <LightDOMContainer>
      <Dialog>
        <DialogTrigger asChild>
          <Button>
            <span className="inline-flex items-center gap-2">
              <Icons.Plus className="h-4 w-4" />
              New
            </span>
          </Button>
        </DialogTrigger>
      </Dialog>
    </LightDOMContainer>
  );
}
"""
        fixed, fixes = apply_auto_fixes(tsx, [], {}, {})
        assert not any("Wrapped mixed icon+text children" in f for f in fixes)
        # The span appears exactly once
        assert fixed.count("inline-flex items-center gap-2") == 1

    @pytest.mark.unit
    def test_button_without_astchild_trigger_not_wrapped(self):
        """Plain <Button>icon + text</Button> outside a *Trigger asChild is fine."""
        tsx = """
import { React, LightDOMContainer, Button, Icons } from "@exepad/sdk";
export default function Foo() {
  return (
    <LightDOMContainer>
      <Button>
        <Icons.Save className="mr-2 h-4 w-4" />
        Save
      </Button>
    </LightDOMContainer>
  );
}
"""
        fixed, fixes = apply_auto_fixes(tsx, [], {}, {})
        assert not any("Wrapped mixed icon+text children" in f for f in fixes)


class TestRunSemanticChecksIntegration:
    """Test that new checks are wired into run_semantic_checks()."""

    @pytest.mark.unit
    def test_conditional_hook_in_full_check(self):
        tsx = """
import { React, useApp, useNavigation, LightDOMContainer } from '@exepad/sdk';
const path = ready ? useNavigation() : null;
export default function Comp() { return <LightDOMContainer><div /></LightDOMContainer>; }
"""
        result = run_semantic_checks(tsx, [], {}, [])
        assert not result.valid
        assert any("Conditional hook" in e for e in result.errors)

    @pytest.mark.unit
    def test_inline_object_in_full_check(self):
        tsx = """
import { React, useApp, LightDOMContainer } from '@exepad/sdk';
const { a } = useApp(s => ({ a: s.a }));
export default function Comp() { return <LightDOMContainer><div /></LightDOMContainer>; }
"""
        result = run_semantic_checks(tsx, [], {}, [])
        assert not result.valid
        assert any("useApp()" in e for e in result.errors)


class TestShadowStyleCoverage:
    """Test that shadow-* boxShadow classes are not false-positived as colors."""

    @pytest.mark.unit
    def test_shadow_ambient_not_flagged_as_color(self):
        """shadow-ambient should not appear in custom color refs."""
        tsx = '<div className="shadow-ambient bg-surface text-primary" />'
        refs = extract_custom_color_refs(tsx)
        color_names = [name for _, name in refs]
        assert "ambient" not in color_names

    @pytest.mark.unit
    def test_shadow_custom_flagged_when_not_in_config(self):
        """shadow-* classes with custom names are flagged when not in @theme colors."""
        tsx_sources = {"Comp": '<div className="shadow-custom-glow" />'}
        config = "@theme { --color-primary: #000; }"
        warnings = validate_style_coverage(tsx_sources, config)
        assert any("custom-glow" in w for w in warnings)

    @pytest.mark.unit
    def test_actual_missing_color_still_flagged(self):
        """Genuine missing colors should still be flagged."""
        tsx_sources = {"Comp": '<div className="bg-nonexistent" />'}
        config = "@theme { --color-primary: #000; }"
        warnings = validate_style_coverage(tsx_sources, config)
        assert any("nonexistent" in w for w in warnings)


class TestOutlineVariantCoverage:
    """Test that outline-variant (M3 color) is not false-positived as missing."""

    @pytest.mark.unit
    def test_outline_variant_not_flagged_when_config_has_flat_key(self):
        """outline-variant used as a class should not warn when it exists as a config color."""
        tsx_sources = {"Comp": '<div className="outline-variant border-outline-variant" />'}
        config = "@theme { --color-outline: #857462; --color-outline-variant: #d7c3ae; }"
        warnings = validate_style_coverage(tsx_sources, config)
        assert not any("variant" in w for w in warnings)

    @pytest.mark.unit
    def test_bare_outline_variant_auto_fixed_to_border(self):
        """Bare outline-variant in className should be rewritten to border-outline-variant."""
        tsx = '<div className="outline-variant p-4" />'
        fixed, fixes = apply_auto_fixes(tsx, [], {}, {})
        assert "border-outline-variant" in fixed
        assert "outline-variant" not in fixed.replace("border-outline-variant", "")
        assert any("outline-variant" in f for f in fixes)

    @pytest.mark.unit
    def test_border_outline_variant_not_double_prefixed(self):
        """Already-correct border-outline-variant should not become border-border-..."""
        tsx = '<div className="border-outline-variant p-4" />'
        fixed, fixes = apply_auto_fixes(tsx, [], {}, {})
        assert "border-border-outline-variant" not in fixed
        assert "border-outline-variant" in fixed

    """Verify URL sanitization only targets <img> tags, not <iframe>/<video>/etc."""

    @pytest.mark.unit
    def test_img_hallucinated_url_replaced(self):
        tsx = '<img src="https://images.unsplash.com/photo-abc" alt="office" />'
        fixed, fixes = apply_auto_fixes(tsx, [], {}, {})
        # Auto-fix converts hallucinated <img> to <ExepadImage>
        assert "<ExepadImage" in fixed or "__PLACEHOLDER__" in fixed

    @pytest.mark.unit
    def test_img_unknown_domain_replaced(self):
        tsx = '<img src="https://randomsite.example.com/photo.jpg" alt="photo" />'
        fixed, fixes = apply_auto_fixes(tsx, [], {}, {})
        assert "<ExepadImage" in fixed or "__PLACEHOLDER__" in fixed

    @pytest.mark.unit
    def test_img_allowed_domain_preserved(self):
        tsx = '<img src="https://storage.googleapis.com/bucket/img.png" alt="photo" />'
        fixed, fixes = apply_auto_fixes(tsx, [], {}, {})
        assert "storage.googleapis.com" in fixed

    @pytest.mark.unit
    def test_iframe_openstreetmap_preserved(self):
        tsx = (
            '<iframe src="https://www.openstreetmap.org/export/embed.html?bbox=-73.99,40.75,-73.97,40.77'
            '&layer=mapnik&marker=40.76,-73.98" className="w-full h-64" loading="lazy" />'
        )
        fixed, fixes = apply_auto_fixes(tsx, [], {}, {})
        assert "openstreetmap.org" in fixed
        assert "__PLACEHOLDER__" not in fixed

    @pytest.mark.unit
    def test_iframe_google_maps_preserved(self):
        tsx = '<iframe src="https://www.google.com/maps/embed?pb=!1m18" className="w-full h-64" />'
        fixed, fixes = apply_auto_fixes(tsx, [], {}, {})
        assert "google.com/maps" in fixed
        assert "__PLACEHOLDER__" not in fixed

    @pytest.mark.unit
    def test_video_source_preserved(self):
        tsx = '<video><source src="https://cdn.example.com/video.mp4" type="video/mp4" /></video>'
        fixed, fixes = apply_auto_fixes(tsx, [], {}, {})
        assert "cdn.example.com" in fixed
        assert "__PLACEHOLDER__" not in fixed

    @pytest.mark.unit
    def test_mixed_img_and_iframe(self):
        """Img gets sanitized while iframe in the same component is preserved."""
        tsx = (
            '<img src="https://unsplash.com/photo.jpg" alt="hero" />\n'
            '<iframe src="https://www.openstreetmap.org/export/embed.html?bbox=-1,1,-1,1" />'
        )
        fixed, fixes = apply_auto_fixes(tsx, [], {}, {})
        assert "<ExepadImage" in fixed or "__PLACEHOLDER__" in fixed
        assert "openstreetmap.org" in fixed

    @pytest.mark.unit
    def test_check_hallucinated_only_warns_for_img(self):
        tsx = (
            '<img src="https://unsplash.com/photo.jpg" alt="hero" />\n'
            '<iframe src="https://www.openstreetmap.org/export/embed.html" />'
        )
        warnings = check_hallucinated_image_urls(tsx)
        assert len(warnings) == 1
        assert "unsplash" in warnings[0]

    @pytest.mark.unit
    def test_check_hallucinated_no_warnings_for_iframe_only(self):
        tsx = '<iframe src="https://www.openstreetmap.org/export/embed.html" />'
        warnings = check_hallucinated_image_urls(tsx)
        assert warnings == []

    @pytest.mark.unit
    def test_kept_when_no_stock_provider_configured(self):
        # When no keyword-search provider is configured the URL is KEPT, so
        # the blocking semantic check must NOT flag it (else it forces a
        # wasted save/retry). Covers both blocked (unsplash) + unknown
        # (pexels, now off the blocklist) domains.
        tsx = (
            '<img src="https://images.unsplash.com/photo-1" alt="hero" />\n'
            '<img src="https://images.pexels.com/photos/1/x.jpg" alt="t" />'
        )
        assert check_hallucinated_image_urls(tsx, stock_provider_configured=False) == []
        # With a provider it still flags both (default True preserves behavior).
        assert len(check_hallucinated_image_urls(tsx, stock_provider_configured=True)) == 2

    @pytest.mark.unit
    def test_run_semantic_checks_keeps_url_without_provider(self):
        tsx = '<img src="https://images.unsplash.com/photo-1" alt="hero" />'
        result = run_semantic_checks(
            tsx, [], {}, [], expected_component_name="Hero", stock_provider_configured=False
        )
        # The kept URL must not produce a blocking error.
        assert not any("unsplash" in e.lower() for e in result.errors)


class TestCheckDuplicateImageUrls:
    """Tests for check_duplicate_image_urls() — array property detection."""

    @pytest.mark.unit
    def test_detects_duplicate_urls_in_array_properties(self):
        tsx = """const items = [
          { image: "https://example.com/same.jpg", alt: "one" },
          { image: "https://example.com/same.jpg", alt: "two" },
          { image: "https://example.com/same.jpg", alt: "three" },
        ];"""
        warnings = check_duplicate_image_urls(tsx)
        assert len(warnings) >= 1
        assert "array image properties" in warnings[-1]

    @pytest.mark.unit
    def test_no_warning_for_unique_urls_in_array(self):
        tsx = """const items = [
          { image: "https://example.com/a.jpg", alt: "one" },
          { image: "https://example.com/b.jpg", alt: "two" },
        ];"""
        warnings = check_duplicate_image_urls(tsx)
        assert len(warnings) == 0

    @pytest.mark.unit
    def test_no_warning_for_placeholder_values(self):
        tsx = """const items = [
          { image: "__PLACEHOLDER__", alt: "one" },
          { image: "__PLACEHOLDER__", alt: "two" },
        ];"""
        warnings = check_duplicate_image_urls(tsx)
        assert len(warnings) == 0

    @pytest.mark.unit
    def test_no_warning_for_single_item(self):
        tsx = '{ image: "https://example.com/a.jpg", alt: "one" }'
        warnings = check_duplicate_image_urls(tsx)
        assert len(warnings) == 0


class TestAutoFixArrayImageUrls:
    """Tests for auto-fixing hallucinated URLs in JS data array properties."""

    @pytest.mark.unit
    def test_fixes_hallucinated_url_in_data_array(self):
        tsx = """const items = [
  { name: "Alice", image: "https://img.b2bpic.net/free-photo/portrait_123.jpg", alt: "portrait" },
  { name: "Bob", image: "https://img.b2bpic.net/free-photo/man_456.jpg", alt: "portrait" },
];"""
        fixed, fixes = apply_auto_fixes(tsx, [], {}, {})
        assert "__PLACEHOLDER__" in fixed
        assert "https://img.b2bpic.net" not in fixed
        assert any("array image URL" in f for f in fixes)

    @pytest.mark.unit
    def test_preserves_allowed_url_in_data_array(self):
        tsx = """const items = [
  { name: "A", image: "https://storage.googleapis.com/bucket/img.jpg", alt: "photo" },
];"""
        fixed, fixes = apply_auto_fixes(tsx, [], {}, {})
        assert "storage.googleapis.com" in fixed
        assert not any("array image URL" in f for f in fixes)

    @pytest.mark.unit
    def test_fixes_multiple_image_key_names(self):
        tsx = """const data = [
  { avatar: "https://unsplash.com/photo1.jpg", alt: "face" },
  { thumbnail: "https://images.pexels.com/photo/200", alt: "thumb" },
];"""
        fixed, fixes = apply_auto_fixes(tsx, [], {}, {})
        assert "unsplash.com" not in fixed
        assert "images.pexels.com" not in fixed
        assert fixed.count("__PLACEHOLDER__") == 2

    def test_picsum_array_url_kept_allowlisted(self):
        # picsum.photos is now the allowlisted keyless fallback provider —
        # its URLs are KEPT even when a stock provider is configured.
        tsx = """const data = [
  { thumbnail: "https://picsum.photos/seed/x/200/200", alt: "thumb" },
];"""
        fixed, _fixes = apply_auto_fixes(tsx, [], {}, {})
        assert "https://picsum.photos/seed/x/200/200" in fixed
        assert "__PLACEHOLDER__" not in fixed


class TestAutoFixStaticSrcInMap:
    """Tests for auto-fixing static <img src> inside .map() blocks."""

    @pytest.mark.unit
    def test_placeholder_src_in_map_rewritten_to_dynamic(self):
        """src='__PLACEHOLDER__' inside .map() should become src={item.image}."""
        tsx = """{items.map((item) => (
          <div>
            <img src="__PLACEHOLDER__" alt={item.alt} className="w-full" />
          </div>
        ))}"""
        fixed, fixes = apply_auto_fixes(tsx, [], {}, {})
        assert "src={item.image}" in fixed
        assert 'src="__PLACEHOLDER__"' not in fixed
        assert any("static <img src>" in f or "static" in f.lower() for f in fixes)

    @pytest.mark.unit
    def test_hardcoded_url_in_map_rewritten_to_dynamic(self):
        """Hardcoded URL inside .map() should become src={item.image} after auto-fix."""
        tsx = """{gallery.map((item) => (
          <img src="https://img.b2bpic.net/free-photo/techno_1048-12779.jpg" alt={item.alt} />
        ))}"""
        fixed, fixes = apply_auto_fixes(tsx, [], {}, {})
        assert "src={item.image}" in fixed
        assert "b2bpic" not in fixed

    @pytest.mark.unit
    def test_dynamic_src_in_map_not_touched(self):
        """Already-dynamic src={item.image} should not be modified."""
        tsx = """{items.map((item) => (
          <img src={item.image} alt={item.alt} />
        ))}"""
        fixed, fixes = apply_auto_fixes(tsx, [], {}, {})
        assert "src={item.image}" in fixed

    @pytest.mark.unit
    def test_map_param_name_used_correctly(self):
        """The map parameter name should be used in the dynamic expression."""
        tsx = """{instructors.map((instructor) => (
          <img src="__PLACEHOLDER__" alt={instructor.alt} />
        ))}"""
        fixed, fixes = apply_auto_fixes(tsx, [], {}, {})
        assert "src={instructor.image}" in fixed

    @pytest.mark.unit
    def test_placeholder_src_in_map_no_parens_rewritten(self):
        """No-parens arrow: .map(item => ...) should also get auto-fixed."""
        tsx = """{items.map(item => (
          <img src="__PLACEHOLDER__" alt={item.alt} className="w-full" />
        ))}"""
        fixed, fixes = apply_auto_fixes(tsx, [], {}, {})
        assert "src={item.image}" in fixed
        assert 'src="__PLACEHOLDER__"' not in fixed

    @pytest.mark.unit
    def test_map_no_parens_param_name_used(self):
        """No-parens arrow: .map(member => ...) should use 'member' in the fix."""
        tsx = """{team.map(member => (
          <img src="__PLACEHOLDER__" alt={member.name} />
        ))}"""
        fixed, fixes = apply_auto_fixes(tsx, [], {}, {})
        assert "src={member.image}" in fixed

    @pytest.mark.unit
    def test_img_outside_map_not_rewritten(self):
        """Regression: <img> after .map() closes must NOT get src={param.image}.

        The previous scope-blind implementation used a 3000-char window
        and would inject {param.image} into sibling JSX, causing runtime
        ReferenceError: param is not defined. The RetailFlux bug on
        preview-ufot9cf8 shipped because of this.
        """
        tsx = (
            "function Home() {\n"
            "  const features = [{ title: 'a' }, { title: 'b' }];\n"
            "  return (\n"
            "    <div>\n"
            "      {features.map((feature, idx) => (\n"
            "         <span key={idx}>{feature.title}</span>\n"
            "      ))}\n"
            '      <img src="__PLACEHOLDER__" alt="hero banner" />\n'
            "    </div>\n"
            "  );\n"
            "}\n"
        )
        fixed, fixes = apply_auto_fixes(tsx, [], {}, {})
        # The <img> after the map MUST NOT be rewritten with `feature.image`.
        assert "{feature.image}" not in fixed
        # Raw <img src="__PLACEHOLDER__"> outside a map is handled by the
        # separate ExepadImage conversion fixer — it converts the tag.
        assert 'src="__PLACEHOLDER__"' not in fixed

    @pytest.mark.unit
    def test_img_in_map_gets_rewrite_and_data_array_gets_image_key(self):
        """Inside a .map, <img> is rewritten AND the source array gains image key."""
        tsx = (
            "function Home() {\n"
            "  const items = [\n"
            "    { alt: 'first' },\n"
            "    { alt: 'second' },\n"
            "  ];\n"
            "  return (\n"
            "    <div>\n"
            "      {items.map((item, i) => (\n"
            '        <img key={i} src="__PLACEHOLDER__" alt={item.alt} />\n'
            "      ))}\n"
            "    </div>\n"
            "  );\n"
            "}\n"
        )
        fixed, fixes = apply_auto_fixes(tsx, [], {}, {})
        # <img> inside the map IS rewritten.
        assert "src={item.image}" in fixed
        # Each object in the source array gains an `image: "__PLACEHOLDER__"`.
        assert fixed.count('image: "__PLACEHOLDER__"') >= 2
        assert any("Injected image" in f for f in fixes)

    @pytest.mark.unit
    def test_img_in_map_image_key_not_duplicated(self):
        """If source array already has image: key, don't inject a duplicate."""
        tsx = (
            "function Home() {\n"
            "  const items = [\n"
            "    { alt: 'first', image: 'https://cdn.exepad.com/real.jpg' },\n"
            "  ];\n"
            "  return (\n"
            "    <div>\n"
            "      {items.map((item, i) => (\n"
            '        <img key={i} src="__PLACEHOLDER__" alt={item.alt} />\n'
            "      ))}\n"
            "    </div>\n"
            "  );\n"
            "}\n"
        )
        fixed, fixes = apply_auto_fixes(tsx, [], {}, {})
        # One image key only — the original URL stays untouched (it's a
        # cdn.exepad.com domain which the allowlist accepts).
        assert fixed.count("image:") == 1

    @pytest.mark.unit
    def test_nested_map_then_img_outside_outer_map_not_rewritten(self):
        """Nested .map inside a .map, <img> after BOTH close: neither
        inner nor outer param leaks."""
        tsx = (
            "function Home() {\n"
            "  const groups = [{ items: [1,2] }];\n"
            "  return (\n"
            "    <div>\n"
            "      {groups.map((group, gi) => (\n"
            "        <section key={gi}>\n"
            "          {group.items.map((item, i) => (\n"
            "            <span key={i}>{item}</span>\n"
            "          ))}\n"
            "        </section>\n"
            "      ))}\n"
            '      <img src="__PLACEHOLDER__" alt="footer" />\n'
            "    </div>\n"
            "  );\n"
            "}\n"
        )
        fixed, fixes = apply_auto_fixes(tsx, [], {}, {})
        assert "{group.image}" not in fixed
        assert "{item.image}" not in fixed


class TestCheckOverflowHiddenOnRoot:
    """Tests for check_overflow_hidden_on_root()."""

    @pytest.mark.unit
    def test_overflow_hidden_on_root_flagged(self):
        tsx = """<LightDOMContainer>
          <div className="flex flex-col w-full overflow-hidden">
            <section>content</section>
          </div>
        </LightDOMContainer>"""
        errors = check_overflow_hidden_on_root(tsx)
        assert len(errors) == 1
        assert "overflow-hidden" in errors[0]

    @pytest.mark.unit
    def test_overflow_hidden_on_inner_section_not_flagged(self):
        tsx = """<LightDOMContainer>
          <div className="flex flex-col w-full">
            <section className="overflow-hidden">content</section>
          </div>
        </LightDOMContainer>"""
        errors = check_overflow_hidden_on_root(tsx)
        assert errors == []

    @pytest.mark.unit
    def test_overflow_x_clip_on_root_not_flagged(self):
        tsx = """<LightDOMContainer>
          <div className="flex flex-col w-full overflow-x-clip">
            <section>content</section>
          </div>
        </LightDOMContainer>"""
        errors = check_overflow_hidden_on_root(tsx)
        assert errors == []

    @pytest.mark.unit
    def test_no_overflow_class_not_flagged(self):
        tsx = """<LightDOMContainer>
          <div className="flex flex-col">
            <section>content</section>
          </div>
        </LightDOMContainer>"""
        errors = check_overflow_hidden_on_root(tsx)
        assert errors == []


class TestCheckLowOpacityBg:
    """Tests for check_low_opacity_bg()."""

    @pytest.mark.unit
    def test_very_low_opacity_flagged(self):
        tsx = '<div className="bg-primary/5 p-4">content</div>'
        warnings = check_low_opacity_bg(tsx)
        assert len(warnings) == 1
        assert "bg-primary/5" in warnings[0]

    @pytest.mark.unit
    def test_opacity_10_flagged(self):
        tsx = '<div className="bg-primary-container/10">content</div>'
        warnings = check_low_opacity_bg(tsx)
        assert len(warnings) == 1

    @pytest.mark.unit
    def test_opacity_20_flagged(self):
        tsx = '<div className="bg-secondary/20">content</div>'
        warnings = check_low_opacity_bg(tsx)
        assert len(warnings) == 1

    @pytest.mark.unit
    def test_opacity_30_not_flagged(self):
        """Boundary: /30 is the minimum acceptable, should not warn."""
        tsx = '<div className="bg-primary-container/30">content</div>'
        warnings = check_low_opacity_bg(tsx)
        assert warnings == []

    @pytest.mark.unit
    def test_opacity_50_not_flagged(self):
        tsx = '<div className="bg-primary/50">content</div>'
        warnings = check_low_opacity_bg(tsx)
        assert warnings == []

    @pytest.mark.unit
    def test_no_opacity_not_flagged(self):
        tsx = '<div className="bg-primary p-4">content</div>'
        warnings = check_low_opacity_bg(tsx)
        assert warnings == []


class TestCheckInverseSurfaceTextPairing:
    """Tests for check_inverse_surface_text_pairing()."""

    @pytest.mark.unit
    def test_on_surface_variant_with_inverse_surface_flagged(self):
        tsx = """<footer className="bg-inverse-surface">
          <p className="text-on-surface-variant">body text</p>
        </footer>"""
        warnings = check_inverse_surface_text_pairing(tsx)
        assert len(warnings) == 1
        assert "text-inverse-on-surface" in warnings[0]

    @pytest.mark.unit
    def test_inverse_on_surface_with_inverse_surface_not_flagged(self):
        tsx = """<footer className="bg-inverse-surface">
          <p className="text-inverse-on-surface">body text</p>
        </footer>"""
        warnings = check_inverse_surface_text_pairing(tsx)
        assert warnings == []

    @pytest.mark.unit
    def test_on_surface_variant_without_inverse_surface_not_flagged(self):
        tsx = """<div className="bg-surface">
          <p className="text-on-surface-variant">body text</p>
        </div>"""
        warnings = check_inverse_surface_text_pairing(tsx)
        assert warnings == []


class TestAutoFixInverseSurfaceTextPairing:
    """Tests for the inverse-surface text pairing auto-fix.

    The old file-level blanket replacement (text-on-surface-variant →
    text-inverse-on-surface when bg-inverse-surface exists anywhere) was
    removed because it broke mixed components with both dark and light
    sections. The check_inverse_surface_text_pairing warning still catches
    the reverse case.
    """

    @pytest.mark.unit
    def test_on_surface_variant_rewritten_under_inverse_surface_ancestor(self):
        """Track 2: the ancestor walker recognizes the bg-inverse-surface
        parent and rewrites child ``text-on-surface-variant`` →
        ``text-inverse-on-surface``.  Previously this was left alone
        because the per-className auto-fixer had no ancestor knowledge;
        Track 2 closes that loop so the categorical error never reaches
        the fixer agent retry.
        """
        tsx = """<footer className="bg-inverse-surface text-inverse-on-surface pt-16">
          <p className="text-on-surface-variant">description</p>
          <a className="text-on-surface-variant hover:text-primary">link</a>
        </footer>"""
        fixed, fixes = apply_auto_fixes(tsx, [], {}, {})
        assert "text-on-surface-variant" not in fixed
        # Parent + 2 children all end up on text-inverse-on-surface.
        assert fixed.count("text-inverse-on-surface") >= 3

    @pytest.mark.unit
    def test_no_replacement_when_no_inverse_surface(self):
        tsx = """<div className="bg-surface">
          <p className="text-on-surface-variant">description</p>
        </div>"""
        fixed, fixes = apply_auto_fixes(tsx, [], {}, {})
        assert "text-on-surface-variant" in fixed
        assert not any("inverse-surface" in f for f in fixes)

    @pytest.mark.unit
    def test_wired_into_run_semantic_checks(self):
        """Verify the AST rules wire into run_semantic_checks() — under
        the always-ship contract, all of these surface as warnings.
        """
        tsx = """
import { React, LightDOMContainer } from '@exepad/sdk';
export default function Footer() {
  return (
    <LightDOMContainer>
      <div className="flex flex-col overflow-hidden">
        <footer className="bg-inverse-surface">
          <p className="text-on-surface-variant">text</p>
          <div className="bg-primary/5">faint</div>
        </footer>
      </div>
    </LightDOMContainer>
  );
}
"""
        result = run_semantic_checks(tsx, [], {}, [])
        assert result.valid
        warning_text = " ".join(result.warnings)
        # overflow-hidden on root + inverse-surface pairing + low-opacity bg
        assert "overflow-hidden" in warning_text
        assert "inverse" in warning_text


class TestCheckLightSurfaceInverseText:
    """Tests for check_light_surface_inverse_text() — same-element check.

    Track 1 (post-2026-04) policy: this check ONLY flags when an explicit
    light bg class lives on the same element as the offending
    text-inverse-on-surface token.  Bare children are treated as
    ancestry-unknown and stay silent — flagging them was the primary
    source of the 53× false-positive cascade documented in drift analysis
    for session-20260415T091442-0dab09.  Track 2 (JSX ancestor walker)
    will eventually recover the missed same-surface-parent cases without
    re-introducing false positives.
    """

    @pytest.mark.unit
    def test_inverse_on_surface_same_element_light_bg_flagged(self):
        """text-inverse-on-surface + bg-surface on the SAME element — flagged."""
        tsx = '<div className="bg-surface text-inverse-on-surface p-4">body text</div>'
        warnings = check_light_surface_inverse_text(tsx)
        assert len(warnings) == 1
        # Message uses the measured-ratio variant when the fallback palette
        # resolves both the text and surface tokens (expected post-2026-04
        # when `_SEMANTIC_LIGHT_HEX` gained the on-* entries).
        assert "text-inverse-on-surface" in warnings[0]
        assert "regular surfaces" in warnings[0]

    @pytest.mark.unit
    def test_inverse_on_surface_bare_child_of_light_parent_flagged(self):
        """Track 2: ancestor walker resolves bg-surface parent → true positive.

        Before Track 2 this was a false negative (silent) because the
        per-className regex could not see the parent's bg class.  Now
        the walker maintains an ancestor stack and the child inherits
        ``bg-surface`` from its parent, so ``text-inverse-on-surface``
        is correctly flagged as invisible on a light surface.
        """
        tsx = """<div className="bg-surface">
          <p className="text-inverse-on-surface">body text</p>
        </div>"""
        warnings = check_light_surface_inverse_text(tsx)
        assert len(warnings) == 1
        assert "text-inverse-on-surface" in warnings[0]

    @pytest.mark.unit
    def test_inverse_on_surface_same_element_dark_bg_not_flagged(self):
        """text-inverse-on-surface + bg-inverse-surface in the SAME className."""
        tsx = '<button className="bg-inverse-surface text-inverse-on-surface px-4">Go</button>'
        warnings = check_light_surface_inverse_text(tsx)
        assert warnings == []

    @pytest.mark.unit
    def test_inverse_on_surface_bare_child_of_dark_parent_not_flagged(self):
        """Child with text-inverse-on-surface inside bg-inverse-surface parent.

        The parent is dark, so the child correctly inherits a dark
        background.  Prior behavior falsely flagged this as "element-
        scoped check flags the child" — Track 1 stops doing that.
        """
        tsx = """<footer className="bg-inverse-surface">
          <p className="text-inverse-on-surface">body text</p>
        </footer>"""
        warnings = check_light_surface_inverse_text(tsx)
        assert warnings == []

    @pytest.mark.unit
    def test_mixed_same_element_light_flagged_dark_silent(self):
        """Only the same-element light-bg case is flagged."""
        tsx = """<section className="bg-surface">
          <p className="bg-surface text-inverse-on-surface">invisible body</p>
          <button className="bg-inverse-surface text-inverse-on-surface">correct</button>
        </section>"""
        warnings = check_light_surface_inverse_text(tsx)
        assert len(warnings) == 1
        assert "Line ~2" in warnings[0]

    @pytest.mark.unit
    def test_inverse_on_surface_with_low_opacity_bg_silent(self):
        """bg-inverse-surface/40 is decorative — ancestry unknown, no flag.

        A translucent dark overlay (e.g. backdrop) reveals whatever is
        beneath.  Without an ancestor walk we cannot compute the effective
        bg; Track 1 prefers a false negative over the old false positive.
        """
        tsx = '<div className="bg-inverse-surface/40 text-inverse-on-surface">overlay</div>'
        warnings = check_light_surface_inverse_text(tsx)
        assert warnings == []

    @pytest.mark.unit
    def test_inverse_on_surface_with_high_opacity_bg_not_flagged(self):
        """bg-inverse-surface/80 is dark enough — should not flag."""
        tsx = '<div className="bg-inverse-surface/80 text-inverse-on-surface">dark</div>'
        warnings = check_light_surface_inverse_text(tsx)
        assert warnings == []

    @pytest.mark.unit
    def test_no_inverse_text_at_all_not_flagged(self):
        tsx = """<div className="bg-surface">
          <p className="text-on-surface">body text</p>
        </div>"""
        warnings = check_light_surface_inverse_text(tsx)
        assert warnings == []

    @pytest.mark.unit
    def test_template_literal_bare_element_not_flagged(self):
        """Template literal with no bg on the same element — silent."""
        tsx = "<p className={`text-inverse-on-surface ${someClass}`}>text</p>"
        warnings = check_light_surface_inverse_text(tsx)
        assert warnings == []

    @pytest.mark.unit
    def test_template_literal_same_element_light_bg_flagged(self):
        """Template literal with explicit light bg — flagged."""
        tsx = "<p className={`bg-surface text-inverse-on-surface ${extra}`}>text</p>"
        warnings = check_light_surface_inverse_text(tsx)
        assert len(warnings) == 1

    @pytest.mark.unit
    def test_template_literal_with_dark_bg_not_flagged(self):
        """Template literal with bg-inverse-surface in static part is OK."""
        tsx = "<p className={`bg-inverse-surface text-inverse-on-surface ${padding}`}>text</p>"
        warnings = check_light_surface_inverse_text(tsx)
        assert warnings == []

    @pytest.mark.unit
    def test_template_literal_conditional_inverse_text_skipped(self):
        """text-inverse-on-surface inside ${} expression is skipped (conditional)."""
        tsx = """<p className={`text-sm ${active ? 'text-inverse-on-surface' : 'text-on-surface'}`}>text</p>"""
        warnings = check_light_surface_inverse_text(tsx)
        assert warnings == []

    @pytest.mark.unit
    def test_same_element_light_bg_surfaces_as_warning(self):
        """M3 token-pairing violations ship as warnings (stylistic, not
        blocking). The actual WCAG-AA contrast guarantee is enforced
        separately at the CSS theme level.
        """
        tsx = """
import { React, LightDOMContainer } from '@exepad/sdk';
export default function Page() {
  return (
    <LightDOMContainer>
      <div className="bg-surface text-inverse-on-surface flex flex-col">
        invisible body
      </div>
    </LightDOMContainer>
  );
}
"""
        result = run_semantic_checks(tsx, [], {}, [])
        assert result.valid
        assert any("text-inverse-on-surface on regular surfaces" in w for w in result.warnings)


class TestAutoFixLightSurfaceInverseText:
    """Tests for the per-className light-surface inverse-text auto-fix."""

    @pytest.mark.unit
    def test_inverse_on_surface_replaced_when_no_inverse_bg(self):
        tsx = """<div className="bg-surface">
          <p className="text-inverse-on-surface">description</p>
          <span className="text-inverse-on-surface">more text</span>
        </div>"""
        fixed, fixes = apply_auto_fixes(tsx, [], {}, {})
        assert "text-inverse-on-surface" not in fixed
        assert "text-on-surface" in fixed
        assert any("text-inverse-on-surface" in f for f in fixes)

    @pytest.mark.unit
    def test_no_replacement_when_same_element_has_dark_bg(self):
        """text-inverse-on-surface + bg-inverse-surface in the SAME className is kept."""
        tsx = '<button className="bg-inverse-surface text-inverse-on-surface px-4">Go</button>'
        fixed, fixes = apply_auto_fixes(tsx, [], {}, {})
        assert "text-inverse-on-surface" in fixed

    @pytest.mark.unit
    def test_child_inside_dark_bg_parent_keeps_inverse_text(self):
        """Child inside bg-inverse-surface parent: the orphan fix skips children
        inside a dark parent's proximity window, so text-inverse-on-surface is
        kept (not incorrectly rewritten to text-on-surface)."""
        tsx = """<footer className="bg-inverse-surface text-inverse-on-surface">
          <p className="text-inverse-on-surface text-sm">child text</p>
        </footer>"""
        fixed, fixes = apply_auto_fixes(tsx, [], {}, {})
        # The footer's className has bg-inverse-surface → kept
        assert 'bg-inverse-surface text-inverse-on-surface"' in fixed
        # The <p> is inside dark bg parent → should keep inverse text
        assert '"text-inverse-on-surface text-sm"' in fixed

    @pytest.mark.unit
    def test_mixed_dark_and_light_sections(self):
        """Mixed component: only light section text gets fixed."""
        tsx = """<section className="bg-surface">
          <p className="text-inverse-on-surface">should be fixed</p>
          <button className="bg-inverse-surface text-inverse-on-surface">should stay</button>
        </section>"""
        fixed, fixes = apply_auto_fixes(tsx, [], {}, {})
        assert '"text-on-surface"' in fixed  # the <p> was fixed
        assert "bg-inverse-surface text-inverse-on-surface" in fixed  # button kept

    @pytest.mark.unit
    def test_low_opacity_dark_bg_still_fixed(self):
        """bg-inverse-surface/40 is too transparent — text should be fixed."""
        tsx = '<div className="bg-inverse-surface/40 text-inverse-on-surface">overlay</div>'
        fixed, fixes = apply_auto_fixes(tsx, [], {}, {})
        assert "text-inverse-on-surface" not in fixed
        assert "text-on-surface" in fixed


class TestAutoFixChildInverseText:
    """Tests that child dark-surface pairings are ancestor-aware auto-fixed.

    Track 2: the ancestor walker resolves the nearest enclosing bg token
    for every child className, so the auto-fixer can rewrite token
    mismatches locally in one pass instead of deferring to the fixer
    agent retry.  This class used to assert the pre-Track-2 "do not
    cross-element fix" policy; the rewrite is now safe because the
    walker never guesses ancestry — it either knows or stays silent.
    """

    @pytest.mark.unit
    def test_child_text_on_surface_rewritten_to_inverse(self):
        """Track 2: text-on-surface child of bg-inverse-surface → text-inverse-on-surface."""
        tsx = """<div className="bg-inverse-surface p-8 rounded-2xl">
          <p className="text-on-surface text-sm">dark on dark</p>
        </div>"""
        fixed, fixes = apply_auto_fixes(tsx, [], {}, {})
        assert "text-on-surface text-sm" not in fixed
        assert "text-inverse-on-surface text-sm" in fixed

    @pytest.mark.unit
    def test_child_with_light_bg_override_not_fixed(self):
        """Nested light sections stay untouched."""
        tsx = """<div className="bg-inverse-surface p-8">
          <div className="bg-surface p-4">
            <p className="text-on-surface">this is fine — different section</p>
          </div>
        </div>"""
        fixed, fixes = apply_auto_fixes(tsx, [], {}, {})
        assert "text-on-surface" in fixed
        assert not any("child element" in f for f in fixes)

    @pytest.mark.unit
    def test_template_literal_not_fixed(self):
        """Template literal classNames are too complex for safe regex rewrite."""
        tsx = """<div className="bg-inverse-surface p-8">
          <p className={`text-on-surface ${cond ? 'mt-2' : ''}`}>text</p>
        </div>"""
        fixed, fixes = apply_auto_fixes(tsx, [], {}, {})
        assert not any("child element" in f for f in fixes)

    @pytest.mark.unit
    def test_transparent_dark_bg_skipped(self):
        """bg-inverse-surface/40 is too transparent — children NOT auto-fixed."""
        tsx = """<div className="bg-inverse-surface/40 p-8">
          <p className="text-on-surface">still visible on light parent</p>
        </div>"""
        fixed, fixes = apply_auto_fixes(tsx, [], {}, {})
        assert "text-on-surface" in fixed
        assert not any("child element" in f for f in fixes)

    @pytest.mark.unit
    def test_nested_light_card_never_gets_inverse_text(self):
        """A dark wrapper must not force inverse text into a nested light card."""
        tsx = """<section className="bg-inverse-surface p-8">
          <div className="bg-surface rounded-xl p-6">
            <p className="text-on-surface">Readable body</p>
          </div>
        </section>"""
        fixed, fixes = apply_auto_fixes(tsx, [], {}, {})
        assert "bg-surface rounded-xl p-6" in fixed
        assert "text-on-surface" in fixed
        assert "text-inverse-on-surface" not in fixed
        assert not any("child element" in f for f in fixes)


class TestAutoFixLowOpacityBg:
    """Tests for auto-fix of near-invisible background opacity."""

    @pytest.mark.unit
    def test_bg_opacity_5_clamped(self):
        tsx = '<div className="bg-primary/5 p-4">content</div>'
        fixed, fixes = apply_auto_fixes(tsx, [], {}, {})
        assert "bg-primary/30" in fixed
        assert "bg-primary/5" not in fixed
        assert any("Clamped bg opacity" in f for f in fixes)

    @pytest.mark.unit
    def test_bg_opacity_10_clamped(self):
        tsx = '<div className="bg-outline/10">content</div>'
        fixed, fixes = apply_auto_fixes(tsx, [], {}, {})
        assert "bg-outline/30" in fixed
        assert "bg-outline/10" not in fixed

    @pytest.mark.unit
    def test_bg_opacity_30_unchanged(self):
        """Boundary: /30 is the minimum, should not be changed."""
        tsx = '<div className="bg-primary/30 p-4">content</div>'
        fixed, fixes = apply_auto_fixes(tsx, [], {}, {})
        assert "bg-primary/30" in fixed
        assert not any("Clamped bg opacity" in f for f in fixes)

    @pytest.mark.unit
    def test_bg_opacity_90_unchanged(self):
        tsx = '<div className="bg-surface/90">content</div>'
        fixed, fixes = apply_auto_fixes(tsx, [], {}, {})
        assert "bg-surface/90" in fixed
        assert not any("Clamped bg opacity" in f for f in fixes)


class TestCheckDarkSurfaceLightText:
    """Tests for check_dark_surface_light_text() — proximity-based check."""

    @pytest.mark.unit
    def test_text_on_surface_inside_dark_bg_flagged(self):
        """text-on-surface on child of bg-inverse-surface is flagged."""
        tsx = """<div className="bg-inverse-surface p-8 rounded-2xl">
          <p className="text-on-surface text-sm font-medium">dark on dark</p>
        </div>"""
        warnings = check_dark_surface_light_text(tsx)
        assert len(warnings) == 1
        assert "text-inverse-on-surface" in warnings[0]

    @pytest.mark.unit
    def test_text_on_surface_variant_not_flagged(self):
        """text-on-surface-variant is handled by check_inverse_surface_text_pairing."""
        tsx = """<div className="bg-inverse-surface p-8">
          <p className="text-on-surface-variant">handled elsewhere</p>
        </div>"""
        warnings = check_dark_surface_light_text(tsx)
        assert warnings == []

    @pytest.mark.unit
    def test_no_dark_bg_not_flagged(self):
        """No bg-inverse-surface at all — nothing to check."""
        tsx = """<div className="bg-surface">
          <p className="text-on-surface">normal light text</p>
        </div>"""
        warnings = check_dark_surface_light_text(tsx)
        assert warnings == []

    @pytest.mark.unit
    def test_correct_pairing_not_flagged(self):
        """text-inverse-on-surface on child of bg-inverse-surface is correct."""
        tsx = """<div className="bg-inverse-surface p-8">
          <p className="text-inverse-on-surface">white on dark, correct</p>
        </div>"""
        warnings = check_dark_surface_light_text(tsx)
        assert warnings == []

    @pytest.mark.unit
    def test_light_bg_between_stops_scan(self):
        """A light bg class between dark bg and text-on-surface stops the scan."""
        tsx = """<div className="bg-inverse-surface p-8">
          <p className="text-inverse-on-surface">correct</p>
        </div>
        <div className="bg-surface p-8">
          <p className="text-on-surface">correct on light surface</p>
        </div>"""
        warnings = check_dark_surface_light_text(tsx)
        assert warnings == []

    @pytest.mark.unit
    def test_low_opacity_dark_bg_not_flagged(self):
        """bg-inverse-surface/40 is too transparent to count."""
        tsx = """<div className="bg-inverse-surface/40 p-8">
          <p className="text-on-surface">overlay text</p>
        </div>"""
        warnings = check_dark_surface_light_text(tsx)
        assert warnings == []

    @pytest.mark.unit
    def test_text_on_surface_with_opacity_flagged(self):
        """text-on-surface/80 is still dark text — should be flagged."""
        tsx = """<div className="bg-inverse-surface p-8">
          <p className="text-on-surface/80">dark on dark with opacity</p>
        </div>"""
        warnings = check_dark_surface_light_text(tsx)
        assert len(warnings) == 1


class TestAutoFixDarkSurfaceLightText:
    """Tests for same-element auto-fix: bg-inverse-surface + text-on-surface."""

    @pytest.mark.unit
    def test_same_element_text_on_surface_fixed(self):
        """text-on-surface on same element as bg-inverse-surface gets fixed."""
        tsx = '<div className="bg-inverse-surface text-on-surface p-8">text</div>'
        fixed, fixes = apply_auto_fixes(tsx, [], {}, {})
        assert "text-inverse-on-surface" in fixed
        assert "text-on-surface" not in fixed or "text-inverse-on-surface" in fixed
        assert any("text-on-surface" in f for f in fixes)

    @pytest.mark.unit
    def test_text_on_surface_variant_fixed_on_inverse_surface(self):
        """text-on-surface-variant on bg-inverse-surface is also paired to
        text-inverse-on-surface — the AST rule emits an inverse_surface_pairing
        warning for both the exact and the -variant token, and the fixer
        rewrites both in one pass.
        """
        tsx = '<div className="bg-inverse-surface text-on-surface-variant p-8">text</div>'
        fixed, _fixes = apply_auto_fixes(tsx, [], {}, {})
        assert "text-inverse-on-surface" in fixed
        assert "text-on-surface-variant" not in fixed

    @pytest.mark.unit
    def test_inverse_surface_warning_not_fired_when_tokens_in_different_scopes(self):
        """Regression: 6z5k25jk shipped this warning on 5/8 components even
        when the tokens lived in unrelated scopes. The warning rule now only
        fires when an actual element pairs them.
        """
        from main_agent.services.validation.tsx_ast.rules.component_m3_colors import (
            M3ColorPairingRule,
        )

        # text-on-surface-variant is on bg-surface (correct usage).
        # bg-inverse-surface is on a SIBLING section with text-inverse-on-surface.
        # No element actually mispairs them.
        tsx = """
        <div>
          <section className="bg-surface">
            <p className="text-on-surface-variant">Italic copy on light surface</p>
          </section>
          <section className="bg-inverse-surface text-inverse-on-surface">
            <p>Different scope</p>
          </section>
        </div>
        """
        rule = M3ColorPairingRule()
        tree = parse_tsx(tsx)
        ctx = AstContext(tsx=tsx, source_buf=source_bytes(tsx), tree=tree)
        findings = list(rule.check(ctx))
        msgs = [f.message for f in findings]
        # The inverse-surface warning must NOT fire — the pairing isn't present
        # on any single element.
        assert not any(
            "text-on-surface-variant used with bg-inverse-surface" in m for m in msgs
        ), f"unexpected false-positive warning: {msgs}"

    @pytest.mark.unit
    def test_no_dark_bg_not_fixed(self):
        """Without bg-inverse-surface, text-on-surface is untouched."""
        tsx = '<div className="bg-surface text-on-surface p-8">text</div>'
        fixed, fixes = apply_auto_fixes(tsx, [], {}, {})
        assert "text-on-surface " in fixed  # preserved (with trailing space)

    @pytest.mark.unit
    def test_low_opacity_dark_bg_not_fixed(self):
        """bg-inverse-surface/40 is too transparent — no fix."""
        tsx = '<div className="bg-inverse-surface/40 text-on-surface p-8">overlay</div>'
        fixed, fixes = apply_auto_fixes(tsx, [], {}, {})
        assert "text-on-surface " in fixed  # unchanged


# =============================================================================
# EXEPAD IMAGE CHECKS
# =============================================================================


class TestCheckExepadImageProps:
    """Tests for check_exepad_image_props()."""

    @pytest.mark.unit
    def test_valid_exepad_image(self):
        tsx = '<ExepadImage keywords="modern office lobby with natural light" importance={8} />'
        errors = check_exepad_image_props(tsx)
        assert len(errors) == 0

    @pytest.mark.unit
    def test_missing_keywords(self):
        tsx = '<ExepadImage importance={8} className="w-full" />'
        errors = check_exepad_image_props(tsx)
        assert any("keywords" in e for e in errors)

    @pytest.mark.unit
    def test_missing_importance(self):
        tsx = '<ExepadImage keywords="modern office lobby with natural light" className="w-full" />'
        errors = check_exepad_image_props(tsx)
        assert any("importance" in e for e in errors)

    @pytest.mark.unit
    def test_missing_both(self):
        tsx = '<ExepadImage className="w-full" />'
        errors = check_exepad_image_props(tsx)
        assert len(errors) == 2

    @pytest.mark.unit
    def test_multiple_tags_one_invalid(self):
        tsx = """
        <ExepadImage keywords="modern office lobby with natural light" importance={5} />
        <ExepadImage className="w-full" />
        """
        errors = check_exepad_image_props(tsx)
        assert len(errors) == 2  # missing keywords + missing importance on second tag

    @pytest.mark.unit
    def test_short_keywords_warning(self):
        tsx = '<ExepadImage keywords="office" importance={5} />'
        errors = check_exepad_image_props(tsx)
        assert any("5+" in e for e in errors)

    @pytest.mark.unit
    def test_five_word_keywords_ok(self):
        tsx = '<ExepadImage keywords="modern office lobby with plants" importance={5} />'
        errors = check_exepad_image_props(tsx)
        assert len(errors) == 0

    @pytest.mark.unit
    def test_jsx_expression_keywords_double_quote(self):
        tsx = '<ExepadImage keywords={"modern office lobby with natural light"} importance={8} />'
        errors = check_exepad_image_props(tsx)
        assert len(errors) == 0

    @pytest.mark.unit
    def test_jsx_expression_keywords_single_quote(self):
        tsx = "<ExepadImage keywords={'modern office lobby with natural light'} importance={8} />"
        errors = check_exepad_image_props(tsx)
        assert len(errors) == 0

    @pytest.mark.unit
    def test_jsx_expression_keywords_identifier(self):
        """Dynamic `keywords={kw}` is a valid form — must not flag as missing."""
        tsx = "<ExepadImage keywords={kw} importance={8} width={800} height={600} />"
        errors = check_exepad_image_props(tsx)
        assert not any("keywords" in e for e in errors)

    @pytest.mark.unit
    def test_jsx_expression_keywords_function_call(self):
        """Function-call keywords `keywords={getKw(item)}` must not flag as missing."""
        tsx = "<ExepadImage keywords={getKw(item)} importance={8} width={800} height={600} />"
        errors = check_exepad_image_props(tsx)
        assert not any("keywords" in e for e in errors)

    @pytest.mark.unit
    def test_jsx_expression_importance_identifier(self):
        """Dynamic `importance={score}` must not flag as missing."""
        tsx = (
            '<ExepadImage keywords="modern office lobby with natural light" '
            "importance={score} width={800} height={600} />"
        )
        errors = check_exepad_image_props(tsx)
        assert not any("importance" in e for e in errors)


class TestCheckExepadImageDuplicateKeywords:
    """Tests for check_exepad_image_duplicate_keywords()."""

    @pytest.mark.unit
    def test_unique_keywords_ok(self):
        tsx = """
        <ExepadImage keywords="modern office" importance={8} />
        <ExepadImage keywords="team portrait" importance={6} />
        """
        warnings = check_exepad_image_duplicate_keywords(tsx)
        assert len(warnings) == 0

    @pytest.mark.unit
    def test_duplicate_keywords_warned(self):
        tsx = """
        <ExepadImage keywords="modern office" importance={8} />
        <ExepadImage keywords="modern office" importance={5} />
        """
        warnings = check_exepad_image_duplicate_keywords(tsx)
        assert len(warnings) == 1
        assert "same keywords" in warnings[0]

    @pytest.mark.unit
    def test_jsx_expression_duplicates_detected(self):
        tsx = """
        <ExepadImage keywords={"modern office"} importance={8} />
        <ExepadImage keywords={"modern office"} importance={5} />
        """
        warnings = check_exepad_image_duplicate_keywords(tsx)
        assert len(warnings) == 1


class TestExepadImageAutoFix:
    """Tests for ExepadImage auto-fix in apply_auto_fixes()."""

    @pytest.mark.unit
    def test_jsx_expression_keywords_normalized(self):
        tsx = '<ExepadImage keywords={"bakery storefront with fresh bread"} importance={8} />'
        fixed, fixes = apply_auto_fixes(tsx, [], {}, {})
        assert 'keywords="bakery storefront with fresh bread"' in fixed
        assert "keywords={" not in fixed

    @pytest.mark.unit
    def test_jsx_expression_single_quote_normalized(self):
        tsx = "<ExepadImage keywords={'bakery storefront with fresh bread'} importance={8} />"
        fixed, fixes = apply_auto_fixes(tsx, [], {}, {})
        assert 'keywords="bakery storefront with fresh bread"' in fixed

    @pytest.mark.unit
    def test_missing_importance_injected(self):
        tsx = '<ExepadImage keywords="modern office lobby with plants" />'
        fixed, fixes = apply_auto_fixes(tsx, [], {}, {})
        assert "importance={5}" in fixed

    @pytest.mark.unit
    def test_valid_tag_unchanged(self):
        # Post-2026-04: width/height are now required; a tag that sets them
        # explicitly should pass through untouched.
        tsx = (
            '<ExepadImage keywords="modern office lobby with plants" '
            "importance={8} width={800} height={600} />"
        )
        fixed, fixes = apply_auto_fixes(tsx, [], {}, {})
        assert fixed == tsx

    @pytest.mark.unit
    def test_missing_width_height_injected(self):
        tsx = '<ExepadImage keywords="modern office lobby with plants" importance={8} />'
        fixed, fixes = apply_auto_fixes(tsx, [], {}, {})
        assert "width={800}" in fixed
        assert "height={600}" in fixed

    @pytest.mark.unit
    def test_oversized_width_capped(self):
        tsx = (
            '<ExepadImage keywords="modern office lobby with plants" '
            "importance={8} width={1920} height={1080} />"
        )
        fixed, fixes = apply_auto_fixes(tsx, [], {}, {})
        assert "width={1200}" in fixed
        assert "width={1920}" not in fixed

    @pytest.mark.unit
    def test_missing_keywords_derived_from_alt(self):
        tsx = '<ExepadImage alt="freshly baked bread on wooden table" importance={8} />'
        fixed, fixes = apply_auto_fixes(tsx, [], {}, {})
        assert 'keywords="freshly baked bread on wooden table"' in fixed
        assert any("alt" in f for f in fixes)

    @pytest.mark.unit
    def test_missing_keywords_fallback_to_abstract(self):
        tsx = '<ExepadImage importance={8} className="w-full h-64" />'
        fixed, fixes = apply_auto_fixes(tsx, [], {}, {})
        assert f'keywords="{EXEPAD_IMAGE_FALLBACK_KEYWORDS}"' in fixed
        assert any("fallback" in f for f in fixes)
        # Verify fallback passes the 5-word minimum check
        errors = check_exepad_image_props(fixed)
        assert not any("word(s)" in e for e in errors)

    @pytest.mark.unit
    def test_existing_keywords_not_overwritten(self):
        tsx = '<ExepadImage keywords="cozy bakery interior warm lighting" importance={8} />'
        fixed, fixes = apply_auto_fixes(tsx, [], {}, {})
        assert 'keywords="cozy bakery interior warm lighting"' in fixed
        assert not any("Injected missing" in f for f in fixes)

    @pytest.mark.unit
    def test_dynamic_template_literal_keywords_not_duplicated(self):
        # Regression: the fallback guard used to match only `keywords="..."` or
        # `keywords={"..."}` — dynamic template literals slipped past and got a
        # second `keywords=` attribute prepended (IronPulse debug-report Issue 4).
        tsx = (
            "<ExepadImage "
            "keywords={`professional fitness trainer portrait ${trainer.specialty} athletic`} "
            "importance={8} />"
        )
        fixed, fixes = apply_auto_fixes(tsx, [], {}, {})
        assert fixed.count("keywords=") == 1
        assert not any("Injected missing" in f for f in fixes)

    @pytest.mark.unit
    def test_dynamic_identifier_keywords_not_duplicated(self):
        tsx = "<ExepadImage keywords={imageKeywords} importance={8} />"
        fixed, fixes = apply_auto_fixes(tsx, [], {}, {})
        assert fixed.count("keywords=") == 1
        assert not any("Injected missing" in f for f in fixes)

    @pytest.mark.unit
    def test_dynamic_function_call_keywords_not_duplicated(self):
        tsx = '<ExepadImage keywords={buildKeywords("trainer", idx)} importance={8} />'
        fixed, fixes = apply_auto_fixes(tsx, [], {}, {})
        assert fixed.count("keywords=") == 1
        assert not any("Injected missing" in f for f in fixes)

    @pytest.mark.unit
    def test_short_keywords_padded(self):
        tsx = '<ExepadImage keywords="bakery hero" importance={8} />'
        fixed, fixes = apply_auto_fixes(tsx, [], {}, {})
        assert "bakery hero with detailed scene and natural lighting" in fixed
        assert any("Padded short" in f for f in fixes)
        # Verify padded keywords pass the 5-word minimum check
        errors = check_exepad_image_props(fixed)
        assert not any("word(s)" in e for e in errors)

    @pytest.mark.unit
    def test_four_word_keywords_padded(self):
        tsx = '<ExepadImage keywords="warm rustic bakery interior" importance={5} />'
        fixed, fixes = apply_auto_fixes(tsx, [], {}, {})
        assert "warm rustic bakery interior with detailed scene and natural lighting" in fixed

    @pytest.mark.unit
    def test_five_word_keywords_not_padded(self):
        tsx = '<ExepadImage keywords="cozy bakery interior warm lighting" importance={8} />'
        fixed, fixes = apply_auto_fixes(tsx, [], {}, {})
        assert 'keywords="cozy bakery interior warm lighting"' in fixed
        assert not any("Padded" in f for f in fixes)

    @pytest.mark.unit
    def test_missing_keywords_and_importance_both_fixed(self):
        tsx = '<ExepadImage alt="team photo in modern office" className="rounded" />'
        fixed, fixes = apply_auto_fixes(tsx, [], {}, {})
        assert 'keywords="team photo in modern office"' in fixed
        assert "importance={5}" in fixed

    @pytest.mark.unit
    def test_spread_based_tag_not_modified(self):
        tsx = '<ExepadImage {...item.image} width={200} height={200} className="rounded" />'
        fixed, fixes = apply_auto_fixes(tsx, [], {}, {})
        assert fixed == tsx
        assert not any("Injected missing" in f for f in fixes)
        assert not any("importance" in f.lower() for f in fixes)

    @pytest.mark.unit
    def test_spread_based_tag_no_validation_error(self):
        tsx = '<ExepadImage {...item.image} width={200} height={200} className="rounded" />'
        errors = check_exepad_image_props(tsx)
        assert len(errors) == 0

    @pytest.mark.unit
    def test_spread_with_explicit_keywords_still_validated(self):
        """If a spread tag also has explicit keywords, validate those."""
        tsx = '<ExepadImage {...item.image} keywords="ab" importance={5} />'
        # Spread tags are fully skipped — even if they have explicit keywords
        errors = check_exepad_image_props(tsx)
        assert len(errors) == 0


class TestFixRawImgToExepadImage:
    """Tests for _fix_raw_img_to_exepad_image()."""

    @pytest.mark.unit
    def test_converts_placeholder_img(self):
        tsx = '<img src="__PLACEHOLDER__" alt="modern office lobby" className="w-full h-64" />'
        fixes = []
        result = _fix_raw_img_to_exepad_image(tsx, fixes)
        assert "<ExepadImage" in result
        assert 'keywords="modern office lobby"' in result
        assert "importance={5}" in result
        assert len(fixes) == 1

    @pytest.mark.unit
    def test_converts_empty_src(self):
        tsx = '<img src="" alt="sunset" className="rounded" />'
        fixes = []
        result = _fix_raw_img_to_exepad_image(tsx, fixes)
        assert "<ExepadImage" in result
        assert 'keywords="sunset"' in result

    @pytest.mark.unit
    def test_preserves_non_placeholder(self):
        tsx = '<img src="https://storage.googleapis.com/img.jpg" alt="real" />'
        fixes = []
        result = _fix_raw_img_to_exepad_image(tsx, fixes)
        # Should NOT be converted — has a real URL
        assert "<ExepadImage" not in result
        assert len(fixes) == 0


class TestAutoFixBareUseApp:
    """Tests for the bare useApp() destructuring auto-fix in apply_auto_fixes()."""

    @pytest.mark.unit
    def test_destructured_bare_rewritten(self):
        tsx = "const { count, setState } = useApp();"
        fixed, fixes = apply_auto_fixes(tsx, [], {}, [], expected_component_name="")
        assert "const count = useApp(s => s.count);" in fixed
        assert "const setState = useApp(s => s.setState);" in fixed
        assert any("bare useApp()" in f for f in fixes)

    @pytest.mark.unit
    def test_selector_call_unchanged(self):
        tsx = "const count = useApp(s => s.count);"
        fixed, fixes = apply_auto_fixes(tsx, [], {}, [], expected_component_name="")
        assert tsx in fixed


class TestBrokenOptionalChain:
    """Tests for check_broken_optional_chain()."""

    @pytest.mark.unit
    def test_broken_chain_detected(self):
        tsx = "{user?.email?.[0].toUpperCase()}"
        warnings = check_broken_optional_chain(tsx)
        assert len(warnings) == 1
        assert "toUpperCase" in warnings[0]

    @pytest.mark.unit
    def test_complete_chain_not_flagged(self):
        tsx = "{user?.email?.[0]?.toUpperCase()}"
        warnings = check_broken_optional_chain(tsx)
        assert warnings == []

    @pytest.mark.unit
    def test_no_optional_chain_not_flagged(self):
        """Regular array access + method call is not flagged."""
        tsx = "items[0].toString()"
        warnings = check_broken_optional_chain(tsx)
        assert warnings == []


# ---------------------------------------------------------------------------
# check_undeclared_jsx_handlers — Issue 2: onClick={saveAllAllDirty} typo
# ---------------------------------------------------------------------------


class TestAutoFixUseModelNull:
    """Tests for useModel null-safety auto-fix in apply_auto_fixes()."""

    @pytest.mark.unit
    def test_data_map_gets_null_guard(self):
        tsx = """
import { React, useModel, LightDOMContainer } from '@exepad/sdk';
function MyComponent() {
  const { data: courses } = useModel("courses");
  return <LightDOMContainer>{courses.map(c => <div>{c.name}</div>)}</LightDOMContainer>;
}
export default MyComponent;
"""
        fixed, fixes = apply_auto_fixes(tsx, [{"name": "courses"}], {}, {})
        assert "(courses ?? [])" in fixed
        assert any("null guard" in f for f in fixes)

    @pytest.mark.unit
    def test_data_length_gets_null_guard(self):
        tsx = """
import { React, useModel, LightDOMContainer } from '@exepad/sdk';
function MyComponent() {
  const { data: items } = useModel("items");
  if (items.length > 0) { return null; }
  return <LightDOMContainer />;
}
export default MyComponent;
"""
        fixed, fixes = apply_auto_fixes(tsx, [{"name": "items"}], {}, {})
        assert "(items ?? []).length" in fixed

    @pytest.mark.unit
    def test_already_guarded_not_double_wrapped(self):
        tsx = """
import { React, useModel, LightDOMContainer } from '@exepad/sdk';
function MyComponent() {
  const { data: courses } = useModel("courses");
  return <LightDOMContainer>{(courses ?? []).map(c => c.name)}</LightDOMContainer>;
}
export default MyComponent;
"""
        fixed, fixes = apply_auto_fixes(tsx, [{"name": "courses"}], {}, {})
        # Should not add another wrapper
        assert fixed.count("courses ?? []") == 1


class TestAutoFixSdkHookNullable:
    """Tests for SDK hook nullable field auto-fix."""

    @pytest.mark.unit
    def test_destructured_email_gets_optional_chain(self):
        tsx = """
import { React, useCurrentUser, LightDOMContainer } from '@exepad/sdk';
function MyComponent() {
  const { email } = useCurrentUser();
  return <LightDOMContainer><span>{email.toUpperCase()}</span></LightDOMContainer>;
}
export default MyComponent;
"""
        fixed, fixes = apply_auto_fixes(tsx, [], {}, {})
        assert "email?." in fixed
        assert any("optional chaining" in f for f in fixes)

    @pytest.mark.unit
    def test_var_bound_user_name_gets_optional_chain(self):
        tsx = """
import { React, useCurrentUser, LightDOMContainer } from '@exepad/sdk';
function MyComponent() {
  const user = useCurrentUser();
  return <LightDOMContainer><span>{user.name.split(' ')[0]}</span></LightDOMContainer>;
}
export default MyComponent;
"""
        fixed, fixes = apply_auto_fixes(tsx, [], {}, {})
        assert "user.name?.split" in fixed
        assert "user.name.split" not in fixed
        assert any("user.name" in f for f in fixes)

    @pytest.mark.unit
    def test_var_bound_user_email_gets_optional_chain(self):
        tsx = """
import { React, useCurrentUser, LightDOMContainer } from '@exepad/sdk';
function MyComponent() {
  const current = useCurrentUser();
  return <LightDOMContainer><span>{current.email.toUpperCase()}</span></LightDOMContainer>;
}
export default MyComponent;
"""
        fixed, fixes = apply_auto_fixes(tsx, [], {}, {})
        assert "current.email?.toUpperCase" in fixed
        assert "current.email.toUpperCase" not in fixed
        assert any("current.email" in f for f in fixes)

    @pytest.mark.unit
    def test_var_bound_already_safe_not_modified(self):
        tsx = """
import { React, useCurrentUser, LightDOMContainer } from '@exepad/sdk';
function MyComponent() {
  const user = useCurrentUser();
  return <LightDOMContainer><span>{user.name?.split(' ')[0] ?? 'Guest'}</span></LightDOMContainer>;
}
export default MyComponent;
"""
        fixed, fixes = apply_auto_fixes(tsx, [], {}, {})
        # Already safe — no duplicate ?. added
        assert fixed.count("user.name?.split") == 1
        assert "user.name?.?.split" not in fixed


class TestAutoFixBrokenOptionalChain:
    """Tests for broken optional chain auto-fix."""

    @pytest.mark.unit
    def test_broken_chain_fixed(self):
        tsx = """
import { React, useCurrentUser, LightDOMContainer } from '@exepad/sdk';
function MyComponent() {
  const user = useCurrentUser();
  return <LightDOMContainer>{user?.email?.[0].toUpperCase()}</LightDOMContainer>;
}
export default MyComponent;
"""
        fixed, fixes = apply_auto_fixes(tsx, [], {}, {})
        assert "?.[0]?.toUpperCase()" in fixed
        assert any("broken optional chain" in f.lower() for f in fixes)

    @pytest.mark.unit
    def test_complete_chain_not_modified(self):
        tsx = """
import { React, LightDOMContainer } from '@exepad/sdk';
function MyComponent() {
  return <LightDOMContainer>{user?.email?.[0]?.toUpperCase()}</LightDOMContainer>;
}
export default MyComponent;
"""
        fixed, _ = apply_auto_fixes(tsx, [], {}, {})
        assert fixed.count("?.[0]?.toUpperCase()") == 1


class TestAutoFixUndeclaredHandler:
    """Tests for undeclared JSX handler fuzzy-fix."""

    @pytest.mark.unit
    def test_typo_handler_fixed(self):
        tsx = """
import { React, LightDOMContainer } from '@exepad/sdk';
function MyComponent() {
  const saveAllDirty = async () => {};
  return <LightDOMContainer><button onClick={saveAllAllDirty}>Save</button></LightDOMContainer>;
}
export default MyComponent;
"""
        fixed, fixes = apply_auto_fixes(tsx, [], {}, {})
        assert "onClick={saveAllDirty}" in fixed
        assert any("saveAllAllDirty" in f for f in fixes)


class TestAutoFixInvalidIcon:
    """Unknown Icons.X must never block generation — auto-fixer replaces
    them with a safe fallback (Icons.Circle) so the component still renders.
    Regression: public_id efdxlu81 failed generation because the LLM used
    an uncurated gym icon and the validator's 'did you mean' suggestion
    couldn't guide the retry. Dumbbell / Weight have since been added to
    the curated set, so this test uses Barbell (a real gym term that is
    NOT a lucide icon) as a stand-in for the unknown-icon case."""

    @pytest.mark.unit
    def test_unknown_icon_replaced_with_fallback(self):
        tsx = '<Icons.Barbell className="h-4 w-4" />'
        fixed, fixes = apply_auto_fixes(tsx, [], {}, {})
        assert "Icons.Barbell" not in fixed
        assert "Icons.Circle" in fixed
        assert any("Barbell" in f and "fallback" in f for f in fixes)

    @pytest.mark.unit
    def test_close_typo_still_matched(self):
        tsx = "<Icons.Hosue />"
        fixed, fixes = apply_auto_fixes(tsx, [], {}, {})
        assert "Icons.House" in fixed
        assert any("Hosue" in f and "Typo" in f for f in fixes)

    @pytest.mark.unit
    def test_valid_icon_untouched(self):
        tsx = "<Icons.Search /><Icons.Menu />"
        fixed, fixes = apply_auto_fixes(tsx, [], {}, {})
        assert "Icons.Search" in fixed
        assert "Icons.Menu" in fixed
        assert not any("Icons.Search" in f or "Icons.Menu" in f for f in fixes)

    @pytest.mark.unit
    def test_fixed_tsx_passes_icon_check(self):
        from main_agent.services.validation.tsx_ast import (
            AstContext,
            parse_tsx,
            run_rules,
            source_bytes,
        )
        from main_agent.services.validation.tsx_ast.rules.component_refs import (
            IconsUnknownRule,
        )

        # Dumbbell + Weight are now curated; Barbell stays as an unknown case.
        tsx = "<Icons.Dumbbell /><Icons.Barbell /><Icons.Weight />"
        fixed, _ = apply_auto_fixes(tsx, [], {}, {})
        tree = parse_tsx(fixed)
        ctx = AstContext(tsx=fixed, source_buf=source_bytes(fixed), tree=tree)
        findings = run_rules(ctx, [IconsUnknownRule()])
        assert findings == []


class TestTeamPortraitKeywords:
    """Tests for check_team_portrait_keywords()."""

    @pytest.mark.unit
    def test_action_verb_in_team_keywords_warns(self):
        from main_agent.services.validation.semantic_validator import (
            check_team_portrait_keywords,
        )

        tsx = """
const team = [
    {
        name: "Marcus Miller",
        role: "Lead Cellarman",
        image: { keywords: "candid portrait male brewery worker checking equipment", importance: 6 }
    }
];
"""
        warnings = check_team_portrait_keywords(tsx)
        assert len(warnings) == 1
        assert "checking" in warnings[0]

    @pytest.mark.unit
    def test_clean_portrait_keywords_pass(self):
        from main_agent.services.validation.semantic_validator import (
            check_team_portrait_keywords,
        )

        tsx = """
const team = [
    { name: "Sara Hill", role: "Founder", image: { keywords: "professional portrait female founder", importance: 6 } }
];
"""
        warnings = check_team_portrait_keywords(tsx)
        assert len(warnings) == 0

    @pytest.mark.unit
    def test_non_team_objects_ignored(self):
        from main_agent.services.validation.semantic_validator import (
            check_team_portrait_keywords,
        )

        tsx = """
const beers = [
    { name: "Hop Crusher", style: "IPA", image: { keywords: "amber pint with foam head" } }
];
"""
        warnings = check_team_portrait_keywords(tsx)
        assert len(warnings) == 0


class TestPortraitKeywordNormalizer:
    """Tests for codefocus_image_resolver._normalize_portrait_keywords."""

    @pytest.mark.unit
    def test_strips_action_verbs_for_portrait(self):
        from main_agent.agents.orchestrator.app_types.webapp.services.codefocus_image_resolver import (
            _normalize_portrait_keywords,
        )

        normalized = _normalize_portrait_keywords(
            "candid portrait male brewery worker checking equipment", "portrait"
        )
        assert "checking" not in normalized
        assert "portrait" in normalized

    @pytest.mark.unit
    def test_preserves_landscape_keywords(self):
        from main_agent.agents.orchestrator.app_types.webapp.services.codefocus_image_resolver import (
            _normalize_portrait_keywords,
        )

        original = "team checking equipment in workshop"
        assert _normalize_portrait_keywords(original, "landscape") == original

    @pytest.mark.unit
    def test_injects_portrait_token_when_missing(self):
        from main_agent.agents.orchestrator.app_types.webapp.services.codefocus_image_resolver import (
            _normalize_portrait_keywords,
        )

        normalized = _normalize_portrait_keywords("male brewer with apron", "portrait")
        assert normalized.split()[0] == "portrait"


class TestStatusStyleMapCase:
    """Tests for check_status_style_map_case()."""

    @pytest.mark.unit
    def test_title_case_status_keys_detected(self):
        from main_agent.services.validation.semantic_validator import (
            check_status_style_map_case,
        )

        tsx = """
const styles = {
    Paid: "bg-primary/10 text-primary",
    Pending: "bg-secondary/10 text-secondary",
    Overdue: "bg-error/10 text-error",
    Draft: "bg-surface text-on-surface",
};
"""
        warnings = check_status_style_map_case(tsx)
        assert len(warnings) == 1
        assert "title-case" in warnings[0]
        assert "lowercase" in warnings[0]

    @pytest.mark.unit
    def test_lowercase_keys_pass(self):
        from main_agent.services.validation.semantic_validator import (
            check_status_style_map_case,
        )

        tsx = """
const styles = {
    paid: "bg-primary/10 text-primary",
    pending: "bg-secondary/10 text-secondary",
    draft: "bg-surface text-on-surface",
};
"""
        warnings = check_status_style_map_case(tsx)
        assert len(warnings) == 0

    @pytest.mark.unit
    def test_single_title_case_key_ignored(self):
        from main_agent.services.validation.semantic_validator import (
            check_status_style_map_case,
        )

        tsx = """const config = { Paid: true, amount: 100 };"""
        warnings = check_status_style_map_case(tsx)
        assert len(warnings) == 0

    @pytest.mark.unit
    def test_auto_fix_lowercases_status_keys(self):
        tsx = """import { React } from '@exepad/sdk';
function StatusBadge({ status }) {
  const styles = {
    Paid: "bg-primary/10",
    Pending: "bg-secondary/10",
    Draft: "bg-surface",
  };
  return <span className={styles[status]}>{status}</span>;
}
export default StatusBadge;
"""
        fixed, fixes = apply_auto_fixes(tsx, [], {}, {})
        assert "paid" in fixed
        assert "pending" in fixed
        assert "draft" in fixed
        assert any("Lowercased" in f for f in fixes)


class TestDialogDescriptionAutoFixInjection:
    """Tests for the DialogDescription auto-fix (detection lives in
    tests/unit/validation/tsx_ast/test_component_a11y.py)."""

    @pytest.mark.unit
    def test_auto_fix_adds_dialog_description(self):
        tsx = """import { React, DialogContent, DialogTitle } from '@exepad/sdk';
function MyModal() {
  return (
    <DialogContent className="sm:max-w-md">
      <DialogTitle>Title</DialogTitle>
    </DialogContent>
  );
}
export default MyModal;
"""
        fixed, fixes = apply_auto_fixes(tsx, [], {}, {})
        assert "<DialogDescription" in fixed
        assert 'className="sr-only"' in fixed
        assert "DialogDescription" in fixed.split("from '@exepad/sdk'")[0]
        assert any("DialogDescription" in f for f in fixes)


class TestSdkImportCompletenessAutoFix:
    """Tests for the DialogDescription auto-fix (AST rule coverage for the
    detection side lives in tests/unit/validation/tsx_ast/test_component_jsx.py)."""

    @pytest.mark.unit
    def test_auto_fix_adds_missing_dialog_description_import(self):
        """Auto-fix should add DialogDescription import when used but not imported."""
        tsx = """import { React, Dialog, DialogContent, DialogTitle } from '@exepad/sdk';
function MyModal() {
  return (
    <DialogContent>
      <DialogTitle>Title</DialogTitle>
      <DialogDescription className="sr-only">Desc</DialogDescription>
    </DialogContent>
  );
}
export default MyModal;
"""
        fixed, fixes = apply_auto_fixes(tsx, [], {}, {})
        assert "DialogDescription" in fixed.split("from '@exepad/sdk'")[0]
        assert any("DialogDescription" in f for f in fixes)


class TestLowContrastTextClassFix:
    """text-{gray|slate|zinc|neutral|stone}-{300|400} must be rewritten to -600."""

    def test_text_gray_400_is_rewritten(self):
        tsx = '<p className="text-gray-400">Hello</p>'
        fixed, fixes = apply_auto_fixes(tsx, [], {}, {})
        assert "text-gray-600" in fixed
        assert "text-gray-400" not in fixed
        assert any("Contrast" in f for f in fixes)

    def test_text_slate_300_is_rewritten(self):
        tsx = '<div className="text-slate-300">dim</div>'
        fixed, fixes = apply_auto_fixes(tsx, [], {}, {})
        assert "text-slate-600" in fixed
        assert "text-slate-300" not in fixed
        assert any("Contrast" in f for f in fixes)

    def test_multiple_classes_rewritten(self):
        tsx = """
function X() {
  return (
    <>
      <p className="text-gray-400">a</p>
      <span className="text-zinc-300 mr-2">b</span>
      <label className="text-neutral-400">c</label>
    </>
  );
}
"""
        fixed, fixes = apply_auto_fixes(tsx, [], {}, {})
        assert fixed.count("-600") >= 3
        assert "text-gray-400" not in fixed
        assert "text-zinc-300" not in fixed
        assert "text-neutral-400" not in fixed
        msg = next(f for f in fixes if "Contrast" in f)
        assert "3" in msg

    def test_text_500_is_preserved(self):
        """text-gray-500 usually passes AA and should not be rewritten."""
        tsx = '<p className="text-gray-500">still readable</p>'
        fixed, fixes = apply_auto_fixes(tsx, [], {}, {})
        assert "text-gray-500" in fixed
        assert not any("Contrast" in f for f in fixes)

    def test_bg_and_border_classes_untouched(self):
        """Only text-* classes are rewritten — backgrounds/borders are left alone."""
        tsx = '<div className="bg-gray-300 border-gray-400">x</div>'
        fixed, fixes = apply_auto_fixes(tsx, [], {}, {})
        assert "bg-gray-300" in fixed
        assert "border-gray-400" in fixed
        assert not any("Contrast" in f for f in fixes)

    def test_no_false_positive_on_unrelated_classes(self):
        tsx = '<div className="p-4 flex items-center">plain</div>'
        fixed, fixes = apply_auto_fixes(tsx, [], {}, {})
        assert fixed == tsx
        assert not any("Contrast" in f for f in fixes)

    def test_dark_mode_variant_is_preserved(self):
        """CRITICAL: dark:text-gray-400 on dark bg must NOT be rewritten
        to -600 (which would ruin dark-mode contrast)."""
        tsx = '<p className="text-gray-800 dark:text-gray-400">x</p>'
        fixed, fixes = apply_auto_fixes(tsx, [], {}, {})
        assert "dark:text-gray-400" in fixed
        assert not any("Contrast" in f for f in fixes)

    def test_hover_variant_is_preserved(self):
        tsx = '<a className="text-gray-800 hover:text-gray-400">x</a>'
        fixed, fixes = apply_auto_fixes(tsx, [], {}, {})
        assert "hover:text-gray-400" in fixed

    def test_responsive_variant_is_preserved(self):
        tsx = '<div className="text-gray-800 md:text-slate-300">x</div>'
        fixed, fixes = apply_auto_fixes(tsx, [], {}, {})
        assert "md:text-slate-300" in fixed

    def test_bare_class_next_to_variant_is_still_fixed(self):
        """Bare text-gray-400 must still be rewritten even when a dark: variant
        exists alongside it."""
        tsx = '<p className="text-gray-400 dark:text-gray-400">x</p>'
        fixed, fixes = apply_auto_fixes(tsx, [], {}, {})
        # Bare one got rewritten…
        assert "text-gray-600 dark:text-gray-400" in fixed
        assert any("Contrast" in f for f in fixes)


class TestExepadImageDimensions:
    """check_exepad_image_dimensions — enforces required width/height for CLS."""

    @pytest.mark.unit
    def test_missing_width_is_error(self):
        tsx = (
            '<ExepadImage keywords="modern office lobby with plants" '
            "importance={8} height={600} />"
        )
        errors = check_exepad_image_dimensions(tsx)
        assert any("missing required `width`" in e for e in errors)

    @pytest.mark.unit
    def test_missing_height_is_error(self):
        tsx = (
            '<ExepadImage keywords="modern office lobby with plants" '
            "importance={8} width={800} />"
        )
        errors = check_exepad_image_dimensions(tsx)
        assert any("missing required `height`" in e for e in errors)

    @pytest.mark.unit
    def test_oversized_width_is_error(self):
        tsx = (
            '<ExepadImage keywords="modern office lobby with plants" '
            "importance={8} width={1920} height={1080} />"
        )
        errors = check_exepad_image_dimensions(tsx)
        assert any("too large for mobile" in e for e in errors)

    @pytest.mark.unit
    def test_well_formed_tag_passes(self):
        tsx = (
            '<ExepadImage keywords="modern office lobby with plants" '
            "importance={8} width={800} height={600} />"
        )
        assert check_exepad_image_dimensions(tsx) == []

    @pytest.mark.unit
    def test_spread_tag_skipped(self):
        # Spread tags get props from the object — no error
        tsx = '<ExepadImage {...member.image} className="w-32 h-32" />'
        assert check_exepad_image_dimensions(tsx) == []

    @pytest.mark.unit
    def test_jsx_expression_width_height_identifiers(self):
        """Dynamic `width={W}` / `height={H}` must not flag as missing."""
        tsx = (
            '<ExepadImage keywords="modern office lobby with natural light" '
            "importance={8} width={BOX_W} height={BOX_H} />"
        )
        assert check_exepad_image_dimensions(tsx) == []


class TestExepadImagePropsWarningClassification:
    """Change #1: exepad_image_props + exepad_image_dimensions must be
    collected as warnings by run_semantic_checks so a missing keywords /
    dimensions prop can never fail the build."""

    @pytest.mark.unit
    def test_missing_keywords_is_warning_not_error(self):
        tsx = (
            "import { ExepadImage } from '@exepad/sdk';\n"
            "export default function MissingKwContent() {\n"
            '  return <ExepadImage importance={8} width={800} height={600} className="w-full" />;\n'
            "}\n"
        )
        result = run_semantic_checks(tsx, [], {}, [], expected_component_name="MissingKwContent")
        assert result.valid, f"expected valid, got errors={result.errors}"
        assert any("keywords" in w for w in result.warnings)
        assert not any("keywords" in e for e in result.errors)

    @pytest.mark.unit
    def test_missing_dimensions_is_warning_not_error(self):
        tsx = (
            "import { ExepadImage } from '@exepad/sdk';\n"
            "export default function MissingDimContent() {\n"
            '  return <ExepadImage keywords="modern office lobby with natural light" importance={8} />;\n'
            "}\n"
        )
        result = run_semantic_checks(tsx, [], {}, [], expected_component_name="MissingDimContent")
        assert result.valid, f"expected valid, got errors={result.errors}"
        assert any("width" in w or "height" in w for w in result.warnings)


# Direct-call tests for the migrated heading_order and button_aria_label
# checks moved to tests/unit/validation/tsx_ast/test_component_a11y.py.


class TestCheckAnimateInWithBareDuration:
    """Tests for check_animate_in_with_bare_duration() — flags `animate-in ... duration-N`
    without `transition-*`, which implicitly enables `transition: all` via Tailwind v4's
    bare `transition-duration` rule, causing first-paint layout shift on conditional
    re-renders (loading → loaded)."""

    @pytest.mark.unit
    def test_animate_in_with_bare_duration_flagged(self):
        tsx = '<div className="flex flex-col p-6 lg:p-10 animate-in fade-in-0 duration-500">x</div>'
        warnings = check_animate_in_with_bare_duration(tsx)
        assert len(warnings) == 1
        assert "transition: all" in warnings[0]

    @pytest.mark.unit
    def test_animate_out_with_bare_duration_flagged(self):
        tsx = '<div className="animate-out fade-out-0 duration-300">x</div>'
        warnings = check_animate_in_with_bare_duration(tsx)
        assert len(warnings) == 1

    @pytest.mark.unit
    def test_animate_in_with_arbitrary_duration_flagged(self):
        tsx = '<div className="animate-in fade-in-0 duration-[700ms]">x</div>'
        warnings = check_animate_in_with_bare_duration(tsx)
        assert len(warnings) == 1

    @pytest.mark.unit
    def test_animate_in_paired_with_transition_not_flagged(self):
        # Explicit transition opts in to the implicit-all behavior — caller's choice.
        tsx = '<div className="animate-in fade-in-0 transition-all duration-500">x</div>'
        warnings = check_animate_in_with_bare_duration(tsx)
        assert warnings == []

    @pytest.mark.unit
    def test_animate_in_with_inline_animation_duration_not_flagged(self):
        # Canonical pattern from agent_docs — uses inline style, no `duration-N`.
        tsx = (
            '<div className="animate-in fade-in-0" '
            "style={{ animationDuration: 'var(--animation-duration)' }}>x</div>"
        )
        warnings = check_animate_in_with_bare_duration(tsx)
        assert warnings == []

    @pytest.mark.unit
    def test_data_state_gated_duration_not_flagged(self):
        # shadcn pattern — data-[state=open]:duration-N only fires on state change.
        tsx = (
            '<div className="data-[state=open]:animate-in data-[state=open]:fade-in-0 '
            'data-[state=open]:duration-500">x</div>'
        )
        warnings = check_animate_in_with_bare_duration(tsx)
        assert warnings == []

    @pytest.mark.unit
    def test_animate_in_without_duration_not_flagged(self):
        tsx = '<div className="animate-in fade-in-0">x</div>'
        warnings = check_animate_in_with_bare_duration(tsx)
        assert warnings == []

    @pytest.mark.unit
    def test_duration_without_animate_not_flagged(self):
        # `duration-N` paired with `transition-*` is correct usage.
        tsx = '<div className="transition-colors duration-500 hover:bg-primary">x</div>'
        warnings = check_animate_in_with_bare_duration(tsx)
        assert warnings == []

    @pytest.mark.unit
    def test_template_literal_classname_flagged(self):
        tsx = "<div className={`flex animate-in fade-in-0 duration-500`}>x</div>"
        warnings = check_animate_in_with_bare_duration(tsx)
        assert len(warnings) == 1

    @pytest.mark.unit
    def test_animate_in_with_arbitrary_animation_duration_not_flagged(self):
        # `[animation-duration:Xms]` sets only animation-duration, not
        # transition-duration — so no implicit `transition: all` is created.
        # The checker MUST NOT flag this form (it's the post-auto-fix shape
        # that the polishing fixer rewrites bare `duration-N` to).
        tsx = '<div className="animate-in fade-in-0 [animation-duration:200ms]">x</div>'
        warnings = check_animate_in_with_bare_duration(tsx)
        assert warnings == []

    @pytest.mark.unit
    def test_arbitrary_animation_duration_alone_not_flagged(self):
        # Even with no `animate-in`, `[animation-duration:Xms]` is harmless
        # standalone — confirms the regex anchors on `\bduration-` not
        # `animation-duration:`.
        tsx = '<div className="[animation-duration:500ms]">x</div>'
        warnings = check_animate_in_with_bare_duration(tsx)
        assert warnings == []


class TestAutoFixAnimateInBareDuration:
    """Tests for the auto-fix that rewrites `duration-N` → `[animation-duration:Nms]`
    when used with `animate-in`/`animate-out` and no `transition-*`."""

    @pytest.mark.unit
    def test_rewrites_duration_500_with_animate_in(self):
        tsx = (
            'function C() { return <div className="flex flex-col p-6 lg:p-10 '
            'animate-in fade-in-0 duration-500">x</div>; }'
        )
        fixed, fixes = apply_auto_fixes(tsx, [], {}, {})
        assert "duration-500" not in fixed
        assert "[animation-duration:500ms]" in fixed
        assert any("animate-in" in f and "[animation-duration" in f for f in fixes)

    @pytest.mark.unit
    def test_rewrites_arbitrary_duration_with_animate_in(self):
        tsx = (
            'function C() { return <div className="animate-in fade-in-0 '
            'duration-[700ms]">x</div>; }'
        )
        fixed, _ = apply_auto_fixes(tsx, [], {}, {})
        assert "duration-[700ms]" not in fixed
        assert "[animation-duration:700ms]" in fixed

    @pytest.mark.unit
    def test_preserves_data_state_gated_duration(self):
        tsx = (
            'function C() { return <div className="data-[state=open]:animate-in '
            'data-[state=open]:duration-500 animate-in fade-in-0 duration-300">x</div>; }'
        )
        fixed, _ = apply_auto_fixes(tsx, [], {}, {})
        # Bare `duration-300` should be rewritten
        assert "[animation-duration:300ms]" in fixed
        # Data-state-gated `duration-500` should be preserved unchanged
        assert "data-[state=open]:duration-500" in fixed

    @pytest.mark.unit
    def test_does_not_rewrite_when_transition_present(self):
        tsx = (
            'function C() { return <div className="animate-in fade-in-0 '
            'transition-all duration-500">x</div>; }'
        )
        fixed, _ = apply_auto_fixes(tsx, [], {}, {})
        # Caller opted into explicit transition — leave duration-500 alone.
        assert "duration-500" in fixed
        assert "[animation-duration:500ms]" not in fixed

    @pytest.mark.unit
    def test_does_not_rewrite_duration_without_animate(self):
        tsx = (
            'function C() { return <div className="transition-colors '
            'duration-500 hover:bg-primary">x</div>; }'
        )
        fixed, _ = apply_auto_fixes(tsx, [], {}, {})
        assert "duration-500" in fixed
        assert "[animation-duration" not in fixed

    @pytest.mark.unit
    def test_template_literal_classname_rewritten(self):
        tsx = (
            "function C() { return <div className={`flex animate-in "
            "fade-in-0 duration-500`}>x</div>; }"
        )
        fixed, _ = apply_auto_fixes(tsx, [], {}, {})
        assert "duration-500" not in fixed
        assert "[animation-duration:500ms]" in fixed

    @pytest.mark.unit
    def test_does_not_touch_existing_arbitrary_animation_duration(self):
        # Idempotency: TSX already in the post-fix shape must round-trip
        # unchanged. The styles-only escalation re-runs the fixer over
        # rewritten components, and we don't want a second pass to mangle
        # `[animation-duration:Xms]` (which contains the literal substring
        # `duration-` but NOT the `\bduration-` pattern the regex anchors on).
        tsx = (
            'function C() { return <div className="animate-in fade-in-0 '
            '[animation-duration:200ms]">x</div>; }'
        )
        fixed, fixes = apply_auto_fixes(tsx, [], {}, {})
        assert "[animation-duration:200ms]" in fixed
        # No animate-in-related fixes should fire.
        assert not any("animate-in" in f for f in fixes)


class TestAutoFixBareSlugNavigation:
    """Rewriting bare-slug navigation paths to absolute-within-app paths.

    The SDK's ``navigate()`` only prepends the app basePath when the path
    starts with ``/``. Bare slugs like ``"products"`` fall through and the
    browser resolves them relative to the current URL — so clicking "About
    Us" while on ``/a/preview-xxx/products`` goes to
    ``/a/preview-xxx/products/about-us`` (404). Leading ``/`` is mandatory.
    This auto-fix adds the slash for obvious nav-link patterns so both the
    anchor's ``href`` and the click handler's ``navigate()`` call work.
    """

    @pytest.mark.unit
    def test_bare_href_in_navlinks_array_rewritten(self):
        tsx = (
            "const navLinks = [\n"
            '  { label: "Home", href: "/" },\n'
            '  { label: "Products", href: "products" },\n'
            '  { label: "About", href: "about-us" },\n'
            "];"
        )
        fixed, fixes = apply_auto_fixes(tsx, [], {}, {})
        assert '"/products"' in fixed
        assert '"/about-us"' in fixed
        assert '"products"' not in fixed or "/products" in fixed
        assert any("Prepended leading '/'" in f for f in fixes)

    @pytest.mark.unit
    def test_bare_navigate_arg_rewritten(self):
        tsx = 'onClick={() => navigate("products")}'
        fixed, _ = apply_auto_fixes(tsx, [], {}, {})
        assert 'navigate("/products")' in fixed

    @pytest.mark.unit
    def test_absolute_href_left_alone(self):
        tsx = 'const links = [{ href: "/" }, { href: "/products" }];'
        fixed, fixes = apply_auto_fixes(tsx, [], {}, {})
        assert fixed == tsx
        assert not any("Prepended leading '/'" in f for f in fixes)

    @pytest.mark.unit
    def test_external_url_and_fragment_left_alone(self):
        tsx = (
            "const links = ["
            '{ href: "https://example.com" },'
            '{ href: "#section" },'
            '{ href: "mailto:x@y.com" },'
            "];"
        )
        fixed, _ = apply_auto_fixes(tsx, [], {}, {})
        assert "https://example.com" in fixed
        assert "#section" in fixed
        assert "mailto:x@y.com" in fixed

    @pytest.mark.unit
    def test_link_to_bare_slug_rewritten(self):
        tsx = '<Link to="contact">Contact</Link>'
        fixed, _ = apply_auto_fixes(tsx, [], {}, {})
        assert '<Link to="/contact">' in fixed

    @pytest.mark.unit
    def test_link_to_absolute_left_alone(self):
        tsx = '<Link to="/contact">Contact</Link>'
        fixed, _ = apply_auto_fixes(tsx, [], {}, {})
        assert fixed == tsx

    @pytest.mark.unit
    def test_non_link_to_attribute_left_alone(self):
        # Other JSX attributes called "to" (unusual but possible) should not
        # be touched. Only tags that start with <Link are scoped.
        tsx = '<animate attributeName="x" from="0" to="100" />'
        fixed, _ = apply_auto_fixes(tsx, [], {}, {})
        assert 'to="100"' in fixed  # numeric; regex only matches non-leading-/ strings

    @pytest.mark.unit
    def test_single_quoted_bare_navigate_rewritten(self):
        # Regression: the bare-slug fixer previously only covered double
        # quotes, so ``navigate('products')`` shipped unfixed. Both quote
        # styles must be normalised.
        tsx = "onClick={() => navigate('products')}"
        fixed, _ = apply_auto_fixes(tsx, [], {}, {})
        assert "navigate('/products')" in fixed

    @pytest.mark.unit
    def test_single_quoted_bare_link_to_rewritten(self):
        tsx = "<Link to='contact'>Contact</Link>"
        fixed, _ = apply_auto_fixes(tsx, [], {}, {})
        assert "<Link to='/contact'>" in fixed

    @pytest.mark.unit
    def test_bare_href_jsx_attribute_rewritten(self):
        # ``href="products"`` as a JSX attribute (not an object property)
        # must also be rewritten. Dynamic expressions ``href={foo}`` must
        # stay untouched because the regex excludes ``{`` at position one.
        tsx = '<a href="products">Products</a>' "<a href={dynamicSlug}>Dynamic</a>"
        fixed, _ = apply_auto_fixes(tsx, [], {}, {})
        assert 'href="/products"' in fixed
        assert "href={dynamicSlug}" in fixed

    @pytest.mark.unit
    def test_typo_fixer_does_not_strip_absolute_slash(self):
        # Regression: the typo fixer's fuzzy-match previously treated
        # ``/products`` as "unknown" because ``page_slugs`` stores bare
        # slugs (``products``) and rewrote it back to ``products`` —
        # undoing the bare-slug fix that ran earlier in the same pass.
        # With the slug-set normalisation, ``/products`` must be
        # recognised as valid and left alone.
        tsx = (
            "const navLinks = [\n"
            '  { label: "Products", href: "products" },\n'
            '  { label: "About", href: "about-us" },\n'
            "];\n"
            'onClick={() => navigate("products")}\n'
            "onClick={() => navigate('products')}"
        )
        fixed, fixes = apply_auto_fixes(
            tsx, [], {}, {}, page_slugs=["", "products", "about-us", "contact"]
        )
        # Absolute forms must survive.
        assert '"/products"' in fixed
        assert '"/about-us"' in fixed
        assert 'navigate("/products")' in fixed
        assert "navigate('/products')" in fixed
        # No regression log claiming "/products" → "products".
        assert not any(
            "navigate path typo" in f and "'/products'" in f and "'products'" in f for f in fixes
        )

    @pytest.mark.unit
    def test_typo_fixer_still_corrects_real_typo_to_absolute_form(self):
        # When the path is actually a typo (``productss``), the typo fixer
        # should rewrite to the canonical absolute form ``/products`` —
        # not the bare slug — so the SDK's basePath prepend works.
        tsx = 'onClick={() => navigate("/productss")}'
        fixed, fixes = apply_auto_fixes(
            tsx, [], {}, {}, page_slugs=["", "products", "about-us", "contact"]
        )
        assert 'navigate("/products")' in fixed
        assert any("navigate path typo" in f and "/products" in f for f in fixes)


class TestAutoFixSymmetricSdkImports:
    """Stripping imports the SDK doesn't actually export.

    The historical asymmetric pass ADDED missing imports when a PascalCase JSX
    tag matched the SDK catalog. The symmetric pass STRIPS imports that are
    NOT in the SDK catalog so the runtime module actually loads — otherwise
    the ES module raises ``SyntaxError: does not provide an export named X``
    and the whole component renders blank. Pairs with the ``Link`` regression
    in the HappyDoods Farm app (stitch.zip) — the LLM was instructed to use
    ``Link`` but the SDK did not export it.
    """

    @pytest.mark.unit
    def test_strips_unknown_sdk_import(self):
        # ``useQuery`` is not an Exepad SDK export.
        tsx = (
            'import { React, useModel, useQuery } from "@exepad/sdk";\n'
            "function C() { const { data } = useModel('x'); return <div>{data?.length}</div>; }"
        )
        fixed, fixes = apply_auto_fixes(tsx, [], {}, {})
        assert "useQuery" not in fixed
        assert "useModel" in fixed
        assert "React" in fixed
        assert any("Stripped unknown" in msg and "useQuery" in msg for msg in fixes)

    @pytest.mark.unit
    def test_strips_multiple_unknown_imports(self):
        tsx = (
            'import { React, Link, someHook, AnotherThing } from "@exepad/sdk";\n'
            "function C() { return <div>x</div>; }"
        )
        fixed, fixes = apply_auto_fixes(tsx, [], {}, {})
        # Link IS now an SDK export (shipped alongside the symmetric check),
        # so only the actually-unknown identifiers should be stripped.
        assert "someHook" not in fixed
        assert "AnotherThing" not in fixed
        assert "Link" in fixed
        stripped_msgs = [m for m in fixes if "Stripped unknown" in m]
        assert stripped_msgs
        assert any("someHook" in m for m in stripped_msgs)
        assert any("AnotherThing" in m for m in stripped_msgs)

    @pytest.mark.unit
    def test_all_valid_imports_left_alone(self):
        tsx = (
            'import { React, LightDOMContainer, useModel, navigate } from "@exepad/sdk";\n'
            "function C() { return <LightDOMContainer>x</LightDOMContainer>; }"
        )
        fixed, fixes = apply_auto_fixes(tsx, [], {}, {})
        assert "LightDOMContainer" in fixed
        assert "useModel" in fixed
        assert "navigate" in fixed
        assert not any("Stripped unknown" in m for m in fixes)


class TestAutoFixBakedRepoAssetSrc:
    """Rewriting leaked `/a/<uuid>/repo/assets/...` URLs → `__ASSET_IMG:` placeholders.

    The codefocus_image_resolver used to bake ``/a/{app_uuid}/repo/assets/...``
    URLs into TSX with the agent's internal ``app_uuid`` and the pre-optimization
    extension. The deploy pipeline serves under ``public_id`` with WebP
    extensions, so every such URL 404s. The auto-fix rewrites them to the
    ``__ASSET_IMG:{source_path}__`` placeholder that the backend resolves at
    deploy time. This is the defence-in-depth net for any future regression.
    """

    @pytest.mark.unit
    def test_baked_png_rewritten_to_placeholder(self):
        tsx = (
            '<ExepadImage src="/a/1ef1a6d6-f086-41e6-93e6-b259cacf0a76/repo/'
            'assets/imports/abc.png" keywords="x" />'
        )
        fixed, fixes = apply_auto_fixes(tsx, [], {}, {})
        assert "__ASSET_IMG:assets/imports/abc.png__" in fixed
        assert "/a/1ef1a6d6" not in fixed
        assert any("__ASSET_IMG" in msg for msg in fixes)

    @pytest.mark.unit
    def test_baked_short_id_rewritten_to_placeholder(self):
        tsx = '<ExepadImage src="/a/ynkeso1w/repo/assets/imports/hero.webp" ' 'keywords="hero" />'
        fixed, _ = apply_auto_fixes(tsx, [], {}, {})
        assert "__ASSET_IMG:assets/imports/hero.webp__" in fixed
        assert "/a/ynkeso1w/repo/assets" not in fixed

    @pytest.mark.unit
    def test_baked_images_path_also_rewritten(self):
        tsx = '<img src="/a/uid/repo/assets/images/team-jane.jpg" alt="Jane" />'
        fixed, _ = apply_auto_fixes(tsx, [], {}, {})
        assert "__ASSET_IMG:assets/images/team-jane.jpg__" in fixed

    @pytest.mark.unit
    def test_vendor_design_import_stripped_when_paired_with_placeholder(self):
        tsx = (
            '<ExepadImage src="/a/1ef1a6d6/repo/assets/imports/x.png" '
            'vendor="design_import" keywords="x" />'
        )
        fixed, _ = apply_auto_fixes(tsx, [], {}, {})
        assert "__ASSET_IMG:assets/imports/x.png__" in fixed
        # vendor attr should be removed since the deploy rewriter never emits it
        assert 'vendor="design_import"' not in fixed

    @pytest.mark.unit
    def test_stock_src_is_rewritten_to_placeholder(self):
        # Stock/blocked URLs in <ExepadImage> are now rewritten to
        # __PLACEHOLDER__ by the hallucinated-URL fixer (extended in 2026-05
        # to walk <ExepadImage> alongside <img>). The downstream image
        # resolver fills the placeholder with a licensed catalog asset.
        # The /a/.../repo/assets/ rewrite branch is unaffected — only the
        # external-host classification applies here.
        tsx = '<ExepadImage src="https://images.pexels.com/photos/42.jpg" ' 'keywords="field" />'
        fixed, _ = apply_auto_fixes(tsx, [], {}, {})
        assert "images.pexels.com" not in fixed
        assert "__PLACEHOLDER__" in fixed
        assert "__ASSET_IMG" not in fixed


class TestEnsureTailwindBootstrap:
    """Pre-compile safety net for the design-import LLM's theme.css.

    The design-import flow accepts whatever ``codefocus_style:theme.css``
    the LLM writes. That LLM (unlike DesignSystemBuilder) is not
    instructed to emit ``@import "tailwindcss"`` / ``@source
    "./components"``, so a stitch/claude-design bundle import can ship a
    theme.css that compiles to a ~800-byte utility-less stylesheet —
    every ``bg-primary`` / ``flex`` / ``text-6xl`` class in the
    components has no CSS rule and the app renders unstyled.

    ``_ensure_tailwind_bootstrap`` prepends the missing directives
    before Tailwind runs so the content scan always fires, regardless
    of which builder produced the theme.css. Landed as a defensive
    safety net after the HappyDoods Farm stitch import shipped broken.
    """

    @pytest.mark.unit
    def test_adds_all_missing_directives(self):
        from main_agent.services.validation.final_compile_gate import (
            _ensure_tailwind_bootstrap,
        )

        base_css = (
            '@import url("https://fonts.googleapis.com/css2?family=X");\n'
            "@theme { --color-primary: #000; }\n"
            "@layer base { body { font-family: sans-serif; } }\n"
        )
        fixed, added = _ensure_tailwind_bootstrap(base_css)
        assert added is True
        # The three bootstrap lines must appear before anything else.
        assert fixed.startswith('@import "tailwindcss";')
        assert '@import "tw-animate-css";' in fixed
        assert '@source "./components";' in fixed
        # Original content must still be present intact.
        assert "--color-primary" in fixed
        assert "@layer base" in fixed

    @pytest.mark.unit
    def test_preserves_input_when_all_present(self):
        from main_agent.services.validation.final_compile_gate import (
            _ensure_tailwind_bootstrap,
        )

        base_css = (
            "@layer exepad-app {\n"
            '  @import "tailwindcss";\n'
            '  @import "tw-animate-css";\n'
            '  @source "./components";\n'
            "}\n"
            "@theme { --color-primary: #000; }\n"
        )
        fixed, added = _ensure_tailwind_bootstrap(base_css)
        assert added is False
        assert fixed == base_css

    @pytest.mark.unit
    def test_adds_only_missing_directives(self):
        from main_agent.services.validation.final_compile_gate import (
            _ensure_tailwind_bootstrap,
        )

        # Input already has @import "tailwindcss" but missing the other two.
        base_css = '@import "tailwindcss";\n' "@theme { --color-primary: #000; }\n"
        fixed, added = _ensure_tailwind_bootstrap(base_css)
        assert added is True
        # Must not duplicate the existing @import "tailwindcss".
        assert fixed.count('@import "tailwindcss"') == 1
        # Must add the two missing ones.
        assert '@import "tw-animate-css";' in fixed
        assert '@source "./components";' in fixed


class TestCheckHeroImageContrast:
    """Tests for HeroImageContrastRule."""

    @pytest.mark.unit
    def test_busy_overlay_only_flagged(self):
        """Reservations pattern — bg-black/40 overlay alone, white H2, no image filter."""
        tsx = """<section className=\"relative h-[60vh] overflow-hidden\">
          <ExepadImage keywords=\"luxury bar lounge\" className=\"w-full h-full object-cover\" />
          <div className=\"absolute inset-0 bg-black/40 flex items-center justify-center\">
            <h2 className=\"font-headline text-7xl text-white\">Secure Your Table</h2>
          </div>
        </section>"""
        errors = check_hero_image_contrast(tsx)
        assert len(errors) == 1
        assert "light-text heading" in errors[0]

    @pytest.mark.unit
    def test_brightness_filter_passes(self):
        """Home pattern — brightness-[0.4] on image satisfies the rule alone."""
        tsx = """<section className=\"relative min-h-screen\">
          <ExepadImage keywords=\"hero\" className=\"w-full h-full object-cover brightness-[0.4]\" />
          <h1 className=\"text-white text-7xl\">The Soul of Italian Gastronomy</h1>
        </section>"""
        errors = check_hero_image_contrast(tsx)
        assert errors == []

    @pytest.mark.unit
    def test_strong_overlay_passes(self):
        """bg-black/50 overlay alone satisfies the rule."""
        tsx = """<section className=\"relative\">
          <ExepadImage keywords=\"hero\" className=\"w-full h-full object-cover\" />
          <div className=\"absolute inset-0 bg-black/60\" />
          <h1 className=\"text-white\">Big Title</h1>
        </section>"""
        errors = check_hero_image_contrast(tsx)
        assert errors == []

    @pytest.mark.unit
    def test_gradient_overlay_passes(self):
        tsx = """<section className=\"relative\">
          <ExepadImage keywords=\"hero\" className=\"w-full h-full object-cover\" />
          <div className=\"absolute inset-0 bg-gradient-to-b from-transparent to-black\" />
          <h2 className=\"text-white\">Heading</h2>
        </section>"""
        errors = check_hero_image_contrast(tsx)
        assert errors == []

    @pytest.mark.unit
    def test_no_light_text_heading_skipped(self):
        """Image background but heading uses normal token — not a hero pattern."""
        tsx = """<section className=\"relative\">
          <ExepadImage keywords=\"hero\" className=\"w-full h-full object-cover\" />
          <h2 className=\"text-on-surface\">Dark text heading</h2>
        </section>"""
        errors = check_hero_image_contrast(tsx)
        assert errors == []

    @pytest.mark.unit
    def test_non_relative_section_skipped(self):
        """Section without `relative` cannot be a stacked hero — skip."""
        tsx = """<section className=\"py-24\">
          <ExepadImage keywords=\"hero\" className=\"w-full object-cover\" />
          <h2 className=\"text-white\">Heading</h2>
        </section>"""
        errors = check_hero_image_contrast(tsx)
        assert errors == []


class TestPerRouteH1Rule:
    """Tests for PerRouteH1Rule."""

    @pytest.mark.unit
    def test_route_component_without_h1_warns(self):
        from main_agent.services.validation.tsx_ast.rules.component_route_h1 import (
            PerRouteH1Rule,
        )

        tsx = """function MenuContent() {
          return (
            <section>
              <h2>La Carta</h2>
              <h3>Antipasti</h3>
            </section>
          );
        }"""
        rule = PerRouteH1Rule()
        tree = parse_tsx(tsx)
        ctx = AstContext(
            tsx=tsx,
            source_buf=source_bytes(tsx),
            tree=tree,
            expected_export_name="MenuContent",
        )
        findings = list(rule.check(ctx))
        assert len(findings) == 1
        assert "MenuContent" in findings[0].message
        assert "no <h1>" in findings[0].message

    @pytest.mark.unit
    def test_route_component_with_h1_passes(self):
        from main_agent.services.validation.tsx_ast.rules.component_route_h1 import (
            PerRouteH1Rule,
        )

        tsx = """function HomeContent() {
          return (
            <section>
              <h1>Welcome</h1>
              <h2>Sub heading</h2>
            </section>
          );
        }"""
        rule = PerRouteH1Rule()
        tree = parse_tsx(tsx)
        ctx = AstContext(
            tsx=tsx,
            source_buf=source_bytes(tsx),
            tree=tree,
            expected_export_name="HomeContent",
        )
        assert list(rule.check(ctx)) == []

    @pytest.mark.unit
    def test_non_route_component_skipped(self):
        """A Card / Section / Dialog component without h1 is fine."""
        from main_agent.services.validation.tsx_ast.rules.component_route_h1 import (
            PerRouteH1Rule,
        )

        tsx = """function ProductCard() { return <div><h3>Card title</h3></div>; }"""
        rule = PerRouteH1Rule()
        tree = parse_tsx(tsx)
        ctx = AstContext(
            tsx=tsx,
            source_buf=source_bytes(tsx),
            tree=tree,
            expected_export_name="ProductCard",
        )
        assert list(rule.check(ctx)) == []

    @pytest.mark.unit
    def test_no_export_name_fails_open(self):
        from main_agent.services.validation.tsx_ast.rules.component_route_h1 import (
            PerRouteH1Rule,
        )

        tsx = """function MenuContent() { return <h2>nope</h2>; }"""
        rule = PerRouteH1Rule()
        tree = parse_tsx(tsx)
        ctx = AstContext(
            tsx=tsx,
            source_buf=source_bytes(tsx),
            tree=tree,
            expected_export_name=None,
        )
        assert list(rule.check(ctx)) == []
