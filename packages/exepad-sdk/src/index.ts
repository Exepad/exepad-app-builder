// --- Core ---
export { React, ReactDOM } from './core';

// --- Utilities ---
export { format } from './utilities';
export { _ } from './utilities';
export { z } from './utilities';
export { useForm, Controller } from './utilities';

// --- Visuals ---
export { Charts } from './visuals';
export { Icons } from './visuals';
export { motion, Motion } from './visuals';

// --- Motion Kit (framer-motion presets) ---
export {
  FadeIn,
  SlideUp,
  Reveal,
  StaggerGrid,
  AnimatedCounter,
  Marquee,
  AnimatedGradient,
  AnimatePresence,
} from './motion';
export type {
  RevealProps,
  StaggerGridProps,
  AnimatedCounterProps,
  MarqueeProps,
  AnimatedGradientProps,
} from './motion';

// --- Decorative Backgrounds (pure SVG, zero-dep) ---
export { NoiseBg, MeshGradient, GridPattern, DotPattern } from './backgrounds';
export type {
  NoiseBgProps,
  MeshGradientProps,
  GridPatternProps,
  DotPatternProps,
} from './backgrounds';

// --- Map (OpenStreetMap iframe + marker overlay) ---
export { Map, MapLink } from './map';
export type { MapProps, MapMarker, MapLinkProps } from './map';

// --- UI: Form Controls ---
export {
  Button, buttonVariants,
  Input,
  Textarea,
  Select, SelectGroup, SelectValue, SelectTrigger, SelectContent, SelectLabel, SelectItem, SelectSeparator, SelectScrollUpButton, SelectScrollDownButton,
  Checkbox,
  Label,
  RadioGroup, RadioGroupItem,
  Switch,
  Slider,
  InputOTP, InputOTPGroup, InputOTPSlot, InputOTPSeparator,
  InputGroup, InputGroupAddon, InputGroupButton, InputGroupText, InputGroupInput, InputGroupTextarea,
  Form, FormItem, FormLabel, FormControl, FormDescription, FormMessage, FormField, useFormField,
  Field, FieldLabel, FieldDescription, FieldError, FieldGroup, FieldLegend, FieldSeparator, FieldSet, FieldContent, FieldTitle,
} from './ui/form-controls';

// --- UI: Layout ---
export {
  Card, CardHeader, CardFooter, CardTitle, CardDescription, CardContent,
  Badge, badgeVariants,
  Separator,
  ScrollArea, ScrollBar,
  Accordion, AccordionItem, AccordionTrigger, AccordionContent,
  AspectRatio,
  ResizablePanelGroup, ResizablePanel, ResizableHandle,
  Collapsible, CollapsibleTrigger, CollapsibleContent,
  Tabs, TabsList, TabsTrigger, TabsContent,
} from './ui/layout';

// --- UI: Display ---
export {
  Alert, AlertTitle, AlertDescription,
  Progress,
  Skeleton,
  Spinner,
  Avatar, AvatarImage, AvatarFallback,
  Empty, EmptyHeader, EmptyTitle, EmptyDescription, EmptyContent, EmptyMedia,
  Item, ItemMedia, ItemContent, ItemActions, ItemGroup, ItemSeparator, ItemTitle, ItemDescription, ItemHeader, ItemFooter,
  ExepadImage,
} from './ui/display';
export type { ExepadImageProps } from './ui/display';

// --- UI: Overlays ---
export {
  Dialog, DialogPortal, DialogOverlay, DialogTrigger, DialogClose, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription,
  AlertDialog, AlertDialogPortal, AlertDialogOverlay, AlertDialogTrigger, AlertDialogContent, AlertDialogHeader, AlertDialogFooter, AlertDialogTitle, AlertDialogDescription, AlertDialogAction, AlertDialogCancel,
  Sheet, SheetPortal, SheetOverlay, SheetTrigger, SheetClose, SheetContent, SheetHeader, SheetFooter, SheetTitle, SheetDescription,
  Drawer, DrawerPortal, DrawerOverlay, DrawerTrigger, DrawerClose, DrawerContent, DrawerHeader, DrawerFooter, DrawerTitle, DrawerDescription,
  Popover, PopoverTrigger, PopoverContent, PopoverAnchor,
  HoverCard, HoverCardTrigger, HoverCardContent,
  Tooltip, TooltipTrigger, TooltipContent, TooltipProvider,
} from './ui/overlays';
export type { DialogMotion } from './ui/overlays';

// --- UI: Menus & Navigation ---
export {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuCheckboxItem, DropdownMenuRadioItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuShortcut, DropdownMenuGroup, DropdownMenuPortal, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuRadioGroup,
  ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem, ContextMenuCheckboxItem, ContextMenuRadioItem, ContextMenuLabel, ContextMenuSeparator, ContextMenuShortcut, ContextMenuGroup, ContextMenuPortal, ContextMenuSub, ContextMenuSubContent, ContextMenuSubTrigger, ContextMenuRadioGroup,
  Menubar, MenubarMenu, MenubarTrigger, MenubarContent, MenubarItem, MenubarSeparator, MenubarLabel, MenubarCheckboxItem, MenubarRadioGroup, MenubarRadioItem, MenubarPortal, MenubarSubContent, MenubarSubTrigger, MenubarGroup, MenubarSub, MenubarShortcut,
  NavigationMenu, NavigationMenuList, NavigationMenuItem, NavigationMenuContent, NavigationMenuTrigger, NavigationMenuLink, NavigationMenuIndicator, NavigationMenuViewport, navigationMenuTriggerStyle,
  Breadcrumb, BreadcrumbList, BreadcrumbItem, BreadcrumbLink, BreadcrumbPage, BreadcrumbSeparator, BreadcrumbEllipsis,
  Pagination, PaginationContent, PaginationLink, PaginationItem, PaginationPrevious, PaginationNext, PaginationEllipsis,
  Command, CommandDialog, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem, CommandShortcut, CommandSeparator,
  ButtonGroup, ButtonGroupSeparator, ButtonGroupText, buttonGroupVariants,
  Toggle, toggleVariants,
  ToggleGroup, ToggleGroupItem,
  Kbd, KbdGroup,
} from './ui/menus';

// --- UI: Data Display ---
export {
  Table, TableHeader, TableBody, TableFooter, TableHead, TableRow, TableCell, TableCaption,
  Calendar, CalendarDayButton,
  type CarouselApi, Carousel, CarouselContent, CarouselItem, CarouselPrevious, CarouselNext,
  type ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent, ChartLegend, ChartLegendContent,
} from './ui/data';

// --- UI: Sidebar ---
export {
  Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupAction, SidebarGroupContent, SidebarGroupLabel, SidebarHeader, SidebarInput, SidebarInset, SidebarMenu, SidebarMenuAction, SidebarMenuBadge, SidebarMenuButton, SidebarMenuItem, SidebarMenuSkeleton, SidebarMenuSub, SidebarMenuSubButton, SidebarMenuSubItem, SidebarProvider, SidebarRail, SidebarSeparator, SidebarTrigger, useSidebar,
} from './ui/sidebar';

// --- UI: Notifications ---
export { Toaster } from './ui/notifications';

// --- State Management ---
export { useApp } from './platform/useApp';
export type { AppState } from './platform/useApp';
export { useAppState } from './platform/useAppState';
export { useArrayState } from './platform/useArrayState';
export type { UseArrayStateReturn } from './platform/useArrayState';

// --- Light DOM Container (Code Focus) ---
export { LightDOMContainer } from './components/LightDOMContainer';
export type { LightDOMContainerProps } from './components/LightDOMContainer';
export { escapeHtml } from './helpers/escapeHtml';
export { Link } from './components/Link';
export type { LinkProps } from './components/Link';


// --- File Upload ---
export {
  useFileUpload,
  useFileUrl,
  extractAppIdFromUrl,
  buildFileUrl,
  type UseFileUploadOptions,
  type FileUploadResult,
  type UseFileUploadReturn,
} from './files';

// --- Platform ---
export { useModel } from './platform/useModel';
export { useCount } from './platform/useCount';
export type { UseCountReturn } from './platform/useCount';
export { useHandler } from './platform/useHandler';
export { useNavigation, navigate } from './platform/useNavigation';
export { useTheme } from './platform/useTheme';

// --- Game (canvas-arcade helpers; pure browser, no platform deps) ---
export { clamp, lerp } from './game/math';
export { seededRandom } from './game/random';
export { aabb } from './game/collision';
export type { Box } from './game/collision';
export { useGameLoop } from './game/useGameLoop';
export type { GameLoopCallback } from './game/useGameLoop';
export { useKeys } from './game/useKeys';
export type { KeysState } from './game/useKeys';
export { useAudio } from './game/useAudio';
export type { AudioControls } from './game/useAudio';
export { Sprite } from './game/components/Sprite';
export type { SpriteProps } from './game/components/Sprite';
export { Joystick } from './game/components/Joystick';
export type { JoystickProps, JoystickDirection } from './game/components/Joystick';
export { useCurrentUser } from './platform/useCurrentUser';
export { useFakeStream } from './platform/useFakeStream';
export type {
  UseFakeStreamOptions,
  UseFakeStreamReturn,
} from './platform/useFakeStream';
export { useBodyScrollLock } from './platform/useBodyScrollLock';
export type {
  UseModelOptions, UseModelReturn,
  UseHandlerOptions, UseHandlerReturn,
  NavigationAPI, ThemeTokens, CurrentUser,
  ExepadPlatformAPI,
} from './platform/types';

// --- Helpers ---
export { cn } from './helpers/cn';
export { toast } from './platform/toast';
export { SDK_VERSION } from './helpers/version';
export { downloadFile, downloadCsv } from './helpers/downloadFile';

// Global type declarations loaded via globals.d.ts (included by tsconfig)
