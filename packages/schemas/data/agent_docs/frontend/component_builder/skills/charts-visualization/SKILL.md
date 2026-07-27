---
name: charts-visualization
description: "Charts.* namespace usage from @exepad/sdk — AreaChart / BarChart / LineChart / PieChart / RadarChart / Sparkline patterns with gradients, ResponsiveContainer wrapping, theme-token colors via CSS variables. Load for any data visualization component (charts, graphs, analytics dashboards, trend lines, KPI sparklines). Keywords: chart, graph, visualization, analytics, bar, line, pie, area, recharts, sparkline, gradient."
metadata:
  kind: domain
---
# Skill: Charts & Visualization

## Charts.* Namespace
- All chart types via `Charts.*`: `Charts.BarChart`, `Charts.LineChart`, `Charts.PieChart`, `Charts.AreaChart`, `Charts.RadarChart`
- Inner elements: `Charts.Bar`, `Charts.Line`, `Charts.Pie`, `Charts.Area`, `Charts.XAxis`, `Charts.YAxis`, `Charts.Tooltip`, `Charts.Legend`, `Charts.CartesianGrid`, `Charts.ResponsiveContainer`
- Always wrap in `<Charts.ResponsiveContainer width="100%" height={300}>`

## Data Binding
- Chart series come from backend data — a `useModel()` result you aggregate in
  the component, or a pre-shaped array returned by a `useHandler()` stats call.
  NEVER hardcode series data.
- Example: `const { data: sales } = useModel('sales');` then build the series
  with `const chartData = useMemo(() => aggregateByMonth(sales ?? []), [sales])`
  and pass `chartData` to the chart `data` prop.
- `useApp(s => s.key)` is only for genuinely shared FLAT state (e.g. a selected
  date range) — there is no computed engine, so aggregations happen in the
  component, not in a config-level computed layer.

## Implementation Patterns

### AreaChart with Gradient Fill

```tsx
import { React, Charts } from '@exepad/sdk';

const productionData = [
  { day: 'Day 01', volume: 2.1 },
  { day: 'Day 10', volume: 3.2 },
  { day: 'Day 20', volume: 4.1 },
  { day: 'Today', volume: 4.8 },
];

<div className="h-64 w-full">
  <Charts.ResponsiveContainer width="100%" height="100%">
    <Charts.AreaChart data={productionData} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
      <defs>
        <linearGradient id="areaGradient" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--color-primary)" stopOpacity={0.2} />
          {/* Lower stop never goes below 0.05 — 0 is invisible on dark surfaces. */}
          <stop offset="100%" stopColor="var(--color-primary)" stopOpacity={0.05} />
        </linearGradient>
      </defs>
      <Charts.XAxis dataKey="day" tick={{ fontSize: 10, fill: 'var(--color-on-surface-variant)', fontWeight: 700 }} tickLine={false} axisLine={false} />
      <Charts.Tooltip
        contentStyle={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-outline-variant)', borderRadius: '8px', fontSize: '12px', fontWeight: 600 }}
        formatter={(value: number) => [`${value} kg`, 'Volume']}
      />
      <Charts.Area type="monotone" dataKey="volume" stroke="var(--color-primary)" strokeWidth={2} fill="url(#areaGradient)"
        dot={{ r: 3, fill: 'var(--color-surface)', stroke: 'var(--color-primary)', strokeWidth: 1.5 }}
        activeDot={{ r: 5, fill: 'var(--color-primary)', stroke: 'var(--color-surface)', strokeWidth: 2 }} />
    </Charts.AreaChart>
  </Charts.ResponsiveContainer>
</div>
```

### BarChart — Full Panel

```tsx
const performanceData = [
  { month: 'JAN', yield: 112 },
  { month: 'FEB', yield: 88 },
  { month: 'MAR', yield: 154 },
  { month: 'APR', yield: 210 },
];

<div className="h-[320px] w-full">
  <Charts.ResponsiveContainer width="100%" height="100%">
    <Charts.BarChart data={performanceData} margin={{ top: 20, right: 10, left: -10, bottom: 5 }}>
      <Charts.XAxis dataKey="month" tick={{ fontSize: 10, fill: 'var(--color-on-surface-variant)', fontWeight: 700 }} tickLine={false} axisLine={false} />
      <Charts.YAxis tick={{ fontSize: 10, fill: 'var(--color-on-surface-variant)' }} tickLine={false} axisLine={false} tickFormatter={(value: number) => `${value}kg`} />
      <Charts.Tooltip
        contentStyle={{ backgroundColor: 'var(--color-on-surface)', border: 'none', borderRadius: '8px', fontSize: '12px', fontWeight: 600, color: 'var(--color-surface)' }}
        formatter={(value: number) => [`${value} kg`, 'Yield']}
        cursor={{ fill: 'color-mix(in srgb, var(--color-primary) 5%, transparent)' }} />
      <Charts.Bar dataKey="yield" fill="var(--color-primary)" opacity={0.25} radius={[6, 6, 0, 0]} />
    </Charts.BarChart>
  </Charts.ResponsiveContainer>
</div>
```

### BarChart with Gradient Fill

Apply `<defs>` gradients to bars the same way as area charts:

```tsx
<defs>
  <linearGradient id="barGradient" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0%" stopColor="var(--color-error)" stopOpacity={0.8} />
    <stop offset="100%" stopColor="var(--color-error)" stopOpacity={0.3} />
  </linearGradient>
</defs>
<Charts.Bar dataKey="load" fill="url(#barGradient)" radius={[6, 6, 0, 0]} />
```

### Sparkline BarChart (Inline on Cards)

Compact bar chart for trends — no axes, no tooltips:

```tsx
<div className="h-12 w-full">
  <Charts.ResponsiveContainer width="100%" height="100%">
    <Charts.BarChart data={activityData} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
      <Charts.Bar dataKey="value" fill="var(--color-secondary)" opacity={0.3} radius={[2, 2, 0, 0]} />
    </Charts.BarChart>
  </Charts.ResponsiveContainer>
</div>
```

## Chart Rules

- Wrap every chart in `<Charts.ResponsiveContainer width="100%" height="100%">` inside a fixed-height div.
- Disable grid lines: `tickLine={false} axisLine={false}` on both axes.
- Gradient IDs must be unique per page. Use descriptive names: `honeyGradient`, `miteGradient`.
- Standard tick styling: `{ fontSize: 10, fill: 'var(--color-on-surface-variant)', fontWeight: 700 }`.
- Standard margin: `{{ top: 5, right: 10, left: -10, bottom: 0 }}`.

### Percent vs fraction units

Stats handlers should return rate-shaped fields as 0..1 fractions (the
canonical shape — easier to reason about, never ambiguous):

```ts
return { trendData: [{ date: '2026-05-01', rate: 0.94 }, ...] };
```

The chart's Y-axis MUST scale by 100 to render as a percentage:

```tsx
<Charts.YAxis
  tick={{ fontSize: 10, fill: 'var(--color-on-surface-variant)' }}
  tickLine={false}
  axisLine={false}
  tickFormatter={(val: number) => `${(val * 100).toFixed(0)}%`}
/>
<Charts.Area dataKey="rate" stroke="var(--color-primary)" />
```

**Wrong — appends `%` to a 0..1 fraction (the validator's
`component.charts.fraction_percent_mismatch` rule flags this):**

```tsx
<Charts.YAxis tickFormatter={(val) => `${val}%`} />
<Charts.Area dataKey="rate" />
{/* Renders 0.94 as "0.94%" — should be "94%" */}
```

If your handler genuinely returns a percent already (e.g.
`{ rate: 94.2 }` — a 0..100 value), document that and skip the `*100`
in the formatter. But the canonical platform convention is fractions.

## Color via CSS Variables
- Use design system CSS variables for chart colors: `var(--color-primary)`, `var(--color-secondary)`
- Do NOT use raw hex colors — they break when the user changes the theme

## Anti-Patterns
- NEVER import from 'recharts' — use `Charts.*` from `@exepad/sdk`
- NEVER hardcode chart data arrays (e.g., `[{name: 'Jan', value: 400}]`)
- NEVER use fixed pixel heights without ResponsiveContainer
- NEVER use `stopOpacity={0}` on a gradient lower stop. The lower bound MUST be ≥ `0.05`. On dark backgrounds (`bg-inverse-surface`, dark hero sections) a fully transparent stop renders the entire gradient invisible — the chart looks empty.
- For hero / above-the-fold charts: ALWAYS include at least one `<Charts.XAxis>` with `tick` configured. `<Charts.Tooltip>` alone is not enough — tooltips only appear on hover and the chart reads as decorative until then.


## Canonical implementations (load on demand)
- `load_skill_resource(skill_name='charts-visualization', file_path='assets/example_1.tsx')` — truncated source from the `line-area-analytics-4` reference block.

Read these only when the building plan calls for a layout / wiring pattern that closely matches one of the reference blocks. Don't load all examples up front.
