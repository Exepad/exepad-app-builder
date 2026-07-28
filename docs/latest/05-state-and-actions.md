# State Management

Exepad uses a Zustand-based shared state store that code components access via SDK hooks. The `frontend.logic.state` configuration defines initial state values — all logic (data fetching, derived values, side effects) is handled directly in code component JavaScript/TypeScript.

---

## Overview

```
WebAppProps.frontend.logic
└── state: { count: 0, items: [], theme: { $persist: true, initial: "light" } }
        │
        ▼
    appStateStore (Zustand)
    ├── _state: { count: 0, items: [], theme: "light" }
    ├── set(key, value) / get(key)
    ├── push/remove/updateItem/clear (array helpers)
    └── $persist middleware → localStorage
```

Code components access state via SDK hooks:
- `useAppState(key, initial)` — single value with setter and updater
- `useArrayState(key)` — array with push/remove/updateItem/clear helpers
- `useApp(selector?)` — flat snapshot of all state with `setState`

---

## State Schema

State is defined as key-value pairs in `frontend.logic.state`. Types are inferred from initial values.

```json
{
  "frontend": {
    "logic": {
      "state": {
        "count": 0,
        "name": "",
        "isActive": false,
        "selectedId": null,
        "items": [],
        "formData": {},
        "theme": { "$persist": true, "initial": "light" }
      }
    }
  }
}
```

### Persistent State

State entries with `$persist: true` are automatically saved to localStorage per-app and restored on page reload.

| Field | Type | Description |
|-------|------|-------------|
| `$persist` | boolean/string | `true` for auto-path, or custom path string |
| `initial` | any | Initial value when no persisted value exists |

> **Important:** Only use `$persist` for UI preferences (theme, sidebar state). User data belongs in the backend database.

---

## Store Implementation

**Source:** `apps/runtime/client/src/stores/appStateStore.ts`

The store provides:

| Method | Description |
|--------|-------------|
| `get(key)` | Read a state value (supports dot notation) |
| `set(key, value)` | Write a state value (supports dot notation) |
| `update(key, fn)` | Functional update: `fn(currentValue) → newValue` |
| `push(key, item)` | Append to array |
| `remove(key, predicate)` | Remove by predicate or index |
| `updateItem(key, predicate, updates)` | Update matching items |
| `clear(key)` | Clear array to `[]` |
| `initialize(config, router, basePath)` | Initialize from app config |
| `reset()` | Reset to empty state |

### Smart Merge on Initialization

The store performs smart merging when re-initialized (HMR, config push):
1. **Rehydration** (page reload): preserves all persisted values
2. **Re-initialization** (HMR): preserves only user-modified keys, applies new config values for everything else

---

## SDK Hooks for Code Components

### useAppState — Single Value

```tsx
const [count, setCount, updateCount] = useAppState<number>('count', 0);

setCount(5);                    // Direct set
updateCount(prev => prev + 1);  // Functional update
```

### useArrayState — Array with Helpers

```tsx
const { items, push, remove, updateItem, clear, set } = useArrayState<Product>('products');

push({ id: '1', name: 'Widget' });
remove(i => i.id === '1');        // By predicate
remove(0);                        // By index
updateItem(i => i.id === '1', { name: 'Updated Widget' });
clear();
```

### useApp — Flat State Snapshot

```tsx
const count = useApp(s => s.count);
const { setState } = useApp();
setState('count', 42);
```

### Data Fetching (replaces old onMount + actions)

```tsx
const { data: products, loading, create, update, remove } = useModel('products');
const stats = useHandler('getDashboardStats', { autoFetch: true });
```

### Navigation, Toasts, Auth

```tsx
navigate('/products/123');
toast.success('Saved!');
const user = useCurrentUser();
```

---

## Initialization Flow

1. `useRuntimeStore()` hook runs in layout component
2. Reads `frontend.logic.state` from app config
3. Merges static datasets into initial state
4. Injects `$auth` namespace if security is configured
5. Calls `appStateStore.initialize()` with the state config
6. Store processes `$persist` flags and performs smart merge with existing state

---

## Architecture Notes

- **No expression engine** — removed. Components handle all logic in JS/TSX.
- **No declarative actions** — removed. Components use SDK hooks directly.
- **No computed values** — removed. Components derive values inline.
- **No onMount** — removed. Components fetch data in `useEffect` via `useModel`/`useHandler`.
- **State is the coordination layer** — components communicate through shared state keys.
