/**
 * Two-tier `Icons` namespace.
 *
 *   <Icons.Check />        → curated, synchronous (fast path)
 *   <Icons.Briefcase />    → any other lucide-react icon, lazy-loaded once
 *                            (uses Suspense; falls back to Icons.Circle while
 *                            the chunk loads — typically <1 frame after first use)
 *
 * The curated set below is what bundles into the SDK as a static object
 * literal — Vite tree-shakes anything not referenced. For any name not in
 * the curated set, the Proxy at the bottom of this file falls through to
 * `lucide-react/dynamicIconImports`, which Vite emits as separate chunks
 * under `dist/icons/{name}-{hash}.js`. Each chunk fetches on first access
 * and is cached in-memory thereafter.
 *
 * The agent's validator allowlist (`valid_lucide_icons.json`) is kept in
 * sync with lucide's `dynamicIconImports` keys via
 * `apps/agent/scripts/generate_lucide_icon_lists.py`, NOT with the curated
 * subset below — any lucide name is now valid at runtime.
 *
 * Keep the curated list alphabetized within each category for easy maintenance.
 */
import * as React from 'react';
import dynamicIconImports from 'lucide-react/dynamicIconImports';
import {
  // --- Navigation & arrows ---
  ArrowDown, ArrowDownLeft, ArrowDownRight, ArrowLeft, ArrowRight, ArrowUp, ArrowUpLeft,
  ArrowUpRight, ArrowUpDown, ArrowLeftRight, ChevronDown, ChevronUp, ChevronLeft,
  ChevronRight, ChevronsDown, ChevronsUp, ChevronsLeft, ChevronsRight, CornerDownLeft,
  CornerDownRight, CornerUpLeft, CornerUpRight, Move, MoveHorizontal, MoveVertical,
  Navigation, Navigation2, Compass, ExternalLink, MoveRight, MoveLeft, MoveUp, MoveDown,

  // --- UI state & feedback ---
  Check, CheckCheck, CheckCircle, CheckCircle2, CheckSquare, X, XCircle, XSquare,
  AlertCircle, AlertTriangle, AlertOctagon, Info, HelpCircle, Ban, ShieldAlert, ShieldCheck,
  Shield, ShieldOff, Loader, Loader2, RefreshCw, RefreshCcw, RotateCw, RotateCcw,
  CircleCheck, CircleX, CircleAlert, Circle, CircleDot, CircleDashed,

  // --- Common actions ---
  Plus, PlusCircle, PlusSquare, Minus, MinusCircle, MinusSquare, Edit, Edit2, Edit3,
  Trash, Trash2, Copy, CopyCheck, Clipboard, ClipboardCheck, ClipboardCopy, ClipboardList,
  Save, Download, Upload, Send, SendHorizontal, Share, Share2, Link, Link2, Unlink,
  Lock, LockOpen, Unlock, Key, KeyRound, Eye, EyeOff, Search, SearchCheck, SearchX,
  Filter, FilterX, SlidersHorizontal, Sliders, Settings, Settings2, Cog, Wrench,
  PenTool, Pencil, PencilLine, Highlighter, Paintbrush, Palette, Eraser,
  Power, PowerOff, LogIn, LogOut, UserPlus, UserMinus, UserCheck, UserX, UserCog,

  // --- Layout & views ---
  Menu, MoreHorizontal, MoreVertical, Grid, Grid2x2, Grid3x3, List, LayoutGrid,
  LayoutList, LayoutDashboard, LayoutTemplate, Layers, PanelLeft, PanelRight, PanelTop,
  PanelBottom, Sidebar, Columns, Columns2, Columns3, Rows, Rows2, Rows3, Square,
  SquareCheck, Maximize, Maximize2, Minimize, Minimize2, Expand, Shrink, Focus,

  // --- User & profile ---
  User, Users, User2, UserCircle, UserSquare, Contact, IdCard, AtSign, UsersRound,
  UserRound, UserRoundCheck, UserRoundPlus, UserRoundMinus,

  // --- Communication ---
  Mail, MailOpen, MailCheck, MailPlus, MailX, Inbox, MessageCircle,
  MessageSquare, MessageSquarePlus, MessagesSquare, Phone, PhoneCall, PhoneIncoming,
  PhoneOutgoing, PhoneOff, Voicemail, Megaphone, Bell, BellOff, BellPlus, BellRing,

  // --- Social / brands (lucide includes a subset) ---
  Github, Twitter, Facebook, Instagram, Linkedin, Youtube, Twitch, Rss, Figma, Chrome,
  Slack, Dribbble,

  // --- Media & files ---
  File, FileText, FileImage, FileAudio, FileVideo, FileJson, FileCode, FileCheck,
  FilePlus, FileX, FileArchive, Files, Folder, FolderOpen, FolderPlus, FolderX,
  FolderClosed, Archive, ArchiveX, ArchiveRestore, Paperclip, Image, ImagePlus, ImageOff,
  Camera, CameraOff, Video, VideoOff, Film, Clapperboard, Music, Music2, Headphones,
  Mic, MicOff, Volume, Volume1, Volume2, VolumeX, Play, Pause, StopCircle, SkipForward,
  SkipBack, Rewind, FastForward, Radio, Podcast,

  // --- Charts & data ---
  BarChart, BarChart2, BarChart3, BarChart4, PieChart, LineChart, AreaChart, Activity,
  TrendingUp, TrendingDown, Database, Server, HardDrive, Cpu, MemoryStick, Gauge,
  Percent, Hash, Binary, Sigma, Table, Table2, ScatterChart,

  // --- Commerce & money ---
  ShoppingCart, ShoppingBag, ShoppingBasket, CreditCard, Wallet, DollarSign, Euro,
  PoundSterling, BadgeCheck, BadgePercent, Tag, Tags, Ticket, Receipt,
  Banknote, Coins, HandCoins, PiggyBank,

  // --- Time & date ---
  Calendar, CalendarDays, CalendarCheck, CalendarClock, CalendarX, CalendarPlus,
  CalendarMinus, CalendarHeart, Clock, Clock1, Clock2, Clock3, Clock4, Clock5, Clock6,
  Clock7, Clock8, Clock9, Clock10, Clock11, Clock12, Timer, TimerOff, Hourglass,
  AlarmClock, AlarmClockOff, History,

  // --- Devices & hardware ---
  Laptop, Laptop2, Smartphone, Tablet, Monitor, MonitorSmartphone, Tv, Tv2, Watch,
  Headset, Keyboard, Mouse, MousePointer, MousePointer2, Speaker, Printer, Usb, Plug,
  Battery, BatteryCharging, BatteryFull, BatteryLow, BatteryMedium, Wifi, WifiOff,
  Bluetooth, BluetoothOff, Signal, Router,

  // --- Locations & places ---
  Home, House, MapPin, Map, Globe, Globe2, Building, Building2,
  Castle, Church, Hotel, Landmark, School, Store, Warehouse, Factory, Hospital,
  Pin, Flag, FlagTriangleRight, FlagOff,

  // --- Transport ---
  Car, CarFront, Truck, Bus, Bike, Plane, PlaneTakeoff, PlaneLanding, Ship,
  Train, TrainFront, Sailboat, Rocket, Fuel, ParkingCircle,

  // --- Weather & nature ---
  Sun, SunMedium, Moon, MoonStar, Cloud, CloudRain, CloudSnow, CloudSun, CloudMoon,
  CloudLightning, CloudFog, CloudDrizzle, CloudHail, Cloudy, Wind, Umbrella, Droplets,
  Droplet, Zap, ZapOff, Flame, Snowflake, Sunrise, Sunset, Rainbow, Tornado,

  // --- Plants / animals / food / drink ---
  Leaf, Trees, Flower, Flower2, TreePine, TreeDeciduous, Sprout, Apple, Cherry, Carrot,
  Fish, FishOff, Bird, Dog, Cat, Rabbit, Rat, Squirrel, Bug, Turtle, PawPrint,
  Beef, Drumstick, Ham, Pizza, Sandwich, Salad, Utensils, UtensilsCrossed, Coffee,
  CupSoda, Wine, Beer, GlassWater, ChefHat, IceCream, IceCreamBowl, Croissant, Cookie,
  EggFried, Milk, Wheat,

  // --- Gaming & awards ---
  Award, Trophy, Medal, Crown, Gem, Gift, Sparkles, Heart, HeartHandshake, HeartOff,
  ThumbsUp, ThumbsDown, Star, StarHalf, StarOff, Bookmark, BookmarkCheck, BookmarkPlus,
  BookmarkX, Smile, Frown, Meh, Laugh, Angry, Annoyed,

  // --- Documents & content ---
  Book, BookOpen, BookOpenCheck, BookMarked, Library, LibraryBig, Notebook, NotebookPen,
  StickyNote, ScrollText, Newspaper, Quote, Pen, Feather, Type, CaseSensitive, CaseLower,
  CaseUpper, AlignLeft, AlignCenter, AlignRight, AlignJustify, Bold, Italic, Underline,
  Strikethrough, Heading, Heading1, Heading2, Heading3, ListOrdered,
  ListChecks, ListX, IndentIncrease, IndentDecrease, WrapText,

  // --- Code & dev ---
  Code, Code2, Terminal, TerminalSquare, Braces, Brackets, FileCode2,

  // --- Cloud & platform ---
  CloudUpload, CloudDownload, CloudOff, CloudCog, Blocks, Box, Boxes,
  Package, Package2, PackageOpen, PackageCheck, PackageMinus, PackagePlus, PackageX,

  // --- Medical ---
  Stethoscope, HeartPulse, Pill, Syringe, Bandage, Cross, Ambulance,

  // --- Fitness & sports ---
  Dumbbell, Weight,

  // --- Misc ---
  Puzzle, Gamepad, Gamepad2, Dice1, Dice2, Dice3, Dice4, Dice5, Dice6, Hammer, Scissors,
  Ruler, Triangle, TriangleAlert, Hexagon, Octagon, Diamond,
} from 'lucide-react';

/**
 * Static curated set — synchronous, no Suspense. Names referenced here
 * are bundled into the SDK directly. Vite tree-shakes the lucide imports
 * above to only what's listed.
 *
 * Not exported directly; the public `Icons` export at the bottom of this
 * file is a Proxy that returns these synchronously and falls through to
 * lazy-loaded chunks for any other lucide-react icon.
 */
const CuratedIcons = {
  // Navigation & arrows
  ArrowDown, ArrowDownLeft, ArrowDownRight, ArrowLeft, ArrowRight, ArrowUp, ArrowUpLeft,
  ArrowUpRight, ArrowUpDown, ArrowLeftRight, ChevronDown, ChevronUp, ChevronLeft,
  ChevronRight, ChevronsDown, ChevronsUp, ChevronsLeft, ChevronsRight, CornerDownLeft,
  CornerDownRight, CornerUpLeft, CornerUpRight, Move, MoveHorizontal, MoveVertical,
  Navigation, Navigation2, Compass, ExternalLink, MoveRight, MoveLeft, MoveUp, MoveDown,

  // UI state
  Check, CheckCheck, CheckCircle, CheckCircle2, CheckSquare, X, XCircle, XSquare,
  AlertCircle, AlertTriangle, AlertOctagon, Info, HelpCircle, Ban, ShieldAlert, ShieldCheck,
  Shield, ShieldOff, Loader, Loader2, RefreshCw, RefreshCcw, RotateCw, RotateCcw,
  CircleCheck, CircleX, CircleAlert, Circle, CircleDot, CircleDashed,

  // Actions
  Plus, PlusCircle, PlusSquare, Minus, MinusCircle, MinusSquare, Edit, Edit2, Edit3,
  Trash, Trash2, Copy, CopyCheck, Clipboard, ClipboardCheck, ClipboardCopy, ClipboardList,
  Save, Download, Upload, Send, SendHorizontal, Share, Share2, Link, Link2, Unlink,
  Lock, LockOpen, Unlock, Key, KeyRound, Eye, EyeOff, Search, SearchCheck, SearchX,
  Filter, FilterX, SlidersHorizontal, Sliders, Settings, Settings2, Cog, Wrench,
  PenTool, Pencil, PencilLine, Highlighter, Paintbrush, Palette, Eraser,
  Power, PowerOff, LogIn, LogOut, UserPlus, UserMinus, UserCheck, UserX, UserCog,

  // Layout
  Menu, MoreHorizontal, MoreVertical, Grid, Grid2x2, Grid3x3, List, LayoutGrid,
  LayoutList, LayoutDashboard, LayoutTemplate, Layers, PanelLeft, PanelRight, PanelTop,
  PanelBottom, Sidebar, Columns, Columns2, Columns3, Rows, Rows2, Rows3, Square,
  SquareCheck, Maximize, Maximize2, Minimize, Minimize2, Expand, Shrink, Focus,

  // User
  User, Users, User2, UserCircle, UserSquare, Contact, IdCard, AtSign, UsersRound,
  UserRound, UserRoundCheck, UserRoundPlus, UserRoundMinus,

  // Communication
  Mail, MailOpen, MailCheck, MailPlus, MailX, Inbox, MessageCircle, MessageSquare,
  MessageSquarePlus, MessagesSquare, Phone, PhoneCall, PhoneIncoming, PhoneOutgoing,
  PhoneOff, Voicemail, Megaphone, Bell, BellOff, BellPlus, BellRing,

  // Social
  Github, Twitter, Facebook, Instagram, Linkedin, Youtube, Twitch, Rss, Figma, Chrome,
  Slack, Dribbble,

  // Files & media
  File, FileText, FileImage, FileAudio, FileVideo, FileJson, FileCode, FileCheck,
  FilePlus, FileX, FileArchive, Files, Folder, FolderOpen, FolderPlus, FolderX,
  FolderClosed, Archive, ArchiveX, ArchiveRestore, Paperclip, Image, ImagePlus, ImageOff,
  Camera, CameraOff, Video, VideoOff, Film, Clapperboard, Music, Music2, Headphones,
  Mic, MicOff, Volume, Volume1, Volume2, VolumeX, Play, Pause, StopCircle, SkipForward,
  SkipBack, Rewind, FastForward, Radio, Podcast,

  // Charts & data
  BarChart, BarChart2, BarChart3, BarChart4, PieChart, LineChart, AreaChart, Activity,
  TrendingUp, TrendingDown, Database, Server, HardDrive, Cpu, MemoryStick, Gauge,
  Percent, Hash, Binary, Sigma, Table, Table2, ScatterChart,

  // Commerce
  ShoppingCart, ShoppingBag, ShoppingBasket, CreditCard, Wallet, DollarSign, Euro,
  PoundSterling, BadgeCheck, BadgePercent, Tag, Tags, Ticket, Receipt,
  Banknote, Coins, HandCoins, PiggyBank,

  // Time
  Calendar, CalendarDays, CalendarCheck, CalendarClock, CalendarX, CalendarPlus,
  CalendarMinus, CalendarHeart, Clock, Clock1, Clock2, Clock3, Clock4, Clock5, Clock6,
  Clock7, Clock8, Clock9, Clock10, Clock11, Clock12, Timer, TimerOff, Hourglass,
  AlarmClock, AlarmClockOff, History,

  // Devices
  Laptop, Laptop2, Smartphone, Tablet, Monitor, MonitorSmartphone, Tv, Tv2, Watch,
  Headset, Keyboard, Mouse, MousePointer, MousePointer2, Speaker, Printer, Usb, Plug,
  Battery, BatteryCharging, BatteryFull, BatteryLow, BatteryMedium, Wifi, WifiOff,
  Bluetooth, BluetoothOff, Signal, Router,

  // Places
  Home, House, MapPin, Map, Globe, Globe2, Building, Building2,
  Castle, Church, Hotel, Landmark, School, Store, Warehouse, Factory, Hospital,
  Pin, Flag, FlagTriangleRight, FlagOff,

  // Transport
  Car, CarFront, Truck, Bus, Bike, Plane, PlaneTakeoff, PlaneLanding, Ship,
  Train, TrainFront, Sailboat, Rocket, Fuel, ParkingCircle,

  // Weather & nature
  Sun, SunMedium, Moon, MoonStar, Cloud, CloudRain, CloudSnow, CloudSun, CloudMoon,
  CloudLightning, CloudFog, CloudDrizzle, CloudHail, Cloudy, Wind, Umbrella, Droplets,
  Droplet, Zap, ZapOff, Flame, Snowflake, Sunrise, Sunset, Rainbow, Tornado,

  // Plants / animals / food
  Leaf, Trees, Flower, Flower2, TreePine, TreeDeciduous, Sprout, Apple, Cherry, Carrot,
  Fish, FishOff, Bird, Dog, Cat, Rabbit, Rat, Squirrel, Bug, Turtle, PawPrint,
  Beef, Drumstick, Ham, Pizza, Sandwich, Salad, Utensils, UtensilsCrossed, Coffee,
  CupSoda, Wine, Beer, GlassWater, ChefHat, IceCream, IceCreamBowl, Croissant, Cookie,
  EggFried, Milk, Wheat,

  // Gaming, awards, emotions
  Award, Trophy, Medal, Crown, Gem, Gift, Sparkles, Heart, HeartHandshake, HeartOff,
  ThumbsUp, ThumbsDown, Star, StarHalf, StarOff, Bookmark, BookmarkCheck, BookmarkPlus,
  BookmarkX, Smile, Frown, Meh, Laugh, Angry, Annoyed,

  // Documents & text
  Book, BookOpen, BookOpenCheck, BookMarked, Library, LibraryBig, Notebook, NotebookPen,
  StickyNote, ScrollText, Newspaper, Quote, Pen, Feather, Type, CaseSensitive, CaseLower,
  CaseUpper, AlignLeft, AlignCenter, AlignRight, AlignJustify, Bold, Italic, Underline,
  Strikethrough, Heading, Heading1, Heading2, Heading3, ListOrdered, ListChecks, ListX,
  IndentIncrease, IndentDecrease, WrapText,

  // Code & dev
  Code, Code2, Terminal, TerminalSquare, Braces, Brackets, FileCode2,

  // Cloud & packaging
  CloudUpload, CloudDownload, CloudOff, CloudCog, Blocks, Box, Boxes,
  Package, Package2, PackageOpen, PackageCheck, PackageMinus, PackagePlus, PackageX,

  // Medical
  Stethoscope, HeartPulse, Pill, Syringe, Bandage, Cross, Ambulance,

  // Fitness & sports
  Dumbbell, Weight,

  // Misc
  Puzzle, Gamepad, Gamepad2, Dice1, Dice2, Dice3, Dice4, Dice5, Dice6, Hammer, Scissors,
  Ruler, Triangle, TriangleAlert, Hexagon, Octagon, Diamond,
} as const;

export type CuratedIconName = keyof typeof CuratedIcons;

// ─── Lazy fall-through ────────────────────────────────────────────────────
//
// Build a PascalCase → kebab-case lookup from lucide's own keys at module
// init. Doing it this way (vs deriving via regex) avoids edge cases like
// `Grid2x2` (kebab `grid-2x2`, not `grid-2-x-2`) and `BarChart2`. 4 of the
// 1,912 keys are alias collisions in numbered "Arrow{Up,Down}{01,10}"
// pairs — they resolve to the same icon file, so collisions are harmless.
//
// NB: we use plain Records here rather than ``new Map(...)`` because
// ``Map`` is also a lucide icon name imported above — `new Map<...>()`
// resolves to the icon component, not the JS global. Records have the
// same lookup characteristics for our usage and dodge the shadow.

const _kebabFromPascal: Record<string, string> = Object.create(null);
for (const kebab of Object.keys(dynamicIconImports)) {
  const pascal = kebab
    .split('-')
    .map((part) => (part ? part[0].toUpperCase() + part.slice(1) : ''))
    .join('');
  _kebabFromPascal[pascal] = kebab;
}

// Cache the wrapped (lazy + Suspense) component per name so re-renders and
// sibling instances share the same module fetch.
type IconComponent = React.ComponentType<Record<string, unknown>>;
const _wrappedCache: Record<string, IconComponent> = Object.create(null);

function makeLazyIcon(pascal: string): IconComponent | null {
  const cached = _wrappedCache[pascal];
  if (cached) return cached;
  const kebab = _kebabFromPascal[pascal];
  if (!kebab) return null;
  const loaderMap = dynamicIconImports as Record<string, () => Promise<{ default: IconComponent }>>;
  const loader = loaderMap[kebab];
  if (!loader) return null;
  const Lazy = React.lazy(loader);
  const Wrapped: React.FC<Record<string, unknown>> = (props) =>
    React.createElement(
      React.Suspense,
      { fallback: React.createElement(CuratedIcons.Circle as IconComponent, props) },
      React.createElement(Lazy, props),
    );
  Wrapped.displayName = `Icons.${pascal}`;
  _wrappedCache[pascal] = Wrapped;
  return Wrapped;
}

/**
 * Public `Icons` namespace.
 *
 * - `Icons.X` for any curated name → synchronous component (fast path).
 * - `Icons.X` for any other lucide-react PascalCase name → lazy-loaded
 *   component with built-in Suspense fallback (renders Icons.Circle while
 *   the chunk loads, then the real glyph).
 * - Genuinely unknown names (typos that don't match any lucide icon) →
 *   resolves to `Icons.HelpCircle` so JSX never crashes.
 *
 * The validator (`valid_lucide_icons.json`) accepts all 1,908 unique
 * PascalCase names; only off-list typos hit the HelpCircle fallback.
 */
export const Icons = new Proxy(CuratedIcons as Record<string, IconComponent>, {
  get(target, prop, receiver) {
    if (typeof prop !== 'string') return Reflect.get(target, prop, receiver);
    if (prop in target) return target[prop];
    const lazy = makeLazyIcon(prop);
    if (lazy) return lazy;
    return CuratedIcons.HelpCircle as IconComponent;
  },
  has(target, prop) {
    return typeof prop === 'string' && (prop in target || prop in _kebabFromPascal);
  },
}) as Record<string, IconComponent>;
