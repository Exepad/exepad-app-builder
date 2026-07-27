import {
  React,
  useAppState,
  useNavigation,
  useCurrentUser,
  useHandler,
  Avatar,
  AvatarFallback,
  Separator,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  Icons,
  cn,
} from "@exepad/sdk";

interface NavItem {
  label: string;
  icon: keyof typeof Icons;
  slug: string;
  trend: number[];
  value: string;
}

const NAV_ITEMS: NavItem[] = [
  { label: "Overview", icon: "LayoutDashboard", slug: "/", trend: [3, 5, 4, 7, 6, 8, 9], value: "45.2K" },
  { label: "Traffic", icon: "Globe", slug: "/traffic", trend: [6, 4, 5, 7, 8, 6, 9], value: "12.8K" },
  { label: "Revenue", icon: "DollarSign", slug: "/revenue", trend: [2, 4, 3, 5, 6, 7, 8], value: "$124K" },
  { label: "Users", icon: "Users", slug: "/users", trend: [5, 6, 4, 7, 5, 8, 7], value: "8.4K" },
  { label: "Explorer", icon: "Database", slug: "/explorer", trend: [4, 3, 5, 4, 6, 5, 7], value: "32 tbl" },
];

function MiniSparkline({ data, color }: { data: number[]; color: string }) {
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const width = 48;
  const height = 16;
  const step = width / (data.length - 1);

  const points = data
    .map((v, i) => `${i * step},${height - ((v - min) / range) * height}`)
    .join(" ");

  return (
    <svg width={width} height={height} className="shrink-0">
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function AnalyticsSidebar() {
  const navigation = useNavigation();
  const currentUser = useCurrentUser();
  const signout = useHandler("auth_signout", { autoFetch: false });
  const [dateRange] = useAppState<{ from: string | null; to: string | null }>("dateRange", { from: null, to: null });

  const currentPath = navigation?.currentPath ?? "/";
  const userName = currentUser?.displayName || currentUser?.email || "Analyst";
  const userInitials = userName
    .split(" ")
    .map((n: string) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  const handleNavClick = (slug: string) => {
    navigation.navigate(slug);
  };

  const dr = dateRange ?? { from: null, to: null };
  const fromLabel = dr.from || "Start";
  const toLabel = dr.to || "Today";

  return (
    <aside className="h-full w-64 shrink-0 flex flex-col bg-background border-r border-border">
      {/* Header */}
      <div className="border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Icons.BarChart3 className="h-4 w-4" />
          </div>
          <div>
            <span className="font-bold text-sm">InsightBoard</span>
            <p className="text-[10px] text-muted-foreground leading-none">Analytics Platform</p>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <div className="flex-1 overflow-y-auto py-2">
        <div className="px-3 mb-1">
          <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Analytics</span>
        </div>
        <nav className="space-y-0.5 px-2">
          {NAV_ITEMS.map((item) => {
            const Icon = Icons[item.icon] as React.ComponentType<{ className?: string }>;
            const isActive = currentPath === item.slug;
            return (
              <button
                key={item.slug}
                onClick={() => handleNavClick(item.slug)}
                className={cn(
                  "flex items-center justify-between w-full rounded-md px-2.5 py-2 text-sm transition-colors",
                  isActive
                    ? "bg-primary/10 text-primary font-medium"
                    : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                )}
              >
                <div className="flex items-center gap-2">
                  {Icon && <Icon className="h-4 w-4" />}
                  <span>{item.label}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <MiniSparkline
                    data={item.trend}
                    color={isActive ? "hsl(var(--primary))" : "hsl(var(--muted-foreground))"}
                  />
                  <span className="text-[10px] text-muted-foreground font-medium min-w-[32px] text-right">
                    {item.value}
                  </span>
                </div>
              </button>
            );
          })}
        </nav>

        <Separator className="my-3" />

        {/* Quick Stats */}
        <div className="px-3 mb-1">
          <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Quick Stats</span>
        </div>
        <div className="px-4 py-2 space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Bounce Rate</span>
            <span className="font-medium">34.2%</span>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Avg Session</span>
            <span className="font-medium">4m 32s</span>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Pages/Session</span>
            <span className="font-medium">3.8</span>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="border-t border-border p-3">
        <div className="px-2 py-1.5 mb-2">
          <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
            <Icons.Calendar className="h-3 w-3" />
            <span>{fromLabel} — {toLabel}</span>
          </div>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex items-center gap-2 w-full px-2 py-1.5 rounded-md hover:bg-accent transition-colors">
              <Avatar className="h-8 w-8">
                <AvatarFallback className="text-xs bg-primary/10 text-primary">
                  {userInitials}
                </AvatarFallback>
              </Avatar>
              <div className="flex flex-col text-left text-xs leading-tight">
                <span className="font-semibold truncate">{userName}</span>
                <span className="text-muted-foreground truncate">
                  {currentUser?.email || "analyst@insightboard.io"}
                </span>
              </div>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="start" className="w-56">
            <DropdownMenuLabel>
              <div className="flex flex-col">
                <span className="text-sm">{userName}</span>
                <span className="text-xs text-muted-foreground">{currentUser?.email || "analyst@insightboard.io"}</span>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            {currentUser.isAuthenticated ? (
              <>
                <DropdownMenuItem onClick={() => navigation.navigate("/profile")}>
                  <Icons.User className="mr-2 h-4 w-4" />Profile
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => navigation.navigate("/settings")}>
                  <Icons.Settings className="mr-2 h-4 w-4" />Settings
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={async () => { await signout.execute({}); navigation.navigate("/"); }}>
                  <Icons.LogOut className="mr-2 h-4 w-4" />Sign Out
                </DropdownMenuItem>
              </>
            ) : (
              <DropdownMenuItem onClick={() => navigation.navigate("/login")}>
                <Icons.LogIn className="mr-2 h-4 w-4" />Sign In
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </aside>
  );
}

export default AnalyticsSidebar;
