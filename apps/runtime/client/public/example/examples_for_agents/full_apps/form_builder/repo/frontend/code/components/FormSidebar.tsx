import {
  React,
  useNavigation,
  useCurrentUser,
  useHandler,
  useModel,
  Avatar,
  AvatarFallback,
  Badge,
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
  path: string;
  section: string;
}

const NAV_ITEMS: NavItem[] = [
  { label: "Dashboard", icon: "LayoutDashboard", path: "/", section: "Overview" },
  { label: "Contact Form", icon: "Mail", path: "/contact-form", section: "Forms" },
  { label: "Registration", icon: "UserPlus", path: "/registration", section: "Forms" },
  { label: "Feedback", icon: "Star", path: "/feedback", section: "Forms" },
  { label: "Submissions", icon: "Inbox", path: "/submissions", section: "Management" },
];

const DEMO_SUBMISSIONS = [
  { id: "1", status: "pending" },
  { id: "2", status: "pending" },
  { id: "3", status: "reviewed" },
  { id: "4", status: "pending" },
  { id: "5", status: "archived" },
];

function FormSidebar() {
  const navigation = useNavigation();
  const currentUser = useCurrentUser();
  const signout = useHandler("auth_signout", { autoFetch: false });
  const submissionsModel = useModel("submissions");
  const submissions = (submissionsModel?.data as any[] | null) ?? DEMO_SUBMISSIONS;
  const currentPath = navigation.currentPath || "/";

  const pendingCount = submissions.filter((s) => s.status === "pending").length;

  const sections = ["Overview", "Forms", "Management"];

  const handleNav = (path: string) => {
    navigation.navigate(path);
  };

  return (
    <div className="flex flex-col h-full bg-background border-r border-border w-64 shrink-0">
      {/* Logo */}
      <div className="flex items-center gap-3 px-4 py-5 border-b border-border">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <Icons.FileText className="h-5 w-5" />
        </div>
        <div className="flex flex-col">
          <span className="font-bold text-sm tracking-tight">FormFlow</span>
          <span className="text-[11px] text-muted-foreground">Form Management</span>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 space-y-6 overflow-y-auto">
        {sections.map((section) => (
          <div key={section}>
            <p className="px-3 mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              {section}
            </p>
            <div className="space-y-1">
              {NAV_ITEMS.filter((item) => item.section === section).map((item) => {
                const Icon = Icons[item.icon] as React.ComponentType<{ className?: string }>;
                const isActive = currentPath === item.path || (item.path !== "/" && currentPath.startsWith(item.path));
                const isExactHome = item.path === "/" && currentPath === "/";
                const active = item.path === "/" ? isExactHome : isActive;

                return (
                  <button
                    key={item.path}
                    onClick={() => handleNav(item.path)}
                    className={cn(
                      "flex items-center gap-3 w-full px-3 py-2 rounded-md text-sm font-medium transition-colors",
                      active
                        ? "bg-primary/10 text-primary"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground"
                    )}
                  >
                    {Icon && <Icon className="h-4 w-4 shrink-0" />}
                    <span className="flex-1 text-left">{item.label}</span>
                    {item.label === "Submissions" && pendingCount > 0 && (
                      <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                        {pendingCount}
                      </Badge>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Footer */}
      <div className="px-3 py-3 border-t border-border">
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
                <span className="text-muted-foreground truncate">{currentUser?.email || "user@formflow.io"}</span>
              </div>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="start" className="w-56">
            <DropdownMenuLabel>
              <div className="flex flex-col">
                <span className="text-sm">{currentUser?.displayName || currentUser?.email || "User"}</span>
                <span className="text-xs text-muted-foreground">{currentUser?.email || "user@formflow.io"}</span>
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
    </div>
  );
}

export default FormSidebar;
