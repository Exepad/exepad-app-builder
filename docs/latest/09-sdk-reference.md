# SDK Reference

The Exepad SDK (`packages/exepad-sdk/`) is a browser-side library that enables custom code components to interact with the Exepad runtime. It is built with Vite and outputs to `apps/runtime/client/public/runtime_assets/dist/`.

**Source:** `packages/exepad-sdk/src/index.ts`

---

## Overview

The SDK provides:
1. **Re-exported libraries** — React, date-fns, lodash, Zod, Recharts, framer-motion, lucide-react, react-hook-form
2. **~53 shadcn/ui components** — Pre-styled UI primitives (Radix-based)
3. **Motion kit** — `FadeIn`, `SlideUp`, `Reveal`, `StaggerGrid`, `AnimatedCounter`, `Marquee`, `AnimatedGradient`, `AnimatePresence`
4. **Decorative backgrounds** — `NoiseBg`, `MeshGradient`, `GridPattern`, `DotPattern` (pure SVG, zero-dep)
5. **Map primitives** — `Map`, `MapLink` (OpenStreetMap iframe + marker overlay)
6. **State management hooks** — Access and modify app state from code components
7. **Platform hooks** — Backend data, navigation, theme, auth, fake-streaming
8. **File upload** — `useFileUpload`, `useFileUrl`, `buildFileUrl`, `extractAppIdFromUrl`
9. **Game / canvas-arcade primitives** — `useGameLoop`, `useKeys`, `useAudio`, `Sprite`, `Joystick`, plus `clamp` / `lerp` / `seededRandom` / `aabb` helpers
10. **Code Focus utilities** — `LightDOMContainer`, `Link`, `cn`, `escapeHtml`, `toast`, `downloadFile`, `downloadCsv`, `SDK_VERSION`

---

## Re-exported Libraries

The SDK bundles and re-exports these libraries so custom components don't need separate imports:

| Library | Export | Usage |
|---------|--------|-------|
| React | `React`, `ReactDOM` | Core rendering |
| date-fns | `format` | Date formatting |
| lodash-es | `_` (namespace) | Utility functions |
| Zod | `z` | Runtime validation |
| react-hook-form | `useForm`, `Controller` | Form management |
| Recharts | `Charts` (namespace) | Data visualization |
| lucide-react | `Icons` (namespace) | Icon library (1000+ icons) |
| framer-motion | `motion` | Animations |

---

## UI Components

~53 shadcn/ui primitives are available via the SDK:

**Form Controls:** Button, Input, Textarea, Select, Checkbox, Label, RadioGroup, Switch, Slider, InputOTP, InputGroup, Form, Field

**Layout:** Card, Badge, Separator, ScrollArea, Accordion, AspectRatio, Resizable, Collapsible, Tabs

**Display:** Alert, Progress, Skeleton, Spinner, Avatar, Empty, Item, Table, Calendar, Carousel, Chart, ExepadImage

**Overlays:** Dialog, AlertDialog, Sheet, Drawer, Popover, HoverCard, Tooltip

**Menus & Navigation:** DropdownMenu, ContextMenu, Menubar, NavigationMenu, Breadcrumb, Pagination, Command, ButtonGroup, Toggle, ToggleGroup, Kbd

**Sidebar:** Sidebar (with SidebarContent, SidebarMenu, SidebarProvider, etc.)

**Notifications:** Toaster

---

## State Management Hooks

These hooks connect custom components to the Exepad state system.

### useAppState

Access and modify a single state value.

```typescript
const [value, setValue, updateValue] = useAppState<T>(key: string, initialValue?: T);

// Example
const [count, setCount] = useAppState('count', 0);
setCount(5);
```

### useArrayState

Manage array state with convenience methods.

```typescript
const { items, push, remove, updateItem, clear, set } = useArrayState<T>(key: string, initialValue?: T[]);

// Example
const { items, push, remove } = useArrayState('tasks', []);
push({ id: 1, title: 'New task' });
remove(item => item.id === 1);
```

---

## Platform Hooks

### useModel

Fetch data from a backend model with CRUD operations.

```typescript
const { data, loading, error, refetch, create, update, remove } = useModel('contacts', {
  filters: { status: 'active' },
  orderBy: { createdAt: 'desc' },
  limit: 20,
});
```

### useHandler

Call a backend handler and get its result.

```typescript
const { data, loading, error, execute, refetch } = useHandler('getStats');
const result = await execute({ startDate: '2024-01-01' });
```

### useNavigation / navigate

Navigate between pages programmatically.

```typescript
const { navigate, currentPath, basePath } = useNavigation();
navigate('/about');

// Or standalone function:
import { navigate } from '@exepad/sdk';
navigate('/dashboard');
```

### useTheme

Access the app theme tokens.

```typescript
const { colors, typography, borderRadius, mode } = useTheme();
```

### useCurrentUser

Access the current authenticated user.

```typescript
const { id, email, roles, isAuthenticated } = useCurrentUser();
```

### useCount

Lightweight model row-count helper that uses `sys_aggregate` under the hood.

```typescript
const { count, loading, error, refetch } = useCount('orders', { status: 'open' });
```

### useFakeStream

Drives a token-by-token UI without a backend SSE channel — useful for demoing chat/AI flows. Configure rate, jitter, abort signal, completion callback.

```typescript
const { text, isStreaming, start, stop } = useFakeStream({ text: response, charsPerTick: 4 });
```

### useBodyScrollLock

Lock body scroll while a modal/sheet is open (handles iOS quirks + scrollbar-gutter shift).

---

## Code Focus Utilities

### LightDOMContainer

Wrapper component required for all Code Focus components. Renders children in the light DOM:

```tsx
import { LightDOMContainer } from '@exepad/sdk';

export default function MyComponent() {
  return (
    <LightDOMContainer>
      <div className="p-4">Content</div>
    </LightDOMContainer>
  );
}
```

### File Upload

```typescript
import { useFileUpload, useFileUrl, buildFileUrl, extractAppIdFromUrl } from '@exepad/sdk';

const { upload, uploading, error } = useFileUpload({ maxSize: 5 * 1024 * 1024 });
const imageUrl = useFileUrl('uploads/photo.jpg');

// Resolve a stored relative key to a fetchable URL (works in preview + published)
const url = buildFileUrl(record.attachment);
```

### Game / Canvas-Arcade Primitives

A small pure-browser kit for the platform's animated/game apps — no platform state coupling.

```typescript
import {
  useGameLoop, useKeys, useAudio,
  Sprite, Joystick,
  clamp, lerp, seededRandom, aabb,
} from '@exepad/sdk';

useGameLoop((dt) => { /* tick */ });
const keys = useKeys();          // { ArrowLeft, ArrowRight, Space, ... }
const { play } = useAudio('jump');
```

### Helpers

```typescript
import { cn, toast, escapeHtml, downloadFile, downloadCsv, SDK_VERSION } from '@exepad/sdk';

// Merge class names (clsx + tailwind-merge)
const classes = cn('p-4', isActive && 'bg-primary');

// Show notifications
toast.success('Saved!');
toast.error('Failed');
toast('Info message');

// Sanitize HTML for safe inline rendering
const safe = escapeHtml(userInput);

// Trigger a browser download
downloadFile(blob, 'report.pdf');
downloadCsv(rows, 'orders.csv');
```

---

## Building the SDK

```bash
pnpm build:sdk    # Vite build → runtime/client/public/runtime_assets/dist/
```

The SDK is bundled as a single ESM module that code components can import.

---

## Related Documents

- [State & Actions](05-state-and-actions.md) — State management concepts
- [Component Catalog](04-component-catalog.md) — Available component types
- [Development Guide](12-development-guide.md) — Build commands
