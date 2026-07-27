# 08 — Backend Modes

> Canonical source: `src/app_runtime/interfaces/backend.ts`

The Exepad runtime supports three mutually exclusive backend modes, expressed as a
TypeScript discriminated union on the `mode` field. Apps may declare a mode in
their `backend` property, or omit it entirely for frontend-only apps.

---

## 1. BackendProps Discriminated Union

```ts
// backend.ts
export type BackendProps = StaticBackend | DynamicBackend | NoneBackend;
```

The discriminant is the `mode` field:

| Mode       | Type            | Infrastructure                                | Use case                                      |
|------------|-----------------|-----------------------------------------------|-----------------------------------------------|
| `"static"` | `StaticBackend` | None (self-contained JSON)                    | Charts, reports, previews, prototypes, MCP artifacts |
| `"dynamic"`| `DynamicBackend`| A SQLite database + the in-process app-backend; a filesystem bucket when file storage is enabled | Full-stack deployed applications |
| `"none"`   | `NoneBackend`   | None                                          | Frontend-only apps (explicit signal)          |

---

## 2. StaticBackend

```ts
// backend.ts
export interface StaticBackend {
  mode: 'static';

  /** Inline data layer */
  data: {
    /** Map of dataset names to static dataset definitions.
     *  Components reference via 'dataset.' prefix. */
    datasets: Record<string, StaticDatasetProps>;
  };
}
```

**When to use:** Any app that ships its own data inline and does not need a
server or a database. The entire app is a single JSON artifact. Typical cases:

- Dashboard charts with pre-computed data
- Static reports and previews
- Prototypes and mockups
- MCP artifact responses

Each dataset's records are injected into the Zustand store under the dataset
name at app init (see §7), so a code component reads them with the SDK's
`useAppState('products')`. The `'dataset.' prefix` mentioned in the interface's
doc-comment above is a leftover from the removed JSON component library — no
prefix parser exists any more (see §8).

---

## 3. StaticDatasetProps and FieldDefProps

> Source: `src/app_runtime/interfaces/data/index.ts`

### 3.1 FieldDefProps

```ts
// data/index.ts
export interface FieldDefProps {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'date' | 'url' | 'email' | 'currency';
  label?: string;       // Display label; defaults to titleCase of name
  required?: boolean;    // For form generation. @default false
  format?: string;       // e.g., 'YYYY-MM-DD' for dates, '$0,0.00' for currency
}
```

Supported field types:

| Type       | Description                              |
|------------|------------------------------------------|
| `string`   | Plain text                               |
| `number`   | Numeric value                            |
| `boolean`  | True/false                               |
| `date`     | Date or datetime (display via `format`)  |
| `url`      | Hyperlink                                |
| `email`    | Email address                            |
| `currency` | Monetary value (display via `format`)    |

### 3.2 DatasetSchemaProps

```ts
// data/index.ts
export interface DatasetSchemaProps {
  fields: FieldDefProps[];
  primaryKey?: string;  // @default 'id'
}
```

### 3.3 StaticDatasetProps

```ts
// data/index.ts
export interface StaticDatasetProps {
  type: 'static';
  schema?: DatasetSchemaProps;
  records: Record<string, any>[];
  generated?: boolean;        // If true, shows "sample data" banner. @default false
  generationHint?: string;    // Hint for AI data generation
  _meta?: {
    totalCount?: number;      // Full dataset size
    truncated?: boolean;      // True when records are a subset
    sourceHint?: string;      // Where to find the full data
  };
}
```

- **`records`** -- Array of plain objects. Each record should include a field
  matching the schema's `primaryKey`.
- **`generated`** -- When `true`, the UI renders a "sample data" banner so
  users know the data is AI-generated.
- **`generationHint`** -- A natural-language description used by the AI when
  generating seed records (e.g., `"e-commerce products with price and category"`).
- **`_meta`** -- Metadata for truncated datasets. The runtime can display a
  count indicator and link to the full source.

---

## 4. DynamicBackend

```ts
// backend.ts
export interface DynamicBackend {
  mode: 'dynamic';

  /** Data models with automatic CRUD endpoints */
  models?: ModelProps[];

  /** Custom JavaScript handlers for complex logic */
  handlers?: HandlerProps[];

  // Passed through by the runtime, interpreted by deploy-utils / app-backend.
  sources?: Record<string, unknown>;
  storage?: unknown;
  queues?: unknown[];
  tasks?: unknown[];
  pipelines?: unknown[];
  realtime?: unknown;
}
```

All fields are optional. Only `models`, `handlers`, and `storage` have a
working implementation today — see §4.4. The runtime itself only reads `models`
and `handlers`; the rest are config passthrough.

### 4.1 Models (Tier 1 -- Auto-CRUD)

- Route: `POST /api/{appId}/{modelName}` (or `/rpc` with an explicit `method`).
- Each model gets automatic CRUD. The app-backend implements
  `sys_create`, `sys_read`, `sys_list`, `sys_update`, `sys_delete`,
  `sys_upsert`, `sys_aggregate`, `sys_batch`, and `sys_multi_query` (via the
  `_bulk` gateway path). `ModelProps` (from `@exepad/types`) defines columns,
  indexes, foreign keys, access levels, CRUD policies, `ownerScope`, soft
  delete, and migration policy.

### 4.2 Handlers (Tier 2 -- Custom JavaScript)

- Route: `POST /api/{appId}/{handlerName}`.
- Custom JavaScript functions for business logic that goes beyond CRUD.
- `HandlerProps` (from `@exepad/types`) defines inputs, outputs, `authLevel`,
  `handlerType` (`'read'` | `'write'`), and the method name referencing the
  compiled JS the deploy pipeline reads out of `repo.backend.handlers`.

### 4.3 Storage (file uploads)

```ts
// packages/types/src/backend.ts
export interface StorageProps {
  enabled: boolean;
  maxFileSize?: number;         // @default 10_485_760 (10 MB)
  allowedMimeTypes?: string[];  // supports wildcards like 'image/*'
  maxFilesPerUser?: number;     // @default 1000
  maxStoragePerUser?: number;   // @default 524_288_000 (500 MB)
  maxStoragePerApp?: number;    // @default 5_368_709_120 (5 GB)
  allowSvg?: boolean;           // @default false (XSS risk)
  publicAccess?: boolean;       // @default false
  filePolicy?: FilePolicyProps; // per-operation access levels
}
```

When `enabled`, the deploy pipeline creates the app's bucket directory
(`<EXEPAD_DATA_DIR>/buckets/exepad-files-{appId}`) and a `_files` system table,
and the backend gets an `R2_FILES` binding — which is a filesystem adapter, not
Cloudflare R2. Uploads and downloads go through the gateway's `_files/*` routes.
`storage.enabled` requires `backend.mode === 'dynamic'`; the deploy pipeline
rejects it on a static backend.

### 4.4 Not Implemented: `sources`, `queues`, `tasks`, `pipelines`, `realtime`

These five fields survive on `DynamicBackend` as `unknown` passthrough, and the
runtime explicitly does not interpret them:

```ts
// backend.ts (trailing comment)
// Additional backend types (Sources, Storage, Queues, Tasks, Pipelines, Realtime)
// are defined in @exepad/types and used by deploy-utils and app-backend.
// The runtime does not use them directly.
```

Only `StorageProps` (and `McpProps`) actually exist in `@exepad/types` today —
there are no `SourceProps`, `QueueProps`, `TaskProps`, `PipelineProps`, or
`RealtimeProps` definitions, no deploy step provisions any of them, and no
runtime code consumes them. The self-hosted container has no queue service, no
cron/task scheduler for app-declared tasks, and no WebSocket coordination layer.
Treat these keys as reserved names, not features: setting them has no effect.

---

## 5. Type Guards

Three runtime type guards narrow the discriminated union:

```ts
// backend.ts
export function isStaticBackend(config: BackendProps | undefined | null): config is StaticBackend {
  return config?.mode === 'static';
}

export function isDynamicBackend(config: BackendProps | undefined | null): config is DynamicBackend {
  return config?.mode === 'dynamic';
}

export function isNoneBackend(config: BackendProps | undefined | null): config is NoneBackend {
  return config?.mode === 'none';
}
```

Both accept `undefined | null` to safely handle configs that may not have a
backend section at all.

---

## 6. Legacy Fallback -- `frontend.data.datasets`

> Source: `src/hooks/useRuntimeStore.ts`

Older app configs stored datasets at `frontend.data.datasets` instead of
`backend.data.datasets`. The runtime detects this and issues a deprecation
warning:

```ts
// useRuntimeStore.ts
let datasets: Record<string, unknown> = {};
if (isStaticBackend(appConfig.backend)) {
  datasets = appConfig.backend.data.datasets;
} else {
  const legacyDatasets =
    (appConfig as any).frontend?.data?.datasets ||
    (appConfig as any).data?.datasets;
  if (legacyDatasets) {
    console.warn(
      '[Exepad] Deprecated: frontend.data.datasets -> use backend: { mode: "static", data: { datasets } }'
    );
    datasets = legacyDatasets;
  }
}
```

The Python backend validator auto-injects `mode: "dynamic"` for backward
compatibility with LLM-generated configs that omit the `mode` field.

**Migration path:** Move the `datasets` object from `frontend.data.datasets`
into `backend: { mode: "static", data: { datasets: { ... } } }`.

---

## 7. Dataset Auto-Injection into Zustand State

> Source: `src/hooks/useRuntimeStore.ts`

After resolving datasets (from either the canonical or legacy location), the
`useRuntimeStore` hook — called by `ClientLayoutRenderer` and by the preview
page — auto-injects every static dataset's records into the Zustand state store
at initialization:

```ts
// useRuntimeStore.ts
const initialState = { ...frontend?.logic?.state };

for (const [datasetId, dataset] of Object.entries(datasets)) {
  if (
    dataset &&
    (dataset as any).type === 'static' &&
    Array.isArray((dataset as any).records)
  ) {
    initialState[datasetId] = (dataset as any).records;
  }
}
```

**Effect:** A dataset named `"products"` in `backend.data.datasets` becomes
available as the `products` key in the Zustand store, so a code component reads
it with `useAppState('products')` from the SDK. There is no separate dataset
lookup API — the store *is* the dataset surface.

The full initialization sequence in `useRuntimeStore`:

1. Set `currentAppId` for localStorage scoping
2. Resolve datasets from backend or legacy path
3. Build initial state from `frontend.logic.state`
4. Auto-inject dataset records into state
5. Inject `$auth` namespace if security is configured
6. Build `AppConfig` with state only
7. Initialize the Zustand store

---

## 8. How Components Read Data

> Source: `src/app_runtime/runtime/hooks/{useModelData,useHandlerData}.ts`,
> `src/components/ExposePlatformGlobal.tsx`

There is no declarative data-binding layer. The JSON-component era's
`"dataset."` / `"state."` / `"model."` / `"handler."` prefix strings, the
`parseDataRef` parser (`src/lib/dataRef.ts`) and the `useDataset` /
`useStateArray` / `useDataSource` hooks have all been **removed** along with the
JSON component library. A vestigial `DataRef` type is still declared in
`src/app_runtime/interfaces/components/common/core.ts`, but nothing imports it.

Code Focus components fetch their own data through SDK hooks. The runtime
implements two of them and publishes them on the `window.ExepadPlatform` global
via `ExposePlatformGlobal.tsx`; the SDK's `useModel` / `useHandler` are thin
bridges onto that global.

| Source                     | Runtime hook                    | SDK hook the component calls | Wire call |
|----------------------------|---------------------------------|------------------------------|-----------|
| Backend CRUD model         | `useModelData(name, params)`    | `useModel(name, opts)`       | `POST /api/{appId}/{modelName}` with `sys_list` (or `sys_aggregate`) |
| Backend handler            | `useHandlerData(name, params)`  | `useHandler(name, opts)`     | `POST /api/{appId}/{handlerName}` |
| Static dataset / UI state  | — (plain Zustand read)          | `useAppState(key)` / `useArrayState(key)` | none — datasets were injected into the store at init (§7) |

`useModelBridge` in `ExposePlatformGlobal.tsx` wraps the read-only
`useModelData` with `create` / `update` / `remove` mutations (`sys_create`,
`sys_update`, `sys_delete`) so `useModel` returns a full CRUD handle;
`useHandler` adds an imperative `execute()` on top of `useHandlerData`.
