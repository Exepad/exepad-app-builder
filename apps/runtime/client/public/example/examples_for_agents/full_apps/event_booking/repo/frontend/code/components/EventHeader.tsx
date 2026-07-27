import {
  React,
  useAppState,
  useNavigation,
  useCurrentUser,
  Button,
  Badge,
  Avatar,
  AvatarFallback,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
  Icons,
  cn,
} from "@exepad/sdk";

interface NavLink {
  label: string;
  slug: string;
  icon: keyof typeof Icons;
}

const NAV_LINKS: NavLink[] = [
  { label: "Home", slug: "/", icon: "Home" },
  { label: "Events", slug: "/events", icon: "CalendarDays" },
  { label: "Calendar", slug: "/calendar", icon: "Calendar" },
  { label: "My Tickets", slug: "/tickets", icon: "Ticket" },
];

function EventHeader() {
  const navigation = useNavigation();
  const currentUser = useCurrentUser();
  const [mobileMenuOpen, setMobileMenuOpen] = React.useState(false);
  const [cartTickets] = useAppState<any[]>("cartTickets", []);

  const currentPath = navigation?.currentPath ?? "/";
  const ticketCount = (cartTickets ?? []).length;

  const userName = currentUser?.displayName || currentUser?.email?.split("@")[0] || "Guest";
  const userEmail = currentUser?.email || "guest@eventspark.com";
  const userInitials = userName
    .split(" ")
    .map((n: string) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  const handleSignOut = async () => {
    try {
      const basePath = navigation.basePath || "";
      const segments = basePath.split("/").filter(Boolean);
      const platform = (window as any).ExepadPlatform;
      const apiAppId = platform?.getAppId?.() || segments[segments.length - 1] || "app";
      await fetch(`/api/${apiAppId}/rpc`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ method: "auth_signout", params: {} }),
      });
      window.dispatchEvent(new CustomEvent("exepad:auth:changed"));
      navigation.navigate("/login");
    } catch {
      navigation.navigate("/login");
    }
  };

  const handleNav = (slug: string) => {
    navigation.navigate(slug);
    setMobileMenuOpen(false);
  };

  return (
    <header className="sticky top-0 z-50 w-full border-b border-border/40 bg-background/80 backdrop-blur-xl">
      <div className="max-w-7xl mx-auto flex h-16 items-center justify-between px-4 sm:px-6">
        {/* Logo */}
        <div
          className="flex items-center gap-2 cursor-pointer"
          onClick={() => handleNav("/")}
        >
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <Icons.Sparkles className="h-5 w-5" />
          </div>
          <span className="text-xl font-bold tracking-tight">
            Event<span className="text-primary">Spark</span>
          </span>
        </div>

        {/* Desktop Nav */}
        <nav className="hidden md:flex items-center gap-1">
          {NAV_LINKS.map((link) => {
            const Icon = Icons[link.icon] as React.ComponentType<{ className?: string }>;
            const isActive = currentPath === link.slug ||
              (link.slug !== "/" && currentPath.startsWith(link.slug));
            return (
              <button
                key={link.slug}
                onClick={() => handleNav(link.slug)}
                className={cn(
                  "flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors",
                  isActive
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted"
                )}
              >
                {Icon && <Icon className="h-4 w-4" />}
                {link.label}
                {link.slug === "/tickets" && ticketCount > 0 && (
                  <Badge variant="default" className="h-5 min-w-[20px] px-1.5 text-xs">
                    {ticketCount}
                  </Badge>
                )}
              </button>
            );
          })}
        </nav>

        {/* Right side actions */}
        <div className="flex items-center gap-3">
          <Button
            size="sm"
            className="hidden sm:flex gap-2"
            onClick={() => handleNav("/events")}
          >
            <Icons.Plus className="h-4 w-4" />
            Create Event
          </Button>

          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <button className="rounded-full focus:outline-hidden focus:ring-2 focus:ring-primary">
                <Avatar className="h-8 w-8">
                  <AvatarFallback className="text-xs bg-primary/10 text-primary">{userInitials}</AvatarFallback>
                </Avatar>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuLabel>
                <div className="flex flex-col">
                  <span className="text-sm font-medium">{userName}</span>
                  <span className="text-xs text-muted-foreground">{userEmail}</span>
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => navigation.navigate("/profile")}>
                <Icons.User className="mr-2 h-4 w-4" />Profile
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => navigation.navigate("/settings")}>
                <Icons.Settings className="mr-2 h-4 w-4" />Settings
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleSignOut}>
                <Icons.LogOut className="mr-2 h-4 w-4" />Sign Out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Mobile menu toggle */}
          <button
            className="md:hidden p-2 rounded-lg hover:bg-muted"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          >
            {mobileMenuOpen ? (
              <Icons.X className="h-5 w-5" />
            ) : (
              <Icons.Menu className="h-5 w-5" />
            )}
          </button>
        </div>
      </div>

      {/* Mobile Nav */}
      {mobileMenuOpen && (
        <div className="md:hidden border-t border-border bg-background px-4 py-3 space-y-1">
          {NAV_LINKS.map((link) => {
            const Icon = Icons[link.icon] as React.ComponentType<{ className?: string }>;
            const isActive = currentPath === link.slug;
            return (
              <button
                key={link.slug}
                onClick={() => handleNav(link.slug)}
                className={cn(
                  "flex items-center gap-3 w-full px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
                  isActive
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted"
                )}
              >
                {Icon && <Icon className="h-4 w-4" />}
                {link.label}
              </button>
            );
          })}
          <Button size="sm" className="w-full mt-2 gap-2" onClick={() => handleNav("/events")}>
            <Icons.Plus className="h-4 w-4" />
            Create Event
          </Button>
        </div>
      )}
    </header>
  );
}

export default EventHeader;
