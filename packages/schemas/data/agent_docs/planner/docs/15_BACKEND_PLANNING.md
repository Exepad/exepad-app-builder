# 10. Backend Plan (`app_backend_plan`)

Plan the data models and API handlers.

## Backend Type

- `"none"` — Frontend-only, no backend. Landing pages, portfolios, content sites.
- `"dynamic"` — Full D1 backend with models, handlers, and CRUD.

**Use `"none"` when:**
- Pure content sites, landing pages, portfolios with no data collection
- Apps with static display data (pricing tiers, feature lists) — embed these directly in the component code, not in a backend dataset

**Use `"dynamic"` when:**
- Apps collect data (contact forms, feedback, surveys, signups) — define a model and submit via `useModel().create()`
- Apps need CRUD entities (bookings, products, inventory, user profiles)
- Apps need custom business logic (calculations, aggregations, integrations)

## Model Planning

- Model names are lowercase_snake_case (e.g., `bookings`, `products`)
- Never include system columns (id, owner_id, created_at, updated_at) — these are added automatically
- For each model that needs sample data, set `seed_hint` with context for realistic generation (e.g., 'Include 5-10 products with realistic names, prices, and categories')
- **Reserved names** — do NOT declare models whose names start with `_` (the platform owns these).

## Handler Planning

Handlers provide custom API endpoints for logic that goes beyond auto-CRUD (aggregations, multi-model queries, calculations).

- Handler names are camelCase (e.g., `getDashboardStats`, `createBooking`)
- Each handler defines `inputs` (parameters it accepts) and `outputs` (fields it returns)

**Write handlers** — for operations that modify data beyond auto-CRUD:
- If a page plan describes "save profile", "update settings", or similar write actions, plan a corresponding handler or ensure a model exists for that data
- Every form with a submit button in the frontend MUST have a corresponding backend target — a model for data collection / CRUD (submitted via `useModel().create()`), or a handler for custom logic
- If a planned page has interactive forms but no backend target, this is a planning gap — either add a model/handler or simplify the page to read-only

**Output field naming (CRITICAL):**
- Handler `outputs` define the data contract between backend and frontend. The component builder uses these exact field names.
- Output field names MUST be camelCase (e.g., `totalRevenue`, `avgWaitTime`, `chartData`)
- For scalar values (KPIs, counts, totals): name the field exactly as the frontend should display it (e.g., `totalRevenue`, `activeUsers`, `conversionRate`)
- For array values (chart data, lists): name the wrapper field (e.g., `chartData`, `recentOrders`) — the array items will have column names from the SQL query
- List ALL fields the frontend needs — don't expect the component to derive or hardcode missing data

**Output `type` (CRITICAL — choose the narrowest one):**

The `type` you declare flows into a TypeScript type that the consuming
component sees through `useHandler<{...}>(name)`. Pick the shape that
matches what the SQL actually returns; vague types force the LLM into
ugly casts that ship as warnings.

| Returns | Use this `type` | Frontend sees |
|---|---|---|
| Rows of a declared model (e.g. `SELECT * FROM articles`) | `array<articles>` | `AppModels['articles'][]` — full row type, including FKs joined siblings |
| List of strings/numbers (e.g. tag list) | `array<string>` / `array<number>` | `string[]` / `number[]` |
| List with custom shape that doesn't match a model | `array` | `unknown[]` — use only when nothing better fits |
| Single scalar | `string` / `integer` / `boolean` / `number` | exact primitive |
| Single object whose shape isn't worth pinning | `json` | `any` — unblocks field reads but loses narrowing |

**Worked example — "most-viewed articles" handler:**

```
{"name": "getTrendingArticles",
 "handler_type": "read",
 "inputs": ["limit: integer"],
 "outputs": ["trendingArticles: array<articles>"]}
```

The component then writes `const { data } = useHandler('getTrendingArticles', { params: { limit: 10 } })` and uses `data?.trendingArticles` directly with full type narrowing — no triple-cast required.

**Anti-pattern** — `array<articles>` with an inline-object shape inside the
brackets (e.g. `array<{id: integer, name: string}>`). The HandlerPlan
output parser splits on `,` and will mangle the inner shape. Use a
declared model name or a primitive only.

## Seed Data

When models back charts, tables, or dashboards, seed data makes the app look alive on first load.

- Set `seed_hint` on each model with enough context for realistic generation
- **Time-series data:** specify temporal distribution in the hint (e.g., 'distributed across the last 7 days, 3-5 records per day'). Without this, all records get the same timestamp and charts show a single data point.
- **Categorical data:** include variety (multiple statuses, categories, users) so filters and charts are meaningful
- **Realistic volumes:** 10-50 records per model is usually enough

## File Storage

Enable file storage when the app involves user-uploaded files: profile pictures, document uploads, photo galleries, file attachments, receipts, or any user-generated content.

- Storage is independent of `backend_type` — a `"none"` app can still have storage
- Do NOT create models for file metadata — the platform manages this automatically

---

# 11. Security Plan (`app_security_plan`)

Plan authentication and authorization when the app needs login, signup, roles, or access control.

**When to set `needs_auth: true`:**
- User description mentions: login, signup, authentication, user accounts, roles, admin, permissions, protected, private
- App has user-scoped data (models with `ownerScope: "user"` — each user sees only their own records)
- Any page needs access restrictions (admin panel, dashboard, settings)
- CRUD entities require owner-based or role-based access control

**When to set `needs_auth: false` (default):**
- Public content sites, landing pages, portfolios
- Public data-collection apps (contact forms, surveys) where submissions are not user-scoped
- Display apps with no user-specific data

**Fields:**
- `auth_providers` — list of auth methods. **Default to `["email"]` only.** Add `"google"` **only when the user's description explicitly asks for Google sign-in or SSO**. Google OAuth requires runtime-side client credentials that may not be provisioned — listing `"google"` in a config that lacks credentials ships a broken button that always errors on click. When in doubt, use `["email"]`.
- `roles` — only define if the app needs role-based access (e.g., `["admin", "editor", "viewer"]`). Omit for simple authenticated-only apps.
- `role_hierarchy` — parent-to-children inheritance. Example: `{"admin": ["editor"], "editor": ["viewer"]}` means admin inherits all editor and viewer permissions.
- `default_role` — must be in `roles[]`. Assigned to new signups.
- `default_access` — access level for pages without explicit override. Usually `"authenticated"`. Cannot be `"owner"` or `"none"`.
- `page_access` — per-page access overrides. At minimum set `"/": "public"` for a public homepage and `"/admin": "role:admin"` for admin pages.
- `allow_signup` — whether users can self-register. Default: `true`.

**Access levels:** `"public"` (anyone), `"authenticated"` (logged in), `"role:X"` (specific role), `"owner"` (record owner, CRUD policies only), `"none"` (blocked, CRUD policies only).

**Example (CRM with admin):**
needs_auth: true, auth_providers: ["email"], roles: ["admin", "member"], role_hierarchy: {"admin": ["member"]}, default_role: "member", default_access: "authenticated", page_access: {"/": "public", "/admin": "role:admin"}, allow_signup: true
