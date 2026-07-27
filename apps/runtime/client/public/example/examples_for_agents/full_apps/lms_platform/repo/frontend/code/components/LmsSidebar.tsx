import {
  React,
  useModel,
  useNavigation,
  useCurrentUser,
  useHandler,
  Avatar,
  AvatarFallback,
  Badge,
  Progress,
  ScrollArea,
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

const DEMO_ENROLLMENTS = [
  { id: 1, course_id: 1, progress_pct: 72, status: "active", enrolled_at: "2026-01-15T10:00:00Z", course_title: "React & TypeScript Masterclass" },
  { id: 2, course_id: 3, progress_pct: 45, status: "active", enrolled_at: "2026-02-01T10:00:00Z", course_title: "Python for Data Science" },
  { id: 3, course_id: 5, progress_pct: 100, status: "completed", enrolled_at: "2025-11-10T10:00:00Z", course_title: "UI/UX Design Fundamentals" },
  { id: 4, course_id: 7, progress_pct: 18, status: "active", enrolled_at: "2026-03-05T10:00:00Z", course_title: "AWS Cloud Practitioner" },
  { id: 5, course_id: 9, progress_pct: 100, status: "completed", enrolled_at: "2025-10-20T10:00:00Z", course_title: "Digital Marketing Strategy" },
];

interface NavItem {
  label: string;
  icon: keyof typeof Icons;
  path: string;
}

const NAV_ITEMS: NavItem[] = [
  { label: "Dashboard", icon: "LayoutDashboard", path: "/" },
  { label: "Courses", icon: "BookOpen", path: "/courses" },
  { label: "Progress", icon: "BarChart3", path: "/progress" },
  { label: "Quizzes", icon: "FileQuestion", path: "/quizzes" },
];

export default function LmsSidebar() {
  const { navigate, currentPath } = useNavigation();
  const currentUser = useCurrentUser();
  const signout = useHandler("auth_signout", { autoFetch: false });
  const enrollmentsModel = useModel("enrollments");
  const enrollments = (enrollmentsModel?.data as any[] | null) ?? DEMO_ENROLLMENTS;
  const activeEnrollments = (enrollments || DEMO_ENROLLMENTS).filter(
    (e: any) => e.status === "active"
  );

  const isActive = (path: string) => {
    if (path === "/") return currentPath === "/" || currentPath === "";
    return currentPath.startsWith(path);
  };

  return (
    <div className="flex flex-col h-full bg-background border-r border-border w-64 shrink-0">
      {/* Logo */}
      <div className="p-6 flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center">
          <Icons.GraduationCap className="w-6 h-6 text-primary-foreground" />
        </div>
        <div>
          <h1 className="text-lg font-bold text-foreground tracking-tight">LearnHub</h1>
          <p className="text-xs text-muted-foreground">Learning Platform</p>
        </div>
      </div>

      <Separator />

      {/* Navigation */}
      <nav className="p-3 space-y-1">
        {NAV_ITEMS.map((item) => {
          const Icon = Icons[item.icon] as React.ComponentType<{ className?: string }>;
          const active = isActive(item.path);
          return (
            <button
              key={item.path}
              onClick={() => navigate(item.path)}
              className={cn(
                "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
                active
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              {Icon && <Icon className="w-5 h-5" />}
              {item.label}
            </button>
          );
        })}
      </nav>

      <Separator className="mx-3" />

      {/* My Courses */}
      <div className="p-3 flex-1 overflow-hidden flex flex-col">
        <h3 className="px-3 mb-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          My Courses
        </h3>
        <ScrollArea className="flex-1">
          <div className="space-y-1">
            {activeEnrollments.map((enrollment: any) => (
              <button
                key={enrollment.id}
                onClick={() => navigate(`/course/${enrollment.course_id}`)}
                className="w-full text-left px-3 py-2.5 rounded-lg hover:bg-muted transition-colors group"
              >
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-sm font-medium text-foreground truncate pr-2 group-hover:text-primary transition-colors">
                    {enrollment.course_title}
                  </span>
                  <span className="text-xs text-muted-foreground shrink-0">
                    {enrollment.progress_pct}%
                  </span>
                </div>
                <div className="w-full bg-muted rounded-full h-1.5">
                  <div
                    className="bg-primary rounded-full h-1.5 transition-all duration-500"
                    style={{ width: `${enrollment.progress_pct}%` }}
                  />
                </div>
              </button>
            ))}
          </div>
        </ScrollArea>
      </div>

      {/* Footer */}
      <Separator />
      <div className="p-3">
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
                <span className="text-muted-foreground truncate">{currentUser?.email || "user@learnhub.io"}</span>
              </div>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="start" className="w-56">
            <DropdownMenuLabel>
              <div className="flex flex-col">
                <span className="text-sm">{currentUser?.displayName || currentUser?.email || "User"}</span>
                <span className="text-xs text-muted-foreground">{currentUser?.email || "user@learnhub.io"}</span>
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
  );
}
