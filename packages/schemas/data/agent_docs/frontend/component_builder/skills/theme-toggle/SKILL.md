---
name: theme-toggle
description: "Dark / light mode toggle button using localStorage + html.dark class. Canonical recipe — do NOT invent your own persistence or class-management. Load when the building plan asks for a theme / dark-mode / appearance toggle. Keywords: theme-toggle, dark-mode, light-mode, dark-light, color-scheme, theme-switcher, appearance, night-mode."
metadata:
  kind: domain
---
# Skill: Theme Toggle

When `building_plan` asks for a dark-mode / light-mode / theme toggle
button, follow this exact pattern. Do NOT invent your own persistence or
class-management scheme.

## Canonical recipe

```tsx
import { React, Icons, Button } from "@exepad/sdk";

// Read the initial mode: persisted choice wins, else the OS preference.
function getInitialMode(): "light" | "dark" {
  try {
    const stored = localStorage.getItem("theme");
    if (stored === "light" || stored === "dark") return stored;
  } catch {
    // localStorage can throw in privacy mode — fall through to system.
  }
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function ThemeToggle() {
  const [mode, setMode] = React.useState<"light" | "dark">(getInitialMode);

  // Apply / remove the `dark` class on <html> whenever `mode` changes,
  // and persist the choice to localStorage.
  React.useEffect(() => {
    const html = document.documentElement;
    if (mode === "dark") {
      html.classList.add("dark");
    } else {
      html.classList.remove("dark");
    }
    try {
      localStorage.setItem("theme", mode);
    } catch {
      // Persistence unavailable (privacy mode) — the class toggle still
      // drives the theme for this session.
    }
  }, [mode]);

  const toggle = () => {
    setMode((m) => (m === "light" ? "dark" : "light"));
  };

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={toggle}
      aria-label="Toggle theme"
    >
      {mode === "light" ? <Icons.Moon className="h-4 w-4" /> : <Icons.Sun className="h-4 w-4" />}
    </Button>
  );
}
```

## Rules

1. **Local state is the source of truth, `localStorage` persists it.**
   Drive the class toggle from `React.useState`. Initialize it from the
   persisted `"theme"` key (falling back to the OS `prefers-color-scheme`
   preference), and write the new value back to `localStorage` in the
   same `useEffect` that toggles the class. This makes the toggle survive
   page reloads for every app, with no auth requirement. Never build your
   own React context for this — `localStorage` plus the `html.dark` class
   is all you need.

2. **The only side-effect is `html.classList`.** Toggle `html.dark` in a
   `useEffect` that depends on `mode`. Nothing else — do not mutate
   `data-theme`, do not swap class names on the root `<div>`, do not
   touch inline styles.

3. **theme.css MUST have the matching `html.dark { ... }` block.** This
   toggle relies on `theme.css` redefining every `@theme` color token
   under a `html.dark { ... }` selector. If that block is missing, the
   toggle will be cosmetic (the icon swaps but nothing else changes).
   The DesignSystemBuilder is responsible for emitting the block — if
   your building_plan mentions a toggle but theme.css has no `html.dark`
   block, flag this as a blocker rather than shipping a no-op toggle.

4. **Do NOT use Tailwind's `dark:` prefix in components.** Code Focus
   does not emit `dark:` variants during Tailwind compilation. The only
   supported mechanism is token redefinition under `html.dark`. Content
   components MUST consume M3 token classes (`bg-surface`,
   `text-on-surface`, `bg-background`, `border-outline`, ...) so they
   flip automatically when tokens change.

5. **Default to the system preference.** When there is no persisted
   `"theme"` value, initialize from `prefers-color-scheme` (see
   `getInitialMode` above) so first-time visitors get the mode their OS
   already asked for. If the app's brand is inherently dark (dark sidebar
   in both modes), the `html.dark` override — not the component default —
   still controls the main surface colors.

6. **Placement.** The toggle typically lives in the sidebar header (top
   of a sidebar, above the nav list) or in the top-right of a desktop
   header. Match the existing component role — do NOT create a new
   floating component for the toggle.

7. **Icons.** Use `Icons.Moon` when in light mode (clicking it switches
   to dark) and `Icons.Sun` when in dark mode (clicking switches to
   light). This is the standard convention — the icon shows the
   destination, not the current state.

## Anti-patterns

- Manually calling `document.documentElement.style.setProperty('--color-surface', ...)` — the whole point of theme.css is to own these tokens.
- Writing a custom `ThemeProvider` with a React context — `localStorage` already handles persistence, and the `html.dark` class reaches every component without any context plumbing.
- Reading `localStorage` directly inside the effect or on every render instead of seeding `React.useState` once via the lazy initializer — local state must own the current mode so toggling re-runs the class/persist effect.
- Using `useEffect(() => { ... }, [])` (empty deps) to set the class once — the effect must depend on `mode` so toggling actually re-runs it.
- Conditionally rendering the whole app shell based on `mode` — the tokens change, not the markup.
