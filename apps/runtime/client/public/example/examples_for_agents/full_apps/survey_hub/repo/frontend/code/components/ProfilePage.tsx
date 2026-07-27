import {
  React,
  useCurrentUser,
  Icons,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  Badge,
  cn,
} from "@exepad/sdk";

const RECENT_ACTIVITY = [
  { action: "Created survey", detail: "Customer Feedback Q1", time: "2 hours ago", icon: "ClipboardList" },
  { action: "Received response", detail: "Employee Satisfaction", time: "4 hours ago", icon: "Inbox" },
  { action: "Closed survey", detail: "Product Launch Poll", time: "1 day ago", icon: "CheckCircle" },
  { action: "Exported results", detail: "Team Engagement", time: "2 days ago", icon: "Download" },
  { action: "Shared survey link", detail: "Website Usability", time: "3 days ago", icon: "Share2" },
  { action: "Analyzed trends", detail: "Monthly NPS Report", time: "4 days ago", icon: "TrendingUp" },
];

function ProfilePage() {
  const currentUser = useCurrentUser();
  const userName = currentUser?.displayName || currentUser?.email?.split("@")[0] || "User";
  const userEmail = currentUser?.email || "user@pulsecheck.app";
  const initials = userName.slice(0, 2).toUpperCase();

  const STATS = [
    { label: "Surveys Created", value: "12", icon: "ClipboardList", color: "text-blue-500", bgColor: "bg-blue-50" },
    { label: "Responses", value: "1,847", icon: "Inbox", color: "text-green-500", bgColor: "bg-green-50" },
    { label: "Completion Rate", value: "76%", icon: "BarChart", color: "text-orange-500", bgColor: "bg-orange-50" },
    { label: "Active Surveys", value: "3", icon: "Activity", color: "text-purple-500", bgColor: "bg-purple-50" },
  ];

  return (
    <div className="p-6 space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-foreground tracking-tight">Profile</h2>
        <p className="text-sm text-muted-foreground mt-1">Your survey creation and analytics</p>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="space-y-6">
          <Card>
            <CardContent className="pt-6 text-center">
              <div className="w-20 h-20 rounded-full bg-primary mx-auto mb-3 flex items-center justify-center">
                <span className="text-2xl font-bold text-primary-foreground">{initials}</span>
              </div>
              <h3 className="font-bold text-lg text-foreground">{userName}</h3>
              <p className="text-sm text-muted-foreground">{userEmail}</p>
              <div className="flex items-center justify-center gap-2 mt-3">
                <Badge variant="secondary"><Icons.Shield className="h-3 w-3 mr-1" />Survey Admin</Badge>
              </div>
              <p className="text-xs text-muted-foreground mt-3">Member since March 2025</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Performance</CardTitle>
              <CardDescription>Your survey metrics</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex justify-between text-sm"><span className="text-muted-foreground">Avg Responses</span><span className="font-semibold">154</span></div>
              <div className="flex justify-between text-sm"><span className="text-muted-foreground">Most Popular</span><span className="font-semibold">Employee Satisfaction</span></div>
              <div className="flex justify-between text-sm"><span className="text-muted-foreground">Best Completion</span><span className="font-semibold">94%</span></div>
              <div className="flex justify-between text-sm"><span className="text-muted-foreground">Avg Time to Complete</span><span className="font-semibold">4.2min</span></div>
            </CardContent>
          </Card>
        </div>
        <div className="lg:col-span-2 space-y-6">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {STATS.map((stat) => {
              const Icon = Icons[stat.icon as keyof typeof Icons] as React.ComponentType<{ className?: string }>;
              return (
                <Card key={stat.label}>
                  <CardContent className="pt-6 text-center">
                    <div className={cn("w-10 h-10 rounded-lg mx-auto mb-2 flex items-center justify-center", stat.bgColor)}>
                      {Icon && <Icon className={cn("h-5 w-5", stat.color)} />}
                    </div>
                    <p className="text-xl font-bold text-foreground">{stat.value}</p>
                    <p className="text-xs text-muted-foreground">{stat.label}</p>
                  </CardContent>
                </Card>
              );
            })}
          </div>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Recent Activity</CardTitle>
              <CardDescription>Your latest survey actions</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {RECENT_ACTIVITY.map((activity, index) => {
                  const Icon = Icons[activity.icon as keyof typeof Icons] as React.ComponentType<{ className?: string }>;
                  return (
                    <div key={index} className="flex items-center gap-3 py-2">
                      <div className="w-8 h-8 rounded-full bg-accent flex items-center justify-center shrink-0">
                        {Icon && <Icon className="h-4 w-4 text-primary" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">{activity.action}</p>
                        <p className="text-xs text-muted-foreground">{activity.detail} · {activity.time}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

export default ProfilePage;
