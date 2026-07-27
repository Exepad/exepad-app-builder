import {
  React,
  useNavigation,
  useCurrentUser,
  Button,
  Avatar,
  AvatarFallback,
  Badge,
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
  { label: "Listings", slug: "/listings", icon: "Building2" },
  { label: "Favorites", slug: "/favorites", icon: "Heart" },
  { label: "Agents", slug: "/agents", icon: "Users" },
];

function RealEstateHeader() {
  const navigation = useNavigation();
  const currentUser = useCurrentUser();
  const [mobileMenuOpen, setMobileMenuOpen] = React.useState(false);

  const currentPath = navigation?.currentPath ?? "/";
  const isAuthenticated = currentUser?.isAuthenticated ?? false;
  const userName = currentUser?.displayName || currentUser?.email?.split("@")[0] || "User";
  const userEmail = currentUser?.email || "user@app.com";
  const userInitials = userName.split(" ").map((n: string) => n[0]).join("").toUpperCase().slice(0, 2);

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

  return (
    <header className="sticky top-0 z-50 w-full border-b border-border/40 bg-background/80 backdrop-blur-lg">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        {/* Logo */}
        <div
          className="flex items-center gap-2 cursor-pointer"
          onClick={() => navigation.navigate("/")}
        >
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Icons.Home className="h-5 w-5" />
          </div>
          <span className="text-xl font-bold tracking-tight">
            Nest<span className="text-primary">Finder</span>
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
                onClick={() => navigation.navigate(link.slug)}
                className={cn(
                  "flex items-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                )}
              >
                {Icon && <Icon className="h-4 w-4" />}
                {link.label}
              </button>
            );
          })}
        </nav>

        {/* Right Section */}
        <div className="flex items-center gap-3">
          <Button
            size="sm"
            className="hidden sm:flex gap-1.5"
            onClick={() => navigation.navigate("/listings")}
          >
            <Icons.Plus className="h-4 w-4" />
            List Property
          </Button>

          {isAuthenticated ? (
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
          ) : (
            <Button variant="outline" size="sm" onClick={() => navigation.navigate("/login")}>
              <Icons.LogIn className="mr-1.5 h-4 w-4" />
              Sign In
            </Button>
          )}

          {/* Mobile menu toggle */}
          <button
            className="md:hidden p-2 rounded-md hover:bg-accent"
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
        <div className="md:hidden border-t border-border bg-background px-4 py-3">
          <nav className="flex flex-col gap-1">
            {NAV_LINKS.map((link) => {
              const Icon = Icons[link.icon] as React.ComponentType<{ className?: string }>;
              const isActive = currentPath === link.slug;
              return (
                <button
                  key={link.slug}
                  onClick={() => {
                    navigation.navigate(link.slug);
                    setMobileMenuOpen(false);
                  }}
                  className={cn(
                    "flex items-center gap-2 rounded-md px-3 py-2.5 text-sm font-medium transition-colors text-left",
                    isActive
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:bg-accent"
                  )}
                >
                  {Icon && <Icon className="h-4 w-4" />}
                  {link.label}
                </button>
              );
            })}
            <Button size="sm" className="mt-2 w-full gap-1.5">
              <Icons.Plus className="h-4 w-4" />
              List Property
            </Button>
          </nav>
        </div>
      )}
    </header>
  );
}

export default RealEstateHeader;
