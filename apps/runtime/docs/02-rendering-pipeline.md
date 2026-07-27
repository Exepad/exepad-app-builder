# Rendering Pipeline

This document covers the full rendering pipeline of the Exepad Runtime -- from JSON configuration to interactive React component tree. All references use `file:line` notation relative to `apps/runtime/client/src/`.

> **Heads-up: scaffold and expression systems removed.** The runtime no longer ships any `CrudScaffold` / `DashboardScaffold` / `SettingsScaffold` / `AuthScaffold` / `ChatScaffold` expanders, and `ScaffoldRenderer.tsx` no longer exists. The component registry now has exactly **one** entry — `CodeComponentProps` (`client/src/registry/index.ts`). Every page is agent-emitted Code Focus TSX loaded by the `CodeComponent` runtime under `client/src/app_runtime/runtime/components/custom/code/`.
>
> Section 2's Steps 2, 3, 5 and 6 and the whole of Section 6 are **historical**: `extractStateKeys`, `resolveComponentProps`, the `useShallow` combined selector, expression-string evaluation and `isScaffold` are no longer in `DynamicRenderer.tsx`, and the `file:line` anchors in those parts do not resolve. Code components manage their own state, data fetching, and logic via SDK hooks. The live per-component path is Step 1 → Step 4 (`showWhen`, boolean only) → Step 7 (error boundary + edit-mode wrapper).

---

## 1. Pipeline Overview

```
                         JSON Config (WebAppProps)
                                |
                                v
                      +-----------------+
                      |  ConfigService  |  load / cache / resolve source
                      +-----------------+
                                |
                                v
                      +-----------------+
                      |  Zustand Stores |  appStore (config metadata)
                      |                 |  appStateStore (runtime state)
                      +-----------------+
                                |
                                v
                      +-----------------+
                      |  AppRenderer    |  client component -- resolves page,
                      |                 |  builds layout shell
                      +-----------------+
                                |
                   +------------+-------------+
                   |                          |
                   v                          v
      +------------------------+   +------------------------+
      | ClientLayoutRenderer   |   | (direct render path    |
      | (client component)     |   |  via AppRenderer)      |
      | - state init           |   +------------------------+
      | - persistent shell     |
      +------------------------+
                   |
                   v
      +------------------------+
      | ClientPageRenderer     |  derives current page from pathname,
      |                        |  wraps with HybridPageTransition
      +------------------------+
                   |
                   v
      +------------------------+
      | DynamicRendererList    |  iterates page content[]
      +------------------------+
                   |
          (for each component)
                   |
                   v
      +------------------------+
      | DynamicRenderer        |  per component:
      |   1. Component lookup  |    registry -> sync cache, else lazy load
      |   2. showWhen check    |    shouldRenderComponent() (boolean only)
      |   3. Error boundary    |    ComponentErrorBoundary wrap
      |   4. Edit-mode wrapper |    ComponentWrapper (when uuid present)
      +------------------------+
                   |
                   v
            React Component Tree
```

Two rendering paths exist:

- **Layout path** -- `AppRenderer` is a client component that resolves the page and renders the layout directly. Used for initial page load and example/preview routes.
- **Client navigation path** -- `ClientLayoutRenderer` provides the persistent shell (header, sidebar, footer) and `ClientPageRenderer` renders the active page. This path supports client-side navigation without full re-renders.

Both paths converge at `DynamicRendererList` / `DynamicRenderer` for component rendering.

---

## 2. DynamicRenderer Deep Dive

**File:** `components/DynamicRenderer.tsx`

`DynamicRenderer` is the core rendering engine. It takes a single `ComponentProps` config object and produces a rendered React element. The component is wrapped with `React.memo` (`DynamicRenderer.tsx:429`) for memoization.

### Step 1: Component Resolution -- Registry Lookup

```
DynamicRenderer.tsx:232-234    getComponentSync() for synchronous cache hit
DynamicRenderer.tsx:290-324    useEffect for async getComponent() fallback
registry/index.ts:243-313      getComponent() -- async loader with cache
registry/index.ts:320-322      getComponentSync() -- synchronous cache read
```

The renderer first attempts a **synchronous cache lookup** via `getComponentSync()` to avoid a loading-state flicker:

```ts
// DynamicRenderer.tsx:232-233
const cachedComponent = componentType ? getComponentSync(componentType) : null;
const [ReactComponent, setReactComponent] = React.useState<React.ComponentType<any> | null>(
  () => cachedComponent
);
```

If not cached, an async `useEffect` calls `getComponent()` which lazy-loads the module from the component registry (`registry/index.ts:8`), validates it is a valid React component, and caches it in a `Map<string, React.ComponentType>` (`registry/index.ts:236`).

While the chunk is in flight the renderer returns `null` — not a skeleton — because `CodeComponent` mounts its own height-reserved skeleton immediately after, and a sized placeholder here would cause its own layout shift. If loading fails or the type is unregistered, `ComponentFallback` renders.

### Step 2: State Key Extraction -- `extractStateKeys()`

```
DynamicRenderer.tsx:42-64    extractStateKeys() function
```

Before subscribing to the Zustand store, the renderer scans the component's props tree to determine which state keys are referenced:

```ts
// DynamicRenderer.tsx:42-64
function extractStateKeys(value: unknown): Set<string> {
  const keys = new Set<string>();
  const scan = (v: unknown) => {
    if (typeof v === 'string' && /\$[a-zA-Z_]/.test(v)) {
      const matches = v.matchAll(/\$([a-zA-Z_]\w*)/g);
      for (const match of matches) {
        const name = match[1];
        // Skip special context variables
        if (!['payload', 'event', 'item', 'index', 'state', 'computed'].includes(name)) {
          keys.add(name);
        }
      }
    } else if (Array.isArray(v)) {
      v.forEach(scan);
    } else if (v !== null && typeof v === 'object') {
      Object.values(v).forEach(scan);
    }
  };
  scan(value);
  return keys;
}
```

The function recursively walks strings, arrays, and objects. It matches `$variableName` patterns and collects the referenced key names. **Reserved context variables** (`$payload`, `$event`, `$item`, `$index`, `$state`, `$computed`) are skipped because they are injected at different points in the pipeline, not from the global store.

The result is memoized via `useMemo` keyed on the component config (`DynamicRenderer.tsx:185-188`).

### Step 3: Granular Zustand Selector -- `useShallow`

```
DynamicRenderer.tsx:194-205    combinedSelector construction
DynamicRenderer.tsx:205        useAppStateStore(useShallow(combinedSelector))
```

A combined selector function is built from the extracted state keys. It reads from both `_state` and `_computed` namespaces:

```ts
// DynamicRenderer.tsx:194-205
const combinedSelector = useCallback(
  (s: { _state: Record<string, unknown>; _computed: Record<string, unknown> }) => {
    if (stateKeys.size === 0) return EMPTY_STATE;
    const result: Record<string, unknown> = {};
    for (const key of stateKeys) {
      result[key] = s._state[key] ?? s._computed[key];
    }
    return result;
  },
  [stateKeys]
);
useAppStateStore(useShallow(combinedSelector));
```

Key performance details:

- **`EMPTY_STATE` sentinel** (`DynamicRenderer.tsx:35`) -- components with zero state references return a shared frozen object, preventing selector re-allocation.
- **`useShallow` from `zustand/react/shallow`** -- performs shallow equality comparison on the selected subset, so re-renders only fire when the referenced keys actually change, not on every store mutation.
- The selector exists purely for **re-render triggering**. Actual value resolution happens later via `resolveComponentProps()` which calls `useAppStateStore.getState()` for the freshest snapshot.

### Step 4: Conditional Rendering -- `showWhen` Evaluation

```
DynamicRenderer.tsx:135-151    shouldRenderComponent() function
DynamicRenderer.tsx:371-373    showWhen check before render
DynamicRenderer.tsx:346-348    showWhen check before scaffold expansion
```

Components can declare `showWhen` or `visibilityCondition` props. The `shouldRenderComponent()` function evaluates these:

```ts
// DynamicRenderer.tsx
function shouldRenderComponent(props: Record<string, unknown>): boolean {
  const condition = props.showWhen ?? props.visibilityCondition;
  if (condition === undefined) return true;
  return Boolean(condition);
}
```

**Only boolean-ish values are supported.** Expression strings such as `$isLoggedIn && $items.length > 0` are no longer evaluated — they would coerce to `true` as non-empty strings. Code components handle their own visibility in JSX. The check runs **after** all hooks are called, to comply with React's Rules of Hooks.

### Step 5: Variable Substitution -- `resolveComponentProps()`

After the `showWhen` gate, all props are resolved by replacing `$variable` references with their current values from state:

```ts
function resolveComponentProps(
  props: Record<string, unknown>,
  isStateful: boolean
): Record<string, unknown> {
  if (!isStateful) return props;
  const store = useAppStateStore.getState();
  const context = { state: store._state };
  return resolveExpressions(props, context) as Record<string, unknown>;
}
```

The resolution recursively walks the props tree:

- **Strings** containing `$variable` references are replaced with their state values.
- **Arrays** are mapped recursively.
- **Objects** are walked key-by-key.

This function calls `useAppStateStore.getState()` directly (not through a hook) to always get the **freshest** state snapshot at render time.

### Step 6: Scaffold Detection — REMOVED

`DynamicRenderer` used to check `isScaffold(componentType)` and delegate to `ScaffoldRenderer`. Both are gone; there is no scaffold branch in the renderer. See Section 6.

### Step 7: Error Boundary Wrapping

```
DynamicRenderer.tsx:400-410    ComponentErrorBoundary wrapping
DynamicRenderer.tsx:412-425    ComponentWrapper for edit mode
```

The final rendered component is wrapped in a `ComponentErrorBoundary`:

```ts
// DynamicRenderer.tsx:400-410
const content = (
  <ComponentErrorBoundary componentType={componentType} componentId={uuid}>
    <FinalComponent key={`${uuid}-${renderKey}`} {...finalProps} />
  </ComponentErrorBoundary>
);
```

If the component has a `uuid`, it is additionally wrapped in a `ComponentWrapper` for edit-mode integration (`DynamicRenderer.tsx:412-422`).

### DynamicRendererList

```
DynamicRenderer.tsx:445-499    DynamicRendererList component
```

`DynamicRendererList` renders an array of components. It is memoized with a custom comparator (`DynamicRenderer.tsx:489-499`) that uses `areComponentsEqual()` for epoch-based comparison instead of `JSON.stringify`:

```ts
// DynamicRenderer.tsx:489-498
export const DynamicRendererList = React.memo(DynamicRendererListInner, (prevProps, nextProps) => {
  return (
    prevProps.className === nextProps.className &&
    prevProps.pageLayout === nextProps.pageLayout &&
    prevProps.isInHeader === nextProps.isInHeader &&
    prevProps.mainContent === nextProps.mainContent &&
    prevProps.articleSpacing === nextProps.articleSpacing &&
    areComponentsEqual(prevProps.components, nextProps.components)
  );
});
```

Single-component arrays are rendered without a wrapper `div` to avoid breaking layout components like Sidebar (`DynamicRenderer.tsx:470-472`).

---

## 3. AppRenderer

**File:** `components/AppRenderer.tsx`

`AppRenderer` is a **client component** that receives the full resolved `WebAppProps` config as a prop and orchestrates the initial render.

### Responsibilities

1. **Page resolution** (`AppRenderer.tsx:60-76`) -- finds the current page by `pageId` or falls back to the root slug (`/`) or first page. Creates a minimal fallback page if the pages array is empty.

2. **Layout detection** (`AppRenderer.tsx:98-99`):
   - `HeaderMenuTop` -- top navbar layout
   - `SidebarMenuLeft` -- left sidebar layout

3. **Scroll behavior extraction** (`AppRenderer.tsx:31-47`) -- reads `scrollBehavior` from the NavbarProps component in the header array. Supports `static`, `fixed`, `sticky`, `hide`, and `shrink`.

4. **Layout assembly** -- constructs the layout shell:
   - **Sidebar layout** (`AppRenderer.tsx:159-183`): `SidebarLayout` wrapping content + footer
   - **Header layout** (`AppRenderer.tsx:186-218`): `PersistentHeader` + content + `PersistentFooter`

5. **Page transitions** (`AppRenderer.tsx:144-151`) -- wraps main content in a `PageTransition` component.

6. **Page content** (`renderPageContent` in `AppRenderer.tsx`) -- renders `currentPage.content` through `DynamicRendererList`. There is no per-page-type dispatch: the specialized `BlogMainPageProps` / `BlogPostPageProps` renderers went away with the JSON-component system, and every page is now `WebPageProps` rendered by the same path.

7. **Editor integration** -- includes `PageUuidTracker` to communicate page changes to the parent editor window, and `EditModeToolbar` for in-app editing.

---

## 4. ClientLayoutRenderer

**File:** `components/ClientLayoutRenderer.tsx`

This is a client component (`ClientLayoutRenderer.tsx:1`) that provides the **persistent application shell** across page navigations. Unlike `AppRenderer` (which re-renders on each route), `ClientLayoutRenderer` persists and only its `children` slot changes when navigating.

### State Initialization

`ClientLayoutRenderer` does not build the initial state itself. It calls the `useRuntimeStore()` hook (`hooks/useRuntimeStore.ts`), which was extracted so the preview page can share the same initialization. See [03-state-management.md](./03-state-management.md) §2 and [08-backend-modes.md](./08-backend-modes.md) §7 for the sequence; in outline it scopes localStorage to the app, rehydrates the persisted store, merges static datasets into `frontend.logic.state`, injects the `auth` namespace when auth is configured, initializes the store with the router + basePath, installs the platform-auth fetch interceptor, initializes the component registry from `repo`, and runs the `auth_me` session check.

**State is read from `frontend.logic.state`, NOT `frontend.state`** — and `logic` carries *only* `state`. The `actions` / `computed` fields and the auto-generated modal close actions are gone with the action system; the store is initialized with `{ state: initialState }` and nothing else.

### Layout Modes

The layout is selected from `currentPage.menuPosition ?? frontend.menuPosition`:

**Auth pages** — when the app has `security` and the path matches the configured `loginPage` (or `/signup`, `/forgot-password`, `/reset-password`) **and** the visitor is unauthenticated, the shell is skipped entirely: children render standalone, with only the toaster and the window-global bridges alongside.

**`SidebarMenuLeft`** — used only when `frontend.sidebar` is non-empty. Renders `CodeFocusSidebarShell` with the sidebar components, the footer, and the shared extras slot.

**`HeaderMenuTop` / no navigation** — flat rendering: an optional `PersistentHeader` (only when `frontend.header` is non-empty), the content slot, an optional `PersistentFooter`, then the shared extras.

### Persistent Utilities

Every branch mounts the same set:
- `Toaster` + `ToastEventListener` -- toast notification system
- `ExposeStateGlobal` / `ExposePlatformGlobal` -- publish `window.ExepadState` / `window.ExepadPlatform` for the SDK bridge
- `PlatformAuthControl` -- sign-in/out affordance (both non-auth-page branches)

`ClientLayoutRenderer` also installs `installImageDimensionGuard(document.body)` once on mount — a CLS guard that reserves aspect-ratio for unsized code-component images — and wraps everything in `CodeFocusCssLoader`, which fetches the per-app compiled Tailwind sheet.

### Width / Layout Classes

Layout width is resolved via `getLayoutClasses(currentPage.layout, frontend?.layout)` (`utils/layoutPatterns.ts`), which maps `LayoutOption` values. It is applied by the three components that own a page content wrapper — `AppRenderer`, `ClientPageRenderer`, and `core/preview/PreviewPage` — not by `ClientLayoutRenderer` or `PersistentHeader`. Available width options include boxed, wide, narrow, and full-width variants, with the page-level value falling back to the `frontend.layout` config field.

---

## 5. ClientPageRenderer

**File:** `components/ClientPageRenderer.tsx`

This client component renders page content using the cached config from `AppConfigContext`, enabling **client-side navigation without server fetches**.

### Page Resolution

```
ClientPageRenderer.tsx:48    useCurrentPage() hook
hooks/useCurrentPage.ts:32-53    page lookup implementation
```

`useCurrentPage()` derives the current page from the URL pathname:

1. Strips `basePath` from `pathname` to get the page slug.
2. Calls `getPageBySlug()` from context to find the matching page config.
3. Result is memoized on `[pathname, basePath, getPageBySlug]`.

### Page Not Found Handling

```
ClientPageRenderer.tsx:64-76    redirect timer for missing pages
ClientPageRenderer.tsx:80-96    404 display or loading state
```

When no page matches:
- If the current path differs from `basePath`, a 100ms delayed redirect sends the user to the app's home page (`ClientPageRenderer.tsx:69-73`).
- If already at `basePath`, an `UnifiedErrorDisplay` with `type="config-missing"` is shown.
- Before mount, `null` is returned to avoid rendering mismatches (`ClientPageRenderer.tsx:81`).

### Auto-Modals

```
ClientPageRenderer.tsx:56    useAutoModals(currentPage?.content)
ClientPageRenderer.tsx:110-112    contentWithModals merge
```

`useAutoModals()` scans page content for CRUD patterns and auto-generates missing modal components. These are appended to the content array before rendering.

### Page Transitions

```
ClientPageRenderer.tsx:132-139    HybridPageTransition wrapping
```

The main content is wrapped in `HybridPageTransition` with both global and page-level transition configs:

```ts
// ClientPageRenderer.tsx:132-139
<HybridPageTransition
  globalConfig={frontend?.transitions}
  pageOverride={currentPage.transitions}
>
  {MainContent}
</HybridPageTransition>
```

### Scroll Behavior

`HybridPageTransition` handles scroll-to-top on page navigation. In the Framer Motion fallback path (`HybridPageTransition.tsx:233-237`), `onExitComplete` scrolls to top unless a hash anchor is present:

```ts
// HybridPageTransition.tsx:233-237
onExitComplete={() => {
  if (typeof window !== 'undefined' && !window.location.hash) {
    window.scrollTo(0, 0);
  }
}}
```

### HybridPageTransition

**File:** `components/HybridPageTransition.tsx`

This component provides a two-tier transition system:

1. **Native View Transitions API** (`HybridPageTransition.tsx:146-203`) -- used when `document.startViewTransition` is available (Chrome 111+, Edge 111+, Safari 18+). Sets `view-transition-name` and data attributes on the document element for CSS targeting.

2. **Framer Motion fallback** (`HybridPageTransition.tsx:218-266`) -- used for older browsers. Uses `AnimatePresence` with `mode="wait"` and `motion.div` keyed on `pathname`.

**Transition types** (defined at `HybridPageTransition.tsx:50-96`):

| Type        | Effect                            |
|-------------|-----------------------------------|
| `none`      | No animation                      |
| `fade`      | Opacity fade                      |
| `slideFade` | Opacity + vertical slide (default)|
| `slide`     | Horizontal slide                  |
| `slideUp`   | Vertical slide up                 |
| `slideDown` | Vertical slide down               |
| `scale`     | Scale down + fade                 |
| `zoom`      | Scale up + fade                   |
| `flip`      | 3D Y-axis rotation                |

**Timing** (`HybridPageTransition.tsx:125-132`): `fast` (150ms), `normal` (300ms), `slow` (500ms).

Transitions respect the user's `prefers-reduced-motion` setting via `TransitionContext` (`HybridPageTransition.tsx:303-304`).

---

## 6. ScaffoldRenderer — REMOVED

The scaffold subsystem is gone. `components/ScaffoldRenderer.tsx`, the scaffold registry and `expandScaffold()` under `app_runtime/runtime/scaffolds/`, and every `*ScaffoldProps` component type no longer exist, and nothing in the runtime expands a config node into a component tree.

Whatever a scaffold used to generate — a CRUD table plus its state, actions and computed values — is now emitted directly by the agent as Code Focus TSX, which fetches its own data through the SDK's `useModel` / `useHandler` and holds its own state through `useAppState` / `useArrayState`. There is no `_actions` or `_computedSchema` namespace in `appStateStore` to inject into.

---

## 7. Error Boundaries

There is no `core/ErrorBoundary/` directory and no app-level or page-level class boundary — those were removed. Three boundaries exist, at three different levels, and they do **not** share a common base class or a retry/backoff policy.

### Route Level: `RouterErrorBoundary`

**File:** `pages/RouterErrorBoundary.tsx`, wired in `router.tsx`

Every route in `router.tsx` sets `errorElement: withSuspense(RouterErrorBoundary)` (the module is `lazy()`-imported). It is a function component that reads the thrown value with React Router's `useRouteError()`:

- `isRouteErrorResponse(error)` → title becomes `"{status} {statusText}"`, message comes from `error.data?.message`.
- A plain `Error` → its `message` is shown.
- Anything else → the generic "Something went wrong" copy.

Recovery is manual: a **Reload Page** button (`window.location.reload()`) and a **Go Home** link. There is no automatic retry.

### Code Component Boundaries (Code Focus)

`CodeComponent.tsx` is the loader that the registry resolves `CodeComponentProps` to. It dynamically `import()`s the agent-generated TSX module, mounts it in the light DOM, and wraps it in `CodeErrorBoundary` — a class boundary private to `CodeComponent.tsx` (not exported). On a caught render error it calls `reportCodeComponentFailure({ failureClass: 'render_failed', … })` and renders `CodeComponentPlaceholder` (or the caller's `fallback`), so an end user never sees a stack trace. `reportCodeComponentFailure` fans out to three sinks: `logger.error`, an `exepad:code-component-failure` `CustomEvent` on `window`, and — only when the page is inside an iframe — a `postMessage` to the editor origin. There is no retry: a crashed module stays on the placeholder until the tree remounts.

Inside that boundary sit two further cross-cutting layers:

- **`CodeComponentContrastBoundary`** (`client/src/app_runtime/runtime/components/custom/code/CodeComponentContrastBoundary.tsx`) — a WCAG-AA safety net that scans the mounted subtree on mutation, computes effective foreground/background colors (compositing semi-transparent layers), and applies an inline text-color correction when contrast falls below `4.5:1`. The boundary calls `isOverImageBackdrop()` first and **skips correction over image backdrops** — the previous unconditional behavior blanked hero headlines by forcing `text-white → text-black` over photographic backgrounds.
- **Compiled-CSS scoping** — Per-app Tailwind output is fetched by `CodeFocusCssLoader` and applied under `@layer exepad-app`, with content-hashed filenames (see [07-theming-and-styling.md](./07-theming-and-styling.md)) so theme/colour edits invalidate every cache in front of the asset cleanly.

### Edit-Mode Selection Overlay

In edit mode the runtime renders a portaled fixed-position overlay (`client/src/components/editable/SelectionOverlay.tsx`) into `document.body` rather than wrapping the selected element with a ring. This was necessary because `HybridPageTransition` clips `box-shadow` rings via `overflow`/`transform` and because clicking inside a code component used to scope selection to the whole page-as-component instead of the actual sub-element. The overlay reads from `selectionElementStore.ts` and tracks the live element's bounding rect.

### Component Level: `ComponentErrorBoundary`

**File:** `components/ComponentErrorBoundary.tsx`

One implementation, wrapping every component `DynamicRenderer` renders:

```tsx
// DynamicRenderer.tsx
<ComponentErrorBoundary componentType={componentType} componentId={uuid}>
  <FinalComponent key={`${uuid}-${renderKey}`} {...finalProps} />
</ComponentErrorBoundary>
```

- `getDerivedStateFromError` flips `hasError`; `componentDidCatch` logs to the console **and** calls `ErrorReportingService.report()` with `componentType`, `componentId`, and the component stack.
- The fallback is a red panel naming the failing `componentType`. Only in `MODE === 'development'` does it expand a `<details>` block with the error message and stack.
- **Retry is manual and stateless** — the button just calls `this.setState({ hasError: false, error: undefined })`. There is no attempt counter, no exponential backoff, and no permanent-failure state.

### Error Reporting

**File:** `services/ErrorReportingService.ts`

A static class with a single production call site (`ComponentErrorBoundary.componentDidCatch`). `report()`:

- increments a per-component counter in a `Map<string, number>` keyed on `componentId ?? componentType`, and writes `errorCount` back into the reported context;
- appends to a rolling log capped at the last 100 errors;
- logs to the console in development, and in production only once a component reaches 3+ occurrences;
- dispatches a `runtime-error` `CustomEvent` on `window` — the operator-visible side channel.

`initSentry()` is a **deliberate no-op**: the Sentry SDK is not bundled in this build, so `sentryInitialized` stays `false` and the Sentry branch in `report()` never runs. The remaining public methods (`shouldRecover()`, `clearErrors()`, `getErrorStats()`, `hasCriticalErrors()`, `exportLogs()`) have no callers outside the unit tests — `shouldRecover()` in particular is left over from the removed auto-recovery boundary and nothing consults it today.

---

## 8. Performance Patterns

### Memoization

| Component / Utility             | Technique                   | File Reference                          |
|---------------------------------|-----------------------------|-----------------------------------------|
| `DynamicRenderer`               | `React.memo`                | `DynamicRenderer.tsx`                   |
| `DynamicRendererList`           | `React.memo` + custom comparator | `DynamicRenderer.tsx`              |
| `PersistentHeader`              | `React.memo` + `areComponentsEqual` comparator | `PersistentHeader.tsx`  |
| `PersistentFooter`              | `React.memo`                | `PersistentFooter.tsx`                  |
| `useCurrentPage` result         | `useMemo`                   | `hooks/useCurrentPage.ts`               |

### State Subscriptions

`DynamicRenderer` no longer subscribes to `appStateStore` at all — the `extractStateKeys()` / `useShallow(combinedSelector)` / `EMPTY_STATE` machinery was removed with the expression engine. A rendered code component instead subscribes to exactly the key it asks for: `useAppState(key)` (`hooks/useAppStateHooks.ts`) passes a key-scoped selector straight to `useAppStateStore`, so it re-renders only when that key's value changes. The granularity now lives in the component, not the renderer.

### Epoch-Based Component Comparison

```
utils/componentComparison.ts:16-50    areComponentsEqual()
```

Instead of `JSON.stringify` (O(n) with large component trees), component equality uses epoch-based comparison:

1. **Reference equality** first (`componentComparison.ts:22`).
2. **Length check** (`componentComparison.ts:25`).
3. **UUID comparison** -- fastest structural check (`componentComparison.ts:33`).
4. **`lastUpdatedEpoch` comparison** -- if both components have epochs, a single number comparison determines equality (`componentComparison.ts:36-38`).
5. **`componentType` comparison** -- detects structural changes (`componentComparison.ts:41`).
6. **Shallow props fallback** for components without epochs (`componentComparison.ts:44-46`) -- uses `Object.is` for primitives, reference equality for objects, and a heuristic check on the first 3 array elements.

### Lazy Loading

The registry's one entry (`CodeComponentProps`) is a dynamic `import()` of the `CodeComponent` module (`registry/index.ts`), so the `CodeComponent` runtime is code-split out of the initial bundle. Each agent-generated TSX module is then itself dynamically imported by `CodeComponent` at render time, and resolved modules are memoized in the registry's `componentCache`.

The synchronous cache check in `DynamicRenderer` (`getComponentSync()`) prevents loading-state flicker for previously loaded components during re-renders or page transitions. While the module chunk is in flight, `DynamicRenderer` renders `null` rather than a sized placeholder — `CodeComponent` mounts its own height-reserved skeleton immediately after, so a second placeholder here would itself cause a layout shift.

### Single-Component Array Optimization

When `DynamicRendererList` receives a single component and no `className` / `articleSpacing`, it renders the component directly without a wrapper `div`. This matters for layout components that rely on being direct children of their parent container.

### Editor-Only Work Kept Off the Published Path

`DynamicRenderer` routes `CodeComponentProps` through the lazy `EditableCodeComponent` wrapper **only** when `isPreview` is true. On published views it renders the plain `CodeComponent`, so the editor chunk (its Suspense boundary, wrapper div, and MutationObserver) never gates a visitor's first render. The hot-reload subscription and the `component-updated` window listener are likewise gated on `isEditMode`, so published pages install neither.

### Persistent Layout Components

`PersistentHeader` and `PersistentFooter` are rendered by `ClientLayoutRenderer` outside the page content slot. They persist across navigations and only re-render when their component arrays actually change — `PersistentHeader` uses an `areComponentsEqual` comparator, `PersistentFooter` plain `React.memo`. Navigation elements are therefore not torn down and rebuilt on each page transition. (There is no `PersistentSidebar`; the sidebar layout is `CodeFocusSidebarShell`.)
