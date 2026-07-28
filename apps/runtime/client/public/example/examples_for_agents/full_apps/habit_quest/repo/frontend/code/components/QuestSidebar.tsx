import {
  React,
  useAppState,
  cn,
  navigate,
  useCurrentUser,
  useHandler,
  Avatar,
  AvatarFallback,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  Icons,
  Badge,
} from "@exepad/sdk";

const navItems = [
  { label: "Dashboard", icon: "LayoutDashboard", href: "/" },
  { label: "My Habits", icon: "ListChecks", href: "/habits" },
  { label: "Achievements", icon: "Trophy", href: "/achievements" },
  { label: "Profile", icon: "User", href: "/profile" },
];

function QuestSidebar({ className }: { className?: string }) {
  const currentUser = useCurrentUser();
  const signout = useHandler("auth_signout", { autoFetch: false });
  const [totalXp] = useAppState<number>("totalXp", 280);
  const [level] = useAppState<number>("level", 5);
  const path = typeof window !== "undefined" ? window.location.pathname : "/";
  const currentPath = path.replace(/^\/[^/]+\/[^/]+\/[^/]+\/[^/]+/, "") || "/";
  const xpInLevel = totalXp % 100;
  const xpPercent = Math.round((xpInLevel / 100) * 100);

  return (
    <aside
      className={cn(
        "h-full w-64 shrink-0 hidden lg:flex flex-col bg-white border-r border-border",
        className
      )}
    >
      <div className="flex flex-col h-full py-6 px-4">
        {/* Logo */}
        <div className="px-3 mb-8">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-xl level-badge flex items-center justify-center shadow-lg shadow-primary/20">
              <Icons.Flame className="h-5 w-5 text-white" />
            </div>
            <div>
              <h1 className="font-bold text-lg text-foreground tracking-tight leading-none">
                HabitQuest
              </h1>
              <p className="text-[10px] text-muted-foreground mt-0.5">
                Level Up Your Life
              </p>
            </div>
          </div>

          {/* Level Badge */}
          <div className="level-badge rounded-lg px-3 py-2 flex items-center gap-2">
            <Icons.Shield className="h-5 w-5 text-white" />
            <div>
              <p className="text-white font-bold text-sm leading-none">
                Level {level}
              </p>
              <p className="text-white/70 text-[10px] mt-0.5">
                {totalXp} XP total
              </p>
            </div>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 space-y-1">
          {navItems.map((item) => {
            const Icon = Icons[item.icon as keyof typeof Icons] as React.ComponentType<{
              className?: string;
            }>;
            const isActive = currentPath === item.href;

            return (
              <a
                key={item.label}
                className={cn(
                  "nav-item flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer text-sm",
                  isActive
                    ? "bg-accent text-primary font-semibold"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted"
                )}
                onClick={(e) => {
                  e.preventDefault();
                  navigate(item.href);
                }}
              >
                {Icon && (
                  <Icon
                    className={cn(
                      "h-5 w-5",
                      isActive ? "text-primary" : "text-muted-foreground"
                    )}
                  />
                )}
                <span>{item.label}</span>
                {item.label === "Achievements" && (
                  <Badge
                    variant="secondary"
                    className="ml-auto text-[10px] px-1.5 py-0 bg-primary/10 text-primary"
                  >
                    3 new
                  </Badge>
                )}
              </a>
            );
          })}
        </nav>

        {/* Bottom: Level Progress */}
        <div className="mt-auto pt-4 border-t border-border">
          <div className="px-3 py-3 bg-accent/50 rounded-lg mb-3">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <Icons.Zap className="h-4 w-4 text-primary" />
                <span className="text-xs font-medium text-foreground">
                  Next Level
                </span>
              </div>
              <span className="text-[10px] text-muted-foreground">
                {xpPercent}%
              </span>
            </div>
            <div className="w-full bg-border rounded-full h-2 mb-1.5">
              <div
                className="bg-primary h-2 rounded-full"
                style={{ width: `${xpPercent}%` }}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              <span className="font-semibold text-foreground">
                {xpInLevel}
              </span>{" "}
              / 100 XP to Level {level + 1}
            </p>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex items-center gap-2 w-full px-2 py-1.5 rounded-md hover:bg-accent transition-colors">
                <Avatar className="h-8 w-8">
                  <AvatarFallback className="text-xs bg-primary/10 text-primary">
                    {(currentUser?.displayName || currentUser?.email || "U").charAt(0).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div className="flex flex-col text-left text-xs leading-tight">
                  <span className="font-semibold truncate">{currentUser?.displayName || currentUser?.email || "User"}</span>
                  <span className="text-muted-foreground truncate">{currentUser?.email || "user@habitquest.io"}</span>
                </div>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="top" align="start" className="w-56">
              <DropdownMenuLabel>
                <div className="flex flex-col">
                  <span className="text-sm">{currentUser?.displayName || currentUser?.email || "User"}</span>
                  <span className="text-xs text-muted-foreground">{currentUser?.email || "user@habitquest.io"}</span>
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              {currentUser.isAuthenticated ? (
                <>
                  <DropdownMenuItem onClick={() => navigate("/profile")}>
                    <Icons.User className="mr-2 h-4 w-4" />Profile
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => navigate("/settings")}>
                    <Icons.Settings className="mr-2 h-4 w-4" />Settings
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={async () => { await signout.execute({}); navigate("/"); }}>
                    <Icons.LogOut className="mr-2 h-4 w-4" />Sign Out
                  </DropdownMenuItem>
                </>
              ) : (
                <DropdownMenuItem onClick={() => navigate("/login")}>
                  <Icons.LogIn className="mr-2 h-4 w-4" />Sign In
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </aside>
  );
}

export default QuestSidebar;
