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
  { icon: "ShoppingBag", action: "Placed order", detail: "Order #1047 - Electronics", time: "3 hours ago" },
  { icon: "Star", action: "Left review", detail: "Wireless Headphones - 5 stars", time: "1 day ago" },
  { icon: "Heart", action: "Added to wishlist", detail: "Smart Watch Pro", time: "2 days ago" },
  { icon: "Tag", action: "Redeemed coupon", detail: "SAVE20 - 20% off", time: "3 days ago" },
  { icon: "MapPin", action: "Updated address", detail: "Home address updated", time: "5 days ago" },
  { icon: "Truck", action: "Tracked package", detail: "Order #1042 - In transit", time: "1 week ago" },
];

function ProfilePage() {
  const currentUser = useCurrentUser();
  const userName = currentUser?.displayName || currentUser?.email?.split("@")[0] || "User";
  const userEmail = currentUser?.email || "user@app.com";
  const initials = userName.slice(0, 2).toUpperCase();

  const STATS = [
    { icon: "ShoppingBag", label: "Orders", value: "47", bgColor: "bg-blue-100", color: "text-blue-600" },
    { icon: "DollarSign", label: "Total Spent", value: "$2,840", bgColor: "bg-green-100", color: "text-green-600" },
    { icon: "Star", label: "Reviews", value: "12", bgColor: "bg-yellow-100", color: "text-yellow-600" },
    { icon: "Heart", label: "Wishlist", value: "8", bgColor: "bg-purple-100", color: "text-purple-600" },
  ];

  return (
    <div className="p-6 space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-foreground tracking-tight">Profile</h2>
        <p className="text-sm text-muted-foreground mt-1">Your shopping activity and order history</p>
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
                <Badge variant="secondary"><Icons.Shield className="h-3 w-3 mr-1" />Premium Member</Badge>
              </div>
              <p className="text-xs text-muted-foreground mt-3">Member since March 2025</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Shopping Highlights</CardTitle>
              <CardDescription>Your purchasing patterns</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Avg order</span>
                <span className="font-medium text-foreground">$60</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Most bought</span>
                <span className="font-medium text-foreground">Electronics</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Reward points</span>
                <span className="font-medium text-foreground">2,340</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Saved addresses</span>
                <span className="font-medium text-foreground">3</span>
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
              <CardDescription>Your latest shopping actions</CardDescription>
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
