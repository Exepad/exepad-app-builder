import {
  React,
  useAppState,
  useNavigation,
  useCurrentUser,
  Input,
  Button,
  Label,
  Switch,
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
  toast,
} from "@exepad/sdk";

function DashboardHeader() {
  const navigation = useNavigation();
  const currentUser = useCurrentUser();
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
  const [dateRange, setDateRange] = useAppState<{ from: string | null; to: string | null }>(
    "dateRange",
    { from: null, to: null }
  );
  const [comparisonEnabled, setComparisonEnabled] = useAppState<boolean>("comparisonEnabled", false);

  const dr = dateRange ?? { from: null, to: null };
  const comparison = comparisonEnabled ?? false;

  const handleFromChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setDateRange({ ...dr, from: e.target.value || null });
  };

  const handleToChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setDateRange({ ...dr, to: e.target.value || null });
  };

  const handleRefresh = () => {
    toast("Dashboard data refreshed");
  };

  const handleExport = (format: string) => {
    toast(`Exporting dashboard as ${format}...`);
  };

  const handlePresetRange = (days: number) => {
    const to = new Date();
    const from = new Date();
    from.setDate(from.getDate() - days);
    setDateRange({
      from: from.toISOString().split("T")[0],
      to: to.toISOString().split("T")[0],
    });
  };

  const currentPath = navigation?.currentPath ?? "/";
  const pageTitle =
    currentPath === "/" ? "Overview" :
    currentPath === "/traffic" ? "Traffic Analytics" :
    currentPath === "/revenue" ? "Revenue Reports" :
    currentPath === "/users" ? "User Analytics" :
    currentPath === "/explorer" ? "Data Explorer" : "Dashboard";

  return (
    <div className="flex items-center justify-between gap-4 px-6 py-3 border-b border-border bg-background">
      <div className="flex items-center gap-3">
        <button
          onClick={() => navigation.navigate("/")}
          className="flex items-center gap-2 hover:opacity-80 transition-opacity md:hidden"
        >
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Icons.BarChart3 className="h-4 w-4" />
          </div>
        </button>
        <div>
          <h1 className="text-lg font-semibold">{pageTitle}</h1>
          <p className="text-xs text-muted-foreground hidden sm:block">
            Real-time analytics and insights
          </p>
        </div>
      </div>

      <div className="flex items-center gap-3 flex-wrap justify-end">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5">
            <Label className="text-xs text-muted-foreground whitespace-nowrap hidden lg:inline">From</Label>
            <Input
              type="date"
              value={dr.from || ""}
              onChange={handleFromChange}
              className="h-8 w-[130px] text-xs"
            />
          </div>
          <div className="flex items-center gap-1.5">
            <Label className="text-xs text-muted-foreground whitespace-nowrap hidden lg:inline">To</Label>
            <Input
              type="date"
              value={dr.to || ""}
              onChange={handleToChange}
              className="h-8 w-[130px] text-xs"
            />
          </div>
        </div>

        <div className="hidden md:flex items-center gap-1">
          {[
            { label: "7D", days: 7 },
            { label: "30D", days: 30 },
            { label: "90D", days: 90 },
          ].map((preset) => (
            <Button
              key={preset.label}
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => handlePresetRange(preset.days)}
            >
              {preset.label}
            </Button>
          ))}
        </div>

        <div className="hidden sm:flex items-center gap-1.5">
          <Switch
            checked={comparison}
            onCheckedChange={(checked: boolean) => setComparisonEnabled(checked)}
            className="scale-75"
          />
          <Label className="text-xs text-muted-foreground cursor-pointer">Compare</Label>
        </div>

        <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={handleRefresh}>
          <Icons.RefreshCw className="h-3.5 w-3.5" />
          <span className="hidden sm:inline text-xs">Refresh</span>
        </Button>

        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="h-8 gap-1.5">
              <Icons.Download className="h-3.5 w-3.5" />
              <span className="hidden sm:inline text-xs">Export</span>
              <Icons.ChevronDown className="h-3 w-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-40">
            <DropdownMenuItem onClick={() => handleExport("PDF")}>
              <Icons.FileText className="mr-2 h-4 w-4" />
              Export PDF
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => handleExport("CSV")}>
              <Icons.Sheet className="mr-2 h-4 w-4" />
              Export CSV
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => handleExport("PNG")}>
              <Icons.Image className="mr-2 h-4 w-4" />
              Export PNG
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

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
      </div>
    </div>
  );
}

export default DashboardHeader;
