# Backend Model Configuration Guide

This guide covers the model config schema: modes, model definitions, columns, crudPolicy, and ownerScope.

---

## BackendProps — Mode Selection

`BackendProps` is a **discriminated union** on the `mode` field. Every backend config must specify exactly one mode.

### `mode: "static"` — Self-Contained JSON Apps

Use for apps that embed all data inline as static datasets (micro UIs, charts, previews). No infrastructure is provisioned.

```json
{
  "backend": {
    "mode": "static",
    "data": {
      "datasets": {
        "products": {
          "type": "static",
          "records": [
            { "id": "1", "name": "Widget", "price": 29.99 }
          ]
        }
      }
    }
  }
}
```

### `mode: "dynamic"` — Full Infrastructure Apps

Use for apps that need D1 database tables with auto-CRUD.

```json
{
  "backend": {
    "mode": "dynamic",
    "models": [...]
  }
}
```

### Choosing a Mode

| Scenario | Mode | Reason |
|----------|------|--------|
| Chart with inline data | `static` | No server needed, data embedded in config |
| Preview / MCP artifact | `static` | Self-contained JSON, no infrastructure |
| CRUD app with database | `dynamic` | Needs D1 models and auto-CRUD |
| Dashboard / analytics app | `dynamic` | Needs D1 models for data storage |
| Booking / inventory system | `dynamic` | Needs D1 models for entity management |

### Content-Only Apps

When `backend_type` is `"none"`, output `{"mode": "none"}`.
When `backend_type` is `"static"`, output `{"mode": "static", "data": {"datasets": {}}}`.
When `backend_type` is `"dynamic"` but the app stores no records of its own
(e.g. it only uses file uploads), output:
```json
{"mode": "dynamic", "models": []}
```
If the app collects ANY form data (contact, survey, newsletter, etc.), define a
model for it instead — do NOT use an empty `models` array.

---

## Built-in Services — DO NOT Generate Models For These

A few features are handled by the platform and need no model of their own:

| Feature | Built-in? | Generate Model? |
|---------|-----------|-----------------|
| File uploads | YES | NO — FileUploadFieldProps + R2 storage handles it |
| Booking system (CRUD entities) | NO | YES |
| Product catalog (CRUD entities) | NO | YES |
| User dashboard (CRUD entities) | NO | YES |
| Inventory management | NO | YES |

**Rule: Data-collection features (contact form, feedback, survey, newsletter
signup, registration, etc.) are NOT built-in. You MUST define a model for the
data you want to collect.** The frontend writes rows into it via
`useModel("<model>").create(...)`, and your reads (`useModel("<model>")`) see
exactly those rows. Do NOT emit `{"mode": "dynamic", "models": []}` for a form
that needs to store submissions — give it a real model with the appropriate
columns.

---

## ModelConfig — Data Models

Each model defines a D1 (SQLite) table. The runtime auto-creates system columns (`id`, `owner_id`, `created_at`, `updated_at`) — never declare them.

### Required Fields

| Field | Type | Description |
|-------|------|-------------|
| `uuid` | string | UUID v4 identifier |
| `name` | string | SQL table name (lowercase_snake_case, must match `^[a-zA-Z_][a-zA-Z0-9_]*$`) |
| `summary` | string | Human-readable description |
| `columns` | ColumnConfig[] | User-defined columns (NOT system columns) |

### Optional Fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `indexes` | IndexConfig[] | `[]` | Database indexes |
| `crudPolicy` | CrudPolicy | all `"authenticated"` | Per-operation auth levels |
| `ownerScope` | `"user"` \| `"shared"` | `"user"` | Data visibility scope |
| `softDelete` | boolean | `false` | Use `deleted_at` instead of hard delete |
| `migrationPolicy` | `"safe"` | `"safe"` | Schema migration strategy. Always use `"safe"`. **Do NOT emit `"destructive"` or `"reset"`** — those DROP live tables/columns and destroy user data. The deploy pipeline downgrades them to `"safe"` unless an operator explicitly confirms a destructive deploy, so requesting them has no effect except a warning. |

### ColumnConfig

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | SQL column name (snake_case) |
| `type` | `"text"` \| `"integer"` \| `"real"` \| `"blob"` \| `"json"` | D1/SQLite storage type |
| `summary` | string | Plain-English description of the column |
| `isUnique` | boolean | If true, adds UNIQUE constraint. Default false |
| `isNullable` | boolean | If true, column accepts NULL. Default false |
| `isPrimary` | boolean | If true, column is primary key. Default false |
| `defaultValue` | any | Default value when none provided |
| `references` | ForeignKeyRef | Optional foreign key reference |

**IMPORTANT:** Do NOT use `description`, `required`, or `unique` — these are not valid ColumnConfig fields. Use `summary`, `isNullable`, and `isUnique` instead.

**Column types:** `text`, `integer`, `real`, `blob`, `json`

### ForeignKeyRef

| Field | Type | Description |
|-------|------|-------------|
| `model` | string | **Required.** Referenced model name (NOT "table") |
| `column` | string | **Required.** Column in referenced model (typically `"id"`) |
| `onDelete` | enum | `"cascade"` \| `"set_null"` \| `"restrict"` \| `"no_action"`. **Runtime default: `"cascade"`** — silently deletes child rows when the parent is removed, so set it explicitly whenever that is not what you want. |

```json
{
  "name": "author_id",
  "type": "integer",
  "summary": "Foreign key to authors table",
  "references": { "model": "authors", "column": "id" }
}
```

**IMPORTANT:** Use `model`, NOT `table`. The field refers to the model name, not the SQL table name.

### OwnerScope

- `"user"` — Each user sees only their own records (`WHERE owner_id = ?`). Default.
- `"shared"` — All authenticated users see all records. Writes still set `owner_id`. Auto-CRUD skips `owner_id` filtering for reads.

### softDelete Behavior

When `softDelete: true` on a model:

- A `deleted_at` TEXT column is **auto-added** during schema generation (never declare it manually)
- **Delete** operations run `UPDATE SET deleted_at = timestamp` instead of `DELETE FROM`
- **Auto-CRUD list/read** automatically adds `WHERE "deleted_at" IS NULL`
- **Force hard delete:** Pass `soft: false` in delete params to permanently remove even on softDelete models

### CrudPolicy

Per-operation access levels:

| AccessLevel | Description |
|-------------|-------------|
| `"public"` | No login required — anyone can perform this operation |
| `"authenticated"` | User must be logged in (any role) |
| `"role:X"` | User must have role `X` (e.g., `"role:admin"`, `"role:editor"`) |
| `"owner"` | Only the record owner (matching `owner_id`) can perform this operation |
| `"none"` | Operation is disabled entirely |

> **Note:** For write operations (`create`, `update`, `delete`), `"public"` is effectively treated as `"authenticated"` — the platform requires authentication for all writes.

**Common patterns:**
- Public catalog: `{ "create": "role:admin", "read": "public", "update": "role:admin", "delete": "role:admin" }`
- User-owned data: `{ "create": "authenticated", "read": "owner", "update": "owner", "delete": "owner" }`
- Role-based: `{ "create": "role:editor", "read": "authenticated", "update": "role:editor", "delete": "role:admin" }`

### System Columns (Auto-Added — NEVER Declare)

| Column | Type | Description |
|--------|------|-------------|
| `id` | integer | Primary key, auto-generated (`INTEGER PRIMARY KEY AUTOINCREMENT`) — NEVER set manually |
| `owner_id` | text | User who created the record |
| `created_at` | text (ISO 8601) | Creation timestamp |
| `updated_at` | text (ISO 8601) | Last update timestamp |
| `deleted_at` | text (ISO 8601) | Soft-delete timestamp — **only added when `softDelete: true`** |

> **WARNING: There is NO column called `timestamp`.** Use `created_at` for creation and `updated_at` for modification.

---

## Model Examples

### Booking System

```json
{
  "uuid": "...",
  "name": "bookings",
  "summary": "Stores booking reservations",
  "columns": [
    { "name": "service_type", "type": "text", "summary": "Service being booked" },
    { "name": "date", "type": "text", "summary": "Booking date" },
    { "name": "time_slot", "type": "text", "summary": "Time slot" },
    { "name": "notes", "type": "text", "isNullable": true, "summary": "Optional notes" },
    { "name": "status", "type": "text", "defaultValue": "confirmed", "summary": "Booking status" }
  ],
  "crudPolicy": { "create": "authenticated", "read": "authenticated", "update": "authenticated", "delete": "role:admin" },
  "ownerScope": "user"
}
```

### Product Catalog

```json
{
  "uuid": "...",
  "name": "products",
  "summary": "Product catalog with pricing",
  "columns": [
    { "name": "name", "type": "text", "summary": "Product name" },
    { "name": "description", "type": "text", "isNullable": true, "summary": "Product description" },
    { "name": "price", "type": "real", "summary": "Price in default currency" },
    { "name": "category", "type": "text", "isNullable": true, "summary": "Product category" },
    { "name": "image_url", "type": "text", "isNullable": true, "summary": "Product image URL" },
    { "name": "is_active", "type": "integer", "defaultValue": "1", "summary": "Whether product is active" }
  ],
  "crudPolicy": { "create": "role:admin", "read": "public", "update": "role:admin", "delete": "role:admin" },
  "ownerScope": "shared"
}
```

### User Submissions

```json
{
  "uuid": "...",
  "name": "user_submissions",
  "summary": "Generic user-submitted content",
  "columns": [
    { "name": "title", "type": "text", "summary": "Submission title" },
    { "name": "content", "type": "text", "summary": "Submission content" },
    { "name": "status", "type": "text", "defaultValue": "pending", "summary": "Review status" }
  ],
  "crudPolicy": { "create": "authenticated", "read": "authenticated", "update": "authenticated", "delete": "role:admin" },
  "ownerScope": "user"
}
```

---

## Naming Conventions

- **Model names**: `lowercase_snake_case` (e.g., `bookings`, `products`)
- **Column names**: `lowercase_snake_case` (e.g., `first_name`, `department_id`)

---

## Security — Auth-Aware CrudPolicy

**Do NOT generate a `security` object in your output.** Security config is a root-level
WebAppProps field built separately by the assembly pipeline.

Your responsibility: use the `security_plan` input (when provided) as **read-only context**
to set correct `crudPolicy` auth levels on models.
