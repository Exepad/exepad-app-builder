# Data Fetching Contracts (`useModel` / `useHandler` / `useCount`)

This doc covers the wire contracts between code components and the backend
gateway. Get these wrong and you ship a working-looking page that
returns `0` everywhere (or worse, a `VALIDATION_ERROR` that blanks the
page entirely). Get them right and the dashboard renders real data on
first load.

## `useHandler('X', { params })` body shape — FLAT, NEVER WRAPPED

The runtime gateway turns the `params` object you pass into the body it
sends to the handler. The wire envelope is always:

```jsonc
// what the gateway sends to the handler:
{ "method": "X", "params": { "days": 30 } }
```

`useHandler` adds the `params:` wrapper for you. **You write the keys
flat**:

```tsx
// ✅ GOOD — flat keys
const { data } = useHandler("getOrderTrends", { params: { days: 30 } });

// ❌ BAD — double-wrapped (wire envelope leaks into your call)
const { data } = useHandler("getOrderTrends", { params: { params: { days: 30 } } });
```

Double-wrapping fails with `VALIDATION_ERROR: Unrecognized key(s) in
object: 'params'` because the inner `params` is rejected by the
handler's strict input schema.

## Handler input is strict — every `params` key must be declared

The handler's `ctx.params` is validated by a strict Zod schema on the
app-backend side. Every key the component sends MUST be a key the
handler reads via `ctx.params.X` or destructures (`const { X } =
ctx.params`). Unknown keys produce:

```jsonc
{ "success": false, "error": { "code": "VALIDATION_ERROR",
  "message": "Input validation failed",
  "details": { "errors": [
    { "field": "", "message": "Unrecognized key(s) in object: 'timeRange'" }
  ]}}}
```

The page that consumes this handler renders the `error` branch (or
stale `null` data — depending on how the consumer is written).

**Build-time guard.** The validator rule
`component.handler.params_mismatch` flags
`useHandler('X', { params: { Y } })` when handler `X` doesn't read
`ctx.params.Y`. If you see this warning, either:

1. **Make the handler accept the param** (preferred — the component is
   sending it for a reason): add `const { Y } = ctx.params;` or
   `const Y = ctx.params.Y;` to the handler body and wire it into the
   query.
2. **Drop the param from the call** if it really is dead code: remove
   `Y` from the `params:` object on the `useHandler` call.

Do NOT silence the warning by deleting it from the validator output —
the strict input schema will still reject the request at runtime.

## `useHandler.execute(...)` resolves to the handler's data — not a boolean

`useHandler('X')` returns both reactive state (`data`, `loading`,
`error`) AND an imperative `execute(params)` for write-style calls.
`execute` resolves to **whatever the handler returned**, or `null`
when the request failed (network error, non-`success` response).

```tsx
// ✅ Good — destructure the actual return shape
const { execute: updateStatus, loading } = useHandler("updateOrderStatus", { autoFetch: false });

const onChangeStatus = async (orderId, newStatus) => {
  const result = await updateStatus({ orderId, newStatus });
  if (result?.success) {
    toast.success(`Order ${orderId} → ${newStatus}`);
  } else {
    toast.error("Update failed");
  }
};
```

```tsx
// ❌ Bad — treating the return value as a boolean
const success = await updateStatus({ orderId, newStatus });
if (success) toast.success("Updated");      // success is the object {success: true},
                                            // always truthy on success — misleading control flow.
```

**Why this matters.** A handler like `updateOrderStatus` returns
`{ success: true | false }`. `await execute(...)` gives you that
object directly, not a boolean. Naming the awaited value `success`
and checking `if (success)` then-tosting will always fire the success
toast unless the network itself failed. Always destructure the return
shape that matches the handler's `return` statement.

**Failure mode.** `execute` returns `null` on transport error or when
the gateway returned `success: false` (handler threw, validation
rejected the params, etc.). Optional-chain through it
(`result?.success`, `result?.data`) to avoid a runtime crash.

## `useModel` aggregate is an array, not a number — use `useCount` instead

`useModel(name, { aggregate: { fn: 'count', of: '*' } })` returns the
same shape as a regular `useModel`:

```tsx
{ data: Array<…>, loading, error, totalCount, … }
```

The aggregate result lands in `data[0]` as `{ count_*: <n> }` — never a
plain number. Rendering it directly displays `[object Object]`:

```tsx
// ❌ BAD — `orders` is an array of aggregate rows, not a count
const { data: orders } = useModel('orders', { aggregate: { fn: 'count', of: '*' } });
return <span>{(orders as any) ?? 0}</span>;  // renders "[object Object]" or "0"
```

Use `useCount` for the "just give me a number" case:

```tsx
// ✅ GOOD — typed convenience hook
import { useCount } from "@exepad/sdk";

function OrdersBadge() {
  const { count, loading } = useCount("orders");
  return <span>{loading ? "…" : count.toLocaleString()}</span>;
}
```

`useCount` returns `{ count: number; loading: boolean; error: string | null; refetch: () => void }`
— a typed, idiomatic shape. Under the hood it issues a `sys_list` with
`limit: 1` and surfaces the gateway's `pagination.total` as the count.

## `id` (synthetic PK) vs `<entity>_id` (domain FK target) — they coexist

Every backend model has **two** id-shaped columns:

| Column | What it is | When to use |
|---|---|---|
| `id` | Auto-increment integer PK assigned by the app-backend scaffold at insert time. Stable across the lifetime of the row. | React keys, `update(item.id, ...)` calls, navigation params. |
| `<entity>_id` | The domain id from the seed CSV (e.g. `customer_id`, `product_id`). Stable across deploys; what FKs point at. | FK lookups (`WHERE product_id = item.product_id`), URL params when the domain id is what the user reasoned about. |

Most components want `item.id` for keys and `update()` calls:

```tsx
// ✅ Good — synthetic PK for CRUD
filteredOrders.map((order) => (
  <tr key={order.id} onClick={() => navigate(`/orders/${order.id}`)}>
    <td>{order.order_code}</td>
    ...
  </tr>
))
```

```tsx
// ✅ Good — domain id for FK joins
const productMap = useMemo(() => {
  const map = new Map();
  (products ?? []).forEach(p => map.set(p.product_id, p.name));
  return map;
}, [products]);

return inventory?.map(item => (
  <tr key={item.id}>
    <td>{productMap.get(item.product_id) ?? `Product #${item.product_id}`}</td>
  </tr>
));
```

Avoid using `<entity>_id` as a React key on rows whose primary identity
comes from the synthetic `id` — same domain id can map to multiple rows
across snapshots.

## FK columns are auto-embedded — read `row.<alias>`, don't `.find()`

The app-backend auto-joins every `<X>_id` FK column to its referenced
model and attaches the resolved row under the de-suffixed alias. So
`useModel("orders")` rows come back with `order.customer` already
populated (when `customer_id` references the customers model). You
DO NOT need a second `useModel("customers")` + manual `.find()`.

```tsx
// ✅ Good — use the embedded relation
const { data: orders } = useModel("orders", { orderBy: { order_date: "desc" } });

return orders?.map(order => (
  <tr key={order.id}>
    <td>{order.order_code}</td>
    <td>{order.customer?.first_name} {order.customer?.last_name}</td>
    <td>{order.customer?.email}</td>
  </tr>
));
```

```tsx
// ❌ Bad — manual lookup against a second list
const { data: orders } = useModel("orders");
const { data: customers } = useModel("customers");      // 50-row default limit
const customerName = (id) => {
  const c = customers?.find(c => c.customer_id === id); // misses for id > 50
  return c ? `${c.first_name} ${c.last_name}` : `ID: ${id}`;
};
```

**Why this matters.** `useModel` defaults to `limit: 50` server-side
(`apps/app-backend/src/crud/list.ts:DEFAULT_LIMIT`). Seed datasets
routinely exceed 50 rows (the Nexus Ops shop seeded 200 customers,
250 orders). A `.find()` against the limited list misses every row
whose domain id is > 50 and falls back to a degraded display
("Customer: ID: 195"). The auto-embed runs server-side on the actual
join, so it works regardless of the limit.

**Embed contract:**

- Trigger: a column whose name ends in `_id` and declares
  `references: { model: "..." }`. The de-suffixed alias is the join
  key — `customer_id` → `row.customer`, `product_id` → `row.product`.
- Ownership: the embedded row respects the joined model's own
  `ownerScope` — a `shared` parent can embed a `shared` child for any
  user; a `user`-scoped parent cannot pull another user's data.
- Nullability: `row.<alias>` is `null` when the FK column is `null`,
  the target row was deleted, or the joined model is missing from the
  registry. Always guard with `?.` on access.
- Opt-out: a model declaring `autoExpandFKs: false` suppresses
  auto-embed for ALL of its FKs (rare — only set when the embed cost
  outweighs the value).

```tsx
// Reach for the embed BEFORE pulling a second model.
// Need products' supplier? Use `inventory.supplier` instead of
// fetching the whole suppliers list:
const { data: inventory } = useModel("inventory");
return inventory?.map(i => (
  <li key={i.id}>{i.product?.name} — supplied by {i.supplier?.company_name}</li>
));
```

## `useCurrentUser()` never returns null, but its fields can

The hook always returns a `CurrentUser` object. Anonymous users get the
fallback `{ id: null, email: null, name: null, roles: [],
isAuthenticated: false }`. So:

- `user.roles.includes('admin')` — **safe**. `roles` defaults to `[]`,
  `.includes` on `[]` returns `false`.
- `user.isAuthenticated` — **safe**. Boolean.
- `user.id` / `user.email` / `user.name` in JSX text — **safe**.
  `null` interpolates harmlessly.
- `user.email.toLowerCase()` — **crashes** when `email` is `null`. Use
  `user.email?.toLowerCase()`.
- `user.name.charAt(0)` — **crashes**. Use `user.name?.charAt(0) ?? "U"`.

**Build-time guard.** Rule
`component.sdk.use_current_user_nullable_field_chain` flags chained
access on the nullable fields without an optional chain. Auto-fix
rewrites to optional-chain form.

## JSON-typed columns (`type: "json"`)

Columns declared `type: "json"` in the model schema are **auto-parsed
by the app-backend** before returning rows to the frontend. The value
arrives as a JS array, object, or `null` — **never a string**.

```tsx
// Model schema: plans.features is type: "json"
const { data: plans } = useModel("plans");
// plans[0].features is already a JS value — DO NOT call JSON.parse().

✗ const features = JSON.parse(plan.features || "[]");
    // Crashes with `SyntaxError: "[object Object]" is not valid JSON`
    // whenever the seed stored an object literal.

✓ const features = Array.isArray(plan.features)
    ? plan.features
    : plan.features && typeof plan.features === "object"
      ? Object.values(plan.features)
      : [];
```

The defensive `Array / typeof "object"` branching handles all three
shapes the seed might emit: array (iterate directly), object
(`.values()` collapses to a list for `.map`), or null/undefined (empty
fallback). The auto-fixer rewrites the bad `JSON.parse` pattern when
detected, but writing the correct shape first time saves a render
crash if the fixer's gate ever changes.

## Quick reference

```tsx
import {
  useModel,
  useCount,
  useHandler,
  useCurrentUser,
} from "@exepad/sdk";

// List with filters / search
const { data: orders, loading } = useModel("orders", {
  orderBy: { order_date: "desc" },
  limit: 50,
});

// Count only — typed number
const { count: orderCount } = useCount("orders");

// Custom handler with params (FLAT — no nested `params:`)
const { data: stats } = useHandler("getDashboardStats", {
  params: { timeRange: "Month" },
});

// User identity — guard nullable fields
const user = useCurrentUser();
const initial = user.name?.charAt(0) ?? "U";
const isAdmin = user.roles.includes("admin");  // safe — roles never null
```
