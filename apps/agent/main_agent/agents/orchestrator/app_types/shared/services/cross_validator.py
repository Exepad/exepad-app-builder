"""
Deterministic cross-validator for assembled app configurations.

Runs post-assembly (after all builder artifacts are merged) to detect and
auto-fix structural inconsistencies across the full app_config. No LLM calls —
purely rule-based checks.
"""

import re
from typing import Any

import structlog

logger = structlog.get_logger(__name__)

# Hardcoded Tailwind color patterns that should not appear in sidebar/footer.
# Matches both numbered variants (bg-slate-900) and plain bg-white/text-white/bg-black.
_HARDCODED_COLOR_PATTERN = re.compile(
    r"\b(?:"
    r"bg-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|"
    r"emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}"
    r"|text-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|"
    r"emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}"
    r"|bg-white|bg-black|text-white"
    r")\b"
)

_MUSTACHE_PATTERN = re.compile(r"\{\{.*?\}\}")

# Mapping of common hardcoded Tailwind colors to semantic token equivalents.
_HARDCODED_TO_SEMANTIC: dict[str, str] = {
    # Dark backgrounds → card
    "bg-zinc-900": "bg-card",
    "bg-zinc-950": "bg-card",
    "bg-gray-900": "bg-card",
    "bg-slate-900": "bg-card",
    "bg-neutral-900": "bg-card",
    "bg-stone-900": "bg-card",
    "bg-black": "bg-card",
    # Light backgrounds → background
    "bg-white": "bg-background",
    "bg-gray-50": "bg-background",
    "bg-slate-50": "bg-background",
    "bg-zinc-50": "bg-background",
    # Muted backgrounds
    "bg-gray-100": "bg-muted",
    "bg-slate-100": "bg-muted",
    "bg-zinc-100": "bg-muted",
    "bg-gray-800": "bg-muted",
    "bg-zinc-800": "bg-muted",
    "bg-slate-800": "bg-muted",
    # White text → card-foreground
    "text-white": "text-card-foreground",
    # Dark text → foreground
    "text-zinc-900": "text-foreground",
    "text-zinc-800": "text-foreground",
    "text-zinc-700": "text-foreground",
    "text-slate-900": "text-foreground",
    "text-gray-900": "text-foreground",
    "text-gray-800": "text-foreground",
    # Muted text → muted-foreground
    "text-zinc-600": "text-muted-foreground",
    "text-zinc-500": "text-muted-foreground",
    "text-zinc-400": "text-muted-foreground",
    "text-zinc-300": "text-muted-foreground",
    "text-slate-600": "text-muted-foreground",
    "text-slate-500": "text-muted-foreground",
    "text-gray-600": "text-muted-foreground",
    "text-gray-500": "text-muted-foreground",
    "text-gray-400": "text-muted-foreground",
    # Borders
    "border-zinc-200": "border-border",
    "border-zinc-300": "border-border",
    "border-zinc-800": "border-border",
    "border-zinc-100": "border-border",
    "border-slate-200": "border-border",
    "border-gray-200": "border-border",
}


class CrossValidator:
    """Deterministic validator for assembled app configurations."""

    def validate_and_fix(self, app_config: dict) -> list[str]:
        """
        Run all validation checks and apply safe auto-fixes.

        Returns a list of warning messages for issues found.
        Modifies app_config in-place for auto-fixable issues.
        """
        warnings: list[str] = []

        logic = app_config.get("frontend", {}).get("logic", {})
        backend = app_config.get("backend", {})
        state = logic.get("state", {})
        actions = logic.get("actions", {})  # legacy — may still exist in old configs
        computed = logic.get("computed", {})  # legacy — may still exist in old configs
        models = backend.get("models", [])
        handlers = backend.get("handlers", [])
        repo_handlers = app_config.get("repo", {}).get("backend", {}).get("handlers", {})

        model_names = {m["name"].lower() for m in models if isinstance(m, dict) and m.get("name")}
        if not handlers and repo_handlers:
            handler_names = set(repo_handlers.keys())
        else:
            handler_names = {
                h.get("name") or h.get("method", "") for h in handlers if isinstance(h, dict)
            }

        triggered = self._find_triggered_actions(app_config)
        resultfield_handler_map = self._find_resultfield_to_handler_map(actions)

        # Code Focus apps call handlers directly from component TSX via
        # `useHandler(name)` — not through `frontend.logic.actions`. The
        # legacy action-based checks always emit false positives for them,
        # so skip action-scoped checks when we detect a Code Focus repo.
        is_code_focus = bool(app_config.get("repo", {}).get("frontend", {}).get("components"))

        warnings.extend(self._check_orphan_computed_refs(state, actions, computed))
        warnings.extend(self._check_computed_refs_nonexistent_state(state, computed, model_names))
        if not is_code_focus:
            warnings.extend(self._check_unused_handlers(actions, handler_names))
        warnings.extend(self._check_orphan_action_handlers(actions, handler_names))
        warnings.extend(self._check_conditional_static_fields(app_config))
        warnings.extend(self._check_generic_action_id(app_config))
        warnings.extend(self._check_hardcoded_nav_colors(app_config))
        warnings.extend(self._check_inline_chart_data(app_config))
        warnings.extend(self._check_state_shadows_models(state, actions, model_names))
        warnings.extend(
            self._check_chart_state_data_sources(
                app_config, actions, triggered, resultfield_handler_map
            )
        )
        warnings.extend(self._check_untriggered_handler_actions(actions, handler_names, triggered))

        warnings.extend(self._check_undefined_role_references(app_config, models))
        warnings.extend(self._check_repo_components(app_config))

        # Code Focus specific: remove untriggered data-loading actions and their
        # state targets when a handler.X pattern can serve the data directly.
        # This prevents "KPIs show 0" bugs where a component reads from state
        # populated by an action that is never dispatched.
        warnings.extend(
            self._fix_untriggered_state_actions(
                app_config, actions, triggered, resultfield_handler_map
            )
        )

        # Auto-fixes
        warnings.extend(self._fix_orphan_repo_seed(app_config, model_names))
        warnings.extend(self._fix_shadow_state_arrays(app_config, state, actions, model_names))
        warnings.extend(self._fix_missing_selected_state(app_config, state, actions))
        warnings.extend(self._fix_chart_handler_data_source(app_config, resultfield_handler_map))
        warnings.extend(self._fix_public_read_pii_inbox(app_config, models))
        warnings.extend(self._fix_missing_security_for_auth_scaffold(app_config))
        warnings.extend(self._fix_missing_security_for_authenticated_crud(app_config, models))
        warnings.extend(self._fix_hardcoded_colors(app_config))
        warnings.extend(self._fix_missing_form_labels(app_config))
        warnings.extend(self._fix_http_image_urls(app_config))

        return warnings

    def _check_orphan_computed_refs(self, state: dict, actions: dict, computed: dict) -> list[str]:
        """Check computed values that reference unpopulated state arrays."""
        warnings = []
        populated_by_action = self._find_populated_state_keys(actions)

        for name, expr in computed.items():
            if not isinstance(expr, dict):
                continue
            for op in ("count", "sum", "filter", "find"):
                ref = expr.get(op)
                if not ref or not isinstance(ref, str):
                    continue
                if (
                    ref in state
                    and isinstance(state.get(ref), list)
                    and ref not in populated_by_action
                ):
                    warnings.append(
                        f"Computed '{name}' uses {{{op}: '{ref}'}} but state.{ref} "
                        f"is an empty array never populated by any action"
                    )
        return warnings

    def _check_unused_handlers(self, actions: dict, handler_names: set[str]) -> list[str]:
        """Check for backend handlers not referenced by any frontend action."""
        warnings = []
        referenced_handlers = set()
        for _name, steps in actions.items():
            for step in self._normalize_steps(steps):
                api = step.get("api", {})
                if isinstance(api, dict):
                    h = api.get("handler", "")
                    if h:
                        referenced_handlers.add(h)

        for handler in handler_names:
            if handler and handler not in referenced_handlers:
                warnings.append(f"Handler '{handler}' is defined but never called by any action")
        return warnings

    def _check_orphan_action_handlers(self, actions: dict, handler_names: set[str]) -> list[str]:
        """Check actions that call handlers not defined in backend."""
        warnings = []
        for action_name, steps in actions.items():
            for step in self._normalize_steps(steps):
                api = step.get("api", {})
                if isinstance(api, dict) and api.get("type") == "handler":
                    h = api.get("handler", "")
                    if h and h not in handler_names:
                        warnings.append(
                            f"Action '{action_name}' calls handler '{h}' "
                            f"which is not defined in backend.handlers"
                        )
        return warnings

    def _check_conditional_static_fields(self, app_config: dict) -> list[str]:
        """Scan for {{}} Mustache expressions in actionId and ModalProps.title."""
        warnings = []
        self._walk_components(
            app_config,
            lambda comp, path: warnings.extend(self._check_component_static_fields(comp, path)),
        )
        return warnings

    def _check_component_static_fields(self, component: dict, path: str) -> list[str]:
        warnings = []
        comp_type = component.get("componentType", "")

        if comp_type == "ModalProps":
            title = component.get("title", "")
            if isinstance(title, str) and _MUSTACHE_PATTERN.search(title):
                warnings.append(f"ModalProps at {path} has {{{{}}}} expression in title: '{title}'")

        submit = component.get("onSubmitAction", {})
        if isinstance(submit, dict):
            action_id = submit.get("actionId", "")
            if isinstance(action_id, str) and _MUSTACHE_PATTERN.search(action_id):
                warnings.append(
                    f"Form at {path} has {{{{}}}} expression in actionId: '{action_id}'"
                )
            if isinstance(action_id, str) and "$" in action_id and "?" in action_id:
                warnings.append(
                    f"Form at {path} has conditional expression in actionId: '{action_id}'"
                )
        return warnings

    def _check_hardcoded_nav_colors(self, app_config: dict) -> list[str]:
        """Scan all frontend components for hardcoded Tailwind color classes."""
        warnings = []
        frontend = app_config.get("frontend", {})

        for region in ("sidebar", "footer", "header"):
            components = frontend.get(region, [])
            if not isinstance(components, list):
                continue
            for comp in components:
                self._scan_classes_recursive(comp, f"frontend.{region}", warnings)

        for page in frontend.get("pages", []):
            slug = page.get("slug", "unknown")
            for comp in page.get("content", []):
                self._scan_classes_recursive(comp, f"frontend.pages[{slug}]", warnings)

        return warnings

    def _scan_classes_recursive(self, node: Any, path: str, warnings: list[str]) -> None:
        if isinstance(node, dict):
            classes = node.get("classes", "")
            if isinstance(classes, str):
                matches = _HARDCODED_COLOR_PATTERN.findall(classes)
                if matches:
                    comp_type = node.get("componentType", "unknown")
                    warnings.append(
                        f"Hardcoded color(s) {matches} in {comp_type} at {path} — "
                        f"use semantic tokens instead"
                    )
            for key, val in node.items():
                self._scan_classes_recursive(val, f"{path}.{key}", warnings)
        elif isinstance(node, list):
            for i, item in enumerate(node):
                self._scan_classes_recursive(item, f"{path}[{i}]", warnings)

    def _check_inline_chart_data(self, app_config: dict) -> list[str]:
        """Check ChartProps for inline data arrays instead of dataset references."""
        warnings = []
        self._walk_components(
            app_config,
            lambda comp, path: (
                warnings.append(
                    f"ChartProps at {path} has inline data array — "
                    f"use dataset.X or model.X reference instead"
                )
                if comp.get("componentType") == "ChartProps" and isinstance(comp.get("data"), list)
                else None
            ),
        )
        return warnings

    def _check_state_shadows_models(
        self, state: dict, actions: dict, model_names: set[str]
    ) -> list[str]:
        """Warn when state arrays share names with backend models."""
        warnings = []
        populated = self._find_populated_state_keys(actions)

        for key, val in state.items():
            if isinstance(val, list) and key.lower() in model_names and key not in populated:
                warnings.append(
                    f"State '{key}' is an empty array shadowing model '{key}' — "
                    f"model data is auto-fetched and never enters state"
                )
        return warnings

    def _check_computed_refs_nonexistent_state(
        self, state: dict, computed: dict, model_names: set[str]
    ) -> list[str]:
        """Check computed values referencing state keys that don't exist at all."""
        warnings = []
        for name, expr in computed.items():
            if not isinstance(expr, dict):
                continue
            for op in ("count", "sum", "filter", "find"):
                ref = expr.get(op)
                if not ref or not isinstance(ref, str):
                    continue
                if ref not in state:
                    extra = ""
                    if ref.lower() in model_names:
                        extra = (
                            f" ('{ref}' is a backend model — model data is not "
                            f"in state; use a handler to aggregate)"
                        )
                    warnings.append(
                        f"Computed '{name}' references state.{ref} which does not exist{extra}"
                    )
        return warnings

    def _check_generic_action_id(self, app_config: dict) -> list[str]:
        """Check for generic actionId values like 'save_X' that cause CRUD ambiguity."""
        warnings: list[str] = []

        def _visitor(comp: dict, path: str) -> None:
            submit = comp.get("onSubmitAction")
            if not isinstance(submit, dict):
                return
            aid = submit.get("actionId", "")
            if isinstance(aid, str) and aid.startswith("save_"):
                warnings.append(
                    f"Form at {path} has generic actionId '{aid}' — "
                    f"use 'create_X' or 'update_X' for correct CRUD mapping"
                )

        self._walk_components(app_config, _visitor)
        return warnings

    def _check_chart_state_data_sources(
        self,
        app_config: dict,
        actions: dict,
        triggered: set[str],
        resultfield_handler_map: dict[str, str],
    ) -> list[str]:
        """Warn when ChartProps use state.X but the populating action is never triggered."""
        warnings: list[str] = []
        populated_by = self._find_populated_state_keys(actions)

        # Build reverse map: state_key -> action_name(s) that populate it
        state_key_to_actions: dict[str, list[str]] = {}
        for action_name, steps in actions.items():
            for step in self._normalize_steps(steps):
                for target in (
                    step.get("set"),
                    (step.get("api") or {}).get("resultField"),
                ):
                    if target and isinstance(target, str):
                        state_key_to_actions.setdefault(target, []).append(action_name)

        def _visitor(comp: dict, path: str) -> None:
            if comp.get("componentType") not in ("ChartProps", "DataTableProps"):
                return
            data = comp.get("data")
            if not isinstance(data, str) or not data.startswith("state."):
                return

            parts = data.split(".", 2)
            root_key = parts[1] if len(parts) > 1 else ""
            if not root_key:
                return

            if root_key not in populated_by:
                warnings.append(
                    f"{comp['componentType']} at {path} uses data='{data}' "
                    f"but state.{root_key} is never populated by any action"
                )
                return

            populating_actions = state_key_to_actions.get(root_key, [])
            untriggered = [a for a in populating_actions if a not in triggered]
            if untriggered and len(untriggered) == len(populating_actions):
                handler_hint = ""
                if root_key in resultfield_handler_map:
                    handler_hint = f" — use 'handler.{resultfield_handler_map[root_key]}' instead"
                warnings.append(
                    f"{comp['componentType']} at {path} uses data='{data}' but the "
                    f"populating action(s) {untriggered} are never triggered"
                    f"{handler_hint}"
                )

        self._walk_components(app_config, _visitor)
        return warnings

    def _check_untriggered_handler_actions(
        self,
        actions: dict,
        handler_names: set[str],
        triggered: set[str],
    ) -> list[str]:
        """Warn when actions call backend handlers but are never triggered."""
        warnings: list[str] = []
        for action_name, steps in actions.items():
            if action_name in triggered:
                continue
            for step in self._normalize_steps(steps):
                api = step.get("api")
                if not isinstance(api, dict) or api.get("type") != "handler":
                    continue
                handler = api.get("handler", "")
                if handler:
                    warnings.append(
                        f"Action '{action_name}' calls handler '{handler}' "
                        f"but is never triggered by any component or other action"
                    )
                    break
        return warnings

    def _check_repo_components(self, app_config: dict) -> list[str]:
        """Validate repo.components entries have required fields and no inline source."""
        warnings: list[str] = []
        repo = app_config.get("repo", {})
        repo_components = repo.get("components", {})
        # Code Focus apps nest components under repo.frontend.components
        if not repo_components:
            repo_components = repo.get("frontend", {}).get("components", {})

        # Collect all component names referenced in CodeComponentProps
        referenced_components: set[str] = set()
        self._walk_components(
            app_config.get("frontend", {}),
            lambda comp, path: (
                referenced_components.add(comp["component"])
                if comp.get("componentType") == "CodeComponentProps" and comp.get("component")
                else None
            ),
        )

        for name, config in repo_components.items():
            if not isinstance(config, dict):
                continue

            # Check for missing compiled field
            if not config.get("compiled"):
                warnings.append(
                    f"repo.components[{name}]: missing 'compiled' field — "
                    f"component will fail to load at runtime"
                )

            # Check for inline source code (should be a file path, not code)
            source = config.get("source", "")
            if "\n" in source or "import " in source:
                warnings.append(
                    f"repo.components[{name}]: 'source' contains inline code "
                    f"instead of a file path — this bloats the config and "
                    f"bypasses the GCS upload pipeline"
                )

        # Check for CodeComponentProps referencing non-existent repo entries
        for ref_name in referenced_components:
            if ref_name not in repo_components:
                warnings.append(
                    f"CodeComponentProps references component '{ref_name}' "
                    f"but no matching repo.components entry exists"
                )

        return warnings

    # ---- Auto-fixes ----

    def _fix_orphan_repo_seed(self, app_config: dict, model_names: set[str]) -> list[str]:
        """Remove repo.seed entries that don't match any backend model."""
        warnings = []
        repo_seed = app_config.get("repo", {}).get("seed", {})
        if not repo_seed:
            return warnings

        # System tables (e.g. _auth_users, _auth_accounts) are auto-created by
        # the deploy pipeline and are NOT listed in backend.models[].
        orphans = [
            name
            for name in repo_seed
            if name.lower() not in model_names and not name.startswith("_auth_")
        ]
        for name in orphans:
            del repo_seed[name]
            warnings.append(f"Auto-fix: removed repo.seed['{name}'] (no matching backend model)")
        return warnings

    def _fix_shadow_state_arrays(
        self, app_config: dict, state: dict, actions: dict, model_names: set[str]
    ) -> list[str]:
        """Remove state arrays that shadow model names and are never populated."""
        warnings = []
        populated = self._find_populated_state_keys(actions)
        logic = app_config.get("frontend", {}).get("logic", {})
        mutable_state = logic.get("state", {})

        shadows = [
            key
            for key, val in state.items()
            if isinstance(val, list) and key.lower() in model_names and key not in populated
        ]
        for key in shadows:
            if key in mutable_state:
                del mutable_state[key]
                warnings.append(f"Auto-fix: removed state.{key} (shadows model, never populated)")
        return warnings

    def _fix_missing_selected_state(
        self, app_config: dict, state: dict, actions: dict
    ) -> list[str]:
        """Auto-add missing selectedX state variables referenced by actions."""
        warnings = []
        logic = app_config.get("frontend", {}).get("logic", {})
        mutable_state = logic.get("state", {})

        for _action_name, steps in actions.items():
            for step in self._normalize_steps(steps):
                target = step.get("set")
                value = step.get("to")
                if (
                    target
                    and isinstance(target, str)
                    and target.startswith("selected")
                    and target not in mutable_state
                    and value == "$payload"
                ):
                    mutable_state[target] = None
                    warnings.append(
                        f"Auto-fix: added state.{target} = null "
                        f"(referenced by action but missing from state)"
                    )
        return warnings

    def _fix_chart_handler_data_source(
        self,
        app_config: dict,
        resultfield_handler_map: dict[str, str],
    ) -> list[str]:
        """Rewrite ChartProps/DataTableProps data from state.X to handler.Y when possible."""
        if not resultfield_handler_map:
            return []

        warnings: list[str] = []

        def _visitor(comp: dict, _path: str) -> None:
            if comp.get("componentType") not in ("ChartProps", "DataTableProps"):
                return
            data = comp.get("data")
            if not isinstance(data, str) or not data.startswith("state."):
                return

            parts = data.split(".", 2)
            root_key = parts[1] if len(parts) > 1 else ""
            field_suffix = parts[2] if len(parts) > 2 else ""

            handler_name = resultfield_handler_map.get(root_key)
            if not handler_name:
                return

            new_data = f"handler.{handler_name}"
            if field_suffix:
                new_data += f".{field_suffix}"

            old_data = comp["data"]
            comp["data"] = new_data
            warnings.append(
                f"Auto-fix: {comp['componentType']} at {_path} — "
                f"changed data from '{old_data}' to '{new_data}'"
            )

        self._walk_components(app_config, _visitor)
        return warnings

    def _fix_missing_security_for_auth_scaffold(self, app_config: dict) -> list[str]:
        """Auto-inject minimal security config when AuthScaffoldProps exists but security is missing."""
        warnings = []

        # Check if any page contains an AuthScaffoldProps component
        has_auth_scaffold = False

        def _check_auth_scaffold(comp: dict, _path: str) -> None:
            nonlocal has_auth_scaffold
            if comp.get("componentType") == "AuthScaffoldProps":
                has_auth_scaffold = True

        self._walk_components(app_config, _check_auth_scaffold)

        if not has_auth_scaffold:
            return warnings

        # Check if security config exists at root level
        security = app_config.get("security")
        if security and isinstance(security, dict) and security.get("authProviders"):
            return warnings

        # Auto-inject minimal security config
        app_config["security"] = {
            "authProviders": [{"provider": "email"}],
            "sessionDuration": 604800,
            "allowSignup": True,
        }
        warnings.append(
            "Auto-fix: injected minimal security config (AuthScaffoldProps found "
            "but no security config was present)"
        )
        return warnings

    # Contact-PII column signals — their presence on a public-read inbox means
    # every visitor can read other people's contact details.
    _PII_COLUMN_NAMES = frozenset(
        {"email", "phone", "phone_number", "phonenumber", "mobile", "tel", "telephone"}
    )
    _PII_COLUMN_SUFFIXES = ("_email", "_phone")

    def _model_has_contact_pii(self, model: dict) -> bool:
        for col in model.get("columns", []) or []:
            if not isinstance(col, dict):
                continue
            name = (col.get("name") or "").lower()
            if name in self._PII_COLUMN_NAMES or name.endswith(self._PII_COLUMN_SUFFIXES):
                return True
        return False

    def _fix_public_read_pii_inbox(self, app_config: dict, models: list[dict]) -> list[str]:
        """Lock down world-readable contact-PII submission inboxes.

        A ``shared`` model with ``crudPolicy.read == 'public'`` that carries contact
        PII (an ``email``/``phone`` column) is an anonymous submission inbox — a
        contact form, adoption/volunteer application, trial signup, etc. With
        ``read: 'public'`` every visitor can read every OTHER submitter's name,
        email, phone, and message (confirmed live on a generated rescue-org app:
        anon ``sys_list`` returned all applicants' PII). The agent picks this shape
        because it conflates "anyone can SUBMIT" with "anyone can READ".

        Fix: downgrade ``read`` (and any ``public`` ``update``/``delete``) to
        ``'role:admin'`` so only the operator manages submissions. ``create`` is
        left untouched, so the public can still submit. The operator keeps read
        access in both preview (preview-owner carries the admin role) and published
        (the platform session is admin); the admin data browser bypasses crudPolicy
        entirely. A shared public-read model WITHOUT contact-PII columns is treated
        as a legitimately-public catalogue (pets, books, recipes, products) and is
        left completely untouched — that is the tight scoping that avoids breaking
        intentionally-public data.
        """
        warnings: list[str] = []
        ADMIN = "role:admin"
        for model in models:
            if not isinstance(model, dict):
                continue
            if (model.get("ownerScope") or "user") != "shared":
                continue
            policy = model.get("crudPolicy")
            if not isinstance(policy, dict) or policy.get("read") != "public":
                continue
            if not self._model_has_contact_pii(model):
                continue

            changed = []
            for op in ("read", "update", "delete"):
                if policy.get(op) == "public":
                    policy[op] = ADMIN
                    changed.append(op)
            if changed:
                warnings.append(
                    f"Auto-fix: model '{model.get('name')}' collects contact PII "
                    f"(email/phone) but had read:'public' on a shared model — every "
                    f"visitor could read all submissions. Downgraded {changed} to "
                    f"'role:admin' (operator-only); 'create' is unchanged so the "
                    f"public can still submit."
                )
        return warnings

    def _fix_missing_security_for_authenticated_crud(
        self, app_config: dict, models: list[dict]
    ) -> list[str]:
        """Auto-inject minimal email-auth security when a backend model requires
        authentication but no auth providers are configured.

        The Creator emits ``app_config["security"]`` only when its
        ``app_security_plan.needs_auth`` is true, but the backend model builder
        independently sets each model's ``crudPolicy``. A weak model can produce an
        INCOHERENT plan — e.g. a support tracker with
        ``crudPolicy.{create,update,delete}: 'authenticated'`` yet ``needs_auth``
        false — so ``security`` is omitted entirely. The deployed app is then
        unusable AND its access model is accidental: writes require a signed-in
        user, but with no auth providers the gateway never routes
        ``auth_signup``/``auth_signin`` (they 404), so no one can ever authenticate
        to perform them. (Observed live on a generated ticket tracker.)

        This mirrors ``_fix_missing_security_for_auth_scaffold`` but triggers on the
        backend ``crudPolicy`` instead of an ``AuthScaffoldProps`` component, so it
        also covers Code Focus apps (TSX components, no JSON auth scaffold). It only
        makes auth AVAILABLE (providers + signup) — it deliberately does NOT set
        ``defaultAccess``/``pageAccess``, so public pages stay public and a model's
        own ``read: 'public'`` policy is untouched.
        """
        warnings: list[str] = []

        def _level_requires_auth(level: object) -> bool:
            return isinstance(level, str) and (
                level in ("authenticated", "owner") or level.startswith("role:")
            )

        requires_auth = False
        for model in models:
            if not isinstance(model, dict):
                continue
            policy = model.get("crudPolicy") or {}
            if isinstance(policy, dict) and any(
                _level_requires_auth(policy.get(op))
                for op in ("create", "read", "update", "delete")
            ):
                requires_auth = True
                break

        if not requires_auth:
            return warnings

        # Already has auth providers? Nothing to do.
        security = app_config.get("security")
        if security and isinstance(security, dict) and security.get("authProviders"):
            return warnings

        app_config["security"] = {
            "authProviders": [{"provider": "email"}],
            "sessionDuration": 604800,
            "allowSignup": True,
        }
        warnings.append(
            "Auto-fix: injected minimal email-auth security config (a backend model's "
            "crudPolicy requires authentication but no auth providers were configured — "
            "without this, authenticated CRUD is unreachable because auth_signup/"
            "auth_signin never get routed)"
        )
        return warnings

    def _check_undefined_role_references(self, app_config: dict, models: list[dict]) -> list[str]:
        """Check that all role:X references in page access and crudPolicy match security.roles."""
        warnings = []
        security = app_config.get("security", {})
        if not security or not isinstance(security, dict):
            return warnings

        # Build the set of defined roles (including hierarchy parents/children)
        defined_roles: set[str] = set(security.get("roles", []))
        for parent, children in security.get("roleHierarchy", {}).items():
            defined_roles.add(parent)
            if isinstance(children, list):
                defined_roles.update(children)

        if not defined_roles:
            return warnings

        # Check page access fields
        for page in app_config.get("frontend", {}).get("pages", []):
            access = page.get("access", "")
            if isinstance(access, str) and access.startswith("role:"):
                role_name = access[5:]
                if role_name not in defined_roles:
                    warnings.append(
                        f"Undefined role reference: page '{page.get('slug', '?')}' "
                        f"has access='{access}' but role '{role_name}' is not in "
                        f"security.roles {sorted(defined_roles)}"
                    )

        # Check model crudPolicy
        for model in models:
            if not isinstance(model, dict):
                continue
            crud = model.get("crudPolicy", {})
            if not isinstance(crud, dict):
                continue
            for op, level in crud.items():
                if isinstance(level, str) and level.startswith("role:"):
                    role_name = level[5:]
                    if role_name not in defined_roles:
                        warnings.append(
                            f"Undefined role reference: model '{model.get('name', '?')}' "
                            f"crudPolicy.{op}='{level}' but role '{role_name}' is not in "
                            f"security.roles {sorted(defined_roles)}"
                        )

        return warnings

    def _fix_untriggered_state_actions(
        self,
        app_config: dict,
        actions: dict,
        triggered: set[str],
        resultfield_handler_map: dict[str, str],
    ) -> list[str]:
        """Remove untriggered data-loading actions and redirect components to handler.X.

        When an action calls a handler and stores the result in state via
        ``resultField``, but no component ever dispatches the action, the state
        remains at its initial value (null/[]).  If the handler is available via
        ``handler.X``, the runtime can auto-fetch it on mount — making the action
        unnecessary.

        This fix:
        1. Identifies untriggered actions whose only purpose is handler → state
        2. Removes those actions from ``frontend.logic.actions``
        3. Removes the orphaned ``resultField`` state key from ``frontend.logic.state``
        """
        warnings: list[str] = []
        logic = app_config.get("frontend", {}).get("logic", {})
        mutable_actions = logic.get("actions", {})
        mutable_state = logic.get("state", {})

        actions_to_remove: list[str] = []
        state_keys_to_remove: list[str] = []

        # Actions referenced in onMount/onUnmount are mount-triggered, not untriggered
        on_mount: list[str] = (
            logic.get("onMount", []) if isinstance(logic.get("onMount"), list) else []
        )
        on_unmount: list[str] = (
            logic.get("onUnmount", []) if isinstance(logic.get("onUnmount"), list) else []
        )
        mount_referenced = set(on_mount) | set(on_unmount)

        for action_name, steps in list(actions.items()):
            if action_name in triggered:
                continue
            if action_name in mount_referenced:
                continue

            # Only target simple data-loading actions: set loading → api call → set loading
            normalized = self._normalize_steps(steps)
            handler_steps = [
                s
                for s in normalized
                if isinstance(s.get("api"), dict) and s["api"].get("type") == "handler"
            ]
            if not handler_steps:
                continue

            # Check each handler step has a resultField with a known handler mapping
            all_redirectable = True
            step_targets: list[str] = []
            for step in handler_steps:
                rf = step["api"].get("resultField", "")
                handler_name = step["api"].get("handler", "")
                if rf and handler_name and rf in resultfield_handler_map:
                    step_targets.append(rf)
                else:
                    all_redirectable = False
                    break

            if all_redirectable and step_targets:
                actions_to_remove.append(action_name)
                state_keys_to_remove.extend(step_targets)

        for action_name in actions_to_remove:
            if action_name in mutable_actions:
                del mutable_actions[action_name]
                warnings.append(
                    f"Auto-fix: removed untriggered action '{action_name}' "
                    f"(data available via handler.X pattern)"
                )

        for key in state_keys_to_remove:
            if key in mutable_state:
                del mutable_state[key]
                warnings.append(
                    f"Auto-fix: removed orphaned state.{key} "
                    f"(was only populated by a removed untriggered action)"
                )

        # Clean up computed values that reference removed state keys
        mutable_computed = logic.get("computed", {})
        if mutable_computed and state_keys_to_remove:
            computed_to_remove: list[str] = []
            for comp_name, expression in list(mutable_computed.items()):
                if not isinstance(expression, str):
                    continue
                for key in state_keys_to_remove:
                    if f"${key}" in expression:
                        computed_to_remove.append(comp_name)
                        break
            for comp_name in computed_to_remove:
                if comp_name in mutable_computed:
                    del mutable_computed[comp_name]
                    warnings.append(
                        f"Auto-fix: removed computed.{comp_name} " f"(references removed state key)"
                    )

        return warnings

    # ---- Helpers ----

    def _find_populated_state_keys(self, actions: dict) -> set[str]:
        """Find state keys that are written to by at least one action."""
        populated = set()
        for _name, steps in actions.items():
            for step in self._normalize_steps(steps):
                target = step.get("set")
                if target:
                    populated.add(target)
                result_field = (step.get("api") or {}).get("resultField")
                if result_field:
                    populated.add(result_field)
        return populated

    @staticmethod
    def _normalize_steps(steps) -> list[dict]:
        """Normalize action steps: single dict → [dict], list kept as-is, else []."""
        if isinstance(steps, dict):
            return [steps]
        if isinstance(steps, list):
            return [s for s in steps if isinstance(s, dict)]
        return []

    def _find_triggered_actions(self, app_config: dict) -> set[str]:
        """Find action names that are actually triggered by component events or other actions."""
        triggered: set[str] = set()

        def _collect_from_component(comp: dict, _path: str) -> None:
            action = comp.get("action")
            if isinstance(action, str):
                triggered.add(action)
            elif isinstance(action, dict):
                a = action.get("action", "")
                if isinstance(a, str) and a:
                    triggered.add(a)

            for ra in comp.get("rowActions", []):
                if isinstance(ra, dict):
                    a = ra.get("action", "")
                    if isinstance(a, str) and a:
                        triggered.add(a)

            for fa in comp.get("footerActions", []):
                if isinstance(fa, dict):
                    a = fa.get("action", "")
                    if isinstance(a, str) and a:
                        triggered.add(a)

        self._walk_components(app_config, _collect_from_component)

        # Transitively add actions dispatched by other actions
        actions = app_config.get("frontend", {}).get("logic", {}).get("actions", {})
        changed = True
        while changed:
            changed = False
            for action_name, steps in actions.items():
                if action_name not in triggered:
                    continue
                for step in self._normalize_steps(steps):
                    dispatched = step.get("action", "")
                    if isinstance(dispatched, str) and dispatched and dispatched not in triggered:
                        triggered.add(dispatched)
                        changed = True
        return triggered

    def _find_resultfield_to_handler_map(self, actions: dict) -> dict[str, str]:
        """Map resultField state keys to the handler name that populates them."""
        mapping: dict[str, str] = {}
        for _name, steps in actions.items():
            for step in self._normalize_steps(steps):
                api = step.get("api")
                if not isinstance(api, dict) or api.get("type") != "handler":
                    continue
                handler = api.get("handler", "")
                result_field = api.get("resultField", "")
                if handler and result_field:
                    mapping[result_field] = handler
        return mapping

    def _walk_components(self, config: dict, visitor: callable, path: str = "root") -> None:
        """Recursively walk all components in the config, calling visitor on each."""
        if isinstance(config, dict):
            if config.get("componentType"):
                visitor(config, path)
            for key, val in config.items():
                self._walk_components(val, visitor, f"{path}.{key}")
        elif isinstance(config, list):
            for i, item in enumerate(config):
                self._walk_components(item, visitor, f"{path}[{i}]")

    # ------------------------------------------------------------------
    # Auto-fix: replace hardcoded Tailwind colors with semantic tokens
    # ------------------------------------------------------------------

    def _fix_hardcoded_colors(self, app_config: dict) -> list[str]:
        """Replace hardcoded Tailwind color classes with semantic tokens across the entire config."""
        warnings: list[str] = []
        self._replace_colors_recursive(app_config.get("frontend", {}), "frontend", warnings)
        return warnings

    def _replace_colors_recursive(self, node: Any, path: str, warnings: list[str]) -> None:
        if isinstance(node, dict):
            classes = node.get("classes", "")
            if isinstance(classes, str) and classes:
                new_classes = classes
                for hardcoded, semantic in _HARDCODED_TO_SEMANTIC.items():
                    if hardcoded in new_classes:
                        new_classes = re.sub(
                            r"\b" + re.escape(hardcoded) + r"\b",
                            semantic,
                            new_classes,
                        )
                if new_classes != classes:
                    node["classes"] = new_classes
                    comp_type = node.get("componentType", "unknown")
                    warnings.append(f"Auto-fix: replaced hardcoded colors in {comp_type} at {path}")
            for key, val in node.items():
                self._replace_colors_recursive(val, f"{path}.{key}", warnings)
        elif isinstance(node, list):
            for i, item in enumerate(node):
                self._replace_colors_recursive(item, f"{path}[{i}]", warnings)

    # ------------------------------------------------------------------
    # Auto-fix: fill missing label on TextFieldProps
    # ------------------------------------------------------------------

    def _fix_missing_form_labels(self, app_config: dict) -> list[str]:
        """Auto-fill missing 'label' on TextFieldProps from placeholder or name."""
        warnings: list[str] = []

        def _visitor(comp: dict, path: str) -> None:
            if comp.get("componentType") == "TextFieldProps" and not comp.get("label"):
                fallback = comp.get("placeholder") or comp.get("name", "Field")
                comp["label"] = fallback
                warnings.append(f"Auto-fix: set TextFieldProps.label to '{fallback}' at {path}")

        self._walk_components(app_config.get("frontend", {}), _visitor)
        return warnings

    # ------------------------------------------------------------------
    # Auto-fix: rewrite http:// to https:// on image src URLs
    # ------------------------------------------------------------------

    def _fix_http_image_urls(self, app_config: dict) -> list[str]:
        """Rewrite http:// to https:// on all src fields in the config."""
        warnings: list[str] = []
        self._fix_http_urls_recursive(app_config.get("frontend", {}), "frontend", warnings)
        return warnings

    def _fix_http_urls_recursive(self, node: Any, path: str, warnings: list[str]) -> None:
        if isinstance(node, dict):
            src = node.get("src", "")
            if isinstance(src, str) and src.startswith("http://"):
                node["src"] = src.replace("http://", "https://", 1)
                warnings.append(f"Auto-fix: rewrote HTTP→HTTPS on src at {path}")
            for key, val in node.items():
                self._fix_http_urls_recursive(val, f"{path}.{key}", warnings)
        elif isinstance(node, list):
            for i, item in enumerate(node):
                self._fix_http_urls_recursive(item, f"{path}[{i}]", warnings)

    # NOTE: _check_onmount_references_exist, _check_chained_action_references,
    # and _fix_missing_onmount_actions were removed — the declarative action
    # system and onMount have been removed from the platform.
