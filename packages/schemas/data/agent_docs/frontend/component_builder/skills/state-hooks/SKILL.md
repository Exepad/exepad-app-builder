---
name: state-hooks
description: "Picking the right state hook — useState (component-local) vs useAppState (shared, declared in frontend.logic.state). Load when you're about to declare a piece of state inside a component and aren't sure which hook to reach for. Keywords: useState, useAppState, state, hook, sharing, local, persistence, $persist."
metadata:
  kind: domain
---
# Skill: Picking the right state hook

Two state APIs cover every component-side variable. Picking the wrong one
either over-couples unrelated components or under-shares state that two
components both need.

## Decision rule

| Hook | When |
|---|---|
| `React.useState(initial)` | The variable is read AND written ONLY by this component. Wizard step indices for a single-page wizard, modal open/close, hover state, search filter inputs, ephemeral toasts. |
| `useAppState(key, initial)` from `@exepad/sdk` | Two or more components touch this variable, OR you need it to survive route changes / reloads (`'key$persist'`). Selected-project-id read on the detail page after being set on the list page. Notification count rendered in both the header badge and the dashboard widget. |

## Decision tree

1. Will any OTHER component read or write this variable? If no → `useState`. Stop.
2. Does it need to persist across hard refresh (resume a draft, remember a theme)? → `useAppState` with a `$persist` suffix in the key.
3. Otherwise → `useAppState` with a plain key.

## Examples

```tsx
// ✅ Component-local — only QuoteCalculator reads this.
function QuoteCalculator() {
  const [step, setStep] = React.useState(1);
  const [items, setItems] = React.useState<Record<string, number>>({});
  // ...
}

// ✅ Shared across two pages — list → detail.
function ProjectList() {
  const [_, setSelected] = useAppState<string | null>("selectedProjectId", null);
  return <Card onClick={() => setSelected(p.id)}>...</Card>;
}
function ProjectDetail() {
  const [selected] = useAppState<string | null>("selectedProjectId", null);
  // read the same value the list set
}

// ✅ Persisted preference — survives reload.
function ThemeToggle() {
  const [theme, setTheme] = useAppState<'light' | 'dark'>("theme$persist", "light");
}
```

## Anti-pattern

```tsx
// ❌ useAppState for a single-component multi-step form. Pollutes the
// shared store and confuses future readers who scan `useAppState` calls
// to discover the app's shared variables.
function QuoteCalculator() {
  const [step, setStep] = useAppState("quoteStep", 1);  // → use useState
  const [price, setPrice] = useAppState("estimatedPrice", 0);  // → use useState
}
```

## State declaration in `frontend.logic.state`

`useAppState(key, initial)` works at runtime with the inline default even
when `key` is not declared in `frontend.logic.state` — the platform falls
back to the default. But declaring shared keys in the config is still the
documented pattern; LogicBuilder picks up `state_variables` from the
Creator plan and emits the declarations for you. If you find yourself
using `useAppState` for a key that NO Creator-side state plan ever
mentioned, that's a smell — the variable is probably component-local
and should be `useState`.
