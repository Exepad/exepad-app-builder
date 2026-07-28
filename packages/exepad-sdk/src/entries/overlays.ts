// --- @exepad/sdk/overlays ---
// Radix-heavy floating/portal surfaces: Sheet, Dialog (+AlertDialog),
// DropdownMenu, Popover, Tooltip (and the lightweight HoverCard that shares
// the popover stack). Split out of /core so pages that don't open overlays
// don't parse the Radix dialog/dropdown/popover/tooltip engines.
//
// NOTE: Radix primitives intentionally DUPLICATE across overlays/forms/core
// (the accepted per-entry-isolation trade-off). Only recharts & framer-motion
// are gated to a single chunk.

export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogTrigger,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from '../components/ui/dialog';
export type { DialogMotion } from '../components/ui/dialog';

export {
  AlertDialog,
  AlertDialogPortal,
  AlertDialogOverlay,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
} from '../components/ui/alert-dialog';

export {
  Sheet,
  SheetPortal,
  SheetOverlay,
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetFooter,
  SheetTitle,
  SheetDescription,
} from '../components/ui/sheet';

export {
  Popover,
  PopoverTrigger,
  PopoverContent,
  PopoverAnchor,
} from '../components/ui/popover';

export {
  HoverCard,
  HoverCardTrigger,
  HoverCardContent,
} from '../components/ui/hover-card';

export {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from '../components/ui/tooltip';

export {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuGroup,
  DropdownMenuPortal,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuRadioGroup,
} from '../components/ui/dropdown-menu';
