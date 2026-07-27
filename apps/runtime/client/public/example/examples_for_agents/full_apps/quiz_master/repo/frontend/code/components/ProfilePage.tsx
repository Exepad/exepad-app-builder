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
  { action: "Completed quiz", detail: "World History - 88%", time: "1 hour ago", icon: "CheckCircle" },
  { action: "Achieved high score", detail: "Science Quiz - 98%", time: "3 hours ago", icon: "Trophy" },
  { action: "Started new quiz", detail: "Geography Challenge", time: "1 day ago", icon: "Play" },
  { action: "Earned badge", detail: "Quiz Master - Gold", time: "2 days ago", icon: "Award" },
  { action: "Challenged friend", detail: "Tech Trivia showdown", time: "3 days ago", icon: "Users" },
  { action: "Reviewed answers", detail: "Sports Quiz corrections", time: "4 days ago", icon: "FileText" },
];

function ProfilePage() {
  const currentUser = useCurrentUser();
  const userName = currentUser?.displayName || currentUser?.email?.split("@")[0] || "User";
  const userEmail = currentUser?.email || "user@quizmaster.app";
  const initials = userName.slice(0, 2).toUpperCase();

  const STATS = [
    { label: "Quizzes Taken", value: "34", icon: "Brain", color: "text-blue-500", bgColor: "bg-blue-50" },
    { label: "Avg Score", value: "82%", icon: "BarChart", color: "text-green-500", bgColor: "bg-green-50" },
    { label: "Best Score", value: "98%", icon: "Trophy", color: "text-orange-500", bgColor: "bg-orange-50" },
    { label: "Current Streak", value: "7", icon: "Flame", color: "text-purple-500", bgColor: "bg-purple-50" },
  ];

  return (
    <div className="p-6 space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-foreground tracking-tight">Profile</h2>
        <p className="text-sm text-muted-foreground mt-1">Your quiz performance and rankings</p>
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
                <Badge variant="secondary"><Icons.Shield className="h-3 w-3 mr-1" />Quiz Pro</Badge>
              </div>
              <p className="text-xs text-muted-foreground mt-3">Member since March 2025</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Performance</CardTitle>
              <CardDescription>Your quiz metrics</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex justify-between text-sm"><span className="text-muted-foreground">Favorite Category</span><span className="font-semibold">Science</span></div>
              <div className="flex justify-between text-sm"><span className="text-muted-foreground">Questions Answered</span><span className="font-semibold">680</span></div>
              <div className="flex justify-between text-sm"><span className="text-muted-foreground">Accuracy Rate</span><span className="font-semibold">79%</span></div>
              <div className="flex justify-between text-sm"><span className="text-muted-foreground">Ranking</span><span className="font-semibold">#12</span></div>
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
              <CardDescription>Your latest quiz actions</CardDescription>
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
