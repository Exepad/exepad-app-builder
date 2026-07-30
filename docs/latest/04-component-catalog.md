# Component Catalog

Exepad uses a **Code Focus** architecture where the AI builder agent generates TSX code components for each page. Components render in the light DOM with compiled Tailwind CSS scoped via `@layer exepad-app`.

**Component registry:** `apps/runtime/client/src/registry/index.ts`
**Code component runtime:** `apps/runtime/client/src/app_runtime/runtime/components/custom/code/`
**SDK primitives:** `packages/exepad-sdk/src/` (~53 shadcn/ui components available for import)

---

## Registered Component Types

The runtime registry contains a single component type:

| componentType | Description |
|---------------|-------------|
| `CodeComponentProps` | AI-generated TSX component — the primary UI building block. Each instance references a compiled TSX module that the runtime loads and renders. |

---

## Code Focus Components

Code Focus is the primary way UIs are built on Exepad. The AI builder agent generates TSX components that:

- Import from `@exepad/sdk` (React, UI primitives, hooks, utilities)
- Render inside a `LightDOMContainer` wrapper
- Use compiled Tailwind CSS scoped via `@layer exepad-app`
- Access shared state via `useAppState`, `useArrayState`, `useApp`
- Fetch backend data via `useModel` and `useHandler`
- Navigate via `navigate()` and show notifications via `toast`

### Component Configuration

Each Code Focus component is defined in the page config as:

```json
{
  "componentType": "CodeComponentProps",
  "name": "ContactList",
  "modulePath": "/components/ContactList.tsx"
}
```

The runtime loads the compiled TSX module from the deploy artifacts and renders it within the page layout.

### Validation Pipeline

Before deployment, every generated component passes through a 4-stage validation pipeline. Stages 1–3 run inline at component save; stage 4 runs once at the end of the workflow:

1. **Syntax** (esbuild) — validates TSX/JS syntax
2. **Semantic** (AST rule engine + residual regex + deterministic auto-fixers) — SDK imports, forbidden APIs, backend references, hooks, JSX shape, a11y, null safety
3. **Style Coverage** (per-component) — does each `className` resolve to a theme token or a built-in Tailwind utility?
4. **Final Tailwind compile gate** (cross-component) — a single `tailwindcss` invocation over `theme.css` plus every component, with deterministic CSS-recovery fixers. No LLM, no retries.

The rule and auto-fixer catalog is `apps/agent/docs/validation/rules.md`.

### Constraints

Code Focus components must follow these rules:

- Import only from `@exepad/sdk` — no npm packages
- Use Tailwind CSS classes only — no CSS-in-JS or inline `<style>` tags
- Wrap content in `LightDOMContainer`
- Navigation links must match pages defined in the app config
- No `addEventListener` — use React synthetic events or a ref + `useEffect`. Only `keydown`/`keyup`/`keypress`/`scroll`/`resize` on `window`/`document` are whitelisted (string-literal event name)
- No `localStorage`/`sessionStorage` — persistent values go through platform state (`$persist`)

---

## SDK UI Primitives

The SDK (`@exepad/sdk`) exports ~53 shadcn/ui components that Code Focus components can import:

**Form Controls:** Button, Input, Textarea, Select, Checkbox, Label, RadioGroup, Switch, Slider, InputOTP, InputGroup, Form, Field

**Layout:** Card, Badge, Separator, ScrollArea, Accordion, AspectRatio, Resizable, Collapsible, Tabs

**Display:** Alert, Progress, Skeleton, Spinner, Avatar, Empty, Item, Table, Calendar, Carousel, Chart, ExepadImage

**Overlays:** Dialog, AlertDialog, Sheet, Drawer, Popover, HoverCard, Tooltip

**Menus & Navigation:** DropdownMenu, ContextMenu, Menubar, NavigationMenu, Breadcrumb, Pagination, Command, ButtonGroup, Toggle, ToggleGroup, Kbd

**Sidebar:** Sidebar (with full sub-components: SidebarContent, SidebarMenu, etc.)

**Notifications:** Toaster

See [SDK Reference](09-sdk-reference.md) for the full export list with usage examples.

---

## Authentication Pages

When `security.authProviders` is configured and no explicit auth pages exist, the agent generates login / signup / forgot-password / reset-password / profile pages as ordinary Code Focus TSX components — there is no longer a runtime AuthScaffold expander.

The components themselves use SDK platform hooks (`useCurrentUser`, `useHandler`) to call the per-app auth router on the app-backend. Pattern exemplars for these flows live under `apps/runtime/client/public/example/examples_for_agents/` (`auth-centered`, `auth-split`, `auth-fullscreen`) and are pulled in by `SkillSelector` at generation time.

---

## Related Documents

- [SDK Reference](09-sdk-reference.md) — Full SDK export list and hook APIs
- [Configuration Reference](07-configuration-reference.md) — ComponentProps schema
- [State Management](05-state-and-actions.md) — How components bind to state
- [Styling & Theming](08-styling-and-theming.md) — Theme system and CSS scoping
