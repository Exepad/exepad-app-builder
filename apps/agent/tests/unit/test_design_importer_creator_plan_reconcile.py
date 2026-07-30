"""Unit tests for Wave 3 / Track F design-importer hardening.

Covers:
  * F.1 — `runner.py` always uses `_default_chrome_name` / `_default_content_name`
          instead of falling back to the LLM's `name` field.
  * F.2 — `_LenientCreatorOutput` (DesignImporter output) NFC-normalizes /
          strips Cyrillic confusables and rejects gibberish
          `app_building_plan_artifact` values without aborting.

F.3 (workflow-level app_name reconciliation) is exercised by the
end-to-end design-import e2e suite — covering it here would require
mocking the entire workflow context. The reconciliation block is small
and self-contained; the e2e regression is the load-bearing test.
"""

from __future__ import annotations

import pytest

from main_agent.agents.orchestrator.importers.tools.decomposition.runner import (
    _default_chrome_name,
    _default_content_name,
)
from main_agent.agents.orchestrator.importers.tools.decomposition.plan import (
    _DesignImportComponentPlanStub,
    _LenientCreatorOutput,
    _strip_unicode_confusables,
)

pytestmark = [pytest.mark.unit]


# ---------------------------------------------------------------------------
# F.1 — deterministic-name helpers (unit-level pin; the actual runner
# integration is exercised by tests/unit/test_design_import_synthesize_plan.py).
# ---------------------------------------------------------------------------


class TestDefaultChromeName:
    def test_header(self):
        assert _default_chrome_name("header") == "MainHeader"

    def test_footer(self):
        assert _default_chrome_name("footer") == "MainFooter"

    def test_sidebar(self):
        assert _default_chrome_name("sidebar") == "MainSidebar"

    def test_unknown_role_gets_titlecased(self):
        assert _default_chrome_name("banner") == "MainBanner"


class TestDefaultContentName:
    def test_root_slug_is_home(self):
        assert _default_content_name("") == "HomeContent"
        assert _default_content_name("/") == "HomeContent"

    def test_kebab_slug_becomes_pascal_content(self):
        assert _default_content_name("our-products") == "OurProductsContent"
        assert _default_content_name("/our-products") == "OurProductsContent"
        assert _default_content_name("about-us") == "AboutUsContent"
        assert _default_content_name("contact-us") == "ContactUsContent"

    def test_underscore_slug_normalized(self):
        assert _default_content_name("our_team") == "OurTeamContent"


# ---------------------------------------------------------------------------
# F.2 — unicode-confusable scrubbing.
# ---------------------------------------------------------------------------


class TestStripUnicodeConfusables:
    def test_cyrillic_lowercase_o_becomes_latin(self):
        # `высокий контраст` would not normally appear, but the rdzn62gx
        # LLM produced `"high-cоntrast"` with a Cyrillic ``о`` (U+043E).
        assert _strip_unicode_confusables("high-cоntrast") == "high-contrast"

    def test_cyrillic_a(self):
        assert _strip_unicode_confusables("аpple") == "apple"  # Cyrillic а

    def test_pure_latin_passthrough(self):
        assert _strip_unicode_confusables("high-contrast") == "high-contrast"

    def test_empty_string(self):
        assert _strip_unicode_confusables("") == ""

    def test_multiple_confusables(self):
        # Cyrillic а, е, о, р all present
        mixed = "Аpple Раy"  # А=Cyrillic, p=Latin, ple=Latin, Р=Cyrillic, ay=Latin
        cleaned = _strip_unicode_confusables(mixed)
        assert cleaned == "Apple Pay"


# ---------------------------------------------------------------------------
# F.2 — `_LenientCreatorOutput` reconciliation: gibberish plan artifact
# rejected silently; Cyrillic confusables scrubbed model-wide.
#
# These tests use a minimal valid CreatorOutput payload; the parent
# CreatorOutput's required fields are filled with placeholder values
# that match its constraints. If the parent schema changes, only the
# fixture builder below needs updating.
# ---------------------------------------------------------------------------


def _minimal_payload(**overrides) -> dict:
    """Build a `_LenientCreatorOutput`-shaped dict with bare defaults.

    The DesignImporter LLM payload has many optional fields; only
    `app_name` and `reasoning` are truly required by CreatorOutput.
    """
    base = {
        "app_name": "Test App",
        "navigation_type": "HeaderMenuTop",
        "design_system": {
            "primary_color": "#000000",
            "secondary_color": "#ffffff",
            "surface_color": "#fafafa",
            "error_color": "#ff0000",
            "headline_font": "Inter",
            "body_font": "Inter",
            "design_style": ["minimalist", "clean"],
        },
        "component_plans": [],
        "app_logic_plan": {"state_variables": []},
        "app_backend_plan": {
            "backend_type": "none",
            "models": [],
            "handlers": [],
            "static_datasets": [],
            "storage": {
                "enabled": False,
                "allowed_mime_types": [],
                "max_file_size_mb": 10,
                "public_access": False,
            },
        },
        "app_security_plan": {
            "needs_auth": False,
            "auth_providers": ["email"],
            "roles": [],
            "role_hierarchy": {},
            "default_role": "",
            "default_access": "authenticated",
            "page_access": {},
            "allow_signup": True,
            "scaffold_layout": "centered",
        },
        "app_favicon_svg": "",
        "reasoning": "test fixture",
        "app_building_plan_artifact": "",
    }
    base.update(overrides)
    return base


class TestLenientCreatorOutputReconciliation:
    def test_valid_plan_artifact_kept(self):
        payload = _minimal_payload(app_building_plan_artifact="plan:app_v1.md")
        plan = _LenientCreatorOutput(**payload)
        assert plan.app_building_plan_artifact == "plan:app_v1.md"

    def test_empty_plan_artifact_kept(self):
        plan = _LenientCreatorOutput(**_minimal_payload(app_building_plan_artifact=""))
        assert plan.app_building_plan_artifact == ""

    def test_gibberish_plan_artifact_reset_to_empty(self):
        """rdzn62gx 2026-05-16 LLM emitted ``"ID), .I. {id}"``."""
        plan = _LenientCreatorOutput(
            **_minimal_payload(app_building_plan_artifact="ID), .I. {id}")
        )
        assert plan.app_building_plan_artifact == ""

    def test_cyrillic_confusable_in_app_name_scrubbed(self):
        # ``Cоffee Shop`` with Cyrillic ``о``
        plan = _LenientCreatorOutput(**_minimal_payload(app_name="Cоffee Shop"))
        assert plan.app_name == "Coffee Shop"

    def test_cyrillic_confusable_in_design_style_list_scrubbed(self):
        design_system = _minimal_payload()["design_system"]
        design_system["design_style"] = ["minimalist", "high-cоntrast", "clean"]
        plan = _LenientCreatorOutput(**_minimal_payload(design_system=design_system))
        assert plan.design_system.design_style == ["minimalist", "high-contrast", "clean"]

    def test_reasoning_field_scrubbed(self):
        plan = _LenientCreatorOutput(
            **_minimal_payload(reasoning="Pure Cyrillic: Соlor Раlette")
        )
        assert plan.reasoning == "Pure Cyrillic: Color Palette"


# ---------------------------------------------------------------------------
# Slim component_plans stub (8qfb42sm 2026-05-18). The runner overrides
# every structural ComponentPlan field deterministically; the LLM should
# only carry forward image_references / interactive_elements / form_ids
# (the fields that survive the runner's ``**base`` merge AND exist on the
# parent ComponentPlan so Pydantic's default extra="ignore" doesn't drop
# them). Asking for the full field set inflates the structured-output
# payload past max_output_tokens.
# ---------------------------------------------------------------------------


class TestSlimComponentPlansStub:
    def test_empty_component_plans_validates(self):
        """The slim contract: emitting an empty list is acceptable. The
        runner builds every entry from ``plan.pages`` + ``plan.chrome``."""
        plan = _LenientCreatorOutput(**_minimal_payload(component_plans=[]))
        assert plan.component_plans == []

    def test_stub_defaults(self):
        stub = _DesignImportComponentPlanStub()
        assert stub.page_slug is None
        assert stub.role is None
        assert stub.image_references == []
        assert stub.interactive_elements == []
        assert stub.form_ids == []

    def test_stub_carries_load_bearing_fields(self):
        stub = _DesignImportComponentPlanStub(
            page_slug="/dashboard",
            role="content",
            image_references=["uuid-1", "uuid-2"],
            interactive_elements=["chart", "data-table"],
            form_ids=["contact-inquiry"],
        )
        assert stub.image_references == ["uuid-1", "uuid-2"]
        assert stub.interactive_elements == ["chart", "data-table"]
        assert stub.form_ids == ["contact-inquiry"]

    def test_stub_drops_legacy_fields_silently(self):
        """Pydantic default ``extra="ignore"`` — the LLM may emit the old
        verbose ComponentPlan fields by habit; they're silently dropped
        (same effect as before, just smaller payload after the model
        learns the new shape)."""
        stub = _DesignImportComponentPlanStub(
            page_slug="/",
            role="content",
            # Legacy fields the runner overrides — silently dropped:
            name="HomeContent",
            page_title="Home",
            page_summary="A long page summary the runner ignores in favor of plan.pages.",
            page_short_summary="One-liner.",
            building_plan_artifact="plan:home_v1.md",
            content_artifact="content:home:hero.md",
            source_html_artifact="content::page.html",
            page_type="WebPageProps",
            complexity_level="basic",
        )
        # Carry-overs survive:
        assert stub.page_slug == "/"
        assert stub.role == "content"
        # Legacy fields not on the stub:
        assert not hasattr(stub, "name")
        assert not hasattr(stub, "page_title")
        assert not hasattr(stub, "page_summary")
        assert not hasattr(stub, "building_plan_artifact")

    def test_lenient_creator_output_accepts_slim_stubs(self):
        payload = _minimal_payload(
            component_plans=[
                {
                    "page_slug": "/",
                    "role": "content",
                    "image_references": ["hero-img-1"],
                    "interactive_elements": [],
                    "form_ids": [],
                },
                {"role": "header", "image_references": [], "interactive_elements": []},
            ]
        )
        plan = _LenientCreatorOutput(**payload)
        assert len(plan.component_plans) == 2
        assert plan.component_plans[0].image_references == ["hero-img-1"]
        assert plan.component_plans[1].role == "header"
