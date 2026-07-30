import {
  React,
  useAppState,
  useCurrentUser,
  useNavigation,
  Icons,
  Badge,
  Avatar,
  AvatarFallback,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
  cn,
} from "@exepad/sdk";

function QuestHeader({ className }: { className?: string }) {
  const [totalXp] = useAppState<number>("totalXp", 280);
  const [level] = useAppState<number>("level", 5);
  const [currentStreak] = useAppState<number>("currentStreak", 7);
  const currentUser = useCurrentUser();
  const navigation = useNavigation();

  const xpForLevel = level * 100;
  const xpInLevel = totalXp % 100;
  const xpPercent = Math.round((xpInLevel / 100) * 100);

  const userName = currentUser?.displayName || currentUser?.email?.split("@")[0] || "Adventurer";
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
    <header
      className={cn(
        "w-full h-14 px-6 flex items-center justify-between bg-white border-b border-border shrink-0",
        className
      )}
    >
      {/* Left: Logo */}
      <div className="flex items-center gap-3 lg:hidden">
        <div className="w-8 h-8 rounded-lg level-badge flex items-center justify-center">
          <Icons.Flame className="h-4 w-4 text-white" />
        </div>
        <span className="font-bold text-foreground">HabitQuest</span>
      </div>

      {/* Center: XP Progress */}
      <div className="hidden sm:flex items-center gap-4 flex-1 max-w-md mx-auto">
        <div className="flex items-center gap-2">
          <div className="level-badge rounded-full px-2.5 py-0.5 flex items-center gap-1">
            <Icons.Shield className="h-3.5 w-3.5 text-white" />
            <span className="text-white text-xs font-bold">Lv. {level}</span>
          </div>
        </div>
        <div className="flex-1">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] text-muted-foreground font-medium">
              Level {level}
            </span>
            <span className="text-[10px] text-muted-foreground">
              {xpInLevel}/{100} XP
            </span>
          </div>
          <div className="w-full bg-border rounded-full xp-bar">
            <div
              className="xp-bar-fill h-full rounded-full"
              style={{ width: `${xpPercent}%` }}
            />
          </div>
        </div>
      </div>

      {/* Right: Streak + Avatar */}
      <div className="flex items-center gap-3">
        {/* Streak */}
        <div className="streak-badge rounded-lg px-2.5 py-1 flex items-center gap-1.5">
          <Icons.Flame className="h-3.5 w-3.5 text-white" />
          <span className="text-white text-xs font-bold">{currentStreak}</span>
        </div>

        {/* Total XP */}
        <Badge variant="secondary" className="text-xs bg-accent text-primary font-semibold">
          {totalXp} XP
        </Badge>

        {/* Avatar Dropdown */}
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
    </header>
  );
}

export default QuestHeader;
