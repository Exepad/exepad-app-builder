# State Usage Guide — Component Usage

> How to read and write shared state in code components via SDK hooks.

## Overview

`logic_surface.state.items` lists the app's shared state variables (name, initial value, type).
Use the **exact variable names** from the surface — do NOT invent state keys.

State variables are defined in `frontend.logic.state` and shared across all components.
Components access them via `useAppState`, `useArrayState`, or `useApp` from `@exepad/sdk`.

## useAppState(key, initialValue)

Best for single values. Returns a 3-element tuple:

```tsx
import { useAppState } from "@exepad/sdk";

const [count, setCount, updateCount] = useAppState("count", 0);

// Direct set:
setCount(5);

// Functional update:
updateCount(prev => prev + 1);
```

| Return | Type | Description |
|--------|------|-------------|
| `[0]` value | `T` | Current value |
| `[1]` setValue | `(value: T) => void` | Replace the value |
| `[2]` updateValue | `(fn: (prev: T) => T) => void` | Functional updater |

## useArrayState(key, initialValue)

Best for arrays. Returns an object with array helpers:

```tsx
import { useArrayState } from "@exepad/sdk";

const { items, push, remove, updateItem, clear, set } = useArrayState("cartItems", []);

// Add item:
push({ id: 1, name: "Widget", price: 9.99 });

// Remove by index:
remove(0);

// Remove by predicate:
remove((item) => item.id === 1);

// Update by index:
updateItem(0, { price: 12.99 });

// Update by predicate:
updateItem((item) => item.id === 1, { price: 12.99 });

// Replace entire array:
set([]);
clear();
```

| Field | Type | Description |
|-------|------|-------------|
| `items` | `T[]` | Current array |
| `push` | `(item: T) => void` | Append item |
| `remove` | `(predicate \| index) => void` | Remove by predicate or index |
| `updateItem` | `(predicate \| index, partial) => void` | Update matching items |
| `clear` | `() => void` | Empty the array |
| `set` | `(items: T[]) => void` | Replace entire array |

## useApp(selector?)

Lower-level hook. Use `useAppState` or `useArrayState` when possible.

```tsx
import { useApp } from "@exepad/sdk";

// Flat selector — re-renders ONLY when this value changes (recommended):
const theme = useApp(s => s.theme);

// Full state + setState — re-renders on ANY state change (use sparingly):
const { count, selectedId, setState } = useApp();
setState("count", 5);
```

**CRITICAL:** NEVER return an object literal from the selector — causes infinite re-render:

```tsx
// WRONG — new object every render → infinite loop:
const { a, b } = useApp(s => ({ a: s.a, b: s.b }));

// CORRECT — select one value per hook call:
const a = useApp(s => s.a);
const b = useApp(s => s.b);
```

## Derived Values

Compute derived values inline in the component — there is no declarative computed system:

```tsx
const { items: cartItems } = useArrayState("cartItems");

const cartTotal = cartItems.reduce((sum, item) => sum + item.price, 0);
const hasItems = cartItems.length > 0;
const itemCount = cartItems.length;
```

## Persistent State ($persist)

State variables with `$persist: true` survive page refreshes via localStorage.
From the component's perspective, they work identically to regular state:

```tsx
// theme was defined as { "$persist": true, "initial": "light" }
const [theme, setTheme] = useAppState("theme", "light");
// Value persists across page reloads automatically
```

Only UI preferences should use `$persist` (theme, sidebar collapsed, last-viewed tab).
User-created content must be stored in the backend via `useModel`.

## Rules

1. **Use exact variable names** from `logic_surface.state.items` — do NOT invent keys
2. **Prefer `useAppState`/`useArrayState`** over `useApp` for clarity and performance
3. **Never return object literals** from `useApp` selectors
4. **Derive values inline** — do NOT store computed results in state
5. **Component-local state** (modal open/close, form input, search query) should use
   `React.useState` — NOT shared state. Only cross-component state belongs in `frontend.logic`
