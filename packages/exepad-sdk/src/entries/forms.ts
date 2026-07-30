// --- @exepad/sdk/forms ---
// Heavy-dep form/interaction widgets:
//   - Calendar         → react-day-picker
//   - InputOTP         → input-otp
//   - Command          → cmdk
//   - Drawer           → vaul
//   - Carousel         → embla-carousel-react
// Imported directly from their component files (not the mixed barrels) so the
// /core entry's graph never reaches these deps.

export { Calendar, CalendarDayButton } from '../components/ui/calendar';

export {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
  InputOTPSeparator,
} from '../components/ui/input-otp';

export {
  Command,
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandShortcut,
  CommandSeparator,
} from '../components/ui/command';

export {
  Drawer,
  DrawerPortal,
  DrawerOverlay,
  DrawerTrigger,
  DrawerClose,
  DrawerContent,
  DrawerHeader,
  DrawerFooter,
  DrawerTitle,
  DrawerDescription,
} from '../components/ui/drawer';

export {
  type CarouselApi,
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselPrevious,
  CarouselNext,
} from '../components/ui/carousel';
