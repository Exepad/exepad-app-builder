# Creator plan contract

Because design imports skip PreCreator and Creator, your plan must contain a complete `creator_plan: CreatorOutput`. The runner OVERRIDES two fields after you author the rest:

- **`component_plans`** — re-built deterministically so every entry's `source_html_artifact` references the artifact the runner emitted.
- **`design_system.{primary,secondary,surface,error}_color`** plus **`headline_font`** / **`body_font`** — overwritten with the resolved theme tokens.

Every other field — `app_name`, `app_building_plan`, `navigation_type`, `app_logic_plan`, `app_backend_plan`, `app_security_plan`, `app_favicon_svg`, `design_system.design_style`, `reasoning` — is kept verbatim from your output.

Use the uploaded design as the source of truth — with ONE explicit exception for `app_name`:

- The bundle decides app domain, layout, page set, and visual direction. `app_description` in your input is context only; if it conflicts with the design, the design wins.
- **`app_name` is owned by the user.** Copy the input `app_name` verbatim into `creator_plan.app_name`, EVEN when the bundle's baked-in copy uses a different brand. Example: user input `"Chick Farm"` + bundle HTML says `HappyDoods` → output `app_name: "Chick Farm"`. The user can edit the design copy later but cannot retroactively edit the URL alias derived from `app_name`.
- The ONLY case where you may override `app_name`: when the input is empty or matches a placeholder (case-insensitive, after stripping whitespace): `""`, `"untitled"`, `"new app"`, `"my app"`, `"test"`, `"app"`, `"create"`, `"make me an app"`. In that case, infer a short Title Case name from the brand/logo or headline in the design.
- Set `navigation_type` from the layout: top nav websites use `"HeaderMenuTop"`; persistent left-sidebar dashboards use `"SidebarMenuLeft"`.
- When the bundle includes a `DESIGN.md` file, specific visual treatments (gradient angles, chip specs, opacity values, border-avoidance rules) MUST appear verbatim in `design_system.design_style` bullets — don't paraphrase numbers or token names. See the format-specific skill's "DESIGN.md" section.
- Set `app_logic_plan.state_variables` to `[]` unless the design clearly has cross-component shared state.
- Set `app_backend_plan.backend_type` to `"none"` unless the design clearly shows a dynamic entity or custom workflow.
- Reflect any `backend_intent` decision in `app_backend_plan` too.
- Set `app_security_plan.needs_auth` to `false` unless the design explicitly shows login, signup, accounts, roles, or protected pages.
- Include an inline `app_favicon_svg` whose **glyph reflects the brand's domain** (farm → wheat/egg/leaf; dashboard → chart bar; storefront → cart/tag; booking → calendar check). Use the brand's `primary_color` as the fill, and a contrasting color for the glyph stroke. A generic colored circle with a plus sign is unacceptable — every Exepad app gets stuck with the same icon. The favicon is one of the few per-app artifacts the user sees in a browser tab; make it domain-specific.
- Fill `reasoning` with a concise explanation of the imported page set, navigation, backend choice, and theme adoption.

## `app_name` and `component_plans` — DO and DO NOT

Past failure: a school-dashboard import produced
`app_name = "InToTheHobby_Main_vId"` and `component_plans = [Header, FeaturedContent, PostFeed, Sidebar, Footer]` even though the loaded HTML was an "Ashford Day School" admin dashboard. Your `pages` analysis was correct; your `creator_plan` envelope was hallucinated. **Both come from the SAME loaded design content.** Treat them together, not as independent passes.

DO:
- Copy the user's input `app_name` into `creator_plan.app_name` verbatim when it is non-placeholder. (`"Chick Farm"`, `"School Dashboard"`, `"Ashford Day School"` are all non-placeholder — keep them as-is.)
- Name `component_plans` entries from what each page IS in the loaded design. A school dashboard with sections for students, classes, billing → `[DashboardOverview, Students, Classes, Billing]`, not `[PostFeed, FeaturedContent]`.
- When the same design has multiple pages, give each its own concrete name. Don't fall back to a single generic content placeholder.
- When (and only when) input `app_name` is a placeholder (empty, `"untitled"`, `"new app"`, `"my app"`, `"test"`, `"app"`, `"create"`, `"make me an app"`), derive `app_name` from the brand text in the loaded HTML (`<title>`, top-of-page brand mark, headline).

DO NOT:
- Override a non-placeholder user `app_name` with the design's baked-in brand. Past failure example (chick_farm import, 2026-05-16): user typed `"Chick Farm"`, bundle had `HappyDoods` everywhere; the importer mis-applied the override policy and produced `app_name = "HappyDoods Farm"` — the final app had inconsistent branding (URL `chick-farm`, page copy `HappyDoods`).
- Emit a placeholder-shaped `app_name` like `"InToTheHobby_Main_vId"`, `"App_v3_TBD"`, `"MyApp_Main_v"` — names with `_vId`, `_Main_`, `_v\d+_`, or 3+ underscores. The deterministic post-pass will reseed these with a warning, but you should never produce them in the first place.
- Default `component_plans` to a generic placeholder scaffold (`Header`, `FeaturedContent`, `MainContent`, `Sidebar`, `Footer`) that ignores what the design actually is. Generic content names like `FeaturedContent`, `MainContent`, `Article`, `Card`, `Hero`, `Page` will be reseeded from the page title — but only on content roles. Chrome roles (`header`, `sidebar`, `footer`) keep generic names because the role IS the description.

### Slim `component_plans` shape

For design imports, `creator_plan.component_plans[*]` uses a **slim** per-entry schema with only the fields the runner actually carries forward:

- `page_slug` — hint so the runner's by-slug lookup binds the carry-overs to the right page (`""` for home, kebab-case otherwise; `null` for chrome roles).
- `role` — hint so chrome carry-overs (e.g. an icon set referenced from the sidebar) attach to the right region. `"header" | "sidebar" | "footer" | "content"`.
- `image_references` — exact image UUIDs from `image_catalog_summary` to bind to this component.
- `interactive_elements` — short labels for charts, data tables, modals, filters, etc.
- `form_ids` — **deprecated; leave empty (`[]`).** The platform forms service was removed, so these ids no longer wire up any submission path. Data-collection forms (contact, newsletter, intake) now persist into a backend model via `useModel().create()` — declare that model in `backend_intent.models` instead. The field is retained only for schema stability and is carried verbatim but ignored by the runner.

**Do NOT emit** `name`, `page_title`, `page_summary`, `page_short_summary`, `building_plan_artifact`, `content_artifact`, `source_html_artifact`, `page_type`, `complexity_level`, `building_plan`, `content_keywords`. The runner overrides all of these deterministically — repeating them in your output just inflates the structured-JSON payload and risks blowing the `max_output_tokens` cap (8qfb42sm 2026-05-18: a 10-page school dashboard truncated 488 tokens below the 32K limit, dominated by ~6–10K of redundant `component_plans` fields). Pydantic silently drops any field outside the slim shape, so emitting them costs tokens without effect.

Put `page_summary` and `page_short_summary` on `pages[*]` (PageMapping fields) — the runner prefers those over per-entry values.

**Empty `component_plans` is acceptable.** If your bundle has no image bindings or interactive-element hints worth threading, emit `component_plans: []` and let the runner build every entry from `pages` + `chrome` alone. This is the safest path for very large multi-page imports approaching the output-token cap.
