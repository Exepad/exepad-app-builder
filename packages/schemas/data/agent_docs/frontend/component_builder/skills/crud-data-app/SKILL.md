---
name: crud-data-app
description: "useModel CRUD wiring — data tables, edit/create modals, dashboard KPIs over a model, model-backed forms, useApp shared state, useHandler aggregations. Load when the component plan involves persistent entity records, table/grid views, modal-driven create/edit/delete, dashboard KPIs computed from useModel data, or status-driven enum filters. Keywords: crud, table, data-table, form, modal, edit, delete, create, useModel, dashboard, kpi."
metadata:
  kind: domain
---
# Skill: CRUD Data App Wiring

## useModel Hook
- `const { data, loading, create, update, remove } = useModel('model_name')`
- `data` is `T[] | null` — always guard with `(data ?? [])` before `.map()` or `.length`
- `create(obj)`, `update(id, obj)`, `remove(id)` return promises
- Always check `loading` before rendering `data` — show a spinner or skeleton

## Form Save (data collection — use useModel)
- All data collection — including contact, newsletter, survey, and
  application forms — writes into a backend model you declared. Wire the
  submit handler to `useModel().create()`:
  `const { create } = useModel('applications'); await create({ field1, field2 });`
- After save, `useModel` auto-refreshes — no manual refetch needed
- **Do NOT use `fetch()` or `axios` to POST form data.** The model your
  `useModel(model)` reads from is the only place submissions should land.

```tsx
// ✅ CORRECT — persists into the model your reads see
const { create } = useModel("applications");
await create({ ... });
```

## Edit Modal Pattern
```
const [editItem, setEditItem] = useState(null);
// Open: setEditItem(item)  |  Close: setEditItem(null)
// Render: {editItem && <Modal>...</Modal>}
```

## Delete Confirmation
- Always confirm before `remove(id)` — use a confirmation dialog or inline confirm
- Disable the delete button while the request is in flight

## CRUD Form Submission Example
```tsx
const { create, update } = useModel('products');
const handleSave = async (e: React.FormEvent<HTMLFormElement>) => {
  e.preventDefault();
  const formData = Object.fromEntries(new FormData(e.currentTarget));
  if (selectedProduct) await update(selectedProduct.id, formData);
  else await create(formData);
  toast.success('Saved!');
};
```
- `useModel` auto-refreshes after mutations — no manual refetch needed
- Do NOT just close the modal without saving — the form data will be lost

## State Management via SDK Hooks

```tsx
// Shared UI state via useApp
const selectedItem = useApp(s => s.selectedItem);
const isModalOpen = useApp(s => s.isModalOpen);
const setState = useApp(s => s.setState);

// Backend CRUD via useModel
const { data: products, create, update, remove } = useModel('products');

// Custom queries via useHandler
const { data: stats } = useHandler('getDashboardStats', { autoFetch: true });
```

## Data Binding Patterns

| Source | Access Pattern | Use Case |
|--------|---------------|----------|
| Backend model data | `useModel('products')` | Tables, lists |
| Aggregations/custom queries | `useHandler('getStats', { autoFetch: true })` | KPI stats |
| UI state | `useApp(s => s.isModalOpen)` | Modal control, selection |

## CRUD Action Patterns

**Open edit modal:**
```tsx
const setState = useApp(s => s.setState);
setState('selectedItem', rowData);
setState('isEditModalOpen', true);
```

**Close modals:**
```tsx
setState('isEditModalOpen', false);
setState('isDeleteModalOpen', false);
setState('selectedItem', null);
```

**Save (create or update) from modal form:**
```tsx
const { create, update } = useModel('products');
const selectedItem = useApp(s => s.selectedItem);
const setState = useApp(s => s.setState);

const handleSave = async (e) => {
  const formData = Object.fromEntries(new FormData(e.currentTarget));
  if (selectedItem) await update(selectedItem.id, formData);
  else await create(formData);
  toast.success('Saved!');
  setState('isEditModalOpen', false);
  setState('selectedItem', null);
};
```
CRITICAL: The component MUST call `create`/`update` with the form data.
Do NOT just close the modal — the data will be silently discarded.

**Delete with confirmation:**
```tsx
const { remove } = useModel('products');

// Open delete confirmation:
setState('selectedItem', rowData);
setState('isDeleteModalOpen', true);

// Confirm delete:
await remove(selectedItem.id);
toast.success('Deleted');
setState('isDeleteModalOpen', false);
setState('selectedItem', null);
```

## Foreign-key labels (auto-expanded joins)

`useModel` auto-expands foreign keys. Every column whose name ends in
`_id` and whose target is another declared model gets a sibling joined
row attached to each result row, named by stripping the `_id` suffix.
You don't need to opt in or write a join — the data is just there.

```tsx
const { data: reservations } = useModel('reservations');

// Each row has BOTH:
//   row.guest_id           — the raw FK (still present for writes/filters)
//   row.guest              — the joined row, or null if missing/unauth
//   row.guest.full_name
//   row.room.room_number

return (reservations ?? []).map(r => (
  <TableCell>{r.guest?.full_name ?? '—'}</TableCell>
));
```

Always read joined fields with optional chaining (`?.`) and provide a
fallback — the joined object is `null` when the FK value is null, when
the joined row was deleted or soft-deleted, or when it's owned by a
different user.

**Wrong (the validator's `component.jsx.fk_id_as_label` flags this and
the auto-fixer rewrites it once it has the joined model schema):**
```tsx
<TableCell>#{r.guest_id}</TableCell>   // shows "1", not "Eleanor Vance"
```

`<TableCell>`, `<TableHead>`, `<td>`, headings, etc. should never render
a bare `*_id` expression. Always resolve to the joined row's display field.

## Filter literals must match declared `enum_values` exactly

SQLite is byte-exact on string equality. If a column declares
`enum_values: ["Full Clean", "Deep Clean"]`, then `useModel("tasks", {
filters: { task_type: "full_clean" } })` returns zero rows — the literal
doesn't byte-match `"Full Clean"`.

The validator's `component.useModel.enum_case_mismatch` check warns AND
auto-fixes deterministic case/punctuation drifts. To stay ahead of it,
copy filter literals straight from the model's declared `enum_values`.

## Render enum columns as `<Select>`, never free-text `<Input>`

A column that declares `enum_values` is a closed set — the form should
present every declared value as a selectable option, not a free-text
field that can drift from the schema. Use `<Select>` + one `<SelectItem>`
per declared value, in the order the model declares them, with the raw
literal as both the `value` and the user-facing label (or a Title-Case
display of it). Filters and forms both apply.

```tsx
// Model declares: pets.species.enum_values = ['dog', 'cat', 'bird', 'rabbit']
const SPECIES = ['dog', 'cat', 'bird', 'rabbit'] as const;

<Select value={form.species} onValueChange={(v) => setForm({ ...form, species: v })}>
  <SelectTrigger><SelectValue placeholder="Species" /></SelectTrigger>
  <SelectContent>
    {SPECIES.map(s => (
      <SelectItem key={s} value={s}>
        {s.charAt(0).toUpperCase() + s.slice(1)}
      </SelectItem>
    ))}
  </SelectContent>
</Select>
```

The same array drives the **filter UI** above the table. The validator's
`component.codegen.enum_coverage` check warns when a `switch (row.col)`
or status-label map omits any declared value — list the array literal
explicitly at the top of the file so coverage is obvious to a reader.
For the **status-label map** pattern (chip color per enum value), spell
each value as its own key — don't `default:` the dominant case:
```tsx
const STATUS_STYLES: Record<typeof STATUSES[number], string> = {
  scheduled: 'bg-primary-container text-on-primary-container',
  'checked-in': 'bg-tertiary-container text-on-tertiary-container',
  completed: 'bg-secondary-container text-on-secondary-container',
  cancelled: 'bg-error-container text-on-error-container',
};
```

## KPI cards must compute from data, never hardcode

**Wrong (the validator's `component.codegen.hardcoded_kpi_literal` flags this):**
```tsx
<Card>
  <p>Outstanding</p>
  <p>$12,450</p>           {/* hardcoded — drifts from reality */}
</Card>
<Card>
  <p>Collection Rate</p>
  <p>94.2%</p>              {/* hardcoded — drifts from reality */}
</Card>
```

**Right — wire the value to a hook:**
```tsx
const { data: stats } = useHandler('getBillingStats', { autoFetch: true });

<Card>
  <p>Outstanding</p>
  <p>${stats?.outstanding?.toLocaleString() ?? '—'}</p>
</Card>
```

If a stat doesn't have a clear handler, request one in your plan rather
than substituting a plausible-looking literal.

## Hardcoded staff / user / role lists

Same rule applies to inline data arrays. **Wrong:**
```tsx
const team = [
  { name: "Sarah Jenkins", role: "Admin" },
  { name: "Marcus Thorne", role: "Front Desk" },
];
return team.map(...);
```

The list silently goes stale the moment a real user is added. Use
`useModel('users')` (or whatever the model is called) instead.

## Anti-Patterns
- NEVER hardcode fake CRUD data — always use `useModel` data
- NEVER hardcode KPI numbers, percentages, or user/staff lists in JSX
- NEVER render `*_id` foreign-key columns as labels — resolve via a joined `useModel`
- NEVER use `fetch()` or `axios` for CRUD — use SDK's `useModel` hooks (`create`, `update`, `remove`)
- NEVER render `data.map(...)` without guarding `loading` and null — use `(data ?? []).map(...)`
- NEVER call `create`/`update`/`remove` inside render — only in event handlers


## Canonical implementations (load on demand)
- `load_skill_resource(skill_name='crud-data-app', file_path='assets/example_1.tsx')` — truncated source from the `stats-dashboard-1` reference block.
- `load_skill_resource(skill_name='crud-data-app', file_path='assets/example_2.tsx')` — truncated source from the `crud-table-11` reference block.

Read these only when the building plan calls for a layout / wiring pattern that closely matches one of the reference blocks. Don't load all examples up front.
