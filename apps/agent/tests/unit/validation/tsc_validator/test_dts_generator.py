"""Unit tests for the per-app TypeScript declaration generator."""

from __future__ import annotations

import pytest

from main_agent.services.validation.tsc_validator.dts_generator import generate_app_dts

pytestmark = [pytest.mark.unit]


class TestEmptyManifest:
    def test_no_inputs_emits_valid_dts(self):
        out = generate_app_dts()
        # Module-augmentation block is always present so tsc can resolve
        # ``declare module '@exepad/sdk'`` references even on a brand-new app.
        assert "declare module '@exepad/sdk'" in out
        assert "interface AppModels" in out
        assert "interface AppHandlerOutputs" in out
        assert "interface AppState" in out
        assert "interface AppRoutes" in out
        assert "interface AppForms" in out
        # Fallback comments make the empty interfaces self-documenting.
        assert "(no models declared)" in out
        assert "(no handlers declared)" in out
        # ``setState`` is always emitted on the AppState block, so the
        # "no state keys declared" placeholder never fires for the
        # state interface — the setState contract assertion below
        # replaces it.
        assert "setState: (key: string, value: unknown) => void;" in out
        assert "(no routes declared)" in out
        assert "(no forms registered)" in out

    def test_explicit_empty_dicts_match_no_inputs(self):
        out = generate_app_dts(backend={}, logic={}, pages=[], services={})
        # Same-shape behavior whether the call uses defaults or empties.
        assert "declare module '@exepad/sdk'" in out
        assert "interface AppForms" in out
        assert "setState: (key: string, value: unknown) => void;" in out

    def test_setState_emitted_alongside_declared_state_keys(self):
        # Regression: ``useApp(s => s.setState)`` slipped past tsc on app
        # ``n1aloggh`` because per-app AppState only contained declared
        # state keys. setState must always be present.
        out = generate_app_dts(logic={"state": {"selectedProjectId": None}})
        assert "setState: (key: string, value: unknown) => void;" in out
        assert "selectedProjectId: unknown;" in out


class TestFormInterface:
    """``services.forms.definitions[].id`` populates the legacy AppForms
    interface. The platform forms service was removed, so this path is no
    longer exercised in production — these tests pin the generator's
    structural stability for older app configs that still carry a
    ``services`` block."""

    def test_single_form_definition(self):
        out = generate_app_dts(services={"forms": {"definitions": [{"id": "contact-us"}]}})
        assert "interface AppForms" in out
        assert "'contact-us': {};" in out

    def test_multiple_form_definitions_are_alphabetised(self):
        out = generate_app_dts(
            services={
                "forms": {
                    "definitions": [
                        {"id": "newsletter"},
                        {"id": "contact"},
                        {"id": "feedback"},
                    ]
                }
            }
        )
        # Sorted: contact, feedback, newsletter
        contact_at = out.find("'contact':")
        feedback_at = out.find("'feedback':")
        newsletter_at = out.find("'newsletter':")
        assert contact_at < feedback_at < newsletter_at

    def test_string_form_ids_also_accepted(self):
        # Defensive: definitions list can carry bare strings too.
        out = generate_app_dts(services={"forms": {"definitions": ["my-form"]}})
        assert "'my-form': {};" in out

    def test_no_services_emits_empty_forms_interface(self):
        out = generate_app_dts()
        assert "interface AppForms" in out
        # Empty interface placeholder.
        assert "(no forms registered)" in out

    def test_empty_services_emit_empty_forms(self):
        # The platform forms service was removed, so the generator now always
        # receives an empty/absent services block and emits an empty
        # AppForms interface.
        out = generate_app_dts(services={})
        assert "interface AppForms" in out
        assert "(no forms registered)" in out

    def test_invalid_definition_entries_are_skipped(self):
        out = generate_app_dts(
            services={
                "forms": {
                    "definitions": [
                        {"id": "ok"},
                        {"id": ""},  # empty
                        {"id": "  "},  # whitespace
                        None,  # not a dict
                        {"name": "x"},  # no id
                        42,  # not a dict or str
                    ]
                }
            }
        )
        assert "'ok': {};" in out
        # No empty/None entries leak in
        assert "'': {};" not in out
        assert "'None'" not in out


class TestModelInterfaces:
    def test_single_model_with_typed_columns(self):
        out = generate_app_dts(
            backend={
                "models": [
                    {
                        "name": "users",
                        "columns": [
                            {"name": "id", "type": "uuid"},
                            {"name": "email", "type": "string"},
                            {"name": "age", "type": "integer"},
                        ],
                    },
                ],
            }
        )
        # System fields are always present + declared columns appear in
        # declaration order after them. ``id`` declared as uuid → string
        # overrides the system default of the same shape.
        assert (
            "users: { id: string; created_at: string; updated_at: string; "
            "owner_id: string; email: string; age: number };"
        ) in out

    def test_nullable_column_emits_null_union(self):
        out = generate_app_dts(
            backend={
                "models": [
                    {
                        "name": "posts",
                        "columns": [
                            {"name": "id", "type": "uuid"},
                            {"name": "deleted_at", "type": "datetime", "nullable": True},
                        ],
                    },
                ],
            }
        )
        assert "deleted_at: string | null" in out

    def test_string_shorthand_columns(self):
        # Some manifests carry columns as ``"name: type"`` strings.
        out = generate_app_dts(
            backend={"models": [{"name": "tags", "columns": ["id: uuid", "label: string"]}]}
        )
        # System fields injected; ``id`` declared as uuid → string still
        # comes through the declared path.
        assert "label: string" in out
        assert "id: string" in out

    def test_multiple_models_each_get_their_own_interface_entry(self):
        out = generate_app_dts(
            backend={
                "models": [
                    {"name": "a", "columns": [{"name": "x", "type": "string"}]},
                    {"name": "b", "columns": [{"name": "y", "type": "number"}]},
                ],
            }
        )
        # System ``id`` defaults to ``number`` (INTEGER PRIMARY KEY AUTOINCREMENT)
        # because that's what DEFAULT_PRIMARY_KEY in deploy-utils provisions.
        assert (
            "a: { id: number; created_at: string; updated_at: string; owner_id: string; x: string };"
            in out
        )
        assert (
            "b: { id: number; created_at: string; updated_at: string; owner_id: string; y: number };"
            in out
        )

    def test_unknown_column_type_falls_back_to_unknown(self):
        out = generate_app_dts(
            backend={
                "models": [{"name": "weird", "columns": [{"name": "blob", "type": "geometry"}]}]
            }
        )
        # Declared columns still get their (best-effort) type after the
        # system fields.
        assert "blob: unknown" in out

    def test_model_with_no_columns_includes_only_system_fields(self):
        # Previously fell back to ``Record<string, unknown>`` — but the
        # platform still injects id/created_at/updated_at/owner_id even
        # for models without declared columns. Use the system shape so
        # ``row.id`` works without false positives.
        out = generate_app_dts(backend={"models": [{"name": "opaque"}]})
        assert (
            "opaque: { id: number; created_at: string; updated_at: string; " "owner_id: string };"
        ) in out

    def test_system_fields_always_present(self):
        # Regression: production trace hit ``Property 'id' does not exist
        # on type '{...}'`` because ``id`` wasn't declared on the model.
        # Every row has id / created_at / updated_at / owner_id from the
        # CRUD layer regardless of what the schema declares.
        out = generate_app_dts(
            backend={
                "models": [
                    {
                        "name": "projects",
                        "columns": [
                            {"name": "client", "type": "string"},
                            {"name": "vertical", "type": "string"},
                        ],
                    }
                ]
            }
        )
        # All four system fields must appear.
        # ``id`` is ``number`` (INTEGER PRIMARY KEY AUTOINCREMENT default);
        # owner_id / created_at / updated_at are TEXT in the DDL.
        for sys_field in (
            "id: number",
            "created_at: string",
            "updated_at: string",
            "owner_id: string",
        ):
            assert sys_field in out, f"missing system field: {sys_field}"

    def test_declared_id_with_text_type_overrides_system_default(self):
        # If a model explicitly declares ``id: text`` (rare; UUID-keyed
        # shared tables), the declared override wins — the system default
        # of ``number`` doesn't clobber it.
        out = generate_app_dts(
            backend={
                "models": [
                    {
                        "name": "legacy",
                        "columns": [
                            {"name": "id", "type": "text"},
                            {"name": "name", "type": "string"},
                        ],
                    }
                ]
            }
        )
        assert "id: string" in out
        # Other system fields still inject.
        assert "created_at: string" in out

    def test_fk_columns_typed_as_number_match_parent_id(self):
        # The motivating tsc trace: ``attendance.member_id (number) ===
        # member.id (number)`` — both number → comparison type-checks.
        # Pre-fix the system ``id`` was ``string``, breaking this JOIN
        # pattern on every dataapp.
        out = generate_app_dts(
            backend={
                "models": [
                    {"name": "members", "columns": [{"name": "name", "type": "text"}]},
                    {
                        "name": "attendance",
                        "columns": [
                            {"name": "member_id", "type": "integer"},
                            {"name": "logged_at", "type": "datetime"},
                        ],
                    },
                ]
            }
        )
        # Parent's id is the system default (number).
        assert "members: { id: number;" in out
        # FK column declared as integer is also number — types match.
        assert "member_id: number" in out

    def test_unnamed_model_skipped(self):
        out = generate_app_dts(
            backend={
                "models": [
                    {"columns": [{"name": "x", "type": "string"}]},  # no name
                    {"name": "real", "columns": [{"name": "y", "type": "number"}]},
                ],
            }
        )
        assert "real:" in out
        # Only one model entry survives — the unnamed entry is silently dropped.
        model_section = out.split("interface AppHandlerOutputs")[0]
        assert model_section.count("y: number") == 1
        # ``x: string`` from the unnamed model must NOT appear.
        assert "x: string" not in model_section


class TestJoinedSiblingFields:
    """Auto-join siblings: every ``<X>_id`` column with ``references.model``
    pointing to another declared model produces an optional ``<X>?`` row
    field typed as the target row.

    Mirrors the runtime auto-CRUD behaviour documented in
    ``crud_data_app.md``. Without this, compliant LLM code like
    ``row.guest?.full_name`` fails tsc with TS2339. Regression for app
    ``ky3clhzb`` (AppointmentContent shipped with two unresolved
    ``Property 'pet' does not exist`` errors).
    """

    def test_fk_with_references_emits_optional_sibling(self):
        out = generate_app_dts(
            backend={
                "models": [
                    {
                        "name": "owners",
                        "columns": [{"name": "name", "type": "string"}],
                    },
                    {
                        "name": "pets",
                        "columns": [
                            {
                                "name": "owner_id",
                                "type": "integer",
                                "references": {"model": "owners", "column": "id"},
                            },
                        ],
                    },
                ],
            }
        )
        # Optional sibling appears with the FK suffix stripped.
        assert "owner?: AppModels['owners'] | null" in out
        # Raw FK is still present for filters/writes.
        assert "owner_id: number" in out

    def test_fk_to_undeclared_model_does_not_emit_sibling(self):
        # If references.model isn't a declared model, skip the join — we
        # don't want to pollute types with phantom siblings.
        out = generate_app_dts(
            backend={
                "models": [
                    {
                        "name": "pets",
                        "columns": [
                            {
                                "name": "vet_id",
                                "type": "integer",
                                "references": {"model": "vets", "column": "id"},
                            },
                        ],
                    },
                ],
            }
        )
        assert "vet?:" not in out
        assert "vet_id: number" in out

    def test_fk_without_references_does_not_emit_sibling(self):
        # ``*_id`` naming alone is not enough — needs explicit references.
        out = generate_app_dts(
            backend={
                "models": [
                    {"name": "vets", "columns": [{"name": "name", "type": "string"}]},
                    {
                        "name": "appointments",
                        "columns": [
                            # No references; just a column named *_id.
                            {"name": "vet_id", "type": "integer"},
                        ],
                    },
                ],
            }
        )
        assert "vet?:" not in out

    def test_existing_field_named_like_sibling_is_not_shadowed(self):
        # If the model declares a column with the same name as the
        # would-be sibling, the declared column wins (no double emission).
        out = generate_app_dts(
            backend={
                "models": [
                    {"name": "vets", "columns": [{"name": "name", "type": "string"}]},
                    {
                        "name": "appointments",
                        "columns": [
                            {
                                "name": "vet_id",
                                "type": "integer",
                                "references": {"model": "vets", "column": "id"},
                            },
                            {"name": "vet", "type": "string"},
                        ],
                    },
                ],
            }
        )
        # Declared ``vet: string`` survives.
        assert "vet: string" in out
        # No optional sibling collision for ``vet``.
        assert "vet?: AppModels['vets']" not in out

    def test_self_reference_does_not_emit_sibling(self):
        # Avoid emitting a sibling that points back at the same model —
        # would name-collide on the parent and produce nonsense types.
        out = generate_app_dts(
            backend={
                "models": [
                    {
                        "name": "categories",
                        "columns": [
                            {
                                "name": "categories_id",
                                "type": "integer",
                                "references": {"model": "categories", "column": "id"},
                            },
                        ],
                    },
                ],
            }
        )
        # Same-model FKs do not get a sibling entry (target == self).
        assert "categories?: AppModels['categories']" not in out
        assert "categories_id: number" in out

    def test_multi_fk_model_emits_multiple_siblings(self):
        # Regression for AppointmentContent: appointments has both
        # pet_id → pets and vet_id → vets. Both siblings must appear.
        out = generate_app_dts(
            backend={
                "models": [
                    {"name": "pets", "columns": [{"name": "name", "type": "string"}]},
                    {"name": "vets", "columns": [{"name": "name", "type": "string"}]},
                    {
                        "name": "appointments",
                        "columns": [
                            {
                                "name": "pet_id",
                                "type": "integer",
                                "references": {"model": "pets", "column": "id"},
                            },
                            {
                                "name": "vet_id",
                                "type": "integer",
                                "references": {"model": "vets", "column": "id"},
                            },
                        ],
                    },
                ],
            }
        )
        assert "pet?: AppModels['pets'] | null" in out
        assert "vet?: AppModels['vets'] | null" in out


class TestHandlerInterfaces:
    def test_object_output_handler(self):
        out = generate_app_dts(
            backend={
                "handlers": [
                    {
                        "name": "send_invite",
                        "outputs": [
                            {"name": "ok", "type": "boolean"},
                            {"name": "id", "type": "uuid"},
                        ],
                    },
                ],
            }
        )
        assert "send_invite: { ok: boolean; id: string };" in out

    def test_array_field_in_multi_field_output_is_not_array_wrapped(self):
        # Regression: a multi-field output containing an array-typed field
        # describes ONE object whose field is array-shaped — NOT an array
        # of objects. Past behaviour wrapped the whole shape in ``[]``,
        # breaking handlers like coje33ih's ``getDashboardStats`` that
        # return ``{tco: number, chartData: T[]}`` — typing it as
        # ``{tco: number, chartData: T[]}[]`` so ``stats.tco`` failed tsc.
        out = generate_app_dts(
            backend={
                "handlers": [
                    {
                        "name": "list_posts",
                        "outputs": [
                            {"name": "rows", "type": "array"},
                            {"name": "title", "type": "string"},
                        ],
                    },
                ],
            }
        )
        assert "list_posts: { rows: unknown[]; title: string };" in out
        # And no stray trailing ``[]`` wrapping the object.
        assert "list_posts: { rows: unknown[]; title: string }[];" not in out

    def test_nameless_array_output_emits_top_level_array(self):
        # The canonical signal for "this handler returns ``T[]``" is a
        # single *nameless* ``type: "array"`` output. We treat it as a
        # bare array; the element type is opaque (``Record<…>``).
        out = generate_app_dts(
            backend={
                "handlers": [
                    {"name": "listIds", "outputs": [{"type": "array"}]},
                ],
            }
        )
        assert "listIds: Record<string, unknown>[];" in out

    def test_named_array_field_alone_is_object_not_array(self):
        # ``outputs: [{name: 'rows', type: 'array'}]`` is a single-field
        # object, NOT a top-level array — its name makes it a field.
        out = generate_app_dts(
            backend={
                "handlers": [
                    {
                        "name": "list_posts_v2",
                        "outputs": [{"name": "rows", "type": "array"}],
                    },
                ],
            }
        )
        assert "list_posts_v2: { rows: unknown[] };" in out
        assert "list_posts_v2: { rows: unknown[] }[];" not in out

    def test_dashboard_stats_regression(self):
        # Direct replay of the coje33ih ``getDashboardStats`` shape. The
        # handler returns one object with five fields, the last of which
        # is an array. Past behaviour wrapped the whole thing in ``[]``
        # → ``Property 'existingTco' does not exist on type {…}[]`` →
        # 2× retries before the agent gave up.
        out = generate_app_dts(
            backend={
                "handlers": [
                    {
                        "name": "getDashboardStats",
                        "outputs": [
                            {"name": "existingTco", "type": "real"},
                            {"name": "proposedTco", "type": "real"},
                            {"name": "savings", "type": "real"},
                            {"name": "payback", "type": "real"},
                            {"name": "chartData", "type": "array"},
                        ],
                    },
                ],
            }
        )
        assert (
            "getDashboardStats: { existingTco: number; proposedTco: number; "
            "savings: number; payback: number; chartData: unknown[] };"
        ) in out

    def test_handler_no_outputs_uses_record_fallback(self):
        out = generate_app_dts(backend={"handlers": [{"name": "noop"}]})
        assert "noop: Record<string, unknown>;" in out

    # ── Regression: getTrendingArticles in Zenith Knowledge Base shipped
    # with two unresolved tsc warnings because the Creator emitted
    # ``outputs: ["trendingArticles: json"]`` and the dts generator
    # mapped ``json`` → ``Record<string, unknown>`` — which blocks
    # ``.length``/``.map``/field reads. Components then triple-cast
    # ``(data as unknown as X)?.field ?? []`` and the second tsc retry
    # still fails on the cast itself. The mapping is now ``any`` so
    # the access patterns the LLM actually writes pass typecheck while
    # preserving the run-time semantics (``json`` is opaque anyway).

    def test_handler_with_json_output_emits_any(self):
        out = generate_app_dts(
            backend={
                "handlers": [
                    {
                        "name": "getTrendingArticles",
                        "outputs": [{"name": "trendingArticles", "type": "json"}],
                    },
                ],
            }
        )
        assert "getTrendingArticles: { trendingArticles: any };" in out

    def test_handler_with_object_output_emits_any(self):
        out = generate_app_dts(
            backend={
                "handlers": [
                    {
                        "name": "getMeta",
                        "outputs": [{"name": "meta", "type": "object"}],
                    },
                ],
            }
        )
        assert "getMeta: { meta: any };" in out

    # ── Typed-array outputs let the Creator declare ``array<modelName>``
    # so the consumer hook resolves to ``AppModels['x'][]`` directly,
    # eliminating the need for the LLM to invent a local interface.

    def test_handler_with_array_modelname_output_resolves_to_appmodels(self):
        out = generate_app_dts(
            backend={
                "models": [{"name": "articles", "columns": [{"name": "title", "type": "string"}]}],
                "handlers": [
                    {
                        "name": "getTrendingArticles",
                        "outputs": [{"name": "trendingArticles", "type": "array<articles>"}],
                    },
                ],
            }
        )
        assert "getTrendingArticles: { trendingArticles: AppModels['articles'][] };" in out

    def test_handler_with_array_primitive_output(self):
        out = generate_app_dts(
            backend={
                "handlers": [
                    {
                        "name": "listTags",
                        "outputs": [{"name": "tags", "type": "array<string>"}],
                    },
                ],
            }
        )
        assert "listTags: { tags: string[] };" in out

    def test_handler_with_string_form_array_modelname(self):
        # The HandlerPlan stores outputs as ``"name: type"`` strings before
        # ``_build_handler_metadata`` parses them; the dts generator must
        # accept the same shape end-to-end.
        out = generate_app_dts(
            backend={
                "handlers": [
                    {
                        "name": "getTrendingArticles",
                        "outputs": ["trendingArticles: array<articles>"],
                    },
                ],
            }
        )
        assert "getTrendingArticles: { trendingArticles: AppModels['articles'][] };" in out

    def test_handler_array_unknown_inner_falls_back_to_unknown(self):
        # Inline ``{...}`` element shapes aren't supported yet (the
        # planner-side ``"name: type"`` parser splits on the inner comma);
        # such inputs degrade to ``unknown[]`` rather than crashing.
        out = generate_app_dts(
            backend={
                "handlers": [
                    {
                        "name": "complex",
                        "outputs": [{"name": "rows", "type": "array<{a: number}>"}],
                    },
                ],
            }
        )
        # The whole bracketed expression gets passed to _array_element_to_ts
        # and falls through (``{`` isn't alphanumeric) → ``unknown``.
        assert "complex: { rows: unknown[] };" in out


class TestStateInterface:
    def test_typed_state_keys(self):
        out = generate_app_dts(
            logic={
                "state": {
                    "isOpen": False,
                    "count": 0,
                    "query": "",
                    "items": [],
                    "config": {},
                    "user": None,
                }
            }
        )
        assert "isOpen: boolean;" in out
        assert "count: number;" in out
        assert "query: string;" in out
        assert "items: unknown[];" in out
        assert "config: Record<string, unknown>;" in out
        assert "user: unknown;" in out


class TestRouteAlias:
    def test_routes_become_interface_entries(self):
        out = generate_app_dts(
            pages=[
                {"slug": "/"},
                {"slug": "/posts"},
                {"slug": "/posts/:id"},
            ]
        )
        # AppRoutes interface is augmented with one entry per slug.
        # ``keyof AppRoutes`` resolves to the union of declared paths.
        assert "'/': true;" in out
        assert "'/posts': true;" in out
        assert "'/posts/:id': true;" in out

    def test_no_pages_falls_back_to_empty_with_comment(self):
        out = generate_app_dts()
        assert "(no routes declared)" in out

    def test_duplicate_slugs_deduped(self):
        out = generate_app_dts(pages=[{"slug": "/"}, {"slug": "/dashboard"}, {"slug": "/"}])
        # Each slug appears exactly once.
        assert out.count("'/': true;") == 1


class TestStability:
    def test_outputs_stable_across_calls(self):
        # Same inputs → byte-identical output (no ordering drift).
        backend = {
            "models": [{"name": "m", "columns": [{"name": "x", "type": "string"}]}],
            "handlers": [{"name": "h", "outputs": [{"name": "ok", "type": "boolean"}]}],
        }
        a = generate_app_dts(backend=backend, logic={"state": {"k": True}}, pages=[{"slug": "/"}])
        b = generate_app_dts(backend=backend, logic={"state": {"k": True}}, pages=[{"slug": "/"}])
        assert a == b
