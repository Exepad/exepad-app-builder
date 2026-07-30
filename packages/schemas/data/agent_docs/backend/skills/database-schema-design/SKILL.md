---
name: database-schema-design
description: "Backend model schema authoring — naming (snake_case + _id suffix), foreign-key conventions, index hints, owner_id multi-tenant pattern, when to denormalize, primitive types, NULL semantics, ON DELETE behaviour. Load when authoring backend.json model entries (BackendModelBuilder). Keywords: schema, model, table, column, foreign-key, fk, index, primary-key, owner-id, multi-tenant, normalization, denormalization, snake-case, sqlite, d1."
metadata:
  kind: backend-pattern
  applies_to: backend-model-builder
---
# Skill: Database Schema Design

For BackendModelBuilder: how to declare model fields and relationships
that survive scale, deploy cleanly to D1, and stay queryable from
`useModel`/`useHandler`.

## Naming

**Always `snake_case` for table and column names.** Cloudflare D1 is
case-insensitive but the platform's CRUD layer normalizes to
`snake_case`; mixed-case names cause subtle mismatches between
`useModel('Applicants')` and the handler reading `applicants`.

**Tables: plural noun.** `applications`, `users`, `bookings`, `posts`.

**Columns: lowercase with units / role.**

| Pattern | Example | Use for |
|---------|---------|---------|
| Primary key | `id` | Auto-generated integer PK — system column, never declared |
| Owner | `owner_id` | The user this row belongs to (multi-tenant scope) |
| Foreign key | `<entity>_id` | `applicant_id`, `category_id`, `posted_by_user_id` |
| Boolean | `is_<adjective>` / `has_<noun>` | `is_active`, `has_paid` — NOT `active`, `paid` |
| Date/time | `<event>_at` | `created_at`, `updated_at`, `started_at`, `published_at` |
| Date only | `<event>_on` | `due_on`, `birth_on` |
| Counter | `<noun>_count` | `view_count`, `like_count` |
| Status enum | `status` | Single `status` column with documented values |
| URL | `<noun>_url` | `avatar_url`, `attachment_url` |
| Email | `<role>_email` | `contact_email`, `billing_email` |

**Avoid abbreviations.** `application_id`, not `app_id`. `application`
is unambiguous; `app` could be the platform app.

## System columns — auto-added, never declare

Every table automatically gets four **system columns** the platform
adds and manages for you. **Do NOT declare them in `columns`** — the
save tool strips them if you try. You only ever *reference* them in
reads (`WHERE owner_id = ?`, `ORDER BY created_at`).

| Column | Type | Managed by platform |
|--------|------|---------------------|
| `id` | `integer` | `INTEGER PRIMARY KEY AUTOINCREMENT` — never set manually |
| `owner_id` | `text` | The user who created the row (multi-tenant scope — see `ownerScope` below) |
| `created_at` | `text` (ISO 8601) | Creation timestamp |
| `updated_at` | `text` (ISO 8601) | Auto-updated on every write |

Declare only your **business columns**. A `ColumnConfig` uses this
exact field vocabulary:

`name`, `type`, `summary`, `isPrimary`, `isUnique`, `isNullable`,
`defaultValue`, `references: { model, column, onDelete }`, `enumValues`.

There are no `primary_key`, `nullable`, `default`, `index`, `comment`,
`on_delete`, or `fields` keys. `type` is one of
`text | integer | real | blob | json` — there is **no** `datetime`/`date`
type; store dates as `text` in ISO 8601.

## Foreign keys

```json
{
  "name": "applicant_id",
  "type": "integer",
  "summary": "Applicant this row belongs to",
  "references": { "model": "applicants", "column": "id", "onDelete": "cascade" }
}
```

Rules:
- **FK type MUST be `integer` when referencing `id`.** The platform's
  `id` is `INTEGER PRIMARY KEY AUTOINCREMENT`. Declaring
  `"type": "text"` makes joins silently fail (SQLite does NOT coerce
  text↔int in `=`, so `WHERE child.parent_id = parent.id` returns 0
  rows even when the values are numerically equal). The validator
  auto-coerces this case to `integer`, but emit the correct type
  yourself — explicit is better.
- **Always declare `references`** — the platform builds the FK
  constraint at deploy time. Without it, joins still work but
  referential integrity breaks silently.
- **Set `onDelete` explicitly.** The runtime **default is `cascade`**,
  which silently deletes child rows when the parent is removed — set it
  explicitly whenever that is not what you want:
  - `cascade` — child rows are deleted when parent goes away
    (`comment.post_id`: deleting the post deletes its comments).
  - `set_null` — child becomes orphaned but survives (`assigned_to`
    when the user is deleted). The FK column must be nullable.
  - `restrict` — block parent deletion if any child references it.
  - `no_action` — no referential action taken.
- **Index frequently-joined FK columns** via the model-level `indexes`
  array (see *Indexes* below). Without an index, JOINs and filtered
  reads (`WHERE applicant_id = ?`) full-scan the child table.
- **Suffix is `_id`.** `applicant_id`, not `applicantId`, not
  `applicant`. The platform's TypeScript codegen reads `_id` suffix to
  generate joined types.

## Indexes

Declare indexes in the model's **`indexes` array** (`IndexConfig[]`) —
indexing is a model-level concern, not a `ColumnConfig` field (there is
no `index` key on a column). The column itself stays plain:

```json
{
  "name": "status",
  "type": "text",
  "defaultValue": "draft",
  "enumValues": ["draft", "reviewing", "accepted", "rejected"],
  "summary": "Application review stage"
}
```

Index when the column appears in:
- `WHERE` clauses ("filter by status", "find by email").
- `ORDER BY` (sorting a list page).
- Foreign-key relationships (always).

Don't index:
- High-cardinality free text already indexed elsewhere (description,
  notes — full-text search is a separate concern).
- Columns that change every write (counters that update on every view).
- Boolean columns where 99 % of rows have one value (low selectivity).

## Multi-tenant: ownerScope

`owner_id` is a **system column** (auto-added — never declare it). What
you control is the model's **`ownerScope`** field:

- `ownerScope: "user"` (default) — the platform scopes every read by
  `owner_id = currentUser.id`. Use for any user-owned record.
- `ownerScope: "shared"` — all authenticated users see all rows (writes
  still stamp `owner_id`, reads skip the `owner_id` filter). Use for
  **truly shared tables** — `categories` (admin managed), `currencies`
  (lookup), `featured_posts` (curated).

Leaving a user-owned model on the default `"user"` scope is what
prevents a cross-tenant data leak — don't set `"shared"` unless the
data is genuinely global.

## Status / enum columns

SQLite has no native ENUM. Declare the allowed values with
**`enumValues`** on a `text` column — the platform validates writes
against the list:

```json
{
  "name": "status",
  "type": "text",
  "defaultValue": "draft",
  "enumValues": ["draft", "reviewing", "accepted", "rejected"],
  "summary": "Application review stage"
}
```

The frontend reads `enumValues` via schema discovery to render
dropdowns; the handler validates incoming values against the list.

## Type cheat sheet

`type` is one of `text | integer | real | blob | json`.

| Logical | Column `type` | Notes |
|---------|---------------|-------|
| Short string | `text` | Email, URL, slug |
| Long string | `text` | Description, content body — same type, no length cap |
| Integer | `integer` | Counter, age, quantity |
| Money / price | `real` | Store the decimal amount directly (`price`, `amount`, `total`) |
| Boolean | `integer` | 0/1; the platform projects to `bool` in the typed read |
| JSON | `json` | Auto-parsed to a JS value on read; document the shape in `summary` |
| Date / time | `text` | ISO 8601, UTC (`2026-05-09` or `2026-05-09T09:30:00Z`) — there is no `date`/`datetime` type |
| File reference | `text` | The asset URL (`/a/...`); see `09_FILE_STORAGE_GUIDE.md` |

SQLite has no array type. Store arrays as `json` (or `text`) and parse
client-side. For bulk data, consider a child table.

## Normalization

Stay at **3NF by default**:

- Each non-key column depends on the primary key, the whole primary
  key, and nothing but the primary key.
- One fact in one place.

**Denormalize only with measured cause:**

- Cached counters (`post.comment_count`) when the alternative is a
  COUNT(*) on every list page. Document it in the column `summary`.
- Cached display fields (`order.customer_name`) when the parent name
  needs to survive after the parent is deleted.
- Snapshot fields for audit (`order.product_price_at_purchase`, a `real`).

When denormalized, document in the column `summary` WHY ("cached counter,
updated by `update_comment_count` handler").

## Schema for relationships

| Cardinality | Pattern |
|-------------|---------|
| 1:1 (rare) | Two tables, one with FK to the other; collapse into one if possible |
| 1:many | FK on the many side: `comment.post_id` |
| many:many | Junction table with two integer FK columns (`post_tags { post_id, tag_id }`); the platform adds `id` |

Junction tables get the auto-added `id` primary key too — you don't
declare a composite PK (there is no column-level composite-PK option).
Declare the two FK columns and enforce the pair's uniqueness with a
unique entry in the model's `indexes` array:

```json
{
  "name": "post_tags",
  "summary": "Join table: which tags are on which post",
  "columns": [
    { "name": "post_id", "type": "integer", "summary": "FK to posts", "references": { "model": "posts", "column": "id", "onDelete": "cascade" } },
    { "name": "tag_id",  "type": "integer", "summary": "FK to tags",  "references": { "model": "tags",  "column": "id", "onDelete": "cascade" } }
  ]
}
```

## Anti-patterns

- ✗ Plural columns (`tags`, `emails`). Either a `json` column, or a child table.
- ✗ Catch-all `metadata` JSON columns to avoid declaring schema.
  Tempting; collapses queryability. Reach for a child table or a
  proper field.
- ✗ Camel-case (`firstName`, `userId`). Snake_case throughout.
- ✗ Setting `ownerScope: "shared"` on user-owned data (owner_id is
  auto-added, so it can't be "missing" — the leak vector is the wrong scope).
- ✗ Missing FK `references` block. Loses constraint enforcement and
  TypeScript codegen accuracy.
- ✗ Frequently-joined FK column with no entry in the model `indexes`
  array. Slow joins.
- ✗ `password` column on a user table. Auth is platform-owned.
- ✗ Non-ISO date strings (`05/09/2026`, `May 9`). Store dates as ISO
  8601 `text` (`2026-05-09`) so lexical sort = chronological sort.

## Compatibility

D1 is the storage layer. The platform's RPC CRUD methods
(`sys_create`, `sys_read`, `sys_list`, `sys_update`, `sys_delete`)
operate on every model declared this way. Custom handlers are covered
in [`handler-patterns-rpc`](../handler-patterns-rpc/SKILL.md). Seed
data conventions in [`seed-data-csv`](../seed-data-csv/SKILL.md).
