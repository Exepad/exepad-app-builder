import {
  React,
  useNavigation,
  useCurrentUser,
  useAppState,
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInput,
  SidebarInset,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarProvider,
  SidebarRail,
  SidebarSeparator,
  SidebarTrigger,
  useSidebar,
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
  Avatar,
  AvatarFallback,
  Badge,
  Button,
  Icons,
  cn,
} from "@exepad/sdk";

interface NavItem {
  label: string;
  icon: keyof typeof Icons;
  slug: string;
  badge?: number;
}

interface Project {
  name: string;
  slug: string;
  color: string;
}

interface ResourceLink {
  label: string;
  icon: keyof typeof Icons;
  href: string;
}

const NAV_ITEMS: NavItem[] = [
  { label: "Dashboard", icon: "LayoutDashboard", slug: "dashboard", badge: 0 },
  { label: "Analytics", icon: "BarChart3", slug: "analytics", badge: 5 },
  { label: "Users", icon: "Users", slug: "users", badge: 12 },
  { label: "Settings", icon: "Settings", slug: "settings", badge: 0 },
];

const PROJECTS: Project[] = [
  { name: "Website Redesign", slug: "website-redesign", color: "bg-blue-500" },
  { name: "Mobile App v2", slug: "mobile-app-v2", color: "bg-green-500" },
  { name: "API Migration", slug: "api-migration", color: "bg-purple-500" },
];

const RESOURCES: ResourceLink[] = [
  { label: "Documentation", icon: "BookOpen", href: "#docs" },
  { label: "API Reference", icon: "Code2", href: "#api" },
];

const PAGE_CONTENT: Record<string, { title: string; description: string; stats: { label: string; value: string }[] }> = {
  dashboard: {
    title: "Dashboard",
    description: "Welcome back! Here's an overview of your workspace activity.",
    stats: [
      { label: "Total Projects", value: "12" },
      { label: "Active Tasks", value: "34" },
      { label: "Team Members", value: "8" },
      { label: "Completion Rate", value: "87%" },
    ],
  },
  analytics: {
    title: "Analytics",
    description: "Track performance metrics and usage patterns across your projects.",
    stats: [
      { label: "Page Views", value: "24.5K" },
      { label: "Unique Visitors", value: "8.2K" },
      { label: "Avg. Session", value: "4m 32s" },
      { label: "Bounce Rate", value: "32%" },
    ],
  },
  users: {
    title: "Users",
    description: "Manage team members, roles, and permissions.",
    stats: [
      { label: "Total Users", value: "156" },
      { label: "Active Today", value: "42" },
      { label: "New This Week", value: "7" },
      { label: "Pending Invites", value: "3" },
    ],
  },
  settings: {
    title: "Settings",
    description: "Configure your workspace preferences and integrations.",
    stats: [
      { label: "Integrations", value: "5" },
      { label: "Webhooks", value: "3" },
      { label: "API Keys", value: "2" },
      { label: "Storage Used", value: "4.2 GB" },
    ],
  },
};

function SidebarAppContent() {
  const { toggleSidebar } = useSidebar();
  const navigation = useNavigation();
  const currentUser = useCurrentUser();
  const [activePage, setActivePage] = useAppState<string>("activePage", "dashboard");
  const [searchQuery, setSearchQuery] = useAppState<string>("sidebarSearch", "");
  const [projectsOpen, setProjectsOpen] = React.useState(true);

  const page = activePage ?? "dashboard";
  const search = searchQuery ?? "";
  const content = PAGE_CONTENT[page] || PAGE_CONTENT.dashboard;

  const userName = currentUser?.displayName || currentUser?.email || "Guest User";
  const userInitials = userName
    .split(" ")
    .map((n: string) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  const filteredNavItems = NAV_ITEMS.filter((item) =>
    item.label.toLowerCase().includes(search.toLowerCase())
  );

  const filteredProjects = PROJECTS.filter((project) =>
    project.name.toLowerCase().includes(search.toLowerCase())
  );

  const handleNavClick = (slug: string) => {
    setActivePage(slug);
    navigation.navigate("/");
  };

  return (
    <>
      <Sidebar>
        <SidebarHeader className="border-b border-border px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <Icons.Layers className="h-4 w-4" />
              </div>
              <span className="font-semibold text-sm">Workspace</span>
            </div>
            <SidebarTrigger />
          </div>
        </SidebarHeader>

        <div className="px-3 py-2">
          <SidebarInput
            placeholder="Search..."
            value={search}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              setSearchQuery(e.target.value)
            }
          />
        </div>

        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>Navigation</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {filteredNavItems.map((item) => {
                  const Icon = Icons[item.icon] as React.ComponentType<{
                    className?: string;
                  }>;
                  const isActive = page === item.slug;
                  return (
                    <SidebarMenuItem key={item.slug}>
                      <SidebarMenuButton
                        isActive={isActive}
                        onClick={() => handleNavClick(item.slug)}
                        tooltip={item.label}
                      >
                        {Icon && <Icon className="h-4 w-4" />}
                        <span>{item.label}</span>
                      </SidebarMenuButton>
                      {item.badge > 0 && (
                        <SidebarMenuBadge>{item.badge}</SidebarMenuBadge>
                      )}
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>

          <SidebarSeparator />

          <SidebarGroup>
            <SidebarGroupLabel>Projects</SidebarGroupLabel>
            <SidebarGroupAction title="Add Project">
              <Icons.Plus className="h-4 w-4" />
            </SidebarGroupAction>
            <SidebarGroupContent>
              <SidebarMenu>
                <Collapsible open={projectsOpen} onOpenChange={setProjectsOpen}>
                  <SidebarMenuItem>
                    <CollapsibleTrigger asChild>
                      <SidebarMenuButton>
                        <Icons.Folder className="h-4 w-4" />
                        <span>All Projects</span>
                        <Icons.ChevronRight
                          className={cn(
                            "ml-auto h-4 w-4 transition-transform",
                            projectsOpen && "rotate-90"
                          )}
                        />
                      </SidebarMenuButton>
                    </CollapsibleTrigger>
                    <SidebarMenuAction title="New Project">
                      <Icons.Plus className="h-4 w-4" />
                    </SidebarMenuAction>
                    <CollapsibleContent>
                      <SidebarMenuSub>
                        {filteredProjects.map((project) => (
                          <SidebarMenuSubItem key={project.slug}>
                            <SidebarMenuSubButton
                              onClick={() => handleNavClick("dashboard")}
                            >
                              <span
                                className={cn(
                                  "h-2 w-2 rounded-full",
                                  project.color
                                )}
                              />
                              <span>{project.name}</span>
                            </SidebarMenuSubButton>
                          </SidebarMenuSubItem>
                        ))}
                      </SidebarMenuSub>
                    </CollapsibleContent>
                  </SidebarMenuItem>
                </Collapsible>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>

          <SidebarSeparator />

          <SidebarGroup>
            <SidebarGroupLabel>Resources</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {RESOURCES.map((resource) => {
                  const Icon = Icons[resource.icon] as React.ComponentType<{
                    className?: string;
                  }>;
                  return (
                    <SidebarMenuItem key={resource.href}>
                      <SidebarMenuButton tooltip={resource.label}>
                        {Icon && <Icon className="h-4 w-4" />}
                        <span>{resource.label}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>

        <SidebarFooter className="border-t border-border p-3">
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton className="h-auto py-2">
                <Avatar className="h-8 w-8">
                  <AvatarFallback className="text-xs bg-primary/10 text-primary">
                    {userInitials}
                  </AvatarFallback>
                </Avatar>
                <div className="flex flex-col text-left text-xs leading-tight">
                  <span className="font-semibold truncate">{userName}</span>
                  <span className="text-muted-foreground truncate">
                    {currentUser?.email || "guest@example.com"}
                  </span>
                </div>
                <Icons.ChevronsUpDown className="ml-auto h-4 w-4 text-muted-foreground" />
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>

        <SidebarRail />
      </Sidebar>

      <SidebarInset>
        <header className="flex h-14 items-center gap-2 border-b border-border px-6">
          <SidebarTrigger className="-ml-2" />
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">Workspace</span>
            <Icons.ChevronRight className="h-3 w-3 text-muted-foreground" />
            <span className="font-medium">{content.title}</span>
          </div>
        </header>
        <main className="flex-1 p-6">
          <div className="mb-6">
            <h1 className="text-2xl font-bold tracking-tight">{content.title}</h1>
            <p className="text-muted-foreground mt-1">{content.description}</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {content.stats.map((stat) => (
              <div
                key={stat.label}
                className="rounded-lg border border-border bg-card p-4"
              >
                <p className="text-sm text-muted-foreground">{stat.label}</p>
                <p className="text-2xl font-bold mt-1">{stat.value}</p>
              </div>
            ))}
          </div>
          <div className="mt-6 rounded-lg border border-border bg-card p-6">
            <h2 className="text-lg font-semibold mb-2">Recent Activity</h2>
            <div className="space-y-3">
              {[
                { action: "Deployed v2.1.0 to production", time: "2 hours ago", icon: "Rocket" as keyof typeof Icons },
                { action: "Merged pull request #142", time: "4 hours ago", icon: "GitMerge" as keyof typeof Icons },
                { action: "Added 3 new team members", time: "Yesterday", icon: "UserPlus" as keyof typeof Icons },
                { action: "Updated API documentation", time: "2 days ago", icon: "FileText" as keyof typeof Icons },
              ].map((activity, index) => {
                const ActivityIcon = Icons[activity.icon] as React.ComponentType<{
                  className?: string;
                }>;
                return (
                  <div
                    key={index}
                    className="flex items-center gap-3 text-sm"
                  >
                    {ActivityIcon && (
                      <ActivityIcon className="h-4 w-4 text-muted-foreground shrink-0" />
                    )}
                    <span className="flex-1">{activity.action}</span>
                    <span className="text-muted-foreground text-xs">
                      {activity.time}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </main>
      </SidebarInset>
    </>
  );
}

function SidebarApp() {
  return (
    <SidebarProvider>
      <SidebarAppContent />
    </SidebarProvider>
  );
}

export default SidebarApp;
