# State Management

> Audience: platform engineers working on the Exepad Runtime.
>
> Base path for all file references: `apps/runtime/client/src/`

---

## Table of Contents

1. [Store Architecture](#1-store-architecture)
2. [State Initialization](#2-state-initialization)
3. [Persistence](#3-persistence)
4. [React Hooks](#4-react-hooks)
5. [SDK Hooks (Code Components)](#5-sdk-hooks-code-components)
6. [File Reference Index](#6-file-reference-index)

---

## 1. Store Architecture

The runtime uses two independent Zustand stores. Both are created with `devtools` (enabled in development) and `persist` middleware.

```
+---------------------------------------------+
|                  appStore                    |
|  (stores/appStore.ts)                       |
|                                             |
|  appConfig: WebAppProps | null              |
|  selectedComponentId: string | null         |
|  isEditMode: boolean                        |
|  contentUpdates: Map<string, ContentUpdate> |
|  wsConnectionStatus: ConnectionStatus       |
|                                             |
|  READ-ONLY after init (preview mode only)   |
+---------------------------------------------+

+---------------------------------------------+
|              appStateStore                   |
|  (stores/appStateStore.ts)                  |
|                                             |
|  _state:            Record<string, unknown> |
|  _router:           RouterInterface | null  |
|  _basePath:         string                  |
|  _initialized:      boolean                 |
|  _persistKeys:      Set<string>             |
|  _userModifiedKeys: Set<string>             |
|  _editingRecord:    Record | null           |
|                                             |
|  READ-WRITE during app lifetime             |
+---------------------------------------------+
```

### appStore (`stores/appStore.ts`)

Preview-mode store that holds the raw JSON configuration, component selection, edit mode state, and WebSocket status. It is **not used in published mode**. Persistence is configured to store nothing (`partialize` returns an empty object).

Key methods: `setAppConfig()`, `selectComponent()`, `setEditMode()`, `getComponentById()`.

### appStateStore (`stores/appStateStore.ts`)

The primary runtime store. Holds all user-facing state (`_state`) and infrastructure for persistence and navigation. This store is read-write throughout the app lifecycle.

| Category | Methods |
|---|---|
| Initialization | `initialize()`, `reset()` |
| State access | `get()`, `set()`, `update()` |
| Array helpers | `push()`, `remove()`, `updateItem()`, `clear()` |
| Status | `isInitialized()` |

Direct store access for non-React contexts (e.g., code components via `window.ExepadState`):

```ts
export const getAppStateStore = () => useAppStateStore.getState();
export const subscribeToAppState = useAppStateStore.subscribe;
```

### Reading from appStore

There is **no** separate selector module — the pre-built `selectXxx` helpers were removed with the JSON component system. Consumers subscribe with an inline selector passed straight to the hook, which is what keeps re-renders narrow:

```tsx
const isEditMode  = useAppStore((s) => s.isEditMode);
const isSelected  = useAppStore((s) => s.selectedComponentId === componentId);
const isProcessing = useAppStore((s) => s.processingComponentIds.has(componentId));
const wsStatus    = useAppStore((s) => s.wsConnectionStatus);
```

Derived reads that used to be free functions now live on the store itself and are selected the same way: `hasUnsavedChanges()`, `getUnsavedUpdates()`, and `getComponentById(id)` (the recursive UUID lookup over the config tree). Avoid the whole-store destructure (`useAppStore()`) outside contexts that genuinely need every field — it re-renders on any store change.

---

## 2. State Initialization

State initialization is orchestrated by `useRuntimeStore()` hook (`hooks/useRuntimeStore.ts`) and the store's `initialize()` method (`stores/appStateStore.ts`).

### Initialization Flow

```
useRuntimeStore() hook
  |
  +--> setCurrentAppId(appConfig.uuid)          // scope localStorage per app
  |
  +--> Extract datasets from backend config
  |      if isStaticBackend(appConfig.backend):
  |        datasets = appConfig.backend.data.datasets
  |
  +--> Build initialState
  |      initialState = { ...frontend.logic.state }
  |
  +--> Auto-inject static datasets into state
  |      for each dataset with type "static":
  |        initialState[datasetId] = dataset.records
  |
  +--> Inject $auth namespace (if security configured)
  |
  +--> initializeStore({ state: initialState }, router, basePath)
```

### The `initialize()` Method

Inside `appStateStore.ts`, `initialize()` performs:

1. **Parse `$persist` flags** — Iterates through raw state entries. If a value is an object with a `$persist` key, it extracts `initial` as the actual initial value and records the key in `_persistKeys`.

2. **Smart merge strategy** — Determines whether this is a rehydration (page reload, where `_userModifiedKeys` is empty but `_initialized` is true) or a re-initialization (HMR/config push). On rehydration, all existing persisted values are preserved. On re-init, only user-modified keys keep their values; everything else takes the new config value.

3. **Preserve scaffold-injected state** — Keys prefixed with `_scaffold_` in state are preserved across re-initialization.

4. **Set store** — Writes merged state, persist keys, router, base path, and `_initialized: true`.

### State Source Mapping

| Config Path | Store Destination |
|---|---|
| `frontend.logic.state` | `appStateStore._state` |
| `backend.data.datasets` (static mode) | Auto-injected into `_state` by dataset ID |

---

## 3. Persistence

State persistence uses Zustand's built-in `persist` middleware with a custom localStorage adapter scoped per app.

### Storage Key Format

```
exepad-app-state:{appId}
```

The `appId` is set before store initialization via `setCurrentAppId()`, called from `useRuntimeStore()`.

### Custom Storage Adapter

A custom storage adapter wraps `localStorage` to scope keys per app:

```typescript
getItem: (name) => localStorage.getItem(_currentAppId ? `${name}:${_currentAppId}` : name)
setItem: (name, value) => localStorage.setItem(_currentAppId ? `${name}:${_currentAppId}` : name, value)
removeItem: (name) => localStorage.removeItem(_currentAppId ? `${name}:${_currentAppId}` : name)
```

**Legacy migration**: When no scoped key exists but a legacy global key does, the adapter performs a one-time migration by copying the data to the scoped key and removing the global key.

### Selecting What to Persist

The `partialize` function determines which state keys are persisted:

1. **Explicit `$persist`**: If any state key has `$persist: true` in its config, only those keys are persisted.
2. **Fallback heuristics**: If no `$persist` keys are defined, all keys are persisted **except**:
   - Keys starting with `show` or containing `Modal`/`Confirm`
   - Keys starting with `editing` or `selected`
   - Keys starting with `isLoading` or ending with `Loading`

The `_initialized` flag is always persisted alongside state.

### The `$persist` Config Syntax

Defined in `app_runtime/interfaces/state/index.ts`:

```typescript
interface PersistentStateConfig {
  $persist: boolean | string;  // true for auto key, or custom path string
  initial: unknown;            // initial value when no persisted value exists
  $debounce?: number;          // ms delay for frequent updates
}
```

Example state config:

```json
{
  "state": {
    "theme": { "$persist": true, "initial": "light" },
    "cartItems": { "$persist": true, "initial": [] },
    "isLoading": false,
    "showModal": false
  }
}
```

In this example, only `theme` and `cartItems` are persisted. `isLoading` and `showModal` are transient.

### Hydration

On page load, Zustand's persist middleware rehydrates state from localStorage. The smart merge in `initialize()` (described in Section 2) ensures rehydrated values are preserved.

---

## 4. React Hooks

Hooks are defined in `hooks/useAppStateHooks.ts` and work identically for all React components (code components, layout components, etc.).

### useAppState

Primary hook for single-value state access. Returns a tuple `[value, setValue, updateValue]`.

```typescript
function useAppState<T>(key: string, initialValue?: T): [T, (value: T) => void, (updater: (prev: T) => T) => void]
```

- Uses `useShallow` for optimized subscriptions with dot-notation support.
- Auto-registers `initialValue` if the key does not exist (for code component dynamic state).
- `setValue` and `updateValue` use `getState()` for non-reactive writes.

```tsx
const [count, setCount] = useAppState('counter', 0);
const [name, setName, updateName] = useAppState('form.name', '');
```

### useArrayState

Hook for array state with helper methods.

```typescript
function useArrayState<T>(key: string, initialValue?: T[]): {
  items: T[];
  push: (item: T) => void;
  remove: (predicate: ((item: T, index: number) => boolean) | number) => void;
  updateItem: (predicate: ((item: T, index: number) => boolean) | number, updates: Partial<T>) => void;
  clear: () => void;
  set: (newItems: T[]) => void;
}
```

```tsx
const { items, push, remove, clear } = useArrayState<CartItem>('cartItems');
```

### useFullState

Read the entire state object. Use sparingly to avoid unnecessary re-renders.

```typescript
function useFullState(): Record<string, unknown>
```

### useIsInitialized

Check whether the state store has been initialized.

```typescript
function useIsInitialized(): boolean
```

### useAppStateAll

Combined convenience hook returning common state utilities.

```typescript
function useAppStateAll(): {
  state, get, set,
  push, remove, updateItem, clear,
  isInitialized
}
```

---

## 5. SDK Hooks (Code Components)

Code components access state and platform APIs via the SDK (`@exepad/sdk`), which bridges to `window.ExepadState` and `window.ExepadPlatform` globals set by `ExposeStateGlobal.tsx` and `ExposePlatformGlobal.tsx`.

### State Hooks

| Hook | Purpose |
|---|---|
| `useApp(selector?)` | Flat state snapshot with `setState` — uses `useSyncExternalStore` for concurrent-mode safety |
| `useAppState(key, initial?)` | Single value with setter — delegates to `window.ExepadState.useAppState` |
| `useArrayState(key, initial?)` | Array with push/remove/updateItem/clear — delegates to `window.ExepadState.useArrayState` |
| `useCount(key, initial?)` | Numeric counter with `increment` / `decrement` / `reset` |

### Platform Hooks

| Hook | Purpose |
|---|---|
| `useModel(name, opts?)` | CRUD data fetching with `create`, `update`, `remove`, `refetch` |
| `useHandler(name, opts?)` | Custom backend handler calls with `execute`, `refetch` |
| `useNavigation()` | `navigate`, `currentPath`, `basePath` |
| `navigate(path, opts?)` | Standalone navigation function (non-hook) |
| `useTheme()` | Theme tokens: `colors`, `typography`, `borderRadius`, `mode` |
| `useCurrentUser()` | `id`, `email`, `roles`, `isAuthenticated` |
| `useFileUpload(opts?)` | File upload with progress tracking |
| `useFileUrl(fileId)` / `buildFileUrl(fileId)` | Resolve uploaded-file IDs to authenticated URLs |
| `useFakeStream` | Token-stream simulator for AI-style typewriter UX |
| `useBodyScrollLock(active)` | Lock body scroll while a modal/drawer is open |

### Helpers and primitives

| Export | Purpose |
|---|---|
| `toast(message, opts?)` | Show toast notifications (from sonner) |
| `cn(...classes)` | Tailwind class merging |
| `escapeHtml(str)` | Sanitize strings for safe injection |
| `downloadFile(blob, filename)`, `downloadCsv(rows, filename)` | Client-side download helpers |
| `extractAppIdFromUrl()`, `SDK_VERSION` | App context / version probe |
| `Link`, `LightDOMContainer` | SDK navigation link, light-DOM portal wrapper |

The SDK also exports motion (`FadeIn`, `SlideUp`, `Reveal`, `StaggerGrid`, `AnimatedCounter`, `Marquee`, `AnimatedGradient`), background (`NoiseBg`, `MeshGradient`, `GridPattern`, `DotPattern`), map (`Map`, `MapLink`), and game (`useGameLoop`, `useKeys`, `useAudio`, `Sprite`, `Joystick`) kits, plus ~53 shadcn/ui primitives. See `packages/exepad-sdk/src/index.ts` for the canonical export list.

All logic (data fetching, derived values, side effects) is handled directly in code component JavaScript/TypeScript. There is no declarative action system, computed values engine, or expression parser.

---

## 6. File Reference Index

| File | Purpose |
|---|---|
| `stores/appStateStore.ts` | Main runtime state store (Zustand), persistence |
| `stores/appStore.ts` | Preview-mode app config store |
| `hooks/useAppStateHooks.ts` | React hooks for state access |
| `hooks/useRuntimeStore.ts` | Store initialization orchestrator |
| `components/ExposeStateGlobal.tsx` | Exposes `window.ExepadState` for SDK bridge |
| `components/ExposePlatformGlobal.tsx` | Exposes `window.ExepadPlatform` for SDK bridge |
| `app_runtime/interfaces/state/index.ts` | State schema and persistence types |
| `components/ClientLayoutRenderer.tsx` | Layout rendering with state/platform globals |
