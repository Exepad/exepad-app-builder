"""Agent output schemas must survive the providers we actually ship to.

Two regressions, both measured live on the studio's RECOMMENDED provider
(OpenRouter), both of which killed a build at its first phase.

1. ``CreatorOutput`` carries free-form objects (``SecurityPlan.page_access`` and
   ``.role_hierarchy``, both open dicts). OpenAI's STRICT structured-output mode
   forbids those, OpenRouter applies that strict format to any model advertising
   support, and the provider answered with a deterministic HTTP 400:

       Invalid schema for response_format 'CreatorOutput': 'required' is
       required to be supplied and to be an array including every key in
       properties. Extra required key 'page_access' supplied.

   Reproduced on openai/gpt-4o-mini AND anthropic/claude-sonnet-4.5 — i.e. every
   capable model on that provider.

2. A model classified "create a landing page for a steel factory" as
   ``marketing``. The Literal rejected it, and the build died before anything was
   built — over a word, not a misjudgement.

These tests need no network and no provider.
"""

from __future__ import annotations

import pytest

pytestmark = [pytest.mark.unit]


def _free_form_objects(node: object, path: str = "") -> list[str]:
    """Schema paths of objects with no declared ``properties``.

    That is precisely what OpenAI strict mode rejects: it requires ``required``
    to enumerate every key in ``properties``, which an open map cannot satisfy.
    """
    found: list[str] = []
    if isinstance(node, dict):
        if node.get("type") == "object" and "properties" not in node:
            found.append(path or "<root>")
        for key, value in node.items():
            found.extend(_free_form_objects(value, f"{path}.{key}" if path else key))
    elif isinstance(node, list):
        for i, value in enumerate(node):
            found.extend(_free_form_objects(value, f"{path}[{i}]"))
    return found


class TestAppTypeNormalisation:
    """PreCreator's app type tolerates a near-miss instead of failing the build."""

    @staticmethod
    def _parse(app_type: str):
        from main_agent.agents.orchestrator.app_types.webapp.subagents.pre_creator import (
            PreCreatorOutput,
        )

        return PreCreatorOutput(
            app_secondary_type=app_type,
            reasoning="test",
        )

    @pytest.mark.parametrize("value", ["website", "form", "dataapp", "custom"])
    def test_valid_values_pass_through(self, value):
        assert self._parse(value).app_secondary_type == value

    @pytest.mark.parametrize(
        "value",
        ["marketing", "landing", "landing-page", "Landing_Page", "brochure", "blog", "portfolio"],
    )
    def test_marketing_synonyms_resolve_to_website(self, value):
        # The field's own description says "'website' for content/marketing
        # sites", so these are synonyms of the RIGHT answer — not unknowns.
        assert self._parse(value).app_secondary_type == "website"

    @pytest.mark.parametrize("value", ["survey", "quiz", "questionnaire"])
    def test_form_synonyms_resolve_to_form(self, value):
        assert self._parse(value).app_secondary_type == "form"

    @pytest.mark.parametrize("value", ["dashboard", "CRM", "analytics"])
    def test_dataapp_synonyms_resolve_to_dataapp(self, value):
        assert self._parse(value).app_secondary_type == "dataapp"

    def test_case_and_separators_are_folded(self):
        assert self._parse("  MARKETING  ").app_secondary_type == "website"

    def test_unknown_value_falls_back_to_custom(self):
        assert self._parse("interpretive-dance").app_secondary_type == "custom"

    def test_marketing_does_not_become_custom(self):
        # The regression this guards: 'custom' is NOT an inert catch-all. It
        # gates the Three.js FPS recipe inlining and skips the website-specific
        # backend suppression, so parking a marketing site there ships a quietly
        # worse app than the crash it replaced.
        assert self._parse("marketing").app_secondary_type != "custom"


class TestSchemasAreStrictStructuredOutputSafe:
    """Every agent output schema must be expressible under OpenAI strict mode."""

    @staticmethod
    def _schemas():
        from main_agent.agents.orchestrator.app_types.shared.subagents.app_help_desk import (
            AppHelpDeskOutput,
        )
        from main_agent.agents.orchestrator.app_types.webapp.subagents.pre_creator import (
            PreCreatorOutput,
        )

        return {
            "PreCreatorOutput": PreCreatorOutput,
            "AppHelpDeskOutput": AppHelpDeskOutput,
        }

    def test_no_free_form_objects(self):
        offenders = {}
        for name, model in self._schemas().items():
            found = _free_form_objects(model.model_json_schema())
            if found:
                offenders[name] = found
        assert not offenders, (
            "Free-form objects (dict[...] with no fixed keys) cannot be sent as an "
            "OpenAI strict json_schema; the provider returns HTTP 400. Give the "
            "field an explicit shape (e.g. list[{key, value}]).\n"
            f"{offenders}"
        )

    def test_detector_catches_a_known_free_form_shape(self):
        # Guard the guard: a detector that never fires protects nothing.
        schema = {
            "type": "object",
            "properties": {"page_access": {"type": "object", "additionalProperties": {}}},
        }
        assert _free_form_objects(schema) == ["properties.page_access"]


class TestResponseFormatIsDroppedForToolGatedProviders:
    """The redundant mechanism must not be sent where the tool gate is in charge.

    `_patch_adk_output_schema_for_litellm` already decided these providers cannot
    be trusted with native structured output. Sending `response_format` as well
    added nothing and was the sole cause of the 400.
    """

    @pytest.mark.parametrize(
        "model_id,should_drop",
        [
            ("openrouter/anthropic/claude-sonnet-4.5", True),
            ("openrouter/openai/gpt-4o-mini", True),
            ("openrouter/qwen/qwen3.7-flash", True),
            ("ollama/llama3.1", True),
            ("openai/gpt-4o", False),
            ("azure/gpt-4o", False),
        ],
    )
    def test_provider_condition_matches_the_emission_gate(self, model_id, should_drop):
        from config import _NATIVE_STRUCTURED_LITELLM_PREFIXES

        # The drop condition and the emission gate read the SAME prefix tuple;
        # if they ever diverge, a provider gets both mechanisms again.
        drops = not model_id.startswith(_NATIVE_STRUCTURED_LITELLM_PREFIXES)
        assert drops is should_drop

    @pytest.mark.parametrize("agent", ["Creator", "Editor", "DesignImporter"])
    def test_tool_carrying_agents_drop_response_format(self, agent):
        from config import _uses_tool_emission_gate

        assert _uses_tool_emission_gate(agent) is True

    @pytest.mark.parametrize("agent", ["PreCreator", "AppHelpDesk", "ChatResponseWriter"])
    def test_tool_less_agents_keep_response_format(self, agent):
        from config import _uses_tool_emission_gate

        # The regression this guards: dropping it for a tool-less agent removes
        # its ONLY output constraint. Measured — PreCreator then returned its
        # JSON inside a ```json fence and failed both attempts.
        assert _uses_tool_emission_gate(agent) is False
