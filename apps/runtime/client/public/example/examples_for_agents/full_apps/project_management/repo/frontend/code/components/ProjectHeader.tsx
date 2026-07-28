import { React, cn, Input, Button, Badge, Avatar, AvatarFallback, Icons, useCurrentUser, useNavigation, useAppState, useModel, DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuLabel } from '@exepad/sdk';

const DEMO_PROJECTS = [
  { id: '1', name: 'TaskForge v2', status: 'active' },
  { id: '2', name: 'Mobile App', status: 'planning' },
  { id: '3', name: 'API Redesign', status: 'active' },
];

export default function ProjectHeader({ className }) {
  const user = useCurrentUser();
  const navigation = useNavigation();
  const { data: projects } = useModel('projects', { limit: 10, orderBy: { name: 'asc' } });
  const [selectedProject] = useAppState<number>('selectedProject', 1);
  const [searchQuery, setSearchQuery] = React.useState('');
  const userName = user?.displayName || user?.email?.split("@")[0] || "User";
  const userEmail = user?.email || "user@taskforge.app";
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

  const projectList = projects?.length ? projects : DEMO_PROJECTS;
  const currentProject = (projectList as any[])[selectedProject - 1] || (projectList as any[])[0];

  const statusColors = {
    active: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300',
    planning: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-300',
    on_hold: 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-300',
    completed: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300',
    archived: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300',
  };

  return (
    <header className={cn('w-full sticky top-0 z-40 bg-card/80 backdrop-blur-md border-b border-border', className)}>
      <div className="flex items-center justify-between px-6 py-3">
        {/* Left: Project Info */}
        <div className="flex items-center gap-4">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-bold text-foreground">{currentProject?.name || 'Project'}</h1>
              <Badge className={cn('text-[10px]', statusColors[currentProject?.status] || statusColors.active)}>
                {(currentProject?.status || 'active').replace('_', ' ')}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground">
              {currentProject?.status === 'active' ? 'In Progress' : 'Planning Phase'} &middot; Updated today
            </p>
          </div>
        </div>

        {/* Center: Search */}
        <div className="hidden md:flex flex-1 max-w-md mx-8">
          <div className="relative w-full">
            <Icons.Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              className="pl-9 bg-secondary border-none h-9"
              placeholder="Search tasks, members..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>

        {/* Right: Actions */}
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" className="relative h-9 w-9">
            <Icons.Bell className="h-4 w-4" />
            <span className="absolute top-1 right-1 w-2 h-2 bg-destructive rounded-full" />
          </Button>
          <Button variant="ghost" size="icon" className="h-9 w-9">
            <Icons.Settings className="h-4 w-4" />
          </Button>
          <div className="h-6 w-px bg-border mx-1" />
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
