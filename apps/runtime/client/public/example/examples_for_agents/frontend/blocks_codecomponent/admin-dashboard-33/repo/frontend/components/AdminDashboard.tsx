import {
  React,
  useModel,
  useCurrentUser,
  useNavigation,
  useTheme,
  useAppState,
  toast,
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarInset,
  SidebarTrigger,
  Charts,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  Sheet,
  SheetTrigger,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  Avatar,
  AvatarFallback,
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  Badge,
  Button,
  Separator,
  Icons,
  cn,
} from "@exepad/sdk";

interface NavItem {
  label: string;
  icon: keyof typeof Icons;
  slug: string;
}

interface KpiData {
  label: string;
  value: string;
  trend: string;
  trendUp: boolean;
  icon: keyof typeof Icons;
}

interface RevenueData {
  month: string;
  revenue: number;
  expenses: number;
}

interface PlanData {
  name: string;
  value: number;
  color: string;
}

interface UserRow {
  id: string;
  name: string;
  email: string;
  role: string;
  status: "Active" | "Inactive" | "Pending";
  joinDate: string;
}

interface ActivityItem {
  id: string;
  action: string;
  user: string;
  time: string;
  type: "create" | "update" | "delete" | "login";
}

const NAV_ITEMS: NavItem[] = [
  { label: "Dashboard", icon: "LayoutDashboard", slug: "dashboard" },
  { label: "Users", icon: "Users", slug: "users" },
  { label: "Orders", icon: "ShoppingCart", slug: "orders" },
  { label: "Analytics", icon: "BarChart3", slug: "analytics" },
  { label: "Settings", icon: "Settings", slug: "settings" },
];

const KPI_DATA: KpiData[] = [
  { label: "Total Revenue", value: "$48,256", trend: "+12.5%", trendUp: true, icon: "DollarSign" },
  { label: "Active Users", value: "2,847", trend: "+8.2%", trendUp: true, icon: "Users" },
  { label: "Total Orders", value: "1,234", trend: "+23.1%", trendUp: true, icon: "ShoppingCart" },
  { label: "Conversion Rate", value: "3.24%", trend: "-0.4%", trendUp: false, icon: "TrendingUp" },
];

const REVENUE_DATA: RevenueData[] = [
  { month: "Jan", revenue: 4200, expenses: 2400 },
  { month: "Feb", revenue: 3800, expenses: 2100 },
  { month: "Mar", revenue: 5100, expenses: 2800 },
  { month: "Apr", revenue: 4600, expenses: 2500 },
  { month: "May", revenue: 5800, expenses: 3000 },
  { month: "Jun", revenue: 6200, expenses: 3200 },
  { month: "Jul", revenue: 5900, expenses: 3100 },
  { month: "Aug", revenue: 6800, expenses: 3400 },
  { month: "Sep", revenue: 7200, expenses: 3600 },
  { month: "Oct", revenue: 6500, expenses: 3300 },
  { month: "Nov", revenue: 7800, expenses: 3800 },
  { month: "Dec", revenue: 8500, expenses: 4000 },
];

const PLAN_DATA: PlanData[] = [
  { name: "Free", value: 1240, color: "hsl(var(--muted-foreground))" },
  { name: "Starter", value: 890, color: "hsl(210, 80%, 55%)" },
  { name: "Pro", value: 520, color: "hsl(var(--primary))" },
  { name: "Enterprise", value: 197, color: "hsl(150, 60%, 45%)" },
];

const USERS: UserRow[] = [
  { id: "u1", name: "Sarah Connor", email: "sarah@example.com", role: "Admin", status: "Active", joinDate: "2024-01-15" },
  { id: "u2", name: "John Smith", email: "john@example.com", role: "Editor", status: "Active", joinDate: "2024-02-20" },
  { id: "u3", name: "Emily Zhang", email: "emily@example.com", role: "Viewer", status: "Pending", joinDate: "2024-03-10" },
  { id: "u4", name: "Michael Brown", email: "michael@example.com", role: "Editor", status: "Active", joinDate: "2024-04-05" },
  { id: "u5", name: "Lisa Park", email: "lisa@example.com", role: "Admin", status: "Active", joinDate: "2024-05-12" },
  { id: "u6", name: "David Wilson", email: "david@example.com", role: "Viewer", status: "Inactive", joinDate: "2024-06-01" },
];

const ACTIVITY: ActivityItem[] = [
  { id: "a1", action: "Created new project 'Marketing Site'", user: "Sarah Connor", time: "5 min ago", type: "create" },
  { id: "a2", action: "Updated user permissions for team", user: "Lisa Park", time: "12 min ago", type: "update" },
  { id: "a3", action: "Deleted unused API key", user: "John Smith", time: "1 hour ago", type: "delete" },
  { id: "a4", action: "Logged in from new device", user: "Emily Zhang", time: "2 hours ago", type: "login" },
  { id: "a5", action: "Updated billing information", user: "Michael Brown", time: "3 hours ago", type: "update" },
  { id: "a6", action: "Created support ticket #892", user: "David Wilson", time: "5 hours ago", type: "create" },
  { id: "a7", action: "Exported analytics report", user: "Sarah Connor", time: "Yesterday", type: "create" },
  { id: "a8", action: "Upgraded to Pro plan", user: "John Smith", time: "Yesterday", type: "update" },
];

const ROLE_COLORS: Record<string, string> = {
  Admin: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-300",
  Editor: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300",
  Viewer: "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-300",
};

const STATUS_COLORS: Record<string, string> = {
  Active: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300",
  Inactive: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300",
  Pending: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300",
};

const ACTIVITY_ICONS: Record<string, keyof typeof Icons> = {
  create: "Plus",
  update: "Pencil",
  delete: "Trash2",
  login: "LogIn",
};

function getInitials(name: string): string {
  return name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2);
}

function AdminDashboardContent() {
  const navigation = useNavigation();
  const currentUser = useCurrentUser();
  const { theme } = useTheme();
  const [activePage, setActivePage] = useAppState<string>("adminPage", "dashboard");
  const usersModel = useModel("users");

  const page = activePage ?? "dashboard";
  const userName = currentUser?.displayName || currentUser?.email || "Admin User";

  const handleNavClick = (slug: string) => {
    setActivePage(slug);
    navigation.navigate("/");
  };

  const handleUserAction = (action: string, user: UserRow) => {
    toast(`${action}: ${user.name}`);
  };

  return (
    <>
      <Sidebar>
        <SidebarHeader className="border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Icons.Shield className="h-4 w-4" />
            </div>
            <div className="flex flex-col">
              <span className="font-semibold text-sm">Admin Panel</span>
              <span className="text-[11px] text-muted-foreground truncate">
                {userName}
              </span>
            </div>
          </div>
        </SidebarHeader>

        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>Navigation</SidebarGroupLabel>
            <SidebarMenu>
              {NAV_ITEMS.map((item) => {
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
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroup>
        </SidebarContent>
      </Sidebar>

      <SidebarInset>
        <header className="flex h-14 items-center justify-between border-b border-border px-6">
          <div className="flex items-center gap-2">
            <SidebarTrigger className="-ml-2" />
            <span className="font-semibold text-sm capitalize">{page}</span>
          </div>
          <div className="flex items-center gap-2">
            <Sheet>
              <SheetTrigger asChild>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button variant="outline" size="icon" className="h-8 w-8">
                        <Icons.Activity className="h-4 w-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Recent Activity</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </SheetTrigger>
              <SheetContent side="right" className="w-[400px] sm:w-[440px]">
                <SheetHeader>
                  <SheetTitle className="flex items-center gap-2">
                    <Icons.Activity className="h-5 w-5" />
                    Recent Activity
                  </SheetTitle>
                  <SheetDescription>
                    Latest actions across the platform.
                  </SheetDescription>
                </SheetHeader>
                <Separator className="my-4" />
                <div className="space-y-4">
                  {ACTIVITY.map((act) => {
                    const ActIcon = Icons[ACTIVITY_ICONS[act.type]] as React.ComponentType<{
                      className?: string;
                    }>;
                    return (
                      <div key={act.id} className="flex items-start gap-3">
                        <div className="mt-0.5 flex h-7 w-7 items-center justify-center rounded-full bg-muted">
                          {ActIcon && <ActIcon className="h-3.5 w-3.5 text-muted-foreground" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm">{act.action}</p>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="text-xs text-muted-foreground font-medium">
                              {act.user}
                            </span>
                            <span className="text-xs text-muted-foreground/60">
                              {act.time}
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </SheetContent>
            </Sheet>

            <Avatar className="h-8 w-8">
              <AvatarFallback className="text-xs bg-primary/10 text-primary">
                {getInitials(userName)}
              </AvatarFallback>
            </Avatar>
          </div>
        </header>

        <main className="flex-1 p-6 space-y-6">
          {/* KPI Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {KPI_DATA.map((kpi) => {
              const KpiIcon = Icons[kpi.icon] as React.ComponentType<{
                className?: string;
              }>;
              return (
                <Card key={kpi.label}>
                  <CardHeader className="flex flex-row items-center justify-between pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground">
                      {kpi.label}
                    </CardTitle>
                    {KpiIcon && (
                      <KpiIcon className="h-4 w-4 text-muted-foreground" />
                    )}
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">{kpi.value}</div>
                    <div className="flex items-center gap-1 mt-1">
                      {kpi.trendUp ? (
                        <Icons.TrendingUp className="h-3 w-3 text-green-500" />
                      ) : (
                        <Icons.TrendingDown className="h-3 w-3 text-red-500" />
                      )}
                      <span
                        className={cn(
                          "text-xs font-medium",
                          kpi.trendUp ? "text-green-500" : "text-red-500"
                        )}
                      >
                        {kpi.trend}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        vs last month
                      </span>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {/* Charts Row */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle className="text-base">Revenue Overview</CardTitle>
              </CardHeader>
              <CardContent>
                <Charts.ResponsiveContainer width="100%" height={300}>
                  <Charts.LineChart data={REVENUE_DATA}>
                    <Charts.CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <Charts.XAxis dataKey="month" className="text-xs" />
                    <Charts.YAxis className="text-xs" tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`} />
                    <Charts.Tooltip
                      formatter={(value: number) => [`$${value.toLocaleString()}`, ""]}
                    />
                    <Charts.Legend />
                    <Charts.Line
                      type="monotone"
                      dataKey="revenue"
                      stroke="hsl(var(--primary))"
                      strokeWidth={2}
                      dot={{ r: 3 }}
                      name="Revenue"
                    />
                    <Charts.Line
                      type="monotone"
                      dataKey="expenses"
                      stroke="hsl(var(--muted-foreground))"
                      strokeWidth={2}
                      strokeDasharray="5 5"
                      dot={{ r: 3 }}
                      name="Expenses"
                    />
                  </Charts.LineChart>
                </Charts.ResponsiveContainer>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Users by Plan</CardTitle>
              </CardHeader>
              <CardContent>
                <Charts.ResponsiveContainer width="100%" height={300}>
                  <Charts.PieChart>
                    <Charts.Pie
                      data={PLAN_DATA}
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={90}
                      paddingAngle={4}
                      dataKey="value"
                      nameKey="name"
                    >
                      {PLAN_DATA.map((entry, index) => (
                        <Charts.Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Charts.Pie>
                    <Charts.Tooltip
                      formatter={(value: number, name: string) => [
                        `${value.toLocaleString()} users`,
                        name,
                      ]}
                    />
                    <Charts.Legend />
                  </Charts.PieChart>
                </Charts.ResponsiveContainer>
              </CardContent>
            </Card>
          </div>

          {/* Users Table */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">Users</CardTitle>
                <Badge variant="secondary" className="text-xs">
                  {USERS.length} total
                </Badge>
              </div>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>User</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Joined</TableHead>
                    <TableHead className="w-[60px]" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {USERS.map((user) => (
                    <TableRow key={user.id}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Avatar className="h-7 w-7">
                            <AvatarFallback className="text-[10px]">
                              {getInitials(user.name)}
                            </AvatarFallback>
                          </Avatar>
                          <span className="font-medium text-sm">{user.name}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {user.email}
                      </TableCell>
                      <TableCell>
                        <Badge className={cn("text-xs", ROLE_COLORS[user.role])}>
                          {user.role}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge className={cn("text-xs", STATUS_COLORS[user.status])}>
                          {user.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {user.joinDate}
                      </TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-7 w-7"
                                  >
                                    <Icons.MoreHorizontal className="h-4 w-4" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>
                                  <p>Actions</p>
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              onClick={() => handleUserAction("View profile", user)}
                            >
                              <Icons.User className="mr-2 h-4 w-4" />
                              View Profile
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => handleUserAction("Edit user", user)}
                            >
                              <Icons.Pencil className="mr-2 h-4 w-4" />
                              Edit
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              className="text-destructive"
                              onClick={() => handleUserAction("Remove user", user)}
                            >
                              <Icons.Trash2 className="mr-2 h-4 w-4" />
                              Remove
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </main>
      </SidebarInset>
    </>
  );
}

function AdminDashboard() {
  return (
    <SidebarProvider>
      <AdminDashboardContent />
    </SidebarProvider>
  );
}

export default AdminDashboard;
