import { React, useAppState, useNavigation, useCurrentUser, Button, Badge, Icons, cn, Avatar, AvatarFallback, DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuLabel } from "@exepad/sdk";

function QuizHeader() {
  const navigation = useNavigation();
  const currentUser = useCurrentUser();
  const [quizScore] = useAppState("quizScore", 0);
  const [activeQuizId] = useAppState("activeQuizId", null);
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const userName = currentUser?.displayName || currentUser?.email?.split("@")[0] || "User";
  const userEmail = currentUser?.email || "user@quizmaster.app";
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
    { label: "Home", slug: "/", icon: "Home" },
    { label: "Browse", slug: "/browse", icon: "Search" },
    { label: "Leaderboard", slug: "/leaderboard", icon: "Trophy" },
  ];

  const currentPath = navigation.currentPath || "/";

  return (
    <header className="sticky top-0 z-50 w-full border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="max-w-7xl mx-auto flex h-16 items-center justify-between px-4 sm:px-6">
        <div className="flex items-center gap-6">
          <button onClick={() => navigation.navigate("/")} className="flex items-center gap-2 hover:opacity-80 transition-opacity">
            <div className="h-9 w-9 rounded-lg bg-primary flex items-center justify-center">
              <Icons.HelpCircle className="h-5 w-5 text-primary-foreground" />
            </div>
            <span className="text-xl font-bold tracking-tight">QuizMaster</span>
          </button>

          <nav className="hidden md:flex items-center gap-1">
            {navItems.map((item) => {
              const Icon = Icons[item.icon as keyof typeof Icons] as any;
              const isActive = currentPath === item.slug || (item.slug !== "/" && currentPath.startsWith(item.slug));
              return (
                <button
                  key={item.slug}
                  onClick={() => navigation.navigate(item.slug)}
                  className={cn(
                    "flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium transition-colors",
                    isActive
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:text-foreground hover:bg-accent"
                  )}
                >
                  {Icon && <Icon className="h-4 w-4" />}
                  {item.label}
                </button>
              );
            })}
          </nav>
        </div>

        <div className="flex items-center gap-3">
          {activeQuizId && (
            <Badge variant="secondary" className="hidden sm:flex items-center gap-1.5 px-3 py-1">
              <Icons.Zap className="h-3.5 w-3.5 text-primary" />
              <span className="font-semibold text-primary">{quizScore}</span>
              <span className="text-muted-foreground">pts</span>
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
            <Button size="sm" onClick={() => navigation.navigate("/login")}>
              <Icons.LogIn className="h-4 w-4 mr-1.5" />
              Sign In
            </Button>
          )}

          <button
            className="md:hidden p-2 rounded-md hover:bg-accent"
            onClick={() => setMobileOpen(!mobileOpen)}
          >
            {mobileOpen ? <Icons.X className="h-5 w-5" /> : <Icons.Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {mobileOpen && (
        <div className="md:hidden border-t border-border bg-background px-4 py-3 space-y-1">
          {navItems.map((item) => {
            const Icon = Icons[item.icon as keyof typeof Icons] as any;
            const isActive = currentPath === item.slug;
            return (
              <button
                key={item.slug}
                onClick={() => { navigation.navigate(item.slug); setMobileOpen(false); }}
                className={cn(
                  "flex items-center gap-2 w-full px-3 py-2 rounded-md text-sm font-medium",
                  isActive ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-accent"
                )}
              >
                {Icon && <Icon className="h-4 w-4" />}
                {item.label}
              </button>
            );
          })}
          {activeQuizId && (
            <div className="pt-2 border-t border-border mt-2">
              <Badge variant="secondary" className="flex items-center gap-1.5 w-fit px-3 py-1">
                <Icons.Zap className="h-3.5 w-3.5 text-primary" />
                <span className="font-semibold text-primary">{quizScore}</span>
                <span className="text-muted-foreground">pts</span>
              </Badge>
            </div>
          )}
        </div>
      )}
    </header>
  );
}

export default QuizHeader;
