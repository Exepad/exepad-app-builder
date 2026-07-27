import { React, cn, navigate, useModel, useAppState, Icons, Badge, Button, Separator, Avatar, AvatarFallback, useCurrentUser, useHandler, DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator } from '@exepad/sdk';

const DEMO_PROJECTS = [
  { id: '1', name: 'TaskForge v2', status: 'active' },
  { id: '2', name: 'Mobile App', status: 'planning' },
  { id: '3', name: 'API Redesign', status: 'active' },
];

const NAV_ITEMS = [
  { label: 'Dashboard', icon: 'LayoutDashboard', href: '/' },
  { label: 'Board', icon: 'Columns3', href: '/board' },
  { label: 'Tasks', icon: 'CheckSquare', href: '/tasks' },
  { label: 'Team', icon: 'Users', href: '/team' },
  { label: 'Timeline', icon: 'GanttChart', href: '/timeline' },
];

export default function ProjectSidebar({ className }) {
  const user = useCurrentUser();
  const signout = useHandler('auth_signout', { autoFetch: false });
  const { data: projects } = useModel('projects', { limit: 10, orderBy: { name: 'asc' } });
  const [selectedProject, setSelectedProject] = useAppState<number>('selectedProject', 1);

  const projectList = projects?.length ? projects : DEMO_PROJECTS;
  const path = typeof window !== 'undefined' ? window.location.pathname : '/';
  const currentPath = path.replace(/^\/[^/]+\/[^/]+\/[^/]+\/[^/]+/, '') || '/';

  return (
    <aside className={cn('h-full w-64 shrink-0 hidden lg:flex flex-col bg-card border-r border-border', className)}>
      <div className="flex flex-col h-full py-6 px-3">
        {/* Brand */}
        <div className="px-3 mb-6">
          <div className="flex items-center gap-3 mb-1">
            <div className="w-9 h-9 rounded-lg bg-primary flex items-center justify-center">
              <Icons.Hammer className="h-5 w-5 text-primary-foreground" />
            </div>
            <span className="text-lg font-bold tracking-tight text-foreground">TaskForge</span>
          </div>
          <p className="text-xs text-muted-foreground ml-12">Project Management</p>
        </div>

        {/* Project Selector */}
        <div className="px-3 mb-4">
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Projects</p>
          <div className="space-y-1">
            {(projectList as any[]).map((p: any, i: number) => (
              <button
                key={p.id}
                className={cn(
                  'w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors text-left',
                  selectedProject === i + 1
                    ? 'bg-accent text-accent-foreground font-medium'
                    : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
                )}
                onClick={() => setSelectedProject(i + 1)}
              >
                <span className={cn(
                  'w-2 h-2 rounded-full',
                  p.status === 'active' ? 'bg-green-500' : p.status === 'planning' ? 'bg-amber-500' : 'bg-gray-400'
                )} />
                <span className="truncate">{p.name}</span>
              </button>
            ))}
          </div>
        </div>

        <Separator className="mx-3 mb-4" />

        {/* Navigation */}
        <nav className="flex-1 space-y-1 px-1">
          {NAV_ITEMS.map((item) => {
            const Icon = Icons[item.icon] as React.ComponentType<{ className?: string }>;
            const isActive = currentPath === item.href;
            return (
              <a
                key={item.label}
                className={cn(
                  'flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors cursor-pointer text-sm',
                  isActive
                    ? 'bg-primary/10 text-primary font-semibold'
                    : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
                )}
                onClick={(e) => { e.preventDefault(); navigate(item.href); }}
              >
                {Icon && <Icon className={cn('h-4 w-4', isActive ? 'text-primary' : '')} />}
                <span>{item.label}</span>
              </a>
            );
          })}
        </nav>

        {/* Footer */}
        <div className="mt-auto pt-4 border-t border-border px-1">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex items-center gap-3 w-full px-3 py-2 rounded-lg hover:bg-accent transition-colors">
                <Avatar className="h-8 w-8">
                  <AvatarFallback className="text-xs bg-primary/10 text-primary font-semibold">
                    {(user?.name || user?.email || 'U')[0].toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0 text-left">
                  <p className="text-sm font-medium text-foreground truncate">{user?.name || user?.email || 'User'}</p>
                  <p className="text-[10px] text-muted-foreground">Project Manager</p>
                </div>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="top" align="start" className="w-56">
              <DropdownMenuLabel>
                <div className="flex flex-col">
                  <span className="text-sm">{user?.name || user?.email || 'User'}</span>
                  <span className="text-xs text-muted-foreground">{user?.email || ''}</span>
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => navigate('/profile')}>
                <Icons.User className="mr-2 h-4 w-4" />Profile
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => navigate('/settings')}>
                <Icons.Settings className="mr-2 h-4 w-4" />Settings
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {user?.isAuthenticated ? (
                <DropdownMenuItem onClick={async () => { await signout.execute({}); navigate('/'); }}>
                  <Icons.LogOut className="mr-2 h-4 w-4" />Sign Out
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem onClick={() => navigate('/login')}>
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
