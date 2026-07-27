// Curated @exepad/sdk declaration for the agent's tsc Stage-1.5 gate.
// Mirrors the SDK's typed surface as a single flat .d.ts so tsc can
// resolve hook signatures without staging the entire SDK source tree
// (which pulls in ~30 third-party packages: lucide-react, @radix-ui/*,
// clsx, cmdk, etc.).
//
// Scope:
//   - useModel / useHandler / useApp / setState / navigate are
//     constrained against AppModels / AppHandlerOutputs / AppState /
//     AppRoutes, which the per-app app.d.ts module-augments at validate
//     time.
//   - JSX components (Button, Dialog, Card, Charts, Map, motion, ...)
//     are typed as `any` — the gate does not validate JSX shape, only
//     identifier names and cross-reference constraints.
//   - Icons is `any` — the AST rule `IconsUnknownRule` covers icon-name
//     typo checks; duplicating that here would just add maintenance
//     burden as new icons are curated.
//
// Per-app augmentation lives in the generated app.d.ts produced by
// `dts_generator.generate_app_dts`. That file adds entries to
// `AppModels`, `AppHandlerOutputs`, `AppState`, and `AppRoutes`.

declare module "@exepad/sdk" {
  // Re-export the React + ReactDOM namespaces from the global ``react``
  // module (declared in ``react-shim.d.ts``). Without this, ``import
  // { React } from '@exepad/sdk'; React.useState<T>(...)`` fires
  // TS2347 (Untyped function calls may not accept type arguments)
  // because a bare ``const React: any`` doesn't carry the typed hook
  // signatures the LLM expects to invoke with explicit type
  // parameters. The ``import * as`` form pulls the namespace into
  // module scope; ``typeof`` then re-exports it under the SDK's name.
  import * as RealReact from "react";
  import * as RealReactDOM from "react-dom";

  // ---------------------------------------------------------------------
  // Per-app augmentation surface — empty here; concrete entries arrive
  // via app.d.ts module augmentation at validate time.
  // ---------------------------------------------------------------------
  interface AppModels {}
  interface AppHandlerOutputs {}
  interface AppState {}
  interface AppRoutes {}

  // Empty-interface fallbacks: when no augmentation is present (e.g., a
  // workflow with zero declared models), fall back to permissive
  // `string` so the gate does not false-positive on partial inputs.
  type _AppModelKey = keyof AppModels extends never ? string : keyof AppModels;
  type _AppModelData<K> = K extends keyof AppModels
    ? AppModels[K]
    : Record<string, unknown>;

  // Built-in platform handlers callable via `useHandler(...)` regardless of
  // the app's custom handlers — they exist on every app (app-backend rpc
  // router: auth_*). Without these, the documented canonical logout pattern
  // `useHandler("auth_signout")` (03_COMPONENT_PATTERNS.md) fails tsc as soon
  // as the app declares ANY custom handler — narrowing `_AppHandlerName` to
  // just the custom names. Auth navigation flows through these HANDLERS
  // (`useHandler("auth_signout")` etc.), NOT through `navigate("/logout")`:
  // `/login` / `/logout` / `/signup` are deliberately absent from the
  // `_AppRoute` union below so tsc agrees they are not navigable app routes,
  // matching the `component_navigate_unknown_route` AST rule.
  type _BuiltinHandlerName =
    | "auth_signout"
    | "auth_signin"
    | "auth_signup"
    | "auth_me"
    | "auth_request_reset"
    | "auth_reset_password"
    | "auth_verify_email"
    | "auth_request_verification"
    | "auth_social_login"
    | "auth_social_complete";

  type _AppHandlerName = keyof AppHandlerOutputs extends never
    ? string
    : (keyof AppHandlerOutputs) | _BuiltinHandlerName;
  type _AppHandlerData<K> = K extends keyof AppHandlerOutputs
    ? AppHandlerOutputs[K]
    : unknown;

  type _AppStateKey = keyof AppState extends never ? string : keyof AppState;
  type _AppStateValue<K> = K extends keyof AppState ? AppState[K] : unknown;

  type _AppRoute = keyof AppRoutes extends never
    ? string
    :
        | (keyof AppRoutes & string)
        | `${keyof AppRoutes & string}?${string}`
        | `${string}#${string}`;

  // ---------------------------------------------------------------------
  // Hook return shapes — kept loose enough that legitimate usage
  // doesn't trip false positives, but tight enough that the
  // model/handler narrowing means anything.
  // ---------------------------------------------------------------------
  // Mirror the real SDK shapes from
  // packages/exepad-sdk/src/platform/types.ts. Drift here causes the LLM
  // to retry valid code: e.g. an earlier copy declared `run(...)` while the
  // SDK actually exports `execute(...)`, sending every useHandler call
  // through 5+ retry rounds before the model gave up.
  interface UseModelReturn<T> {
    data: T[] | null;
    loading: boolean;
    error: string | null;
    totalCount: number;
    refetch: () => void;
    create: (record: Partial<T>) => Promise<T>;
    update: (id: string | number, updates: Partial<T>) => Promise<T>;
    remove: (id: string | number) => Promise<void>;
  }

  interface UseHandlerReturn<T> {
    data: T | null;
    loading: boolean;
    error: string | null;
    execute: (params?: Record<string, unknown>) => Promise<T | null>;
    refetch: () => void;
  }

  // ---------------------------------------------------------------------
  // Typed hook + helper signatures — the actual narrowing surface.
  // ---------------------------------------------------------------------
  function useModel<K extends _AppModelKey, T = _AppModelData<K>>(
    name: K,
    opts?: any,
  ): UseModelReturn<T>;

  function useHandler<K extends _AppHandlerName, T = _AppHandlerData<K>>(
    name: K,
    opts?: any,
  ): UseHandlerReturn<T>;

  // useApp accepts a selector over AppState. When AppState is empty
  // (no augmentation), R defaults to unknown so callers don't get
  // unhelpful errors on every property access.
  function useApp<R = unknown>(selector?: (s: AppState) => R): R;

  // setState has two shapes: keyed update or partial-state merge.
  function setState<K extends _AppStateKey>(key: K, value: _AppStateValue<K>): void;
  function setState(updates: Partial<AppState>): void;

  function useNavigation(): {
    navigate: (path: string) => void;
    currentPath: string;
    currentSlug: string;
    basePath: string;
  };
  function navigate<P extends _AppRoute>(path: P, opts?: { replace?: boolean }): void;

  // useBodyScrollLock — sanctioned alternative to ``document.body.style.overflow``
  // mutations. Mirrors ``packages/exepad-sdk/src/platform/useBodyScrollLock.ts``.
  function useBodyScrollLock(active: boolean): void;

  // downloadFile / downloadCsv — sanctioned alternatives to the
  // ``document.createElement('a').click()`` + ``URL.createObjectURL``
  // chain. Mirrors ``packages/exepad-sdk/src/helpers/downloadFile.ts``.
  function downloadFile(
    filename: string,
    contents: string | Blob,
    mimeType: string,
  ): void;
  function downloadCsv(
    filename: string,
    rows: ReadonlyArray<Record<string, unknown>>,
  ): void;

  // ---------------------------------------------------------------------
  // Game helpers — typed so field-shape mismatches (`{w, h}` instead of
  // `{width, height}`) trip tsc. Mirror the SDK source verbatim:
  //   packages/exepad-sdk/src/game/{collision,math,random,
  //                                 useGameLoop,useKeys,useAudio}.ts
  //   packages/exepad-sdk/src/game/components/{Sprite,Joystick}.tsx
  // ---------------------------------------------------------------------
  interface Box {
    x: number;
    y: number;
    width: number;
    height: number;
  }
  function aabb(a: Box, b: Box): boolean;
  function clamp(value: number, min: number, max: number): number;
  function lerp(a: number, b: number, t: number): number;
  function seededRandom(seed: number): () => number;

  interface KeysState {
    left: boolean;
    right: boolean;
    up: boolean;
    down: boolean;
    jump: boolean;
    action: boolean;
  }
  function useKeys(): RealReact.MutableRefObject<KeysState>;

  type GameLoopCallback = (deltaSeconds: number) => void;
  function useGameLoop(callback: GameLoopCallback): void;

  interface AudioControls<K extends string> {
    play: (name: K) => void;
    stop: (name: K) => void;
  }
  function useAudio<K extends string>(
    sources: Record<K, string>,
    volume?: number,
  ): AudioControls<K>;

  interface SpriteProps {
    svg: string;
    x: number;
    y: number;
    width?: number;
    height?: number;
    rotation?: number;
    scale?: number;
    flipX?: boolean;
    className?: string;
  }
  function Sprite(props: SpriteProps): any;

  type JoystickDirection = 'left' | 'right';
  interface JoystickProps {
    onDirection: (direction: JoystickDirection, pressed: boolean) => void;
    onJump: (pressed: boolean) => void;
    className?: string;
  }
  function Joystick(props: JoystickProps): any;

  // ---------------------------------------------------------------------
  // Untyped surfaces — JSX components, charting libs, motion wrappers,
  // utility helpers. The gate does not validate any of these. The AST
  // rule layer covers what's worth catching (Icons typos, JSX shape via
  // tree-sitter, etc.).
  // ---------------------------------------------------------------------
  const Icons: any;
  const Charts: any;
  const motion: any;
  const Motion: any;
  const Map: any;
  const MapLink: any;
  const NoiseBg: any;
  const MeshGradient: any;
  const GridPattern: any;
  const DotPattern: any;
  const LightDOMContainer: any;
  const Link: any;
  const Toaster: any;

  function escapeHtml(str: string | null | undefined): string;
  const cn: any;
  const toast: any;
  const format: any;
  const _: any;
  const z: any;

  // Generic-friendly forms — the LLM commonly invokes these with
  // explicit type arguments (``useForm<BriefData>()``). A bare
  // ``const X: any`` declaration makes the call ``any``-typed, which TS
  // rejects with TS2347 when type arguments are present. Function
  // declarations carry a generic parameter so the type-arg call
  // type-checks even though the body is opaque.
  function useForm<TFormData = any>(opts?: any): any;
  // Mirrors the REAL SDK signature (packages/exepad-sdk/src/platform/
  // useArrayState.ts): (key, initialValue?) → helpers object. The gate
  // previously declared ``(initial?: T[])`` — no key — so the canonical
  // call ``useArrayState("cartItems", [])`` failed tsc with TS2345
  // ("string not assignable to T[]") + TS2554 ("Expected 0-1 arguments,
  // but got 2"), burning every tsc retry on a phantom error. An
  // array-first call (``useArrayState<Project>([])``) is broken at
  // runtime too (the key must be a string), so erroring on it is correct.
  function useArrayState<T = any>(
    key: string,
    initialValue?: T[],
  ): {
    items: T[];
    push: (item: T) => void;
    remove: (predicate: ((item: T, index: number) => boolean) | number) => void;
    updateItem: (
      predicate: ((item: T, index: number) => boolean) | number,
      updates: Partial<T>,
    ) => void;
    clear: () => void;
    set: (newItems: T[]) => void;
  };
  function useFakeStream<T = any>(opts?: any): any;
  const Controller: <TFormData = any>(props: any) => any;

  function useTheme(): ThemeTokens;
  function useCurrentUser(): CurrentUser;
  function useUserSettings<
    T extends Record<string, unknown> = Record<string, unknown>,
  >(): UseUserSettingsReturn<T>;
  function useAppState<T = unknown>(
    key: string,
    initialValue?: T,
  ): [T, (value: T) => void, (updater: (prev: T) => T) => void];
  const SDK_VERSION: string;

  // React / ReactDOM are the typed-namespace re-exports from above.
  // ``React.useState<MyType>(...)`` etc. resolves to the typed generic
  // signatures in the global React namespace.
  const React: typeof RealReact;
  const ReactDOM: typeof RealReactDOM;

  // shadcn/ui re-exports — all typed any.
  const Button: any;
  const Dialog: any;
  const DialogContent: any;
  const DialogDescription: any;
  const DialogFooter: any;
  const DialogHeader: any;
  const DialogTitle: any;
  const DialogTrigger: any;
  const Card: any;
  const CardContent: any;
  const CardDescription: any;
  const CardFooter: any;
  const CardHeader: any;
  const CardTitle: any;
  const Input: any;
  const Textarea: any;
  const Label: any;
  const Separator: any;
  const Skeleton: any;
  const Toggle: any;
  const Avatar: any;
  const AvatarFallback: any;
  const AvatarImage: any;
  const Badge: any;
  const Tabs: any;
  const TabsContent: any;
  const TabsList: any;
  const TabsTrigger: any;
  const Select: any;
  const SelectContent: any;
  const SelectItem: any;
  const SelectTrigger: any;
  const SelectValue: any;
  const Checkbox: any;
  const RadioGroup: any;
  const RadioGroupItem: any;
  const Switch: any;
  const Slider: any;
  const Progress: any;
  const Tooltip: any;
  const TooltipContent: any;
  const TooltipProvider: any;
  const TooltipTrigger: any;
  const Popover: any;
  const PopoverContent: any;
  const PopoverTrigger: any;
  const DropdownMenu: any;
  const DropdownMenuContent: any;
  const DropdownMenuItem: any;
  const DropdownMenuLabel: any;
  const DropdownMenuSeparator: any;
  const DropdownMenuTrigger: any;
  const Accordion: any;
  const AccordionContent: any;
  const AccordionItem: any;
  const AccordionTrigger: any;
  const Sheet: any;
  const SheetContent: any;
  const SheetDescription: any;
  const SheetFooter: any;
  const SheetHeader: any;
  const SheetTitle: any;
  const SheetTrigger: any;
  const ExepadImage: any;

  // Type re-exports kept loose — components rarely import these directly.
  type LinkProps = any;
  type ExepadImageProps = any;
  type LightDOMContainerProps = any;

  // Mirror packages/exepad-sdk/src/platform/types.ts. Drift here lets the
  // LLM emit calls that the SDK itself rejects at runtime.
  interface CurrentUser {
    id: string | null;
    email: string | null;
    name?: string | null;
    roles: string[];
    isAuthenticated: boolean;
  }

  interface ThemeTokens {
    colors: {
      primary: string;
      'primary-foreground': string;
      secondary: string;
      'secondary-foreground': string;
      accent: string;
      'accent-foreground': string;
      background: string;
      foreground: string;
      muted: string;
      'muted-foreground': string;
      destructive: string;
      'destructive-foreground': string;
      card: string;
      'card-foreground': string;
      popover: string;
      'popover-foreground': string;
      border: string;
      input: string;
      ring: string;
      success: string;
      warning: string;
    };
    typography: {
      fontFamily: string;
      headingFontFamily: string;
    };
    borderRadius: string;
    mode: 'light' | 'dark' | 'system';
  }

  interface UseUserSettingsReturn<
    T extends Record<string, unknown> = Record<string, unknown>,
  > {
    settings: T;
    isLoading: boolean;
    error: string | null;
    patch: (partial: Partial<T>) => Promise<void>;
    set: <K extends keyof T>(key: K, value: T[K]) => Promise<void>;
    remove: (key: keyof T) => Promise<void>;
    clear: () => Promise<void>;
    refetch: () => Promise<void>;
  }

  type UseModelOptions = any;
  type UseHandlerOptions = any;
  type UseArrayStateReturn<T> = any;
  type MapProps = any;
  type MapMarker = any;
  type MapLinkProps = any;

  // ---------------------------------------------------------------------
  // Per-app form augmentation surface — concrete entries arrive via
  // app.d.ts (generated by dts_generator._form_interface from each
  // app's services.forms.definitions). Empty here so a fabricated
  // formId like usePlatformForm("appointment") fails as TS2345 once
  // any form is registered. Mirrors AppModels / AppHandlerOutputs /
  // AppRoutes pattern at the top of the module.
  //
  // These two declarations are kept in the hand-written slice so
  // sync-agent-gate.ts skips them when regenerating from the SDK
  // barrel (it dedupes against handWritten names).
  // ---------------------------------------------------------------------
  interface AppForms {}
  type _AppFormId = keyof AppForms extends never ? string : keyof AppForms;
  // Concrete return type (deliberate exception to the "all `any`" rule
  // on the autogen slice below). The gate gives `usePlatformForm` a real
  // shape so the validator catches RHF-style misuse (`register`,
  // `handleSubmit`, `formState`, `control`) at Stage 1.5 instead of as
  // a runtime TypeError. Mirrors UsePlatformFormReturn at
  // packages/exepad-sdk/src/platform/usePlatformForm.ts:54-82.
  interface _UsePlatformFormReturn {
    submit: (data: any) => Promise<{ submission_id: string }>;
    submitting: boolean;
    uploadProgress: number | null;
    error: string | null;
    success: boolean;
    reset: () => void;
  }
  function usePlatformForm<K extends _AppFormId>(
    formId: K,
    opts?: any,
  ): _UsePlatformFormReturn;

  // <<<AGENT_SDK_GATE_AUTOGEN_BEGIN>>>
  // Auto-generated by packages/exepad-sdk/scripts/sync-agent-gate.ts
  // — DO NOT EDIT BY HAND. Edit packages/exepad-sdk/src/index.ts and
  // rerun `pnpm --filter @exepad/sdk sync:agent-gate` (or `pnpm build:sdk`).
  // All declared as `any`; the gate validates identifier names, not shapes.
  const Alert: any;
  const AlertDescription: any;
  const AlertDialog: any;
  const AlertDialogAction: any;
  const AlertDialogCancel: any;
  const AlertDialogContent: any;
  const AlertDialogDescription: any;
  const AlertDialogFooter: any;
  const AlertDialogHeader: any;
  const AlertDialogOverlay: any;
  const AlertDialogPortal: any;
  const AlertDialogTitle: any;
  const AlertDialogTrigger: any;
  const AlertTitle: any;
  const AnimatePresence: any;
  const AnimatedCounter: any;
  const AnimatedGradient: any;
  const AspectRatio: any;
  const Breadcrumb: any;
  const BreadcrumbEllipsis: any;
  const BreadcrumbItem: any;
  const BreadcrumbLink: any;
  const BreadcrumbList: any;
  const BreadcrumbPage: any;
  const BreadcrumbSeparator: any;
  const ButtonGroup: any;
  const ButtonGroupSeparator: any;
  const ButtonGroupText: any;
  const Calendar: any;
  const CalendarDayButton: any;
  const Carousel: any;
  const CarouselContent: any;
  const CarouselItem: any;
  const CarouselNext: any;
  const CarouselPrevious: any;
  const ChartContainer: any;
  const ChartLegend: any;
  const ChartLegendContent: any;
  const ChartTooltip: any;
  const ChartTooltipContent: any;
  const Collapsible: any;
  const CollapsibleContent: any;
  const CollapsibleTrigger: any;
  const Command: any;
  const CommandDialog: any;
  const CommandEmpty: any;
  const CommandGroup: any;
  const CommandInput: any;
  const CommandItem: any;
  const CommandList: any;
  const CommandSeparator: any;
  const CommandShortcut: any;
  const ContextMenu: any;
  const ContextMenuCheckboxItem: any;
  const ContextMenuContent: any;
  const ContextMenuGroup: any;
  const ContextMenuItem: any;
  const ContextMenuLabel: any;
  const ContextMenuPortal: any;
  const ContextMenuRadioGroup: any;
  const ContextMenuRadioItem: any;
  const ContextMenuSeparator: any;
  const ContextMenuShortcut: any;
  const ContextMenuSub: any;
  const ContextMenuSubContent: any;
  const ContextMenuSubTrigger: any;
  const ContextMenuTrigger: any;
  const DialogClose: any;
  const DialogOverlay: any;
  const DialogPortal: any;
  const Drawer: any;
  const DrawerClose: any;
  const DrawerContent: any;
  const DrawerDescription: any;
  const DrawerFooter: any;
  const DrawerHeader: any;
  const DrawerOverlay: any;
  const DrawerPortal: any;
  const DrawerTitle: any;
  const DrawerTrigger: any;
  const DropdownMenuCheckboxItem: any;
  const DropdownMenuGroup: any;
  const DropdownMenuPortal: any;
  const DropdownMenuRadioGroup: any;
  const DropdownMenuRadioItem: any;
  const DropdownMenuShortcut: any;
  const DropdownMenuSub: any;
  const DropdownMenuSubContent: any;
  const DropdownMenuSubTrigger: any;
  const Empty: any;
  const EmptyContent: any;
  const EmptyDescription: any;
  const EmptyHeader: any;
  const EmptyMedia: any;
  const EmptyTitle: any;
  const FadeIn: any;
  const Field: any;
  const FieldContent: any;
  const FieldDescription: any;
  const FieldError: any;
  const FieldGroup: any;
  const FieldLabel: any;
  const FieldLegend: any;
  const FieldSeparator: any;
  const FieldSet: any;
  const FieldTitle: any;
  const Form: any;
  const FormControl: any;
  const FormDescription: any;
  const FormField: any;
  const FormItem: any;
  const FormLabel: any;
  const FormMessage: any;
  const HoverCard: any;
  const HoverCardContent: any;
  const HoverCardTrigger: any;
  const InputGroup: any;
  const InputGroupAddon: any;
  const InputGroupButton: any;
  const InputGroupInput: any;
  const InputGroupText: any;
  const InputGroupTextarea: any;
  const InputOTP: any;
  const InputOTPGroup: any;
  const InputOTPSeparator: any;
  const InputOTPSlot: any;
  const Item: any;
  const ItemActions: any;
  const ItemContent: any;
  const ItemDescription: any;
  const ItemFooter: any;
  const ItemGroup: any;
  const ItemHeader: any;
  const ItemMedia: any;
  const ItemSeparator: any;
  const ItemTitle: any;
  const Kbd: any;
  const KbdGroup: any;
  const Marquee: any;
  const Menubar: any;
  const MenubarCheckboxItem: any;
  const MenubarContent: any;
  const MenubarGroup: any;
  const MenubarItem: any;
  const MenubarLabel: any;
  const MenubarMenu: any;
  const MenubarPortal: any;
  const MenubarRadioGroup: any;
  const MenubarRadioItem: any;
  const MenubarSeparator: any;
  const MenubarShortcut: any;
  const MenubarSub: any;
  const MenubarSubContent: any;
  const MenubarSubTrigger: any;
  const MenubarTrigger: any;
  const NavigationMenu: any;
  const NavigationMenuContent: any;
  const NavigationMenuIndicator: any;
  const NavigationMenuItem: any;
  const NavigationMenuLink: any;
  const NavigationMenuList: any;
  const NavigationMenuTrigger: any;
  const NavigationMenuViewport: any;
  const Pagination: any;
  const PaginationContent: any;
  const PaginationEllipsis: any;
  const PaginationItem: any;
  const PaginationLink: any;
  const PaginationNext: any;
  const PaginationPrevious: any;
  const PopoverAnchor: any;
  const ResizableHandle: any;
  const ResizablePanel: any;
  const ResizablePanelGroup: any;
  const Reveal: any;
  const ScrollArea: any;
  const ScrollBar: any;
  const SelectGroup: any;
  const SelectLabel: any;
  const SelectScrollDownButton: any;
  const SelectScrollUpButton: any;
  const SelectSeparator: any;
  const SheetClose: any;
  const SheetOverlay: any;
  const SheetPortal: any;
  const Sidebar: any;
  const SidebarContent: any;
  const SidebarFooter: any;
  const SidebarGroup: any;
  const SidebarGroupAction: any;
  const SidebarGroupContent: any;
  const SidebarGroupLabel: any;
  const SidebarHeader: any;
  const SidebarInput: any;
  const SidebarInset: any;
  const SidebarMenu: any;
  const SidebarMenuAction: any;
  const SidebarMenuBadge: any;
  const SidebarMenuButton: any;
  const SidebarMenuItem: any;
  const SidebarMenuSkeleton: any;
  const SidebarMenuSub: any;
  const SidebarMenuSubButton: any;
  const SidebarMenuSubItem: any;
  const SidebarProvider: any;
  const SidebarRail: any;
  const SidebarSeparator: any;
  const SidebarTrigger: any;
  const SlideUp: any;
  const Spinner: any;
  const StaggerGrid: any;
  const Table: any;
  const TableBody: any;
  const TableCaption: any;
  const TableCell: any;
  const TableFooter: any;
  const TableHead: any;
  const TableHeader: any;
  const TableRow: any;
  const ToggleGroup: any;
  const ToggleGroupItem: any;
  const badgeVariants: any;
  const buildFileUrl: any;
  const buttonGroupVariants: any;
  const buttonVariants: any;
  const extractAppIdFromUrl: any;
  const navigationMenuTriggerStyle: any;
  const toggleVariants: any;
  const useCount: any;
  const useFileUpload: any;
  const useFileUrl: any;
  const useFormField: any;
  const useSidebar: any;

  // Type re-exports.
  type AnimatedCounterProps = any;
  type AnimatedGradientProps = any;
  type CarouselApi = any;
  type ChartConfig = any;
  type DialogMotion = any;
  type DotPatternProps = any;
  type ExepadPlatformAPI = any;
  type FileUploadResult = any;
  type GridPatternProps = any;
  type MarqueeProps = any;
  type MeshGradientProps = any;
  type NavigationAPI = any;
  type NoiseBgProps = any;
  type RevealProps = any;
  type StaggerGridProps = any;
  type UseCountReturn = any;
  type UseFakeStreamOptions = any;
  type UseFakeStreamReturn = any;
  type UseFileUploadOptions = any;
  type UseFileUploadReturn = any;
  // <<<AGENT_SDK_GATE_AUTOGEN_END>>>

}
