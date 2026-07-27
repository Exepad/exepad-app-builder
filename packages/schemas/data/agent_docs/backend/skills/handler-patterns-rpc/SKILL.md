---
name: handler-patterns-rpc
description: "Custom backend handler authoring — handler TSX shape, ctx.db / ctx.user / ctx.params access, request validation, error responses, return-shape conventions, idempotency, when to write a handler vs use auto-CRUD. Load when authoring custom handler artifacts (handler_code:*.tsx) under BackendHandlerBuilder. Keywords: handler, rpc, custom-handler, ctx, validation, error, response, return-shape, side-effect, transaction, owner-scope."
metadata:
  kind: backend-pattern
  applies_to: backend-handler-builder
---
# Skill: Custom Handler Patterns

For BackendHandlerBuilder — when, why, and how to write a custom
handler instead of relying on the platform's auto-CRUD.

## When to write a handler

Auto-CRUD (`sys_create`, `sys_read`, `sys_list`, `sys_update`,
`sys_delete`) handles 80 % of mutations. Write a custom handler when:

- **Multi-row writes in one transaction** (transfer money between
  accounts, "add item + decrement stock").
- **Aggregations** (dashboard KPI, weekly revenue, count of pending
  approvals).
- **Computation that doesn't belong in the frontend** (PDF render,
  CSV export, image resize).
- **Cross-table joins beyond what `useModel` exposes**.
- **Auth-gated or role-gated logic** the frontend can't be trusted with.

Don't write a handler for a single-row create/read/update/delete that's
already covered by auto-CRUD.

## Handler signature — the contract

A handler is a SINGLE `handler` function that takes ONE argument,
`ctx: HandlerContext`, and is exported via `export default handler;`.
Read inputs from `ctx.params`. Return a FLAT object whose keys are
EXACTLY the field names declared in `handler_plan.outputs` (matching
case and type).

```tsx
import { HandlerContext } from "@exepad/sdk";

async function handler(ctx: HandlerContext) {
  // 1. read inputs from ctx.params
  const applicantId = ctx.params.applicant_id;
  const reviewerNote = ctx.params.reviewer_note ?? null;

  // 2. read via parameterized SQL (owner-scoped model)
  const applicant = await ctx.db.prepare(
    'SELECT * FROM applicants WHERE id = ? AND owner_id = ?'
  ).bind(applicantId, ctx.user.id).first();
  if (!applicant) {
    throw new Error('Applicant not found');
  }
  if (applicant.status !== 'reviewing') {
    throw new Error(`Cannot approve from status=${applicant.status}`);
  }

  const now = new Date().toISOString();

  // 3. mutate
  await ctx.db.prepare(
    'UPDATE applicants SET status = ?, approved_at = ?, reviewer_note = ?, updated_at = ? WHERE id = ? AND owner_id = ?'
  ).bind('approved', now, reviewerNote, now, applicantId, ctx.user.id).run();

  // 4. record a related row in the same DB (audit_log model) — NEVER set id
  await ctx.db.prepare(
    'INSERT INTO audit_log (owner_id, event, applicant_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
  ).bind(ctx.user.id, 'applicant_approved', applicantId, now, now).run();

  // 5. return a FLAT object whose keys match handler_plan.outputs
  return { status: 'approved', approved_at: now };
}

export default handler;
```

The import line is EXACTLY `import { HandlerContext } from "@exepad/sdk";`
— nothing else. No `@exepad/runtime`, no npm packages, and NEVER a model /
table name as an import (table names live only inside SQL strings). There
is NO `HandlerCtx`, `HandlerResult`, or `ExepadHandlerCtx` type — the only
type is `HandlerContext`. There is NO second `params` argument: everything
the caller sent arrives on `ctx.params`.

## The `ctx` object

| Field | Type | Use |
|-------|------|-----|
| `ctx.db` | `D1Database` | Parameterized SQL only: `ctx.db.prepare(sql).bind(...).all()` / `.first()` / `.run()` |
| `ctx.batch` | `(stmts) => Promise<...>` | Run multiple prepared statements atomically as one batch |
| `ctx.user` | `{ id, email, roles }` | The authenticated caller |
| `ctx.params` | `Record<string, unknown>` | Handler inputs (from `handler_plan.inputs`) |
| `ctx.log` | structured logger | `ctx.log.debug/info/warn/error(...)` |
| `ctx.config` | `{ appId, appAlias }` | App identity |
| `ctx.models` | model configs by name | Inspect `columns`, `softDelete`, `ownerScope` at runtime |

Handlers receive ONLY these fields — there is no `ctx.services` and no
`ctx.settings`. **Don't reach for `process.env` or `globalThis`** either;
all persistence flows through `ctx.db`. There is **NO `ctx.db.<model>` ORM
facade** (no `.read` / `.create` / `.update` / `.remove`) and **NO
`ctx.db.exec`** — the only DB API is `ctx.db.prepare(sql).bind(...)` chained
to `.all()`, `.first()`, or `.run()`.

## DB access — prepare / bind / all|first|run

- `.all()` returns `{ results: T[] }` — read rows via `result.results`.
- `.first()` returns `T | null` directly — no `.results` wrapper.
- `.run()` for INSERT / UPDATE / DELETE; the new row id is
  `result.meta.last_row_id`.
- **ALWAYS parameterize** with `?` + `.bind(...)`. NEVER string-concat user
  input into SQL.
- **INSERT includes** `owner_id`, `created_at`, `updated_at` — but **NEVER
  `id`** (it is `INTEGER PRIMARY KEY AUTOINCREMENT`, auto-generated).

```tsx
// list
const rows = await ctx.db.prepare(
  'SELECT * FROM products WHERE owner_id = ? ORDER BY created_at DESC'
).bind(ctx.user.id).all();
return { products: rows.results };

// single row
const one = await ctx.db.prepare(
  'SELECT * FROM products WHERE id = ? AND owner_id = ?'
).bind(ctx.params.id, ctx.user.id).first();

// write (INSERT — owner_id/created_at/updated_at, NEVER id)
const now = new Date().toISOString();
const res = await ctx.db.prepare(
  'INSERT INTO orders (owner_id, product_id, qty, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
).bind(ctx.user.id, ctx.params.product_id, ctx.params.qty, now, now).run();
return { orderId: res.meta.last_row_id };
```

## Return shape — a FLAT object of the declared output fields

There is NO `{ ok, data }` envelope and NO `HandlerResult` type. Return a
plain object whose keys are EXACTLY the field names declared in
`handler_plan.outputs`, with matching case and type. The RPC layer sends
that object straight to the consumer hook; wrapping or renaming breaks it.

Rules:
- **Keys match `handler_plan.outputs` exactly.** Don't rename, re-case
  (`total_revenue` vs `totalRevenue`), or omit a declared field.
- **Values match the declared type.** TypeScript codegen reads the
  planned outputs; mismatches break `useHandler('name')`.
- **Signal failure by throwing.** Precondition and validation violations
  `throw new Error('message')`; the platform's outer handler converts a
  thrown Error into an error response. Do NOT invent a `{ ok: false }`
  object — there is no such envelope.

## Output typing — match what your SQL actually returns

The planner declared `outputs: ["fieldName: type"]` in `app_backend_plan.handlers`
and that flows into `AppHandlerOutputs[name]` so the consumer sees a real
type via `useHandler('name')`. Your handler body MUST return data whose
shape matches that declaration. Common patterns:

| SQL returns | Declare output as | Handler body returns |
|---|---|---|
| Rows from a declared model (e.g. `SELECT * FROM articles`) | `array<articles>` | `{ trendingArticles: result.results }` |
| List of bare values | `array<string>` / `array<number>` | `{ tags: rows.results.map(r => r.name) }` |
| Single counted scalar | `integer` | `{ count: row?.n ?? 0 }` |
| Free-form blob you can't pin | `json` | `{ payload: ... }` |

If the planner declared `array<articles>` and you join columns from
another table (e.g. `c.name AS category_name`), the result rows still
typecheck against `AppModels['articles']` because the augmentation
includes auto-joined sibling fields — the consumer hook will see
`row.category` (the auto-joined sibling), not `row.category_name`.
Prefer auto-join over `AS`: it keeps the contract aligned with what
the rest of the app already uses for the same model.

## Validation

Validate at the boundary; trust internal calls. Read each input off
`ctx.params`, check it, and `throw` on bad input:

```tsx
const applicantId = ctx.params.applicant_id;
if (typeof applicantId !== 'string' || !applicantId) {
  throw new Error('applicant_id (string) is required');
}
const reviewerNote = ctx.params.reviewer_note;
if (reviewerNote != null && typeof reviewerNote !== 'string') {
  throw new Error('reviewer_note must be a string');
}
```

Use plain TypeScript checks — the ONLY allowed import is `HandlerContext`
from `@exepad/sdk`, so there is no Zod or other validation library in the
handler bundle.

## Errors

Signal failure by throwing an `Error`; the platform converts it into a
structured error response for the frontend.

```tsx
// not found
throw new Error('Applicant not found');

// permission
if (ctx.user.id !== applicant.owner_id && !ctx.user.roles.includes('admin')) {
  throw new Error('Forbidden');
}

// validation
throw new Error('amount must be positive');

// conflict (concurrent edit, idempotency)
throw new Error('Already approved');

// DB write failure — log context, then rethrow a clean message
try {
  await ctx.db.prepare(
    'INSERT INTO orders (owner_id, total, created_at, updated_at) VALUES (?, ?, ?, ?)'
  ).bind(ctx.user.id, ctx.params.total, now, now).run();
} catch (e) {
  ctx.log.error('order_create_failed', { error: String(e) });
  throw new Error('Could not save order. Try again.');
}
```

Wrap risky external work in try/catch so you can log context before
rethrowing. The one thing you must NEVER do is silently swallow an error
and return partial data as if it succeeded — the frontend would render a
misleading "success" state.

## Idempotency

For mutating handlers that may be retried (network flakes, "double
click submit"), record and check an idempotency key in a declared model
(e.g. a `handler_runs` table that exists in `model_plans`):

```tsx
const key = String(ctx.params.idempotency_key);

const existing = await ctx.db.prepare(
  'SELECT result_id FROM handler_runs WHERE owner_id = ? AND key = ?'
).bind(ctx.user.id, key).first();
if (existing) {
  return { orderId: existing.result_id }; // replay — same output shape
}

const now = new Date().toISOString();
const res = await ctx.db.prepare(
  'INSERT INTO orders (owner_id, total, created_at, updated_at) VALUES (?, ?, ?, ?)'
).bind(ctx.user.id, ctx.params.total, now, now).run();

await ctx.db.prepare(
  'INSERT INTO handler_runs (owner_id, key, result_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
).bind(ctx.user.id, key, res.meta.last_row_id, now, now).run();

return { orderId: res.meta.last_row_id };
```

For payment / accounting handlers, idempotency is mandatory. The
`handler_runs` table (or whatever you name it) MUST be declared in
`model_plans` — you cannot write to a table the planner didn't create.

## Owner-scoping in handlers — BRANCH ON `owner_scope`

**Auto-CRUD respects each model's owner scope.** Custom handlers must
respect it too. Read the value from `model_plans[].owner_scope` (the
serialized, snake_case field the builder passes you) for every model the
handler touches, then branch:

| `model_plans[].owner_scope` | Handler MUST emit | Reason |
|---|---|---|
| `"user"` | `WHERE owner_id = ?` bound to `ctx.user.id` | Multi-tenant model; rows are private per user. |
| `"shared"` | **NO** `owner_id` filter | All users share the same rows (catalogues, seeded data apps, lookup tables). |

For a `user`-scoped model (e.g. `applications`):

```tsx
const items = await ctx.db.prepare(
  'SELECT * FROM applications WHERE owner_id = ?'
).bind(ctx.user.id).all();
return { applications: items.results };
```

For a `shared`-scoped model (e.g. `products` in a catalogue app, or any
xlsx-ingested data model — the platform auto-flips those to `shared`):

```tsx
// NO owner_id filter — owner_scope is "shared":
const stats = await ctx.db.prepare(
  'SELECT SUM(total) AS total_revenue FROM orders'
).first();
return { totalRevenue: stats?.total_revenue ?? 0 };
```

**JOINs across multiple models**: apply the rule **per-table**. If you
JOIN a `user`-scoped table with a `shared`-scoped table, only the
user-scoped side gets the `owner_id` filter:

```tsx
// orders.owner_scope = "user", products.owner_scope = "shared"
const rows = await ctx.db.prepare(
  `SELECT o.id, p.name
   FROM orders o
   JOIN products p ON p.id = o.product_id
   WHERE o.owner_id = ?`        // orders only — products has no owner filter
).bind(ctx.user.id).all();
return { rows: rows.results };
```

**Common failure mode this addresses.** App `eiu7xj0v` (2026-05-14):
all 9 models were `owner_scope: "shared"` (xlsx-ingested data app), but
the handler emitted `WHERE owner_id = ctx.user.id` blindly. Result:
auto-CRUD returned all 250 seeded orders to any preview viewer, but
`getDashboardStats` returned `{totalRevenue: 0, recentOrders: []}` —
the dashboard appeared completely empty for every real user. The
validator rule `handler.sql.owner_filter_scope_mismatch` now catches
this at build time. Skipping the filter in a `user`-scoped handler
exposes other users' data; including it in a `shared`-scoped handler
hides every row that exists.

## Aggregations & JOINs — parameterized SQL

All DB access is parameterized SQL via `ctx.db.prepare(...)`. For
aggregations and multi-table joins, do the work in SQL and return the
result rows or scalars directly:

```tsx
const now = new Date();
const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

const stats = await ctx.db.prepare(
  `SELECT COUNT(*) AS total, SUM(total) AS revenue
   FROM orders
   WHERE owner_id = ? AND created_at >= ?`
).bind(ctx.user.id, startOfMonth).first();

return { total: stats?.total ?? 0, revenue: stats?.revenue ?? 0 };
```

(Money / price columns are `type: 'real'` — return them as-is; there is no
integer-cents convention.) Always parameterize — never string-concat user
input into SQL.

## Atomic multi-statement writes — `ctx.batch`

`ctx.db` does NOT auto-wrap several `.run()` calls in a transaction, and
`await Promise.all([...])` does NOT make them atomic. When multiple writes
must succeed or fail together, build the prepared statements and hand them
to `ctx.batch`:

```tsx
const now = new Date().toISOString();
await ctx.batch([
  ctx.db.prepare('UPDATE accounts SET balance = balance - ?, updated_at = ? WHERE id = ? AND owner_id = ?')
    .bind(amount, now, fromId, ctx.user.id),
  ctx.db.prepare('UPDATE accounts SET balance = balance + ?, updated_at = ? WHERE id = ? AND owner_id = ?')
    .bind(amount, now, toId, ctx.user.id),
]);
return { transferred: amount };
```

## Before returning: clean up your scaffolding (MANDATORY)

When you finish a handler body, do one final read-through and remove
anything that was scaffolding rather than execution:

- **Unused query results.** If you write `const result = await ctx.db.prepare(...).all()` and never read `result`, delete the query. Do NOT leave a query you intended to use, decided not to, and forgot to remove.
- **"Redoing query" / "Rewriting" / "Actually let me…" comments.** These are mid-thought artifacts. The reader doesn't need to see your iteration history — only the final code. Strip them.
- **Unreachable branches** (`if (false) { … }`, early `return` followed by more statements, dead `else` after `return`).
- **TODO / FIXME placeholders** unless you've also opened a follow-up. A `// TODO: handle pagination` in a shipped handler is just lying about what the handler does.
- **`console.log` debug prints.** Forbidden everywhere in Code Focus.

Concretely, a handler that started life as:

```tsx
const _firstAttempt = await ctx.db.prepare(sqlA).bind(...).all();
// Redoing query to include i.id for filtering
const data = await ctx.db.prepare(sqlB).bind(...).all();
return { rows: data.results };
```

should ship as just:

```tsx
const data = await ctx.db.prepare(sqlB).bind(...).all();
return { rows: data.results };
```

Validators catch unused TypeScript variables only sporadically. The
agent's last pass is the only thing standing between your mid-thought
draft and the user reading it in production. Make the pass.

## Anti-patterns

- ✗ Importing anything other than `HandlerContext` from `@exepad/sdk` (no `@exepad/runtime`, no npm packages, no model names).
- ✗ A second `params` argument or a made-up type (`HandlerCtx`, `HandlerResult`, `ExepadHandlerCtx`). The signature is exactly `async function handler(ctx: HandlerContext)`.
- ✗ Wrapping the return in `{ ok, data }` or returning a bare value/array. Return a FLAT object whose keys are the declared `handler_plan.outputs`.
- ✗ Reaching `globalThis.fetch('/internal/api')` or `process.env`. All persistence flows through `ctx.db`.
- ✗ An ORM facade (`ctx.db.applicants.read(...)`) or `ctx.db.exec(...)`. The only DB API is `ctx.db.prepare(sql).bind(...).all()/.first()/.run()`.
- ✗ Setting `id` in an INSERT. `id` is `INTEGER PRIMARY KEY AUTOINCREMENT` — omit it; include `owner_id`, `created_at`, `updated_at`.
- ✗ Mutating multiple tables with separate `.run()` calls when they must be atomic. Use `ctx.batch([...])`; `await Promise.all` does NOT make writes atomic.
- ✗ Logging PII (`ctx.log.info('saw_password', { pw: ctx.params.pw })`). Sanitize first.
- ✗ Exporting helpers as named exports. The platform loads only the default export — co-located helpers must live above `handler` in the same file.
- ✗ Leaving "decided not to use this" queries / "redoing" comments / `console.log` debug prints in the final file. See the cleanup checklist above.

## Compatibility

The `HandlerContext` type comes from `@exepad/sdk`. There is no per-app
model facade — every table is reached by name inside a parameterized SQL
string. For the full `ctx` surface (`db`, `batch`, `user`, `params`,
`log`, `config`, `models`) and the complete SQL rules, see
[`BACKEND_HANDLERS_CONFIG.md`](../../docs/BACKEND_HANDLERS_CONFIG.md).
