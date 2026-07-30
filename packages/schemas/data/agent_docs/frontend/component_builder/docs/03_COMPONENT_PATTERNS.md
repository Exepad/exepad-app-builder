# Component Patterns

<!-- Schema Version: 2.1.0 | Last Updated: 2026-04-04 -->

Implementation patterns for the most common UI elements in React JSX components. All examples use `@exepad/sdk` imports exclusively. For the full SDK export list, see `05_CODE_COMPONENTS.md`.

Color note: semantic `on-*` tokens are palette-derived. When you copy any example
below, keep the pairing rule intact (`bg-X` with `text-on-X`) and do not assume
that `text-on-primary` or `text-inverse-on-surface` is always white.

---

## 1. Charts & Data Visualization

Access chart components through the `Charts.*` namespace. Never destructure `Charts`. See the `charts-visualization` skill for full implementation patterns (AreaChart, BarChart, Sparkline, gradients) and chart rules.

---

## 2. Card & KPI Patterns

> **Note:** Card styling (border-radius, shadow, padding, border) should follow the `design_style` from the Creator. The examples below show ONE possible style — adapt to match the app's visual direction. A flat design uses no shadows, a brutalist design uses sharp corners, a neumorphic design uses inset shadows, etc.

### Stat Card with Icon, Value, and Trend

```tsx
<div className="bg-surface p-6 rounded-2xl shadow-sm border border-outline-variant/10 relative overflow-hidden group hover:shadow-md transition-all">
  <div className="flex justify-between items-start mb-4">
    <div className="p-2 bg-tertiary/50 rounded-lg">
      <Icons.Droplets className="w-6 h-6 text-primary" />
    </div>
    <span className="text-[10px] font-bold text-primary uppercase tracking-widest">Season Yield</span>
  </div>
  <h3 className="font-bold text-on-surface-variant text-sm mb-1">Honey Production</h3>
  <div className="flex items-baseline gap-1 mb-3">
    <span className="text-2xl font-black text-on-surface tracking-tight">85%</span>
    <span className="text-xs text-on-surface-variant">of target</span>
  </div>
</div>
```

### Card Grid

```
grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6   — 4-column KPI row
grid grid-cols-1 md:grid-cols-3 gap-6                   — 3-column stat row
grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-6  — card inventory
```

### Progress Bar

```tsx
<div className="w-full h-2 bg-surface-container rounded-full overflow-hidden">
  <div className="h-full bg-gradient-to-r from-primary to-tertiary w-[85%] rounded-full" />
</div>
```

Compact variant with label:

```tsx
<div className="flex justify-between text-[10px] font-bold text-on-surface-variant mb-2">
  <span>POPULATION DENSITY</span><span>92%</span>
</div>
<div className="h-1.5 w-full bg-surface-container rounded-full">
  <div className="h-full w-[92%] bg-secondary rounded-full" />
</div>
```

### KPI value / unit coupling (MANDATORY)

When a KPI has a unit suffix (Months, Hours, %, $, °F, mph), the unit
MUST be **derived from the same source as the value** — not appended as
a static string in the view. The handler is the single source of truth
for both number AND its meaning.

Two acceptable patterns:

**Pattern 1 — embed the unit in the field name:**
```ts
// Handler return
return { paybackMonths: 18, throughputPerHour: 425 };
```
```tsx
// View — unit lives in the label, not concatenated to the value
<KPICard label="Payback Period (Months)" value={data?.paybackMonths ?? 0} />
<KPICard label="Throughput (per Hour)"   value={data?.throughputPerHour ?? 0} />
```

**Pattern 2 — return `{value, unit}` as a pair:**
```ts
return {
  payback: { value: 18, unit: "months" },
  yield:   { value: 85, unit: "%" },
};
```
```tsx
<KPICard label="Payback" value={data?.payback.value} unit={data?.payback.unit} />
```

**The bug to avoid (FORBIDDEN):**
```tsx
// WRONG — handler returns a YEAR number ("2024"); view labels it "Months".
// Live UI reads "2024 Months" or "0 Months". Shipped on coje33ih's Dashboard.
<KPICard label="Payback Period" value={`${data?.payback ?? 0} Months`} />
```

A unit appended in the view as a string literal is a silent decoupling:
the handler's author can change the meaning of the field (year vs months
vs days) and the view won't notice. Either of the two patterns above
fails loudly when the handler shape changes.

### Card Hover & Elevation

- Standard: `hover:shadow-md transition-all`
- Feature card: `group hover:shadow-xl hover:shadow-primary/5 transition-all duration-300`
- Background glow: `<div className="absolute -right-4 -top-4 w-24 h-24 bg-secondary/5 rounded-full blur-2xl group-hover:bg-secondary/10 transition-colors" />`

---

## 3. Data Table Patterns

> **Note:** Table visual styling (header background, row hover, badge shapes) should adapt to the design_style. The structural pattern (overflow-x-auto, thead/tbody, responsive scroll) is required.

### Full Table with Header, Body, Badges, and Pagination

```tsx
<div className="bg-surface rounded-2xl overflow-hidden shadow-sm">
  {/* Table header bar with filter */}
  <div className="p-6 border-b border-outline-variant flex flex-col sm:flex-row sm:items-center justify-between gap-4">
    <h3 className="text-lg font-bold text-on-surface">Harvest Ledger</h3>
    <div className="relative">
      <input className="pl-9 pr-4 py-1.5 bg-surface-container/50 border-none rounded-lg text-sm focus:ring-1 focus:ring-primary w-full md:w-48" placeholder="Filter..." type="text" />
      <Icons.Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-on-surface-variant w-[18px] h-[18px]" />
    </div>
  </div>
  {/* Scrollable table */}
  <div className="overflow-x-auto">
    <table className="w-full text-left border-collapse">
      <thead>
        <tr className="bg-surface-container-low/50">
          <th className="px-6 py-4 text-[11px] font-bold text-on-surface-variant uppercase tracking-wider">Date</th>
          <th className="px-6 py-4 text-[11px] font-bold text-on-surface-variant uppercase tracking-wider">Quality Grade</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-outline-variant">
        {rows.map((row, idx) => (
          <tr key={idx} className="hover:bg-surface-container-low/30 transition-colors">
            <td className="px-6 py-4 text-sm font-medium text-on-surface">{row.date}</td>
            <td className="px-6 py-4">
              <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold ${row.gradeColor}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${row.dotColor}`} />
                {row.grade}
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
  {/* Pagination */}
  <div className="px-6 py-4 flex items-center justify-between bg-surface-container-low/20">
    <p className="text-xs text-on-surface-variant font-medium">Showing 4 of 128 entries</p>
    <div className="flex gap-2">
      <button className="p-1.5 rounded-md border border-outline-variant/20 hover:bg-surface-container text-on-surface-variant transition-colors opacity-50" disabled>
        <Icons.ChevronLeft className="w-[18px] h-[18px]" />
      </button>
      <button className="p-1.5 rounded-md border border-outline-variant/20 hover:bg-surface-container text-on-surface-variant transition-colors">
        <Icons.ChevronRight className="w-[18px] h-[18px]" />
      </button>
    </div>
  </div>
</div>
```

### Status Badge

Compose contextual badge styles from data using template literals:

```tsx
const row = { status: 'URGENT TREATMENT', statusBg: 'bg-error-container', statusText: 'text-on-error-container' };

<span className={`px-2 py-1 rounded-full text-[10px] font-bold ${row.statusBg} ${row.statusText}`}>
  {row.status}
</span>
```

### Table Rules

- Always wrap `<table>` in `<div className="overflow-x-auto">` for mobile scroll.
- Header cells: `text-[11px] font-bold uppercase tracking-wider`.
- Body rows: `divide-y divide-outline-variant` on `<tbody>`, `hover:bg-surface-container-low/30 transition-colors` on `<tr>`.

---

## 4. Form Patterns

See the `form-submission` skill for form input patterns (text, select, toggle, range, icon prefix), form layout grids, form submission decision rules, and the platform form submission code example.

---

## 5. Alert & Notification Patterns

### Alert Card with Colored Left Border

```tsx
<div className="bg-surface p-5 rounded-2xl shadow-sm border-l-4 border-error flex flex-col md:flex-row md:items-start justify-between gap-4">
  <div className="flex gap-4">
    <div className="bg-error-container text-error p-3 rounded-xl h-fit">
      <Icons.Bug className="w-6 h-6" />
    </div>
    <div>
      <h4 className="font-bold text-lg text-on-surface">Varroa Destructor Outbreak</h4>
      <p className="text-on-surface-variant text-sm mt-1">Hive #A-214 &bull; Density: 12%</p>
      <div className="flex gap-2 mt-3">
        <span className="bg-error/10 text-error text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full">Immediate Action</span>
        <span className="bg-surface-container text-on-surface-variant text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full">Detected 4h ago</span>
      </div>
    </div>
  </div>
  <button className="bg-error text-on-error px-4 py-2 rounded-lg text-sm font-bold hover:opacity-90 transition-opacity whitespace-nowrap">Apply Treatment</button>
</div>
```

### Alert Section Container

Wrap alert cards in a tinted section with a background watermark icon:

```tsx
<section className="bg-error-container/20 rounded-3xl p-6 border border-error/10 overflow-hidden relative">
  <div className="absolute top-0 right-0 p-8 opacity-5">
    <Icons.AlertTriangle className="w-24 h-24 text-error" />
  </div>
  <div className="relative z-10 space-y-4">{/* Alert cards */}</div>
</section>
```

### Warning / Info Note

```tsx
<div className="p-4 bg-primary-container/10 rounded-xl border-l-4 border-primary">
  <p className="text-xs font-bold text-primary mb-1">PRO TIP</p>
  <p className="text-[11px] leading-relaxed text-primary">Export your logs regularly to maintain a physical backup.</p>
</div>
```

### Severity Color Map

| Severity | Border | Icon bg | Text |
|----------|--------|---------|------|
| Critical | `border-error` | `bg-error-container` | `text-on-error-container` |
| Warning | `border-tertiary` | `bg-tertiary-container/30` | `text-tertiary` |
| Success | `border-secondary` | `bg-secondary-container/50` | `text-secondary` |
| Info | `border-primary` | `bg-primary-container/10` | `text-primary` |

---

## 6. Layout Composition

### Page Content Wrapper

```tsx
<div className="p-6 lg:p-10 space-y-10">{/* Page sections */}</div>
```

### Two-Column Layout (8/4 Split)

```tsx
<div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
  <div className="lg:col-span-8 space-y-6">{/* Main content */}</div>
  <div className="lg:col-span-4 space-y-6">{/* Sidebar */}</div>
</div>
```

### Three-Column Layout (2/1 Split)

```tsx
<div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
  <div className="lg:col-span-2 space-y-8">{/* Wide column */}</div>
  <div className="space-y-6">{/* Narrow column */}</div>
</div>
```

### Section Heading with Accent Bar

```tsx
<h3 className="font-bold text-on-surface text-lg mb-6 flex items-center gap-2">
  <span className="w-1 h-6 bg-primary rounded-full" />
  Section Title
</h3>
```

### Spacing Conventions

- Between major page sections: `space-y-10` or `space-y-8`
- Within a section: `space-y-6`
- Within a card: `space-y-4` or `gap-4`

---

## 7. Checklist & Interactive List Patterns

### Checkbox Checklist with State

```tsx
const checklistItems = [
  { label: 'Equipment Sanitization', desc: 'Tools torched or soaked in 10% bleach solution.', defaultChecked: false },
  { label: 'Brood Pattern Check', desc: 'Inspected for sunken cappings or foul odor.', defaultChecked: true },
];

const [checklist, setChecklist] = useState(checklistItems.map((item) => item.defaultChecked));
const toggleCheck = (index: number) => {
  setChecklist((prev) => prev.map((val, i) => (i === index ? !val : val)));
};

<div className="space-y-3">
  {checklistItems.map((item, idx) => (
    <label key={idx} className="flex items-start gap-3 p-4 rounded-2xl hover:bg-surface-container-low transition-colors cursor-pointer group border border-transparent hover:border-outline-variant/10">
      <input type="checkbox" checked={checklist[idx]} onChange={() => toggleCheck(idx)}
        className="mt-1 w-5 h-5 rounded text-secondary focus:ring-secondary border-outline-variant" />
      <div>
        <span className="block font-bold text-on-surface group-hover:text-secondary transition-colors">{item.label}</span>
        <p className="text-xs text-on-surface-variant mt-1">{item.desc}</p>
      </div>
    </label>
  ))}
</div>
```

### Key-Value Detail List

```tsx
<div className="flex items-center justify-between p-3 rounded-xl bg-surface-container-low">
  <div className="flex items-center gap-3">
    <Icons.Crown className="w-5 h-5 text-primary" />
    <span className="text-xs font-medium text-on-surface-variant">Queen Presence</span>
  </div>
  <span className="text-xs font-bold text-on-surface">Queen Active</span>
</div>
```

---

## 8. State Management Patterns

### React Hooks

Destructure React hooks at module scope:

```tsx
import { React } from '@exepad/sdk';
const { useState, useEffect, useMemo } = React;
```

### Local State (React.useState)

```tsx
// Controlled input
const [email, setEmail] = useState('user@example.com');
<input value={email} onChange={(e) => setEmail(e.target.value)} />

// Toggle
const [enabled, setEnabled] = useState(true);
<button onClick={() => setEnabled(!enabled)}>{enabled ? 'On' : 'Off'}</button>
```

### Shared State & Backend

For shared state patterns (`useAppState`, `useArrayState`, `useApp`), see the
guide in `logic_surface.state.guide`.

For backend CRUD patterns (`useModel`, `useHandler`), see the guides in
`backend_surface.models.guide` and `backend_surface.handlers.guide`.

### Local vs Shared Decision

| Scope | Hook | Example |
|-------|------|---------|
| Component-only | `React.useState` | Toggle, form input, active tab, checklist |
| Cross-component | `useAppState` / `useApp` | Theme, selected item shared between pages |
| Backend data | `useModel` / `useHandler` | CRUD, dashboards, reports |

---

## 8.5. Drill-down navigation: list → detail

When a list page links to a detail page, pass the row id in the URL and read
it on the detail side. The platform's `navigate()` accepts a query-string
suffix and the detail page reads it from `window.location.search` (read-only
access is allowed).

```tsx
// List page (e.g., RecipesContent): include the row id in the link
<Card
  key={recipe.id}
  onClick={() => navigate(`/recipe-detail?id=${recipe.id}`)}
>
  …
</Card>

// Detail page (e.g., RecipeDetailContent): read the id, find the row
function RecipeDetailContent() {
  const { data: recipes, loading } = useModel('recipes');
  const id = Number(new URLSearchParams(window.location.search).get('id'));
  const recipe = (recipes ?? []).find((r) => r.id === id);

  if (loading) return <Spinner />;
  if (!recipe) {
    return (
      <div className="p-10 text-center text-on-surface-variant">
        Pick a recipe from the library.
        <Button onClick={() => navigate('/recipes')}>Back to list</Button>
      </div>
    );
  }
  // …render recipe…
}
```

### Anti-patterns — do NOT do these

- **DO NOT** navigate to a detail page without the row id
  (`navigate('/recipe-detail')`). The detail page can't know which row to show.
- **DO NOT** hardcode `(items ?? [])[0]` in a detail component as a "mocking
  selection for demonstration" — the page is permanently stuck on the first
  row regardless of which list item the user clicked.
- **DO NOT** introduce a shared-state variable (`useAppState('selectedId', …)`)
  for this — URL params survive refresh, share-by-link, and back/forward
  navigation. Shared state does not.

Keywords accepted by `navigate()`: typed literal routes auto-complete via the
generated `AppRoutes` interface (e.g. `/recipe-detail?${string}` template
literals satisfy the route signature).

### Platform auth: logout / sign-in are NOT pages — use `auth_signout`

`navigate('/logout')` / `navigate('/auth/logout')` / `navigate('/sign-in')`
are NOT app routes. Auth flows are platform-level. The runtime exposes a
built-in `auth_signout` handler that you call via `useHandler`:

```tsx
import { useHandler } from "@exepad/sdk";

function UserProfileChip() {
  const { execute: signOut, loading } = useHandler("auth_signout", {
    autoFetch: false,
  });

  return (
    <button
      onClick={signOut}
      disabled={loading}
      aria-label="Sign out"
      className="..."
    >
      <Icons.LogOut className="w-4 h-4" />
      Sign out
    </button>
  );
}
```

The platform handles cookie/session teardown and the post-logout redirect.
The component does NOT need to call `navigate(...)` after — the runtime
takes the user to the login surface on its own.

**Build-time guard.** Rule `component.routing.navigate_unknown_route`
blocks `navigate("/logout")` / `navigate("/sign-in")` / `navigate("/auth/...")`
with **error** severity and points at this recipe. Other unknown slugs
emit a warning with the list of declared pages.

### Mobile-First Breakpoints

```
grid-cols-1 md:grid-cols-2 lg:grid-cols-4      — progressive grid columns
flex-col md:flex-row                            — stack on mobile, row on desktop
p-4 md:p-6 lg:p-10                             — progressive padding
text-3xl md:text-4xl                            — progressive typography
hidden lg:flex                                  — show on desktop only
hidden sm:block                                 — show on small+ screens
```

### Mobile Bottom Navigation Bar

Use `useNavigation()` for active state detection:

```tsx
const { currentSlug } = useNavigation();

<nav className="md:hidden fixed bottom-0 left-0 right-0 bg-surface/90 backdrop-blur-md border-t border-outline-variant/20 flex justify-around py-4 z-50">
  <button className={`flex flex-col items-center gap-1 ${currentSlug === '/' ? 'text-primary' : 'text-on-surface-variant'}`} onClick={() => navigate('/')}>
    <Icons.LayoutDashboard className="w-5 h-5" />
    <span className="text-[10px] font-bold">Home</span>
  </button>
  <button className={`flex flex-col items-center gap-1 ${currentSlug === '/settings' ? 'text-primary' : 'text-on-surface-variant'}`} onClick={() => navigate('/settings')}>
    <Icons.Settings className="w-5 h-5" />
    <span className="text-[10px] font-bold">Settings</span>
  </button>
</nav>
```

### Floating Action Button (Mobile)

```tsx
<button className="fixed bottom-20 right-6 lg:hidden w-14 h-14 rounded-full bg-primary text-on-primary shadow-xl flex items-center justify-center active:scale-90 transition-transform z-50">
  <Icons.Plus className="w-6 h-6" />
</button>
```

### Touch Targets

Minimum 44px tap size. Use `p-2` or `p-3` on icon buttons. Mobile nav uses `py-4` spacing.

### Mobile Header Menu Overlay

See the `component-header` skill for the full mobile menu overlay pattern (z-index, body scroll lock, conditional render, FORBIDDEN patterns).

### Responsive Breakpoint Rules

Use progressive breakpoints — never jump from 1 column directly to many columns:

```
GOOD: grid-cols-1 md:grid-cols-2 lg:grid-cols-4
BAD:  grid-cols-1 md:grid-cols-7

GOOD: text-3xl md:text-5xl lg:text-7xl
BAD:  text-5xl md:text-7xl  (no mobile fallback)

GOOD: px-4 md:px-6 lg:px-10
BAD:  px-6 lg:px-24  (too large jump)
```

- Grids: max 2–3 columns at `md:`, expand to 4+ only at `lg:` or `xl:`
- Typography: hero headings need a mobile size (text-3xl or smaller as base)
- Padding: start small (px-4 or p-4) and scale up progressively

---

## 10. Animation & Transition Patterns

### Hover

```
hover:shadow-md transition-all                  — subtle card lift
hover:shadow-xl hover:shadow-primary/5 transition-all duration-300  — dramatic lift
hover:bg-surface-container/50 transition-colors         — icon button tint
hover:bg-surface-container-low transition-colors            — list row hover
```

### Press / Active

```
active:scale-95 transition-all                  — button press shrink
active:scale-90 transition-transform            — FAB press
```

### Group Hover

```tsx
<div className="group cursor-pointer">
  <img className="group-hover:scale-105 transition-transform duration-500" />
  <span className="opacity-0 group-hover:opacity-100 -translate-x-2 group-hover:translate-x-0 transition-all">
    <Icons.ArrowRight className="w-4 h-4" />
  </span>
</div>
```

### Glassmorphism

```
bg-surface-container-low/70 backdrop-blur-md                 — frosted header
bg-surface/90 backdrop-blur-md                — frosted mobile nav
bg-surface/80 backdrop-blur-md shadow-sm      — frosted website header
```

### Pulse

```tsx
<span className="w-1.5 h-1.5 rounded-full bg-secondary animate-pulse" />
```

---

## 11. Placeholder Data Conventions

Define data arrays at module scope as `const`. Use domain-appropriate names and realistic values.

**Time-series:**

```tsx
const productionData = [
  { day: 'Day 01', volume: 2.1 },
  { day: 'Day 10', volume: 3.2 },
  { day: 'Day 20', volume: 4.1 },
  { day: 'Today', volume: 4.8 },
];
```

**Monthly aggregates:**

```tsx
const harvestData = [
  { month: 'JAN', yield: 112 },
  { month: 'FEB', yield: 88 },
  { month: 'MAR', yield: 154 },
];
```

**Entity lists with embedded styles:**

```tsx
const ledger = [
  { date: 'Sep 24', hiveId: 'ALPHA-01', quantity: '32.4', grade: 'Grade A+', gradeColor: 'bg-secondary-container/30 text-secondary', dotColor: 'bg-secondary', collector: 'Marcus Thorne' },
  { date: 'Sep 22', hiveId: 'BETA-04', quantity: '28.1', grade: 'Grade A', gradeColor: 'bg-secondary-container/30 text-secondary', dotColor: 'bg-secondary', collector: 'Elara Vance' },
  { date: 'Sep 20', hiveId: 'GAMMA-02', quantity: '19.5', grade: 'Grade B', gradeColor: 'bg-tertiary-container/20 text-tertiary', dotColor: 'bg-tertiary', collector: 'Marcus Thorne' },
];
```

**Placeholder cards:**

```tsx
const placeholderHives = [
  { name: 'Hive Epsilon', status: 'Thriving' },
  { name: 'Hive Zeta', status: 'Monitoring' },
];
```

### Rules

- Include 3-5 realistic entries per table.
- Use domain-appropriate names, not "Lorem Ipsum" or "Test User".
- Embed Tailwind classes in data objects when rows have visual variants (status badges, severity colors).
- Keep status enums short and **always lowercase**: `'active'`, `'pending'`, `'success'`, `'failed'`. D1 is case-sensitive — uppercase values break filters and comparisons.
- Simplest chart data shape: `[{ label, value }]`. For categories: `[{ month, yield }]` or `[{ hour, value }]`.

## Status Badges — Cover Every `enum_values`

When a model column in the backend surface exposes `enum_values`, your
rendering code (switch/case, object map, conditional) **must cover every
value explicitly**. The `default` branch is reserved for genuinely
unexpected data — never for business labels. Forgetting a case makes the
UI silently render the wrong status for most rows.

**Wrong — seed data uses `draft | pending approval | in review | finalized`,
but the switch only handles three names and everything falls to "Draft":**

```tsx
const getStatusBadge = (status: string) => {
  const s = status?.toLowerCase();
  switch (s) {
    case "approved": return <Badge className="bg-green-500">Approved</Badge>;
    case "denied":   return <Badge className="bg-red-500">Denied</Badge>;
    case "pending":  return <Badge className="bg-amber-500">Pending</Badge>;
    default:         return <Badge className="bg-gray-200">Draft</Badge>;
  }
};
```

**Right — one branch per declared value, plus a safe fallback:**

```tsx
// Backend surface tells us: requests.status.enum_values =
//   ["draft", "pending approval", "in review", "finalized"]
const getStatusBadge = (status: string) => {
  switch (status) {
    case "draft":
      return <Badge className="bg-gray-200 text-gray-800">Draft</Badge>;
    case "pending approval":
      return <Badge className="bg-amber-100 text-amber-800">Pending Approval</Badge>;
    case "in review":
      return <Badge className="bg-blue-100 text-blue-800">In Review</Badge>;
    case "finalized":
      return <Badge className="bg-emerald-100 text-emerald-800">Finalized</Badge>;
    default:
      // Safety net only — never reached for in-schema data.
      return <Badge className="bg-neutral-100 text-neutral-500">Unknown</Badge>;
  }
};
```

Map form is fine too:

```tsx
const STATUS_STYLES: Record<string, string> = {
  draft: "bg-gray-200 text-gray-800",
  "pending approval": "bg-amber-100 text-amber-800",
  "in review": "bg-blue-100 text-blue-800",
  finalized: "bg-emerald-100 text-emerald-800",
};
```

Rules:

- Use the exact strings from `enum_values`, case-sensitive, no title-case.
- Never mutate the value before comparing (`toLowerCase()`, `trim()`) — it already matches the schema.
- The `default`/fallback branch must be neutral ("Unknown", muted gray), not a business label.
- A semantic validator check flags component code that misses declared values; fix the branches, don't silence the check.
