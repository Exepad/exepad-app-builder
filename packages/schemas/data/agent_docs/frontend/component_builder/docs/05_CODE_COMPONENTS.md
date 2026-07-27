# Code Components — SDK Reference

> Auto-generated from `packages/exepad-sdk/src/index.ts`. Do not edit manually.

## Import Rules

1. **All imports MUST come from `@exepad/sdk`** — no npm packages, no relative imports. (Narrow exception: a 3D/WebGL game component may also import `@exepad/ext-three` / `@exepad/ext-pixi` — see the `game-3d` skill. No other package, and no Three.js subpaths/addons.)
2. **Use `export default`** for the main component/handler/method.
3. **Namespaces**: `Charts.BarChart`, `Icons.Check`, `Motion.div` — do NOT destructure.
4. **Flat exports**: `Button`, `Card`, `useApp` — import directly.

## Component Template

```tsx
import { React, Button, Card, CardContent, Icons } from "@exepad/sdk";

function MyComponent() {
  return (
    <Card>
      <CardContent>
        <Button><Icons.Check className="mr-2 h-4 w-4" /> Click me</Button>
      </CardContent>
    </Card>
  );
}

export default MyComponent;
```

## Available Exports

### Core

```
React, ReactDOM
```

### Utilities

```
format, _, z, useForm, Controller
```

### Visuals

```
Charts, Icons, motion, Motion
```

### UI: Form Controls

```
Button, buttonVariants, Input, Textarea, Select, SelectGroup, SelectValue, SelectTrigger, SelectContent, SelectLabel, SelectItem, SelectSeparator, SelectScrollUpButton, SelectScrollDownButton, Checkbox, Label, RadioGroup, RadioGroupItem, Switch, Slider, InputOTP, InputOTPGroup, InputOTPSlot, InputOTPSeparator, InputGroup, InputGroupAddon, InputGroupButton, InputGroupText, InputGroupInput, InputGroupTextarea, Form, FormItem, FormLabel, FormControl, FormDescription, FormMessage, FormField, useFormField, Field, FieldLabel, FieldDescription, FieldError, FieldGroup, FieldLegend, FieldSeparator, FieldSet, FieldContent, FieldTitle
```

### UI: Layout

```
Card, CardHeader, CardFooter, CardTitle, CardDescription, CardContent, Badge, badgeVariants, Separator, ScrollArea, ScrollBar, Accordion, AccordionItem, AccordionTrigger, AccordionContent, AspectRatio, ResizablePanelGroup, ResizablePanel, ResizableHandle, Collapsible, CollapsibleTrigger, CollapsibleContent, Tabs, TabsList, TabsTrigger, TabsContent
```

### UI: Display

```
Alert, AlertTitle, AlertDescription, Progress, Skeleton, Spinner, Avatar, AvatarImage, AvatarFallback, Empty, EmptyHeader, EmptyTitle, EmptyDescription, EmptyContent, EmptyMedia, Item, ItemMedia, ItemContent, ItemActions, ItemGroup, ItemSeparator, ItemTitle, ItemDescription, ItemHeader, ItemFooter, ExepadImage
```

#### ExepadImage

Structured image component — use instead of raw `<img>` tags. The platform resolves stock photos automatically using the props.

**Importance** drives loading priority (higher = eager, better LCP), not provider choice — all providers are free (Pexels / Pixabay / Unsplash, with keyless Openverse as a fallback).

```tsx
// Static image
<ExepadImage keywords="modern office lobby with natural light and glass walls" width={1920} height={1080} importance={8} className="w-full h-64 object-cover" />

// Array / .map() — each item MUST have unique keywords
const team = [
  { name: "Alice", role: "CEO", image: { keywords: "professional portrait female CEO modern office", importance: 7 } },
  { name: "Bob", role: "CTO", image: { keywords: "professional portrait male CTO bright workspace", importance: 7 } },
];
{team.map((m) => <ExepadImage {...m.image} width={200} height={200} className="w-32 h-32 rounded-full" />)}
```

Props set by LLM: `keywords` (required, 5+ words), `importance` (required, 1-10), `width`/`height` (optional px), `fit` (optional, default "cover"), `className`.
Props injected by resolver (do NOT set): `src`, `vendor`, `assetId`.

### UI: Overlays

```
Dialog, DialogPortal, DialogOverlay, DialogTrigger, DialogClose, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription, AlertDialog, AlertDialogPortal, AlertDialogOverlay, AlertDialogTrigger, AlertDialogContent, AlertDialogHeader, AlertDialogFooter, AlertDialogTitle, AlertDialogDescription, AlertDialogAction, AlertDialogCancel, Sheet, SheetPortal, SheetOverlay, SheetTrigger, SheetClose, SheetContent, SheetHeader, SheetFooter, SheetTitle, SheetDescription, Drawer, DrawerPortal, DrawerOverlay, DrawerTrigger, DrawerClose, DrawerContent, DrawerHeader, DrawerFooter, DrawerTitle, DrawerDescription, Popover, PopoverTrigger, PopoverContent, PopoverAnchor, HoverCard, HoverCardTrigger, HoverCardContent, Tooltip, TooltipTrigger, TooltipContent, TooltipProvider
```

### UI: Menus & Navigation

```
DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuCheckboxItem, DropdownMenuRadioItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuShortcut, DropdownMenuGroup, DropdownMenuPortal, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuRadioGroup, ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem, ContextMenuCheckboxItem, ContextMenuRadioItem, ContextMenuLabel, ContextMenuSeparator, ContextMenuShortcut, ContextMenuGroup, ContextMenuPortal, ContextMenuSub, ContextMenuSubContent, ContextMenuSubTrigger, ContextMenuRadioGroup, Menubar, MenubarMenu, MenubarTrigger, MenubarContent, MenubarItem, MenubarSeparator, MenubarLabel, MenubarCheckboxItem, MenubarRadioGroup, MenubarRadioItem, MenubarPortal, MenubarSubContent, MenubarSubTrigger, MenubarGroup, MenubarSub, MenubarShortcut, NavigationMenu, NavigationMenuList, NavigationMenuItem, NavigationMenuContent, NavigationMenuTrigger, NavigationMenuLink, NavigationMenuIndicator, NavigationMenuViewport, navigationMenuTriggerStyle, Breadcrumb, BreadcrumbList, BreadcrumbItem, BreadcrumbLink, BreadcrumbPage, BreadcrumbSeparator, BreadcrumbEllipsis, Pagination, PaginationContent, PaginationLink, PaginationItem, PaginationPrevious, PaginationNext, PaginationEllipsis, Command, CommandDialog, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem, CommandShortcut, CommandSeparator, ButtonGroup, ButtonGroupSeparator, ButtonGroupText, buttonGroupVariants, Toggle, toggleVariants, ToggleGroup, ToggleGroupItem, Kbd, KbdGroup
```

### UI: Data Display

```
Table, TableHeader, TableBody, TableFooter, TableHead, TableRow, TableCell, TableCaption, Calendar, CalendarDayButton, CarouselApi, Carousel, CarouselContent, CarouselItem, CarouselPrevious, CarouselNext, ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent, ChartLegend, ChartLegendContent
```

### UI: Sidebar

```
Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupAction, SidebarGroupContent, SidebarGroupLabel, SidebarHeader, SidebarInput, SidebarInset, SidebarMenu, SidebarMenuAction, SidebarMenuBadge, SidebarMenuButton, SidebarMenuItem, SidebarMenuSkeleton, SidebarMenuSub, SidebarMenuSubButton, SidebarMenuSubItem, SidebarProvider, SidebarRail, SidebarSeparator, SidebarTrigger, useSidebar
```

### UI: Notifications

```
Toaster
```

### State Management

```
useApp, useAppState, useArrayState
```

### File Upload

```
useFileUpload, useFileUrl, extractAppIdFromUrl, buildFileUrl, UseFileUploadOptions, FileUploadResult, UseFileUploadReturn
```

### Platform

```
useModel, useHandler, useNavigation, navigate, useTheme, useCurrentUser, UseModelOptions, UseModelReturn, UseHandlerOptions, UseHandlerReturn, NavigationAPI, ThemeTokens, CurrentUser, ExepadPlatformAPI
```

### Light DOM & State

```
LightDOMContainer, useApp, AppState
```

> **Validation:** Components are automatically validated by a 4-stage pipeline
> (syntax, semantic, CSS compilation, style coverage) after generation. Common issues like
> wrong imports, forbidden APIs, and backend ref typos are auto-fixed.

### Helpers

```
cn, toast, escapeHtml, SDK_VERSION
```

## Namespaces

### _

(lodash-es — full lodash library available as namespace)

### Charts

Key members: AreaChart, BarChart, LineChart, PieChart, RadarChart, RadialBarChart, ComposedChart, ScatterChart, Treemap, Funnel, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Area, Bar, Line, Pie, Cell, Radar, RadialBar

Charts data binding rules are in the handler and model guides within `backend_surface`.
Always wrap charts in `<Charts.ResponsiveContainer width="100%" height="100%">` inside a div with explicit height (e.g. `h-80`).

### Icons

(5700+ icons — use any lucide-react icon name, e.g., Icons.Check, Icons.ArrowRight)

### Motion

Key members: div, span, button, ul, li, nav, section, header, footer, main, article, aside, p, h1, h2, h3, img, a, form, input, svg, path

## Platform Hooks

### useModel / useHandler / useFileUpload / useCurrentUser

Full API reference for all backend hooks is in the `guide` field of each
`backend_surface` section (models, handlers, storage, security).

### useNavigation()
Navigate between pages and detect the active page. **Reactive** — the component
re-renders automatically when the route changes (essential for active nav styling).
```tsx
const { navigate, currentPath, currentSlug, basePath } = useNavigation();
// currentSlug: page slug without basePath, e.g. "/about", "/"
// Use currentSlug for active state: currentSlug === '/about'
navigate("/about");
```

**Type-safe nav lists.** `navigate()` is constrained to declared `AppRoute`
literals — passing a `string` variable fails tsc. When you build a nav
array (sidebar / header), use `as const` so each `path` keeps its literal
type instead of widening to `string`:
```tsx
const NAV_ITEMS = [
  { label: "Dashboard", path: "/" },
  { label: "Members", path: "/members" },
  { label: "Settings", path: "/settings" },
] as const;

NAV_ITEMS.map(item => (
  <Button key={item.path} onClick={() => navigate(item.path)}>
    {item.label}
  </Button>
));
```
Without `as const`, TypeScript infers `path: string` and `navigate(item.path)`
errors with TS2345. The homepage route is always `"/"` — never `"/#dashboard"`
or `"/dashboard"` — every dataapp gets a content component pinned to `/`.

**Coerce row IDs to strings at SDK boundaries.** `useModel` returns numeric
primary keys (`id`, `*_id` are `number` per the platform's
`INTEGER PRIMARY KEY AUTOINCREMENT` schema). Anywhere the SDK or the DOM
expects a `string` — `navigate()`, `<Select value={...}>`, URL templates,
chart `labels[]`, `key={...}` props — wrap with `String(...)`. Otherwise
tsc fails with TS2345 "number is not assignable to string", the build
ships the error as a warning, and dropdown selections / route params
silently mismatch at runtime.
```tsx
// Wrong — TS2345
navigate(`/pets/${row.pet_id}`);                   // row.pet_id is number
<Select value={row.status_id}>...                  // value: string
labels: rows.map(r => r.id),                       // chart labels: string[]

// Right
navigate(`/pets/${String(row.pet_id)}`);
<Select value={String(row.status_id)}>...
labels: rows.map(r => String(r.id)),
```
The `<Cell>{row.amount}</Cell>` form is fine — JSX children accept
`string | number | ReactNode`. Only coerce when the consumer's type is
literally `string`.

### useTheme()
Access the app theme tokens (colors, typography, borderRadius).
```tsx
const { colors, typography, borderRadius, mode } = useTheme();
```

## State Management

For shared state patterns (`useAppState`, `useArrayState`, `useApp`), see the
guide in `logic_surface.state.guide`. For backend operations, see the guides
in `backend_surface`.

## Helpers

- `cn(...classes)` — Tailwind class merging utility. **Do NOT use cn() in components** — host tailwind-merge strips custom classes. Use plain className strings instead.
- `toast(message, opts?)` — Show toast notifications (from sonner)
- `escapeHtml(str)` — Sanitize strings for safe injection into templates
- `navigate(path, opts?)` — Standalone navigation function (non-hook)

## Accessibility Rules (MANDATORY)

Lighthouse audits every generated app. These rules prevent the most common
accessibility regressions. The semantic validator enforces them at build time.

### Heading hierarchy
Headings must descend sequentially within a page — `h1` → `h2` → `h3` — never
skip levels, and never start at `h3` with no `h2` above it. Each page has
exactly one `h1` (the main title). Use `h2` for section titles, `h3` for
subsections, and so on.

```tsx
// ❌ BAD: skipping from h1 to h3
<h1>Meet Our Walkers</h1>
<h3>Sarah J.</h3>  // should be h2

// ✅ GOOD: sequential descent
<h1>Meet Our Walkers</h1>
<h2>Sarah J.</h2>
<h3>Credentials</h3>
```

Don't use heading tags for visual size — they carry meaning for screen readers.
Use `className="text-2xl font-bold"` on a `<div>` or `<p>` if you just want
big text without changing the outline.

### Icon-only buttons need `aria-label`
Any `<button>` or `<Button>` whose children are an icon (no visible text) MUST
have an `aria-label` describing what it does. Screen readers announce
"button" with no name otherwise, and Lighthouse flags it.

```tsx
// ❌ BAD: icon button with no accessible name
<Button onClick={handleSubmit}>
  <Icons.Send className="h-4 w-4" />
</Button>

// ✅ GOOD: aria-label describes the action
<Button onClick={handleSubmit} aria-label="Subscribe to newsletter">
  <Icons.Send className="h-4 w-4" />
</Button>
```

This applies to: send buttons, close buttons (X), menu toggles, navigation
arrows, social-icon links, and any round "circle" buttons.

### Image alt text
- `<ExepadImage>` receives its alt from the `keywords` prop automatically — no
  extra action needed.
- Raw `<img>` tags MUST have `alt="..."`. Decorative images should use
  `alt=""` (empty string, not missing).
- Every `<img>` MUST also have explicit `width` and `height` attributes to
  prevent layout shift (see [11_IMAGES.md](./11_IMAGES.md)).

### Inline SVG: use direct JSX, NEVER `dangerouslySetInnerHTML`

When you need an inline SVG icon or sprite, write it as direct JSX with
**camelCase** React attributes:

```tsx
// ✅ GOOD: direct JSX, camelCase attrs, props interpolate cleanly
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
  <circle cx="12" cy="12" r={radius} />
  <text textAnchor="middle">{label}</text>
</svg>

// ❌ BAD: dangerouslySetInnerHTML with kebab-case SVG attrs
<div dangerouslySetInnerHTML={{ __html: '<svg><text text-anchor="middle">x</text></svg>' }} />
```

Why direct JSX wins:
- React can re-render the SVG when props change (no string remount)
- Tailwind utility classes (`className="text-primary"`) apply to elements
  inside the SVG
- Kebab-case SVG attrs (`text-anchor`, `stroke-width`, `fill-opacity`)
  bypass JSX type checking and trip downstream validators that expect
  Tailwind class shapes
- Prop interpolation (`<circle r={radius} />`) is impossible from a string
- React's XSS protection is explicitly bypassed by `dangerouslySetInnerHTML`

Mechanical kebab → camelCase mapping for the most common SVG attrs:
`text-anchor` → `textAnchor`, `stroke-width` → `strokeWidth`,
`stroke-linecap` → `strokeLinecap`, `stroke-linejoin` → `strokeLinejoin`,
`stroke-dasharray` → `strokeDasharray`, `fill-opacity` → `fillOpacity`,
`fill-rule` → `fillRule`, `clip-path` → `clipPath`, `xmlns:xlink` →
`xmlnsXlink` (rarely needed in modern code).

For Canvas-rendered games where SVG strings are loaded into `Image`
objects and drawn to canvas, see the game skill — that's a different
pipeline and string-form SVG is correct there.

## Common Mistakes

```tsx
// ❌ BAD: Direct npm import
import { BarChart } from "recharts";

// ✅ GOOD: Use SDK namespace
import { Charts } from "@exepad/sdk";
// Then: <Charts.BarChart />

// ❌ BAD: Destructure namespace
const { BarChart } = Charts;

// ✅ GOOD: Use namespace directly
<Charts.BarChart data={data}>...</Charts.BarChart>

// ❌ BAD: Import React from react
import React from "react";

// ✅ GOOD: Import React from SDK
import { React } from "@exepad/sdk";
```
