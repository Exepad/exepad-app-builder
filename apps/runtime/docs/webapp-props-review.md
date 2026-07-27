# WebAppProps Architectural Review

**Date:** 2026-03-03 (last major audit) — **partial refresh 2026-05-26 in light of the scaffold removal and the move to Code Focus rendering.**
**Scope:** `apps/runtime/client/src/app_runtime/interfaces/apps/webapp.ts` and all consuming code
**Objective:** Audit every field of `WebAppProps` — identify what is fully implemented, partially implemented, and unimplemented.

> **Refresh notes (2026-05):**
> - The runtime now resolves only one component type from the registry — `CodeComponentProps` (`apps/runtime/client/src/registry/index.ts`). Everything is agent-generated Code Focus TSX rendered by `CodeComponent`. The "14 components consume `theme.defaults`" claim below predates this and is no longer accurate: shadcn primitives that consume `useComponentDefaults()` now live inside the **SDK** (`packages/exepad-sdk/`), and individual agent-emitted pages decide whether to honor those defaults.
> - The Next.js `generateMetadata` pipeline and the `SeoMeta` component in this audit are historical — meta tags are now injected by the Hono worker via `worker/src/lib/meta-injector.ts`, reading config from the `CONFIG_CACHE` storage adapter (the local filesystem tree under `/data/storage`).
> - The `scaffolds/` interface subtree referenced anywhere in this document has been removed; the schema-level types still ship for backward compat with old configs but no expander reads them.
> - `frontend.logic.actions` and `frontend.logic.computed` are removed (matches "Fully Implemented → Client-side logic" line: state remains, actions/computed are no longer wired).

---

## 1. Overall Structure

`WebAppProps` is a layered configuration schema with clean separation of concerns:

```
WebAppProps (extends AppProps)
├── frontend?   → FrontendConfig        (UI, theme, pages, logic)
├── backend?    → BackendConfig          (static data | dynamic infra)
├── repo?       → RepoConfig             (Tier 2 custom code registry)
├── security?   → SecurityConfig         (auth/authz)
└── secrets?    → SecretConfig[]         (KV-stored API keys)
```

The discriminated union on `BackendConfig.mode` (`"static"` | `"dynamic"`) is a strong design choice — it enforces at the type level that static apps cannot accidentally reference dynamic infrastructure.

### Key source files

| File | Role |
|---|---|
| `src/app_runtime/interfaces/apps/webapp.ts` | Root schema definition |
| `src/app_runtime/interfaces/apps/core.ts` | `AppProps`, `ThemeProps`, `LayoutOption`, `MenuPosition`, `ComponentDefaults`, etc. |
| `src/app_runtime/interfaces/backend.ts` | `BackendConfig` discriminated union, type guards |
| `src/app_runtime/interfaces/repo.ts` | `RepoConfig`, `CustomMethod`, `RepoComponentConfig` |
| `src/app_runtime/interfaces/offline.ts` | `OfflineConfig` (PWA support) |
| `src/app_runtime/interfaces/state.ts` | `StateSchema`, `ActionsSchema`, `ComputedSchema` |
| `src/components/ClientLayoutRenderer.tsx` | Primary consumer — wires config into store + renderers |
| `src/components/AppRenderer.tsx` | Layout branching, page routing, transition rendering |
| `src/components/DynamicTheme.tsx` | CSS variable generation from `ThemeProps` |
| `src/context/ComponentDefaultsContext.tsx` | `ComponentDefaultsProvider` + `useComponentDefaults()` hook |
| `src/context/AppConfigContext.tsx` | Extracts `theme.defaults` and wraps children with defaults provider |
| `src/app/_shared/utils/metadataGenerator.ts` | `generateAppMetadata()` — merges theme + page metadata for Next.js |
| `src/app_runtime/runtime/components/custom/website/utils/SeoMeta.tsx` | Client-side `<head>` injection for SEO/OG/Twitter meta tags |

---

## 2. Field-by-Field Implementation Status

### 2.1 Fully Implemented (Production-ready)

These fields are consumed in the runtime with complete coverage.

#### FrontendConfig — Presentation

| Field | Type | Consumer | Notes |
|---|---|---|---|
| `layout` | `LayoutOption` | `AppRenderer`, `ClientLayoutRenderer` → `getLayoutClasses()` | Controls content width (`boxed`, `wide`, `narrow`, `full-width`) |
| `menuPosition` | `MenuPosition` | `AppRenderer`, `ClientLayoutRenderer` | Drives header vs. sidebar layout branching (`isSidebarLayout` / `isHeaderLayout`) |
| `theme.light`, `theme.dark` | `ColorPalette` | `DynamicTheme.tsx` | CSS variables in `:root` / `.dark` selector |
| `theme.charts` | `ChartPalette` | `DynamicTheme.tsx` | `--chart-1` through `--chart-5` CSS variables |
| `theme.fontSizes` | Record | `DynamicTheme.tsx` | `--font-size-{key}` CSS variables |
| `theme.radius` | `string` | `DynamicTheme.tsx` | `--radius` CSS variable |
| `theme.spacing.x`, `.y` | `string` | `DynamicTheme.tsx` | `--spacing-section-x`, `--spacing-section-y` |
| `theme.styles` | `StyleVariables` | `DynamicTheme.tsx` | Shadow and transition CSS variables |
| `theme.layout.containerWidth`, `.contentPadding` | `string` | `DynamicTheme.tsx` | `--container-width`, `--content-padding` |
| `theme.fonts.body`, `.heading` | `FontConfig` | `DynamicTheme.tsx` | Font family + weight CSS variables |
| `theme.defaults` | `ComponentDefaults` | `ComponentDefaultsContext` → 14 components | See detailed breakdown below |
| `frontend.metadata` | `MetadataProps` | `metadataGenerator.ts`, `SeoMeta` component | See detailed breakdown below |

#### theme.defaults — Component Defaults System

A complete context-based defaults pipeline with a `useComponentDefaults()` hook consumed by 14 components.

**Architecture:**
1. `AppConfigContext.tsx` extracts `appConfig.frontend?.theme?.defaults` and wraps children with `ComponentDefaultsProvider`
2. `ComponentDefaultsContext.tsx` provides `useComponentDefaults()` hook
3. Each component applies the resolution chain: **component prop > form-scoped override > theme.defaults > built-in default**

| Component | Defaults Consumed |
|---|---|
| Button | `button.variant`, `button.radius` |
| Card | `card.variant`, `.elevation`, `.radius`, `.hoverEffect` |
| Section | `section.variant`, `.elevation`, `.radius` |
| Heading | `heading.decoration`, `.weight` |
| Text | `text.weight` |
| Tabs | `tab.variant`, `.size` |
| Stepper | `stepper.variant`, `.size` |
| Accordion | `accordion.style` |
| DataTable | `dataTable.striped`, `.hoverable`, `.compact` |
| Form | Merges global defaults with form-level overrides for `input`, `button`, `form` — re-provides via nested `ComponentDefaultsProvider` |
| FormStyleContext | `input.variant`, `.size`, `.radius`, `form.fieldSpacing`, `.labelPosition` |
| FieldSet | `form.fieldSetVariant` |
| ConversationalForm | References `componentDefaults` |

The Form component implements the form-scoped override layer by merging global defaults with form-level props (`fieldVariant`, `fieldSize`, `buttonVariant`, etc.) and re-providing via a nested `<ComponentDefaultsProvider>`.

#### frontend.metadata / Page metadata — SEO System

A complete two-layer metadata pipeline covering server-side rendering and client-side injection.

**Server-side (Next.js `generateMetadata`):**
- `metadataGenerator.ts` — central utility that merges `frontend.metadata` (site-wide) with `currentPage.metadata` (per-page), resolves favicon, builds OpenGraph, sets robots directives
- Called from `generateMetadata()` in all route types: production, demo, example pages
- Route-aware: production gets `index: true`; preview/demo/example get `noindex, nofollow`

**Client-side (`SeoMeta` component):**
- `SeoMeta.tsx` renders `<title>`, `<meta description>`, `<meta keywords>`, OpenGraph tags, Twitter Card tags, canonical URL via Next.js `<Head>`
- Registered in the component registry for use inside page content trees

**Metadata hierarchy:** Page metadata > Frontend metadata (site-wide) > Hardcoded defaults

#### FrontendConfig — Structure

| Field | Type | Consumer | Notes |
|---|---|---|---|
| `pages[]` | `WebPageProps[]` | `AppRenderer`, `ClientPageRenderer` | Iterated for slug/uuid matching; content rendered via `DynamicRendererList` |
| `header[]` | `ComponentProps[]` | `AppRenderer`, `ClientLayoutRenderer`, `PersistentHeader` | Persistent header; rendered only in the `HeaderMenuTop` branch and only when non-empty. The header code component owns its own scroll behavior |
| `sidebar[]` | `ComponentProps[]` | `AppRenderer`, `ClientLayoutRenderer`, `CodeFocusSidebarShell` | Rendered in `CodeFocusSidebarShell` when `menuPosition === 'SidebarMenuLeft'` and `sidebar` is non-empty |
| `footer[]` | `ComponentProps[]` | `AppRenderer`, `ClientLayoutRenderer`, `PersistentFooter` | Optional rendering when `footer.length > 0` |

#### FrontendConfig — Logic

| Field | Type | Consumer | Notes |
|---|---|---|---|
| `logic.state` | `StateSchema` | `useRuntimeStore` → `appStateStore.initialize()` | Initial state loaded into Zustand store; merged with auto-injected datasets and the `auth` namespace |
| ~~`logic.actions`~~ | removed | — | Removed. Code components handle logic via SDK hooks (useModel, useHandler, etc.) |
| ~~`logic.computed`~~ | removed | — | Removed. Code components compute derived values inline in JS/TSX |
| `transitions` | `TransitionConfig` | `PageTransition` component | Global config with page-level overrides via `pages[].transitions` |

#### BackendConfig — Static Mode

| Field | Type | Consumer | Notes |
|---|---|---|---|
| `mode: 'static'` | literal | `isStaticBackend()`, `useRuntimeStore` | Type guard determines dataset loading path |
| `data.datasets` | `Record<string, StaticDataset>` | `useRuntimeStore` | Auto-injected into app state at init; code components read them from the store via the SDK's `useAppState(datasetId)` (the `useDataset` hook was removed) |

#### BackendConfig — Dynamic Mode (client-consumed fields only)

| Field | Type | Consumer | Notes |
|---|---|---|---|
| `mode: 'dynamic'` | literal | `isDynamicBackend()`, `useModelData`, `useHandlerData` | Determines if backend API calls are available |
| `models[]` | `ModelConfig[]` | `useModelData` | Model names construct API routes `/api/{appId}/{modelName}` |
| `handlers[]` | `HandlerConfig[]` | `useHandlerData` | Handler names used in API calls |

#### RepoConfig

| Field | Type | Consumer | Notes |
|---|---|---|---|
| `methods` | `Record<string, CustomMethod>` | — | No client consumer. `initializeMethodRegistry` and the `recomputeAll()` it fed were removed with the action/computed system; handler code runs server-side in the app-backend |
| `components` | `Record<string, RepoComponentConfig>` | `initializeComponentRegistry` in `useRuntimeStore` | Lazy-loads `CodeComponent` modules |

#### SecurityConfig (consumed subset)

| Field | Consumer | Notes |
|---|---|---|
| `redirectAfterLogout` | `ClientLayoutRenderer` | Target for auto-generated `$auth_signOut` action; defaults to `'/login'` |
| `loginPage` | `ClientLayoutRenderer` | Compared against current pathname for auth page detection; defaults to `'/login'` |
| `defaultAccess` | `normalizer.ts` | Migrated during config normalization; used as default page access control |

When `security` is defined, a special `$auth` namespace is injected into initial state with: `isAuthenticated`, `isLoading`, `user`, `roles`, `error`.

---

### 2.2 Partially Implemented (Gaps Exist)

#### `frontend.languages` — i18n

**Interface defined:** `LanguageOption` with `code`, `nameEnglish`, `nameNative`, `isDefault`.

**What's missing:**
- No language switching UI component
- No string table / translation map format
- No `$t(key)` expression support in component text bindings
- No locale-aware date/number formatting
- No language-scoped content variants on pages or components

**Verdict:** Phantom feature. The interface exists but the entire i18n pipeline is absent.

#### `security` — Auth/Authz (deeper fields)

**What works:** Auth state injection, login page detection, sign-out action generation, page-level `access`.

**What's unclear:** Detailed `authProviders` configuration, role-based access enforcement beyond page-level `access`, token refresh flows, session management.

---

### 2.3 Not Implemented (Type-only — No Runtime Consumption)

#### `frontend.offline` — OfflineConfig (PWA)

Six nested interfaces define a complete PWA system:
- `OfflineConfig` → Service Worker enable, state persistence, sync strategy, conflict resolution
- `CacheModelConfig` → per-model caching (cache-first, network-first, stale-while-revalidate)
- `CachingConfig` → static asset caching, API response caching, precache routes

**Zero runtime code.** No Service Worker registration, no IndexedDB persistence, no background sync, no cache management.

#### `backend.realtime`

Declared WebSocket channel configuration.

**No client-side WebSocket connection logic, no channel subscription API, no presence hooks, and no server-side coordination layer exist.** As of the current tree the field is `unknown` passthrough on `DynamicBackend` and there is no `RealtimeProps` type in `@exepad/types` at all — see [08-backend-modes.md §4.4](./08-backend-modes.md).

#### `backend.sources`, `.queues`, `.tasks`, `.pipelines`

Same status: `unknown` passthrough with no type definition, no deploy step, and no runtime consumer. `backend.storage` is the exception — `StorageProps` is real and the deploy pipeline provisions the per-app file bucket and `_files` table from it.

#### `repo.seed`

Seed data configuration. Consumed at deploy time, not at client runtime. Acceptable.

#### `secrets`

Server-side KV injection only. Not exposed to client. Expected and correct.

---

### 2.4 Unused Metadata Fields (from AppProps)

These fields exist on `AppProps` but are not consumed by the client runtime:

| Field | Type | Notes |
|---|---|---|
| `alias` | `string` | Used at deployment/routing layer (Next.js dynamic route), not in runtime |
| `version` | `string` | Metadata only; no schema migration or version checking |
| `appType` | `AppTypeOption` | Discriminator; not type-checked at runtime |
| `appSecondaryType` | `AppSecondaryTypeOption` | Categorization metadata; no UI branches on it |
| `summary` | `string` | Admin panel / listing concern |
| `shortSummary` | `string` | Admin panel / listing concern |
| `lastUpdatedEpoch` | `number` | Present on pages/components; not used at app root |
| `signature` | `string` | Internal integrity hash; no client-side validation |

---

## 3. Architectural Gaps & Recommendations

### Gap A: `languages` / i18n is a phantom feature — MEDIUM PRIORITY

**Problem:** `LanguageOption` interface is defined but the entire i18n pipeline is absent — no language switcher, no string tables, no `$t()` helper, no locale formatting.

**Impact:** Multi-language apps cannot be built despite the schema suggesting support.

**Recommendation:** Either:
- Build the i18n pipeline (add `translations: Record<string, Record<string, string>>` to `FrontendConfig`, add `$t(key)` expression support, add language switcher component)
- Remove `languages` from `FrontendConfig` to avoid misleading schema consumers

### Gap B: `offline` (OfflineConfig) is fully spec'd but unbuilt — MEDIUM PRIORITY

**Problem:** 6 nested interfaces describe a complete PWA system. Zero implementation exists.

**Impact:** Schema bloat without runtime value. LLM-generated configs using `offline: { enabled: true }` are silently ignored.

**Recommendation:** Move to a separate `@exepad/offline` package or gate behind a `// @future` marker. Remove from active schema validation until implementation begins.

### Gap C: `realtime` has no counterpart — LOW-MEDIUM PRIORITY

**Problem:** WebSocket channel configuration was described in the schema but no client WebSocket connection logic, no server-side coordination layer, and no presence API are implemented.

**Status since this audit:** the typed `RealtimeConfig` interface was removed; `realtime` now survives only as an `unknown` passthrough key on `DynamicBackend`. Do not surface it in LLM agent context until implementation begins.

---

## 4. Structural Design Observations

### What's done well

- **Discriminated union** on `BackendConfig.mode` — clean, type-safe, eliminates impossible states
- **Type guards** (`isStaticBackend`, `isDynamicBackend`) — proper defensive programming
- **Tier 1/Tier 2 separation** — declarative actions vs. custom methods is a clean architectural boundary
- **Optional everything** — graceful degradation; frontend-only or backend-only apps both work
- **Legacy compatibility** — `frontend.data.datasets` fallback with `console.warn` is pragmatic migration handling

### What needs attention

1. **No runtime validation** — The client trusts the config shape entirely. A malformed config from the LLM silently breaks things. Consider a lightweight Zod schema or at minimum field-presence checks for critical paths (`frontend.pages`, `frontend.logic.state`).

2. **`AppProps` is bloated for runtime** — Fields like `alias`, `version`, `summary`, `shortSummary`, `signature` are never used client-side. Consider a `RuntimeAppConfig` type that picks only what the renderer needs, keeping `AppProps` for the admin/deployment layer.

3. **No config versioning strategy** — `version` field exists but is never checked. Schema migrations (like the `frontend.data` → `backend.data.datasets` migration) are ad-hoc. A formal `schemaVersion` field with a normalizer registry would prevent drift as the schema evolves.

---

## 5. Summary Scorecard

| Area | Status | Priority |
|---|---|---|
| Core rendering (layout, pages, header/footer/sidebar) | Fully implemented | — |
| Theme system (colors, fonts, spacing, styles) | Fully implemented | — |
| Theme defaults (ComponentDefaults) | Fully implemented (14 components) | — |
| Metadata / SEO (MetadataProps) | Fully implemented (server + client) | — |
| Client-side logic (state, actions, computed) | Fully implemented | — |
| Page transitions | Fully implemented | — |
| Static backend (datasets) | Fully implemented | — |
| Dynamic backend (models, handlers) | Fully implemented | — |
| Repo (methods, components) | Fully implemented | — |
| **`languages` / i18n** | **Type-only, not wired** | **MEDIUM** |
| **`offline` (PWA)** | **Type-only, not wired** | **MEDIUM** |
| **`realtime` (WebSocket)** | **Type-only, not wired** | **LOW** |
| Security (auth) | Partially implemented | Needs separate audit |
| AppProps metadata fields | Unused at runtime | LOW |

### Bottom Line

The core rendering pipeline is comprehensive and production-ready. The theme defaults system is fully wired across 14 components with a clean context-based architecture. SEO/metadata is complete with both server-side `generateMetadata` and a client-side `SeoMeta` component. The remaining gaps are `languages` (i18n), `offline` (PWA), and `realtime` (WebSocket) — all fully typed but with no runtime implementation. Since LLMs are a primary consumer of this schema, the unimplemented fields (`languages`, `offline`, `realtime`) should be clearly marked to avoid generating configs that are silently ignored.
