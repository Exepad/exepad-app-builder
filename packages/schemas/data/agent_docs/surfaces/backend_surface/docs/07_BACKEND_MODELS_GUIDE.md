# Backend Models Guide — Component Usage

> How to use backend models in code components via `useModel` from `@exepad/sdk`.

## useModel Hook

```tsx
import { useModel } from "@exepad/sdk";

const { data, loading, error, refetch, create, update, remove } = useModel("model_name", options?);
```

### Return Values

| Field | Type | Description |
|-------|------|-------------|
| `data` | `T[] \| null` | Array of records (`null` during initial load — always guard with `?? []`) |
| `loading` | `boolean` | True while fetching |
| `error` | `string \| null` | Error message if request failed |
| `totalCount` | `number` | Total record count (useful for pagination) |
| `refetch` | `() => void` | Re-fetch data |
| `create` | `(data) => Promise` | Insert a new record |
| `update` | `(id, data) => Promise` | Update a record by id |
| `remove` | `(id) => Promise` | Delete a record by id |

### Options

```tsx
useModel("contacts", {
  filters: { status: "active", department_id: 3 },
  orderBy: { created_at: "desc" },
  limit: 20,
  offset: 0,
});
```

### Aggregation

```tsx
const { data: totalRevenue } = useModel("orders", {
  aggregate: { fn: "sum", of: "total_amount" },
});

const { data: userCount } = useModel("users", {
  aggregate: { fn: "count" },
});
```

Supported functions: `count`, `sum`, `avg`, `min`, `max`.

### Full-Text Search

```tsx
const { data: results } = useModel("products", {
  search: searchQuery,
  searchFields: ["name", "description"],
});
```

## Column Name Rules

- Column names are **always snake_case** (e.g., `first_name`, `department_id`, `created_at`)
- Use the **exact column names** from the model schema when accessing response data
- Do NOT rename to camelCase — the database returns snake_case keys
- When rendering data: `item.first_name`, not `item.firstName`
- When building forms: field names must match column names exactly

## System Columns

Every model automatically includes these columns (never declared in schema):

| Column | Type | Description |
|--------|------|-------------|
| `id` | integer | Auto-increment primary key |
| `owner_id` | text | ID of the user who created the record |
| `created_at` | text | ISO 8601 creation timestamp |
| `updated_at` | text | ISO 8601 last modification timestamp |
| `deleted_at` | text | Soft-delete timestamp — **only present when `softDelete: true`** |

You can read these (e.g., display `created_at`) but never set `id` or `owner_id` manually.

## Owner Scope

Each model has an `ownerScope` that determines data visibility:

- **`user`** — Each user sees only their own records. CRUD operations are automatically scoped.
- **`shared`** — All authenticated users see all records (e.g., departments, categories).

This is handled by the backend — no filtering needed in component code.

## CRUD Patterns

### List with Loading State

```tsx
const { data: contacts, loading, error } = useModel("contacts", {
  orderBy: { created_at: "desc" },
});

if (loading) return <Skeleton className="h-32" />;
if (error) return <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>;
if (!(contacts ?? []).length) return <Empty><EmptyTitle>No contacts yet</EmptyTitle></Empty>;

return (contacts ?? []).map(c => <div key={c.id}>{c.first_name} {c.last_name}</div>);
```

### Create Record

```tsx
const { create } = useModel("contacts");

const handleSubmit = async (formData) => {
  await create({
    first_name: formData.first_name,
    email: formData.email,
    status: "active",
  });
};
```

**`useModel(model).create(...)` is the universal pattern for EVERY "user submits a record" flow, across all app types** — contact forms, newsletter signups, surveys, job applications, orders, comments, registrations, anything that should persist as a row. Define a backend model for the data you want to collect, then call `create(...)`. It auto-scopes `owner_id` to the current user, applies the schema's defaults and validation, and instantly refetches every other `useModel(model)` instance.

```tsx
// ✅ A contact form: define a `contact_messages` model, then create a row.
const { create } = useModel("contact_messages");
await create({ name, email, message });

// ✅ A job application: define an `applications` model, then create a row.
const { create } = useModel("applications");
await create({ ... });
```

There is no platform "forms service" — all submitted data lands in a model you defined and can read back with `useModel(model)`.

#### Nullable columns in React state

Nullable D1 columns are typed `T | null` in the per-app `app.d.ts` (NOT `T | undefined`). When piping into `useState`, match the type to whichever convention you choose:

```tsx
// Option A — keep null throughout (matches the d.ts shape directly)
const [salary, setSalary] = React.useState<number | null>(null);
useEffect(() => { if (row) setSalary(row.salary); }, [row]);  // ✅

// Option B — coerce at the boundary
const [salary, setSalary] = React.useState<number | undefined>(undefined);
useEffect(() => { if (row) setSalary(row.salary ?? undefined); }, [row]);  // ✅

// ❌ WRONG — TS error: Type 'number | null' is not assignable to 'number | undefined'
const [salary, setSalary] = React.useState<number | undefined>();
useEffect(() => { if (row) setSalary(row.salary); }, [row]);
```

#### Generic constraint (CRITICAL)

The generic on `useModel` is a string-literal model name, NOT the row type. If you annotate the generic with a type alias, TypeScript rejects it.

```tsx
// ❌ WRONG — passes a TYPE; TS error "Type Company does not satisfy keyof AppModels"
const { data } = useModel<Company>("companies");

// ✅ CORRECT — pass only the string name; TS narrows the row type from AppModels
const { data } = useModel("companies");
```

### Update Record

```tsx
const { update } = useModel("contacts");

const handleUpdate = async (id, changes) => {
  await update(id, { status: "inactive" });
};
```

### Delete Record

```tsx
const { remove } = useModel("contacts");

const handleDelete = async (id) => {
  try {
    await remove(id);
    toast.success("Record deleted");
  } catch (err) {
    const msg = err?.message ?? "Failed to delete";
    // FK constraint errors mention "referenced by other records"
    toast.error(
      msg.includes("referenced")
        ? "Cannot delete — this record has dependent data. Remove related records first."
        : msg
    );
  }
};
```

## Auto-Refetch Behavior

When you call `create`, `update`, or `remove` on any model, **all active
`useModel` instances for that same model automatically refetch** across the
entire app.

- Do NOT call `refetch()` after mutations — it happens automatically
- Do NOT add state synchronization between components using the same model
- A DataTable and a Dashboard chart both using `useModel("orders")` stay in sync

## Conditional Fetching

Use `enabled: false` to skip fetching until a condition is met:

```tsx
const [selectedId, setSelectedId] = React.useState(null);
const { data: details } = useModel("orders", {
  filters: { id: selectedId },
  enabled: selectedId !== null,  // don't fetch until an order is selected
});
```

When `enabled` is `false`, the hook returns `{ data: null, loading: false }`
without making any API call. Useful for detail views, dependent filters, and
conditional data loading.

## Default Limit

`useModel` defaults to `limit: 100` when no limit is specified. For large
datasets, set an explicit `limit` and implement pagination using `offset`
and `totalCount`.

## Status and Enum Values

**Status/enum values MUST always be lowercase** (e.g., `"active"`, `"pending"`,
`"completed"`). D1/SQLite is case-sensitive — `"Active"` will NOT match
`"active"` in filters or comparisons.

## Chart Data from Models

`useModel` data is already the correct shape for Recharts (array of objects).
Use column names directly as `dataKey`:

```tsx
const { data: courses } = useModel("courses");
<Charts.BarChart data={(courses ?? [])}>
  <Charts.XAxis dataKey="name" />
  <Charts.Bar dataKey="enrollment_count" />  {/* exact column name */}
</Charts.BarChart>
```
