import { React, useAppState, useNavigation, useCurrentUser, Button, Badge, Icons, cn, Avatar, AvatarFallback, DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuLabel } from "@exepad/sdk";

function GameHeader() {
  const navigation = useNavigation();
  const currentUser = useCurrentUser();
  const [currentScore] = useAppState<number>("currentScore", 0);
  const userName = currentUser?.displayName || currentUser?.email?.split("@")[0] || "User";
  const userEmail = currentUser?.email || "user@mindmatch.app";
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

  const navItems = [
    { label: "Home", slug: "/", icon: Icons.Home },
    { label: "Play", slug: "/play", icon: Icons.Gamepad2 },
    { label: "Leaderboard", slug: "/leaderboard", icon: Icons.Trophy },
    { label: "Stats", slug: "/stats", icon: Icons.BarChart3 },
  ];

  const currentPath = navigation.currentPath || "/";

  return (
    <div className="w-full border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <div
            className="flex items-center gap-2 cursor-pointer"
            onClick={() => navigation.navigate("/")}
          >
            <div className="w-9 h-9 rounded-lg bg-primary flex items-center justify-center">
              <Icons.Brain className="h-5 w-5 text-primary-foreground" />
            </div>
            <span className="text-xl font-bold text-foreground">MindMatch</span>
          </div>

          {/* Navigation */}
          <nav className="hidden md:flex items-center gap-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = currentPath === item.slug || (item.slug !== "/" && currentPath.startsWith(item.slug));
              return (
                <button
                  key={item.slug}
                  onClick={() => navigation.navigate(item.slug)}
                  className={cn(
                    "nav-item flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium",
                    isActive
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:text-foreground hover:bg-accent"
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {item.label}
                </button>
              );
            })}
          </nav>

          {/* Right side */}
          <div className="flex items-center gap-3">
            {currentScore > 0 && (
              <Badge variant="secondary" className="flex items-center gap-1 px-3 py-1">
                <Icons.Trophy className="h-3.5 w-3.5 text-primary" />
                <span className="font-semibold">{currentScore}</span>
              </Badge>
            )}
            {currentUser?.isAuthenticated ? (
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
              <Button
                variant="outline"
                size="sm"
                onClick={() => navigation.navigate("/login")}
              >
                Sign In
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default GameHeader;
