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
  { icon: "FileText", action: "Created form", detail: "Customer Satisfaction Survey", time: "3 hours ago" },
  { icon: "Inbox", action: "Received submission", detail: "Contact Form - John Doe", time: "5 hours ago" },
  { icon: "Copy", action: "Updated template", detail: "Registration Form v2", time: "1 day ago" },
  { icon: "Download", action: "Exported responses", detail: "Feedback Form - CSV (142 rows)", time: "2 days ago" },
  { icon: "Share2", action: "Shared form link", detail: "Event Registration public link", time: "4 days ago" },
  { icon: "Archive", action: "Archived form", detail: "Old Newsletter Signup", time: "1 week ago" },
];

function ProfilePage() {
  const currentUser = useCurrentUser();
  const userName = currentUser?.displayName || currentUser?.email?.split("@")[0] || "User";
  const userEmail = currentUser?.email || "user@app.com";
  const initials = userName.slice(0, 2).toUpperCase();

  const STATS = [
    { icon: "FileText", label: "Forms Created", value: "8", bgColor: "bg-blue-100", color: "text-blue-600" },
    { icon: "Inbox", label: "Submissions", value: "342", bgColor: "bg-green-100", color: "text-green-600" },
    { icon: "BarChart", label: "Response Rate", value: "78%", bgColor: "bg-orange-100", color: "text-orange-600" },
    { icon: "Copy", label: "Templates", value: "5", bgColor: "bg-purple-100", color: "text-purple-600" },
  ];

  return (
    <div className="p-6 space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-foreground tracking-tight">Profile</h2>
        <p className="text-sm text-muted-foreground mt-1">Your form activity and submissions</p>
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
                <Badge variant="secondary"><Icons.Shield className="h-3 w-3 mr-1" />Form Admin</Badge>
              </div>
              <p className="text-xs text-muted-foreground mt-3">Member since March 2025</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Form Performance</CardTitle>
              <CardDescription>Your form management metrics</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Avg responses/form</span>
                <span className="font-medium text-foreground">42</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Most active form</span>
                <span className="font-medium text-foreground">Contact</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Completion rate</span>
                <span className="font-medium text-foreground">82%</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Avg response time</span>
                <span className="font-medium text-foreground">1.2 days</span>
              </div>
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
              <CardDescription>Your latest form management actions</CardDescription>
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
