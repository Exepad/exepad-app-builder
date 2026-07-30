"""Schema-level invariant: every content / ``WebPageProps`` component in
``CreatorOutput`` must reference a non-empty ``building_plan_artifact``.

Background: ``ComponentPlan.building_plan_artifact`` carries
``default=""`` so chrome roles can legitimately ship empty. That same
default is what lets Gemini's
structured-output mode silently drop the field on regular content
components when prose rules are the only enforcement (observed with
Gemini 3 Flash Preview after multi-turn ``save_plan_artifact`` tool
calls — saved 7 artifacts, referenced only 2 in the JSON).

The validator is **context-gated**: it only raises when the caller
passes ``context={"creator_strict": True}`` to ``model_validate``. ADK's
``LlmAgent`` validates with no context, so its default path stays
permissive — the workflow's materializer fallback +
post-materialization guard own runtime enforcement. The strict mode
exists for tests, diagnostics, and any future caller that wants the
synchronous schema-level assertion.

The design-importer's ``DecompositionPlan`` uses ``_LenientCreatorOutput``
which overrides the validator to be unconditionally silent — even under
strict context — because its runner overrides ``component_plans`` with
inline ``building_plan`` and per-component plan artifacts are
intentionally absent.
"""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from main_agent.agents.orchestrator.app_types.webapp.subagents.creator import (
    CreatorOutput,
)
from main_agent.agents.orchestrator.importers.tools.decomposition.plan import (
    _LenientCreatorOutput,
)

pytestmark = [pytest.mark.unit]


def _base_payload() -> dict:
    return {
        "app_name": "Test",
        "app_building_plan_artifact": "plan:app.md",
        "navigation_type": "HeaderMenuTop",
        "design_system": {
            "primary_color": "#000000",
            "secondary_color": "#000000",
            "surface_color": "#ffffff",
            "error_color": "#ff0000",
            "headline_font": "Inter",
            "body_font": "Inter",
            "design_style": ["minimal"],
        },
        "component_plans": [],
        "reasoning": "test",
    }


_STRICT = {"creator_strict": True}


class TestADKDefaultValidationStaysPermissive:
    """ADK's ``LlmAgent`` validates the model response with no validation
    context. The validator must NOT raise on that path, otherwise it
    would short-circuit the materializer fallback before it has a chance
    to recover dropped artifact refs (see plan_artifact_materializer
    naming-convention fallback)."""

    def test_default_validation_accepts_dropped_artifact_refs(self):
        """Today's exact failure payload: 5 content components with
        empty ``building_plan_artifact``. ADK's default
        ``model_validate_json``-style call must accept this so the
        workflow proceeds to materialization and the fallback runs."""
        payload = _base_payload()
        payload["component_plans"] = [
            {
                "name": "DashboardContent", "role": "content", "page_slug": "/",
                "page_title": "Dashboard", "page_type": "WebPageProps",
                "building_plan_artifact": "",
            },
            {
                "name": "JobListContent", "role": "content", "page_slug": "/jobs",
                "page_title": "Jobs", "page_type": "WebPageProps",
                "building_plan_artifact": "",
            },
        ]
        # No context → silent. Equivalent to ADK's call.
        CreatorOutput.model_validate(payload)


class TestStrictArtifactInvariant:
    def test_rejects_empty_artifact_for_content_webpage(self):
        payload = _base_payload()
        payload["component_plans"] = [
            {
                "name": "HomeContent",
                "role": "content",
                "page_slug": "/",
                "page_title": "Home",
                "page_type": "WebPageProps",
                "building_plan_artifact": "",
            }
        ]
        with pytest.raises(ValidationError) as exc:
            CreatorOutput.model_validate(payload, context=_STRICT)
        # The error message is what re-prompts the model on retry —
        # it must name the offender so the model knows what to fix.
        assert "HomeContent" in str(exc.value)
        assert "building_plan_artifact" in str(exc.value)

    def test_rejects_lists_all_offenders(self):
        payload = _base_payload()
        payload["component_plans"] = [
            {
                "name": "DashboardContent", "role": "content", "page_slug": "/",
                "page_title": "Dashboard", "page_type": "WebPageProps",
                "building_plan_artifact": "",
            },
            {
                "name": "JobListContent", "role": "content", "page_slug": "/jobs",
                "page_title": "Jobs", "page_type": "WebPageProps",
                "building_plan_artifact": "",
            },
        ]
        with pytest.raises(ValidationError) as exc:
            CreatorOutput.model_validate(payload, context=_STRICT)
        assert "DashboardContent" in str(exc.value)
        assert "JobListContent" in str(exc.value)

    def test_accepts_filled_artifact(self):
        payload = _base_payload()
        payload["component_plans"] = [
            {
                "name": "HomeContent", "role": "content", "page_slug": "/",
                "page_title": "Home", "page_type": "WebPageProps",
                "building_plan_artifact": "plan:HomeContent.md",
            }
        ]
        CreatorOutput.model_validate(payload, context=_STRICT)

    @pytest.mark.parametrize("role", ["header", "sidebar", "footer"])
    def test_exempts_chrome_roles(self, role: str):
        payload = _base_payload()
        payload["component_plans"] = [
            {
                "name": f"Main{role.capitalize()}",
                "role": role,
                "page_slug": None,
                "building_plan_artifact": "",
            }
        ]
        CreatorOutput.model_validate(payload, context=_STRICT)

    def test_rejects_whitespace_only_artifact(self):
        """Whitespace strings shouldn't slip through — the materializer
        treats them as empty too, so the schema must as well."""
        payload = _base_payload()
        payload["component_plans"] = [
            {
                "name": "HomeContent", "role": "content", "page_slug": "/",
                "page_title": "Home", "page_type": "WebPageProps",
                "building_plan_artifact": "   ",
            }
        ]
        with pytest.raises(ValidationError):
            CreatorOutput.model_validate(payload, context=_STRICT)


class TestLenientCreatorOutput:
    """The design importer's runner overrides component_plans entirely;
    the LLM ships stub plans without per-component artifacts. The
    lenient subclass must stay silent EVEN under strict context, since
    the per-component artifact rule legitimately doesn't apply to it.
    """

    def test_accepts_under_strict_context(self):
        payload = _base_payload()
        payload["component_plans"] = [
            {
                "name": "PlaceholderContent", "role": "content", "page_slug": "/",
                "page_title": "Home", "page_type": "WebPageProps",
                "building_plan_artifact": "",
            }
        ]
        with pytest.raises(ValidationError):
            CreatorOutput.model_validate(payload, context=_STRICT)
        _LenientCreatorOutput.model_validate(payload, context=_STRICT)
