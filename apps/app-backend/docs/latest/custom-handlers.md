# Custom Handlers

Custom handlers are user-defined JavaScript methods that extend the backend with app-specific business logic. They are compiled at deploy time and executed inside the runtime process with direct access to the app's database.

## How Handlers Work

1. App developer (or the agent) writes handler code (TypeScript/JavaScript)
2. The deploy pipeline compiles handlers to ES modules and writes them to storage under `{appId}/{mode}/modules/handlers/`
3. On first use, `src/handlers/app-registry.ts` reads `worker-manifest.json`, loads each module into a constrained `node:vm` context, and caches the registry per `{appId, mode}`
4. When a client calls an RPC method matching a handler name, the executor runs it
5. A redeploy changes the manifest hash, which invalidates the cached registry

## Handler Configuration

Handlers are defined in the app's backend config:

```json
{
  "handlers": [
    {
      "name": "generateReport",
      "method": "generateReport",
      "description": "Generate a revenue report",
      "authLevel": "authenticated",
      "handlerType": "read",
      "inputs": [
        { "name": "startDate", "type": "string", "required": true },
        { "name": "endDate", "type": "string", "required": true }
      ],
      "outputs": [
        { "name": "totalRevenue", "type": "number" },
        { "name": "records", "type": "array" }
      ]
    }
  ]
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `name` | string | required | Handler name (used as the RPC method name) |
| `method` | string | required | Function name in the registry |
| `description` | string | — | Human-readable description |
| `authLevel` | string | `"authenticated"` | `AccessLevel`: `"public"`, `"authenticated"`, `"role:X"`, `"owner"`, or `"none"` (legacy `"admin"` is normalized to `"role:admin"` at deploy time) |
| `handlerType` | string | `"write"` | `"read"` or `"write"` (affects auth enforcement) |
| `inputs` | InputConfig[] | `[]` | Input parameter schema for validation |
| `outputs` | OutputConfig[] | `[]` | Output schema for validation |

## Handler Context

Every handler receives a single `ctx` argument with:

```typescript
interface HandlerContext {
  /**
   * The app's database — direct SQL access, bypassing CRUD authorization.
   * Typed as the D1 surface; backed by the app's SQLite file.
   * Wrapped so raw INSERTs into known model tables get the NOT NULL system
   * columns (owner_id, created_at, updated_at) auto-filled — see
   * `src/context/handler-db.ts`. Explicit values are never overwritten.
   */
  db: D1Database;

  /** Execute multiple statements atomically; any failure rolls the batch back */
  batch: (statements: D1PreparedStatement[]) => Promise<D1Result[]>;

  /** Current user (frozen object) */
  user: {
    id: string;
    email: string;
    roles: string[];
  };

  /** Input parameters (frozen object) */
  params: Record<string, unknown>;

  /** Structured logger with prefix [appId/handlerName] */
  log: {
    debug(message: string, data?: Record<string, unknown>): void;
    info(message: string, data?: Record<string, unknown>): void;
    warn(message: string, data?: Record<string, unknown>): void;
    error(message: string, data?: Record<string, unknown>): void;
  };

  /** App configuration (frozen object) */
  config: {
    appId: string;
    appAlias: string;
  };

  /** Model definitions keyed by name — check ownerScope, columns, softDelete */
  models: Record<string, ModelProps>;
}
```

There is **no `ctx.services`**. The only email path in this backend is the
internal auth transport (verification + password reset), which handlers cannot
call.

### Security Note

Handlers receive **unrestricted access** to `ctx.db` and `ctx.batch`, bypassing all CRUD-layer authorization (owner_id scoping, crudPolicy checks, soft-delete filtering). Handler code is treated as trusted server-side code.

The `user`, `params`, and `config` objects are frozen (read-only) to prevent accidental mutation.

Handler modules run in a `node:vm` context with only standard intrinsics, a
prefixed `console`, and an allowlisted `fetch` (`EXEPAD_FETCH_ALLOWLIST`,
default-deny — outbound requests are blocked unless you opt in). No `require`,
`process`, or `fs`. **This is not a security boundary**: `node:vm` cannot
contain hostile code, so the model is "you trust the apps you generate". Running
apps from multiple untrusted authors in one container is unsafe — see the module
comment in `src/handlers/app-registry.ts`.

## Execution Flow

```
1. Validate input params against handler's declared input schema
2. Resolve handler function from the per-app registry
3. Build handler context (db, batch, user, params, models, config, log)
4. Execute handler with 10-second timeout
5. Validate output against handler's declared output schema
6. Return result or HandlerError (500)
```

If the handler exceeds the 10-second timeout, it's terminated with a `HANDLER_ERROR`.

## Input/Output Validation

### Input Validation

Inputs are validated before execution based on the handler's `inputs` config:

```json
{
  "inputs": [
    { "name": "startDate", "type": "string", "required": true },
    { "name": "count", "type": "number", "required": false }
  ]
}
```

Supported types: `string`, `number`, `boolean`, `array`, `json`.

### Output Validation

After execution, the handler's return value is checked against the `outputs` config:

```json
{
  "outputs": [
    { "name": "totalRevenue", "type": "number" },
    { "name": "records", "type": "array" }
  ]
}
```

Output validation is lenient — missing fields are allowed, but type mismatches trigger a `HANDLER_ERROR`.

## Handler Registry

One process serves every app, so the registry cannot be a process global — it is
resolved per `{appId, mode}` by `src/handlers/app-registry.ts`.

Source of truth is what the deploy pipeline wrote to storage:

```
{appId}/{mode}/worker-manifest.json           ← module list + content hash
{appId}/{mode}/modules/handlers/{method}.js   ← one compiled ES module per handler
```

On first use for an app+mode the registry reads the manifest, loads each module
into its own `vm` context, and caches the result. The cache is keyed by the
manifest's content hash, so a redeploy is picked up on the next call with no
restart.

## Example Handler

```typescript
export default async function getRevenueTrends(ctx) {
  const { startDate, endDate } = ctx.params;

  ctx.log.info('Computing revenue trends', { startDate, endDate });

  const result = await ctx.db
    .prepare(
      `SELECT strftime('%Y-%m', created_at) AS month, SUM(amount) AS total
       FROM orders
       WHERE created_at BETWEEN ? AND ?
       GROUP BY month
       ORDER BY month`
    )
    .bind(startDate, endDate)
    .all();

  return {
    trends: result.results,
    totalRevenue: result.results.reduce((sum, r) => sum + (r.total as number), 0),
  };
}
```

## Authorization

- **Write handlers** (default `handlerType`): Always require authentication, even if `authLevel` is `"public"` (prevents empty `owner_id` on inserts)
- **Read handlers** (`handlerType: "read"`): Respect `authLevel` as declared (can be public)
- Custom handlers bypass the model-level CRUD policy entirely
