# UI Logic — State Configuration Guide

<!-- Schema Version: 2.1.0 | Last Updated: 2026-04-06 -->

## Overview

`frontend.logic` defines **shared reactive state** for code components. It contains only one field:

- `state`: Initial state variables that code components can read and write via SDK hooks

Code components handle all logic directly in JavaScript/TypeScript — there is no declarative action system, computed values, or expression engine. Components use SDK hooks (`useAppState`, `useModel`, `useHandler`, `useApp`, `navigate`, `toast`, `useCurrentUser`) for state, data fetching, mutations, navigation, and side effects.

**Reading and writing the `state` defined here:** `useAppState(key, initialValue?)` is the canonical hook for a single top-level state key — it reads **and writes** that one key, returning a `[value, setValue, updateValue]` tuple (like `useState` bound to a shared key). `useApp(selector)` reads from the whole state store via a selector (e.g. `useApp(s => s.count)`) and re-renders only when the selected values change; called with no selector it returns the full snapshot plus a `setState(key, value)` helper. Use `useAppState` for per-key read/write; use `useApp` for selector-based reads across the store.

---

## Logic Structure

```json
{
  "frontend": {
    "logic": {
      "state": {
        "currentStep": 0,
        "selectedItems": [],
        "isLoading": false,
        "theme": { "$persist": true, "initial": "light" }
      }
    }
  }
}
```

> **IMPORTANT:** `frontend.logic` only allows `state`. Do not add `actions`, `computed`, `onMount`, `initActions`, `listeners`, `watchers`, or `effects` — these are not supported.

---

## State Schema

State is defined as key-value pairs. Types are inferred from initial values.

### Basic State Types

```json
{
  "state": {
    "count": 0,
    "name": "",
    "isActive": false,
    "selectedId": null,
    "items": [],
    "formData": {}
  }
}
```

| Initial Value | Inferred Type |
|--------------|---------------|
| `0` | number |
| `""` | string |
| `false` | boolean |
| `null` | nullable (any) |
| `[]` | array |
| `{}` | object |

### Persistent State

State that survives page refreshes. Use **ONLY for UI preferences** (theme, sidebar collapsed, last-viewed tab).

> **Do NOT use `$persist` for user-created content** (notes, tasks, messages, products, bookings, etc.). User data must be stored in the backend database via models/handlers — never in client-side storage.

```json
{
  "state": {
    "theme": {
      "$persist": true,
      "initial": "light"
    },
    "sidebarCollapsed": {
      "$persist": true,
      "initial": false
    }
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `$persist` | boolean/string | `true` for auto-path, or custom path string |
| `initial` | any | Initial value |

---

## Validation Rules

1. `frontend.logic` must be a JSON object
2. Only `state` is allowed as a field
3. `state` must be a key-value object (not an array or primitive)
4. Persistent state entries must have `$persist` and `initial` fields
5. Do NOT add `actions`, `computed`, `onMount`, or any other fields
