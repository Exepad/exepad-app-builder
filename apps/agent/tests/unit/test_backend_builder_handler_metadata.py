"""Regression tests for ``_build_handler_metadata`` round-tripping rich
output type strings into the dict shape consumed by the dts generator.

Context (2026-05-09 Zenith Knowledge Base run):
the Creator emitted ``outputs: ["trendingArticles: json"]`` for
``getTrendingArticles``. ``_parse_param_description`` produced
``{"name": "trendingArticles", "type": "json"}`` and the dts generator
mapped ``json`` → ``Record<string, unknown>``. Components calling
``data?.trendingArticles.length`` then failed tsc with TS18046, two
components shipped warnings, and the LLM had to triple-cast.

Fix path: planner now teaches ``array<modelName>`` for handler outputs
that return rows from a model. These tests pin the parser→dts round
trip so the syntax doesn't drift.
"""

from __future__ import annotations

import pytest

from main_agent.agents.orchestrator.app_types.shared.builders.backend_builders.backend_builder import (  # noqa: E501
    _build_handler_metadata,
    _parse_param_description,
)

pytestmark = [pytest.mark.unit]


class TestParseParamDescription:
    def test_simple_primitive(self):
        assert _parse_param_description("limit: integer") == {
            "name": "limit",
            "type": "integer",
        }

    def test_json_type_preserved(self):
        # The historical pattern that triggered the Zenith bug — the
        # parser still returns it verbatim. The fix lives in the dts
        # generator's mapping (json → any), not here.
        assert _parse_param_description("trendingArticles: json") == {
            "name": "trendingArticles",
            "type": "json",
        }

    def test_array_modelname_preserved_intact(self):
        # The recommended planner syntax for "rows of a model" outputs.
        # No comma in ``array<articles>`` so the legacy ``split(",")``
        # in the parser doesn't mangle it.
        assert _parse_param_description("trendingArticles: array<articles>") == {
            "name": "trendingArticles",
            "type": "array<articles>",
        }

    def test_array_primitive_preserved(self):
        assert _parse_param_description("tags: array<string>") == {
            "name": "tags",
            "type": "array<string>",
        }

    def test_no_colon_falls_back_to_string(self):
        assert _parse_param_description("messageOnly") == {
            "name": "messageOnly",
            "type": "string",
        }


class TestBuildHandlerMetadata:
    def test_zenith_regression_array_modelname_round_trip(self):
        # End-to-end: Creator-style HandlerPlan dict → metadata dict
        # carrying the typed-array shape ready for dts emission. If
        # this test fails the dts generator will reach for the json
        # fallback and the bug returns.
        plans = [
            {
                "name": "getTrendingArticles",
                "handler_type": "read",
                "inputs": ["limit: integer"],
                "outputs": ["trendingArticles: array<articles>"],
            }
        ]
        meta = _build_handler_metadata(plans)
        assert len(meta) == 1
        assert meta[0]["outputs"] == [{"name": "trendingArticles", "type": "array<articles>"}]
        assert meta[0]["inputs"] == [{"name": "limit", "type": "integer"}]

    def test_dict_outputs_pass_through_unchanged(self):
        # When upstream code already supplies a dict-shaped output, the
        # builder must not re-stringify it (idempotence).
        plans = [
            {
                "name": "h",
                "outputs": [{"name": "rows", "type": "array<users>"}],
                "inputs": [],
            }
        ]
        meta = _build_handler_metadata(plans)
        assert meta[0]["outputs"] == [{"name": "rows", "type": "array<users>"}]
