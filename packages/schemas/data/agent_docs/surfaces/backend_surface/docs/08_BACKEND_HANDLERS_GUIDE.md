# Backend Handlers Guide — Component Usage

> How to use backend handlers in code components via `useHandler` from `@exepad/sdk`.

## useHandler Hook

```tsx
import { useHandler } from "@exepad/sdk";

const { data, loading, error, execute, refetch } = useHandler("handler_name");
```

### Return Values

| Field | Type | Description |
|-------|------|-------------|
| `data` | `T \| null` | Most recent result (null until first call) |
| `loading` | `boolean` | True while executing |
| `error` | `string \| null` | Error message if execution failed |
| `execute` | `(params?) => Promise<T>` | Call the handler with input parameters |
| `refetch` | `() => void` | Re-execute with the last used parameters |

## Read vs Write Handlers

### Read Handlers — Auto-Fetch on Mount (default)

Read handlers fetch computed data (dashboards, aggregations, reports).
By default, `autoFetch` is `true` — the handler executes automatically on mount:

```tsx
// Simple — data loads automatically on mount
const { data: stats, loading } = useHandler("getDashboardStats");

// With parameters — use params option
const { data: report, loading } = useHandler("getSalesReport", {
  params: { date_range: "last_30_days" },
});

if (loading) return <Skeleton className="h-32" />;
```

### Read Handlers — Dynamic Parameters

When parameters change based on user interaction, use `autoFetch: false`
and call `execute()` manually:

```tsx
const { execute, data: report, loading } = useHandler("getSalesReport", {
  autoFetch: false,
});

const handleGenerate = () => execute({ date_range: selectedRange });
```

### Write Handlers — Call on User Action

Write handlers perform mutations (form submissions, batch operations).
**All handlers default to `autoFetch: true`** — you MUST pass `autoFetch: false`
for write handlers to prevent them from executing on mount:

```tsx
const { execute, loading } = useHandler("submitContactForm", {
  autoFetch: false,
});

const handleSubmit = async (formData) => {
  const result = await execute({
    name: formData.name,
    email: formData.email,
    message: formData.message,
  });
  if (result) {
    toast("Form submitted successfully");
  }
};
```

## Input/Output Mapping

The `backend_surface` lists each handler's inputs and outputs. Use them precisely:

- **Inputs**: Pass as an object to `execute({...})` — use exact parameter names
- **Outputs**: Access from the resolved promise or from `data` — use exact field names

```tsx
// Handler surface says:
//   inputs: (date_range: string, department_id: integer)
//   outputs: (total_revenue: real, order_count: integer)

const { execute } = useHandler("getSalesReport");

const result = await execute({
  date_range: "last_30_days",
  department_id: selectedDept,
});

// result.total_revenue, result.order_count
```

## Error Handling

`execute()` **never throws** — it catches errors internally and returns `null`.
Use the `error` field from the hook or check for a `null` return:

```tsx
const { execute, loading, error } = useHandler("processPayment", {
  autoFetch: false,
});

const handlePayment = async () => {
  const result = await execute({ amount: total, method: "card" });
  if (result) {
    toast("Payment processed");
  } else {
    toast("Payment failed", { description: error ?? "Unknown error" });
  }
};
```

## Chart Data from Handlers (CRITICAL)

`Charts.*` components (Recharts) require `data` as an **array of objects**.
`dataKey` MUST match a key in each data object.

Handler results contain named fields, where chart data fields are arrays of objects
with keys matching SQL column aliases. Use these field names directly as `dataKey` props.

```tsx
// Handler returns: { chartData: [{hour: "09:00", count: 5}, {hour: "10:00", count: 12}] }
const { data: volumeData, loading } = useHandler("getCallVolume", {
  params: { period: "24h" },
});

// ✅ CORRECT — pass array directly, use SQL column names as dataKey
<Charts.AreaChart data={volumeData?.chartData ?? []}>
  <Charts.XAxis dataKey="hour" />
  <Charts.Area dataKey="count" />
</Charts.AreaChart>
```

Common chart mistakes:
- WRONG: `data={stats}` — pass the array field, e.g. `data={stats?.chartData ?? []}`
- WRONG: `dataKey="department"` when handler output has `name` not `department`
- WRONG: Passing `null` to `data` — always use `data={items ?? []}`
- WRONG: Reshaping handler data into `{labels[], values[]}` — handlers return array-of-objects

**Chart colors:** Use CSS custom properties — NOT hardcoded hex values:
- BAD: `fill="#E85D04"`, `stroke="#1A1A2E"`
- GOOD: `fill="var(--primary)"`, `stroke="var(--secondary)"`

## Handler Field Name Contract (CRITICAL)

The `backend_surface` defines exact output field names for each handler. Use them
verbatim in your component — do NOT invent alternative names or hardcode fallbacks.

```tsx
// backend_surface says getTopAgents outputs: agents (array with full_name, department, avg_csat, status, total_calls)

// ✅ CORRECT — use exact field names from handler output
<td>{agent.avg_csat}</td>
<td>{agent.status}</td>

// ❌ WRONG — invented field name, falls back to hardcoded value
<td>{agent.qa_score ?? '98%'}</td>  // handler returns avg_csat, not qa_score!
<td>Available</td>                   // handler returns status, don't hardcode!
```

## Rules

1. **Never hardcode data** that should come from a handler — use loading/empty states instead
2. **Use exact handler names** from the backend surface — typos cause silent failures
3. **Use exact input parameter names** — the backend validates them strictly
4. **Use exact output field names** when rendering results — do NOT invent alternatives or add fallback hardcodes
5. **Read handlers** auto-fetch on mount by default — no `useEffect` needed
6. **Write handlers** MUST pass `autoFetch: false` — all handlers default to auto-fetch
7. **`execute()` returns `null` on error** — do NOT use try/catch, check the return value instead
8. **Chart data** from handlers is always array-of-objects — use SQL column names as `dataKey`, never reshape
9. **Never hardcode placeholder values** (e.g., "Available", "98%") for fields that should come from handler data
10. **Do NOT pass a TYPE as the generic** — `useHandler<TOutput>(name)` is a TS error. The generic is the NAME literal, not the output shape. Output type is inferred from `AppHandlerOutputs`.

## Generic constraint (CRITICAL)

The generic on `useHandler` is a string-literal handler name, NOT the output type. Same applies to `useModel`. If you annotate the generic with a type alias or interface, TypeScript rejects it.

```tsx
// ❌ WRONG — passes a TYPE; TS error "Type X does not satisfy keyof AppHandlerOutputs"
const { data } = useHandler<SearchOutput>("getJobSearch");
const { data } = useModel<Company>("companies");

// ✅ CORRECT — pass only the string name; TS narrows the output type from AppHandlerOutputs
const { data } = useHandler("getJobSearch");
const { data } = useModel("companies");

// ✅ If you must annotate: the generic is the NAME literal
const { data } = useHandler<'getJobSearch'>("getJobSearch");
```
