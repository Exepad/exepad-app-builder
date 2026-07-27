# App Type Guide: Data App

<!-- Schema Version: 2.0.0 | Last Updated: 2026-03-30 -->

You are planning a **DATAAPP** — an application focused on displaying, managing, and interacting with structured data (dashboards, admin panels, CRM, inventory, project management, analytics).

Components are TSX files using React JSX rendering with `@exepad/sdk` components (`Charts.*`, `Icons.*`, `Button`, `Card`, etc.). Data binding via `useApp()` hook.

---

## Architecture

- **Pages:** Multiple pages organized by entity or workflow (Dashboard, Contacts, Orders, Settings)
- **Navigation:** `SidebarMenuLeft` — collapsible sidebar with icon + label nav items
- **Rendering mode:** `react_jsx` for all components (sidebar, content)
- **No footer** — dashboards don't need footers
- **CRUD forms:** Modal-based create/edit (inline, not separate pages)

### Page Composition Rule
Do NOT generate static content pages (Privacy Policy, Terms, About, FAQ). DataApps are functional tools — every page should serve a purpose (CRUD, dashboards, settings, reports).

---

## Content Depth Requirements

| App Category | Min Pages | Required Page Types |
|-------------|-----------|-------------------|
| Simple admin | 3 | Dashboard + 1 entity CRUD + Settings |
| Standard app | 4-6 | Dashboard + 2-3 entity CRUD + Settings |
| Complex platform | 6-8 | Dashboard + 3-5 entity CRUD + Reports + Settings |

### Minimum Sections Per Page Type

| Page Type | Min Sections |
|-----------|-------------|
| Dashboard | 3 |
| CRUD list | 2 |
| Detail view | 2 |
| Settings | 2 |
| Reports | 2 |

What goes in those sections is up to you — design each page layout to match the app's personality and data needs. There is no fixed ordering or template.

---

## Dashboard Layout

Dashboards present the app's key data at a glance. Design a layout that fits the data — do NOT follow a rigid template. Consider these layout approaches:

- **Bento grid** — Mix different-sized tiles (large chart, small metrics, medium table) in an asymmetric grid
- **KPI-first** — Prominent stat cards at top, charts and details below
- **Chart-first** — Lead with a full-width hero chart, supporting data below
- **Feed/timeline** — Activity stream with inline metrics and mini-charts
- **Split panel** — Summary on left, details on right
- **Tabbed sections** — Multiple data views behind tabs (Overview, Analytics, Activity)

**Data rules (always apply):**
- Values MUST come from backend data (via `useModel` or `useHandler`)
- NEVER hardcode stat values
- Use `Charts.*` components from SDK for visualizations
- Data bound via `useApp()` state

---

## Entity CRUD Pages

Entity pages let users view, create, edit, and delete records. The layout should fit the data — NOT every entity page needs to be an identical table with modals.

**Layout options to consider:**
- **Table + modals** — Classic table view with create/edit modals (good for many columns)
- **Card grid + side panel** — Cards in a grid, clicking opens a detail panel (good for visual data)
- **Split view** — List on left, detail/edit form on right (good for frequent editing)
- **Inline editing** — Editable table cells without modal popups (good for simple fields)

**Functional requirements (always apply):**
- Users must be able to create, view, edit, and delete records
- Data from backend model via `useModel()`
- Include search or filter capability
- Include "Add New" action
- Edit/delete flows must include proper confirmation and feedback

---

## Data Flow

See the `crud-data-app` skill for `useModel`/`useApp`/`useHandler` patterns, data binding tables, and CRUD action patterns (open/close modals, save, delete with confirmation).

---

## Navigation

### Sidebar Component
- Logo + app name at top
- Navigation links with Lucide icons (`Icons.*` from SDK)
- Highlight active route
- Collapsible on mobile
- Use `navigate()` from SDK for SPA routing
- Sidebar color should follow the design_style — dark, light, or colored are all valid

### Page-Level Navigation
- Tabs for sub-views within a page (Overview, Details, History)
- Breadcrumbs for deep hierarchies

---

## Backend Rule

- **Default:** `backend_needed: true`
- Define a model for each data entity
- Define handlers for complex queries, aggregations, or external API calls
- Every model gets auto-CRUD: create, read, list, update, delete

---

## Common Patterns

### Admin Dashboard
Sidebar → Dashboard (stats + charts) → Entity pages (table + CRUD modals) → Settings

### CRM
Sidebar → Contacts (table) → Contact detail (info + tabs) → Activities → Deals (pipeline view)

### Inventory Management
Sidebar → Products (table with filters) → Product detail → Stock levels (stats) → Orders (table)

### Project Tracker
Sidebar → Board view (kanban-style) → List view (table) → Calendar → Analytics

### Analytics Dashboard
Sidebar → Overview (stats + charts grid) → Detailed reports (tables) → Custom date ranges

---

## Data Binding Rules (CRITICAL)

| Context | MUST Use | NEVER Use |
|---------|----------|-----------|
| KPI values | Handler results or inline calculations | Hardcoded numbers |
| Table data | Backend model via `useApp()` | Inline static arrays |
| Chart data | Backend handler results | Inline data |
| Chart colors | CSS vars: `var(--color-primary)`, `var(--color-secondary)` | Hardcoded hex values |
| Success indicators | `bg-secondary` / `text-on-secondary` | `green-*` Tailwind defaults |
| Warning indicators | `bg-error-container` / `text-on-error-container` | `orange-*` / `yellow-*` Tailwind defaults |
| Error indicators | `bg-error` / `text-on-error` | `red-*` Tailwind defaults |
| Modal state | `state.isEditModalOpen` (reactive) | Hardcoded true/false |
| Form defaults (edit) | `state.selectedItem.fieldName` | Empty defaults |

---

## Quality Checklist

Before finalizing a data app plan, verify:

- [ ] Dashboard has stats grid → charts → data table (minimum 3 sections)
- [ ] KPI values use handler results or `useModel` aggregation — ZERO hardcoded numbers
- [ ] Every entity page has a corresponding backend model
- [ ] Every "Add" action has paired "Edit" modal; every modal has open + close
- [ ] Every CRUD modal calls `create`/`update` via `useModel` — forms MUST NOT just close without saving
- [ ] Delete flows include confirmation modal + success notification
- [ ] State/action pairs match: every `openX` has `closeX`
- [ ] Backend models defined for every data entity
- [ ] Seed data planned for every model (5-10 sample records)
- [ ] No static content pages (no Privacy Policy, Terms, About, FAQ)
- [ ] Auth-gated pages use correct role-based access

---

## Things to Avoid

- **Marketing-style hero sections** — data apps are functional, not promotional
- **Hardcoded data** in tables, charts, or stats — use backend models and handlers
- **Static datasets for KPIs** — use handler queries or `useModel` aggregation
- **HeaderMenuTop as primary navigation** — use SidebarMenuLeft for data apps
- **Built-in form storage for CRUD forms** — entity forms need backend models
- **Excessive decorative content** — focus on data and functionality
- **Footer components** — not needed for dashboards
