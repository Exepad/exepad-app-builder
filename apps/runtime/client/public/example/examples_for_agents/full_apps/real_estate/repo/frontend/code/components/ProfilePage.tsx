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
  { action: "Viewed property", detail: "Modern Loft - Downtown", time: "1 hour ago", icon: "Home" },
  { action: "Added to favorites", detail: "Lakeside Villa", time: "3 hours ago", icon: "Heart" },
  { action: "Sent inquiry", detail: "Suburban Family Home", time: "5 hours ago", icon: "Mail" },
  { action: "Scheduled viewing", detail: "City Penthouse", time: "1 day ago", icon: "Calendar" },
  { action: "Saved search", detail: "3BR under $500K", time: "2 days ago", icon: "Search" },
  { action: "Contacted agent", detail: "RE/MAX - Sarah Chen", time: "3 days ago", icon: "Phone" },
];

function ProfilePage() {
  const currentUser = useCurrentUser();
  const userName = currentUser?.displayName || currentUser?.email?.split("@")[0] || "User";
  const userEmail = currentUser?.email || "user@nestfinder.app";
  const initials = userName.slice(0, 2).toUpperCase();

  const STATS = [
    { label: "Properties Viewed", value: "64", icon: "Home", color: "text-blue-500", bgColor: "bg-blue-50" },
    { label: "Favorites", value: "12", icon: "Heart", color: "text-red-500", bgColor: "bg-red-50" },
    { label: "Inquiries", value: "8", icon: "Mail", color: "text-green-500", bgColor: "bg-green-50" },
    { label: "Saved Searches", value: "5", icon: "Search", color: "text-purple-500", bgColor: "bg-purple-50" },
  ];

  return (
    <div className="p-6 space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-foreground tracking-tight">Profile</h2>
        <p className="text-sm text-muted-foreground mt-1">Your property search activity</p>
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
                <Badge variant="secondary"><Icons.Shield className="h-3 w-3 mr-1" />Home Buyer</Badge>
              </div>
              <p className="text-xs text-muted-foreground mt-3">Member since March 2025</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Search Preferences</CardTitle>
              <CardDescription>Your property criteria</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex justify-between text-sm"><span className="text-muted-foreground">Budget</span><span className="font-semibold">$300K-$500K</span></div>
              <div className="flex justify-between text-sm"><span className="text-muted-foreground">Location</span><span className="font-semibold">Downtown</span></div>
              <div className="flex justify-between text-sm"><span className="text-muted-foreground">Bedrooms</span><span className="font-semibold">3+</span></div>
              <div className="flex justify-between text-sm"><span className="text-muted-foreground">Property Type</span><span className="font-semibold">House</span></div>
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
              <CardDescription>Your latest property search actions</CardDescription>
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
