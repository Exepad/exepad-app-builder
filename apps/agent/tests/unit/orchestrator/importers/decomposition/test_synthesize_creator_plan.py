"""Tests for ``runner._synthesize_creator_plan`` backend_intent merge.

The DesignImporter LLM emits richer schema (FK references, full column
lists, plus-extras like plans/invoices) in ``DecompositionPlan.backend_intent``
than in ``creator_plan.app_backend_plan``. Before this fix, the merge step
in ``_synthesize_creator_plan`` ignored ``backend_intent`` entirely — the
LLM's intent landed in a side artifact and the final ``app_backend_plan``
was populated only by the deterministic data-extractor, which strips FK
metadata.

Reproduced 2026-05-15 on app ``pnkndvyy``: intent had 5 models with 3 FK
refs; final ``app_config.json::backend.models`` had 3 models, 0 FKs, no
``plans``, no ``invoices``. CalendarContent/BillingContent/PlansContent
fell back to hardcoded mock arrays because the columns they needed
weren't in the config.
"""

from __future__ import annotations

import pytest

from main_agent.agents.orchestrator.importers.tools.decomposition.plan import (
    BackendHandlerSpec,
    BackendIntent,
    BackendModelSpec,
    ChromeRegion,
    DecompositionPlan,
    M3Pillars,
    PageMapping,
    ThemePlan,
)
from main_agent.agents.orchestrator.importers.tools.decomposition.runner import (
    _synthesize_creator_plan,
)

pytestmark = [pytest.mark.unit]


def _pillars() -> M3Pillars:
    return M3Pillars(
        primary="#000000",
        secondary="#0051d5",
        surface="#ffffff",
        error="#dc2626",
    )


def _minimal_creator_plan(app_backend_plan: dict | None = None) -> dict:
    return {
        "app_name": "Test",
        "app_building_plan_artifact": "",
        "navigation_type": "HeaderMenuTop",
        "design_system": {
            "primary_color": "#000000",
            "secondary_color": "#000000",
            "surface_color": "#000000",
            "error_color": "#000000",
            "headline_font": "Inter",
            "body_font": "Inter",
            "design_style": ["placeholder bullet"],
        },
        "component_plans": [
            {
                "name": "PlaceholderContent",
                "role": "content",
                "page_slug": "/",
                "page_title": "Home",
                "building_plan_artifact": "",
                "image_references": [],
                "source_html_artifact": "",
            }
        ],
        "app_logic_plan": {},
        "app_backend_plan": app_backend_plan if app_backend_plan is not None else {},
        "app_security_plan": {},
        "app_favicon_svg": "",
        "reasoning": "test fixture",
    }


def _plan(
    *,
    backend_intent: BackendIntent | None,
    creator_app_backend_plan: dict | None = None,
) -> DecompositionPlan:
    return DecompositionPlan(
        format="stitch",
        pages=[
            PageMapping(
                bundle_artifact="bundle:html:home.html",
                output_artifact="content::page.html",
                page_slug="",
                page_route="/",
                page_title="Home",
            )
        ],
        chrome=[],
        theme=ThemePlan(pillars=_pillars()),
        navigation={"routes": [], "default": ""},
        backend_intent=backend_intent,
        creator_plan=_minimal_creator_plan(creator_app_backend_plan),  # type: ignore[arg-type]
    )


def _synth(plan: DecompositionPlan) -> dict:
    return _synthesize_creator_plan(
        plan,
        m3_tokens={
            "--color-primary": "#000000",
            "--color-secondary": "#0051d5",
            "--color-surface": "#ffffff",
            "--color-error": "#dc2626",
        },
        fonts={"headline": "Inter", "body": "Inter"},
    )


class TestBackendIntentMerge:
    """Pnkndvyy 2026-05-15 regression: design-import intent must reach
    app_backend_plan so BackendBuilder.build_create sees the full schema."""

    def test_intent_models_with_fks_merged_into_empty_app_backend_plan(self):
        """The pnkndvyy shape: rich intent, empty app_backend_plan."""
        intent = BackendIntent(
            models=[
                BackendModelSpec(
                    name="members",
                    columns=[
                        {"name": "name", "type": "text"},
                        {"name": "email", "type": "text"},
                    ],
                ),
                BackendModelSpec(
                    name="bookings",
                    columns=[
                        {"name": "member_id", "type": "text", "references": "members"},
                        {
                            "name": "resource_id",
                            "type": "text",
                            "references": "resources",
                        },
                        {"name": "start_time", "type": "text"},
                    ],
                ),
                BackendModelSpec(
                    name="invoices",
                    columns=[
                        {"name": "member_id", "type": "text", "references": "members"},
                        {"name": "amount", "type": "real"},
                    ],
                ),
            ]
        )

        result = _synth(_plan(backend_intent=intent, creator_app_backend_plan={}))
        models = result["app_backend_plan"]["models"]
        names = [m["name"] for m in models]

        assert names == ["members", "bookings", "invoices"]
        # FK references carry through unchanged
        bookings = next(m for m in models if m["name"] == "bookings")
        fk_cols = {c["name"]: c.get("references") for c in bookings["columns"]}
        assert fk_cols == {
            "member_id": "members",
            "resource_id": "resources",
            "start_time": None,
        } or fk_cols == {
            # exclude_none drops the None — accept either shape
            "member_id": "members",
            "resource_id": "resources",
            "start_time": None,
        }
        invoices = next(m for m in models if m["name"] == "invoices")
        invoice_member = next(c for c in invoices["columns"] if c["name"] == "member_id")
        assert invoice_member.get("references") == "members"
        # Design-import demo seeds must be shared so preview viewers see them
        for m in models:
            assert m.get("owner_scope") == "shared"

    def test_column_union_on_name_conflict(self):
        """When both ``app_backend_plan`` and ``backend_intent`` define a
        model with the same name, the merge UNIONs their column lists.

        Intent column wins on name clash (intent is the LLM's richer
        considered schema with FK refs/enum_values). Non-clashing columns
        from app_backend_plan are preserved. The owner_scope from
        app_backend_plan stays (since we mutate that model in place).

        Alo48zsn 2026-05-15 regression: don't-clobber dropped
        ``members.plan_id`` FK because the LLM populated
        ``app_backend_plan.members`` with 5 columns (no plan_id) AND
        ``backend_intent.members`` with 6 columns (including plan_id FK).
        """
        intent = BackendIntent(
            models=[
                BackendModelSpec(
                    name="members",
                    columns=[
                        # Name conflicts with app_backend_plan's — intent wins.
                        {"name": "name", "type": "text", "required": True},
                        # New columns from intent — added.
                        {"name": "plan_id", "type": "text", "references": "plans"},
                        {"name": "status", "type": "text"},
                    ],
                ),
                BackendModelSpec(
                    name="bookings",
                    columns=[
                        {"name": "member_id", "type": "text", "references": "members"},
                    ],
                ),
            ]
        )
        creator_plan_backend = {
            "models": [
                {
                    "name": "members",
                    "columns": [
                        # Conflicting column — intent's version wins.
                        {"name": "name", "type": "text", "is_unique": True},
                        # Non-conflicting column — preserved.
                        {"name": "email", "type": "text"},
                    ],
                    "owner_scope": "user",
                }
            ]
        }

        result = _synth(
            _plan(
                backend_intent=intent,
                creator_app_backend_plan=creator_plan_backend,
            )
        )
        models = result["app_backend_plan"]["models"]
        names = [m["name"] for m in models]
        assert names == ["members", "bookings"]

        members = next(m for m in models if m["name"] == "members")
        # owner_scope from the existing app_backend_plan model is preserved
        # (we mutate that model rather than replacing it).
        assert members["owner_scope"] == "user"

        col_names = [c["name"] for c in members["columns"]]
        # Union: all 4 columns present (1 clash + 1 from each side + 1 from intent).
        assert set(col_names) == {"name", "email", "plan_id", "status"}

        # Intent column wins on name clash: ``name`` has ``required: True``
        # (from intent's ColumnPlan default + override). The is_unique=True
        # from app_backend_plan is overwritten by the intent column's
        # default is_unique=False.
        name_col = next(c for c in members["columns"] if c["name"] == "name")
        assert name_col.get("required") is True
        assert name_col.get("is_unique") is False

        # FK reference from intent's plan_id carries through.
        plan_id_col = next(c for c in members["columns"] if c["name"] == "plan_id")
        assert plan_id_col["references"] == "plans"

    def test_column_union_preserves_disjoint_intent_columns(self):
        """When app_backend_plan and intent share a model name but no
        columns overlap, the union is the concatenation."""
        intent = BackendIntent(
            models=[
                BackendModelSpec(
                    name="resources",
                    columns=[
                        {"name": "capacity", "type": "integer"},
                        {"name": "location", "type": "text"},
                    ],
                ),
            ]
        )
        creator_plan_backend = {
            "models": [
                {
                    "name": "resources",
                    "columns": [
                        {"name": "name", "type": "text"},
                        {"name": "type", "type": "text"},
                    ],
                    "owner_scope": "shared",
                }
            ]
        }

        result = _synth(
            _plan(
                backend_intent=intent,
                creator_app_backend_plan=creator_plan_backend,
            )
        )
        models = result["app_backend_plan"]["models"]
        resources = next(m for m in models if m["name"] == "resources")
        col_names = {c["name"] for c in resources["columns"]}
        assert col_names == {"name", "type", "capacity", "location"}

    def test_no_intent_is_a_noop(self):
        """``backend_intent is None`` leaves app_backend_plan's models untouched.

        We assert the merge invariant only — that no new models appear and the
        original model survives intact. Pydantic round-trips other fields with
        their defaults, so a deep dict equality wouldn't be meaningful.
        """
        creator_plan_backend = {
            "models": [
                {
                    "name": "x",
                    "columns": [{"name": "k", "type": "text"}],
                    "owner_scope": "user",
                }
            ]
        }
        result = _synth(
            _plan(
                backend_intent=None,
                creator_app_backend_plan=creator_plan_backend,
            )
        )
        models = result["app_backend_plan"]["models"]
        assert [m["name"] for m in models] == ["x"]
        assert models[0]["owner_scope"] == "user"
        assert models[0]["columns"][0]["name"] == "k"

    def test_intent_handlers_merged_with_dont_clobber(self):
        """Handlers from backend_intent are merged the same way as models."""
        intent = BackendIntent(
            handlers=[
                BackendHandlerSpec(name="send_welcome_email", type="email"),
                BackendHandlerSpec(name="signup", type="platform_auth"),
            ]
        )
        creator_plan_backend = {
            "handlers": [
                {
                    "name": "signup",
                    "auth_level": "public",
                    "handler_type": "write",
                    "inputs": ["email: text, required"],
                    "outputs": ["success: boolean"],
                }
            ]
        }

        result = _synth(
            _plan(
                backend_intent=intent,
                creator_app_backend_plan=creator_plan_backend,
            )
        )
        handlers = result["app_backend_plan"]["handlers"]
        names = [h["name"] for h in handlers]
        # signup preserved, send_welcome_email appended
        assert names == ["signup", "send_welcome_email"]
