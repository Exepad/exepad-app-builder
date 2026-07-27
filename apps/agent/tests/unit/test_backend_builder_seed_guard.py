"""Regression: the website-only seed-data suppression was removed.

Previously ``BackendBuilder.build_create`` skipped the SeedDataBuilder
whenever ``app_secondary_type == "website"``, which silently dropped seed
rows that design-import bundles legitimately declared (e.g. a marketing
site whose Products page reads ``useModel("products")``). The guard is gone
— SeedDataBuilder no-ops on empty inputs, so we only need a populated
model/static plan to schedule it.

These tests assert the invariant without spinning up real ADK agents:
they read ``build_create``'s source and pin it against the expected shape.
"""

from __future__ import annotations

import inspect

import pytest

from main_agent.agents.orchestrator.app_types.shared.builders.backend_builders.backend_builder import (  # noqa: E501
    BackendBuilder,
)

pytestmark = [pytest.mark.unit]


def test_build_create_does_not_condition_seeds_on_app_secondary_type():
    source = inspect.getsource(BackendBuilder.build_create)
    # The fix removes the `app_secondary_type != "website"` clause from
    # has_seed_data. Pin it so a future refactor can't silently reintroduce
    # the regression.
    assert 'app_secondary_type != "website"' not in source
    assert "app_secondary_type != 'website'" not in source


def test_has_seed_data_expression_depends_only_on_plan_contents():
    source = inspect.getsource(BackendBuilder.build_create)
    # The relevant assignment — match the expected shape. Phase 3.2
    # filters extracted-seed models out of the LLM input, so the
    # variable became ``seed_model_plans`` (a copy of model_plans
    # minus the names whose seed rows came from the data extractor).
    assert "has_seed_data = bool(" in source
    assert (
        "(seed_model_plans or static_datasets) and self.seed_data_builder_agent"
        in source
    )
