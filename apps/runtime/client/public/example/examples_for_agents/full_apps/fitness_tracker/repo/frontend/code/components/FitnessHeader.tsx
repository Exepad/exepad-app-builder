import {
  React,
  cn,
  Icons,
  Button,
  Avatar,
  AvatarFallback,
  Badge,
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
  useCurrentUser,
  useNavigation,
} from "@exepad/sdk";

const STREAK_DAYS = 12;

function FitnessHeader({ className }: { className?: string }) {
  const user = useCurrentUser();
  const navigation = useNavigation();
  const userName = user?.displayName || user?.email?.split("@")[0] || "User";
  const userEmail = user?.email || "user@app.com";
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
  const today = new Date();
  const dateStr = today.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  const initials = (user?.name || user?.email || "U")
    .split(" ")
    .map((w: string) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  return (
    <header
      className={cn(
        "w-full sticky top-0 z-40 bg-white/80 backdrop-blur-md border-b border-border",
        className
      )}
    >
      <div className="flex items-center justify-between px-6 py-3">
        {/* Left: Date + Streak */}
        <div className="flex items-center gap-4">
          <div>
            <p className="text-sm font-semibold text-foreground">{dateStr}</p>
            <p className="text-xs text-muted-foreground">
              Track your fitness journey
            </p>
          </div>
          <Badge className="streak-badge border-0 text-white font-bold text-xs px-2.5 py-1 gap-1">
            <span>🔥</span>
            <span>{STREAK_DAYS} days</span>
          </Badge>
        </div>

        {/* Right: Quick Actions + Avatar */}
        <div className="flex items-center gap-3">
          {/* Quick Log Workout */}
          <Dialog>
            <DialogTrigger asChild>
              <Button
                size="sm"
                className="bg-primary text-white hover:bg-primary/90 gap-1.5"
              >
                <Icons.Plus className="h-4 w-4" />
                <span className="hidden sm:inline">Workout</span>
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Quick Log Workout</DialogTitle>
                <DialogDescription>
                  Add a quick workout entry to your log.
                </DialogDescription>
              </DialogHeader>
              <div className="py-4 text-center text-sm text-muted-foreground">
                Navigate to the Workouts page for full logging features.
              </div>
            </DialogContent>
          </Dialog>

          {/* Quick Log Meal */}
          <Dialog>
            <DialogTrigger asChild>
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5 border-primary/20 text-primary hover:bg-accent"
              >
                <Icons.Plus className="h-4 w-4" />
                <span className="hidden sm:inline">Meal</span>
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Quick Log Meal</DialogTitle>
                <DialogDescription>
                  Add a quick meal entry to your nutrition tracker.
                </DialogDescription>
              </DialogHeader>
              <div className="py-4 text-center text-sm text-muted-foreground">
                Navigate to the Nutrition page for full tracking features.
              </div>
            </DialogContent>
          </Dialog>

          {/* Notifications */}
          <Button variant="ghost" size="sm" className="relative">
            <Icons.Bell className="h-5 w-5 text-muted-foreground" />
            <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-destructive rounded-full" />
          </Button>

          {/* Separator */}
          <div className="h-8 w-px bg-border mx-1" />

          {/* User Avatar */}
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
    </header>
  );
}

export default FitnessHeader;
