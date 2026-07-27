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
  { icon: "Ticket", action: "Booked tickets", detail: "Summer Music Festival - 2 VIP", time: "4 hours ago" },
  { icon: "Star", action: "Left review", detail: "Tech Conference 2025 - 5 stars", time: "1 day ago" },
  { icon: "Bookmark", action: "Bookmarked event", detail: "Jazz Night Downtown", time: "2 days ago" },
  { icon: "Share2", action: "Shared event", detail: "Food & Wine Expo", time: "3 days ago" },
  { icon: "X", action: "Cancelled booking", detail: "Yoga Retreat - refund pending", time: "5 days ago" },
  { icon: "DollarSign", action: "Received refund", detail: "$45.00 credited to account", time: "1 week ago" },
];

function ProfilePage() {
  const currentUser = useCurrentUser();
  const userName = currentUser?.displayName || currentUser?.email?.split("@")[0] || "User";
  const userEmail = currentUser?.email || "user@app.com";
  const initials = userName.slice(0, 2).toUpperCase();

  const STATS = [
    { icon: "Calendar", label: "Events Attended", value: "23", bgColor: "bg-blue-100", color: "text-blue-600" },
    { icon: "Ticket", label: "Tickets", value: "31", bgColor: "bg-green-100", color: "text-green-600" },
    { icon: "Star", label: "Reviews", value: "9", bgColor: "bg-yellow-100", color: "text-yellow-600" },
    { icon: "Bookmark", label: "Bookmarks", value: "15", bgColor: "bg-purple-100", color: "text-purple-600" },
  ];

  return (
    <div className="p-6 space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-foreground tracking-tight">Profile</h2>
        <p className="text-sm text-muted-foreground mt-1">Your event history and bookings</p>
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
                <Badge variant="secondary"><Icons.Shield className="h-3 w-3 mr-1" />Event Goer</Badge>
              </div>
              <p className="text-xs text-muted-foreground mt-3">Member since March 2025</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Event Highlights</CardTitle>
              <CardDescription>Your event attendance patterns</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Favorite category</span>
                <span className="font-medium text-foreground">Music</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Events this month</span>
                <span className="font-medium text-foreground">3</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Avg ticket price</span>
                <span className="font-medium text-foreground">$45</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Total spent</span>
                <span className="font-medium text-foreground">$1,395</span>
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
              <CardDescription>Your latest event interactions</CardDescription>
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
