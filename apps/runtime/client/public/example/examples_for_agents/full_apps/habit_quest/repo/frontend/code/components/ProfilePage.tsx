import {
  React,
  useAppState,
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

const MILESTONES = [
  { level: 1, title: "Novice", xp: 0 },
  { level: 3, title: "Apprentice", xp: 200 },
  { level: 5, title: "Journeyman", xp: 400 },
  { level: 10, title: "Expert", xp: 900 },
  { level: 15, title: "Master", xp: 1400 },
  { level: 20, title: "Grandmaster", xp: 1900 },
  { level: 25, title: "Legend", xp: 2400 },
];

const RECENT_ACTIVITY = [
  { action: "Completed Exercise", xp: 20, time: "2 hours ago", icon: "Dumbbell" },
  { action: "Completed Meditate", xp: 10, time: "3 hours ago", icon: "Brain" },
  { action: "Completed Read", xp: 15, time: "5 hours ago", icon: "BookOpen" },
  { action: "Completed Drink Water", xp: 10, time: "8 hours ago", icon: "Droplets" },
  { action: "Completed Journal", xp: 15, time: "1 day ago", icon: "PenLine" },
  { action: "Completed Exercise", xp: 20, time: "1 day ago", icon: "Dumbbell" },
  { action: "Completed Meditate", xp: 10, time: "1 day ago", icon: "Brain" },
  { action: "Unlocked: Century Club", xp: 0, time: "2 days ago", icon: "Trophy" },
];

function ProfilePage({ className }: { className?: string }) {
  const [totalXp] = useAppState<number>("totalXp", 280);
  const [level] = useAppState<number>("level", 5);
  const [currentStreak] = useAppState<number>("currentStreak", 7);
  const currentUser = useCurrentUser();

  const userName = currentUser?.name || currentUser?.email?.split("@")[0] || "Adventurer";
  const userEmail = currentUser?.email || "adventurer@habitquest.app";
  const initials = userName.slice(0, 2).toUpperCase();
  const xpInLevel = totalXp % 100;
  const xpPercent = Math.round((xpInLevel / 100) * 100);

  const currentMilestone = MILESTONES.filter((m) => level >= m.level).pop();
  const nextMilestone = MILESTONES.find((m) => level < m.level);

  const STATS = [
    { label: "Total Habits", value: "6", icon: "ListChecks", color: "text-blue-500", bgColor: "bg-blue-50" },
    { label: "Completions", value: "142", icon: "CheckCircle", color: "text-green-500", bgColor: "bg-green-50" },
    { label: "Best Streak", value: "12 days", icon: "Flame", color: "text-orange-500", bgColor: "bg-orange-50" },
    { label: "Achievements", value: "4/8", icon: "Trophy", color: "text-primary", bgColor: "bg-accent" },
  ];

  return (
    <div className={cn("p-6 space-y-6", className)}>
      {/* Title */}
      <div>
        <h2 className="text-2xl font-bold text-foreground tracking-tight">Profile</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Your adventure stats and progress
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* User Info + Level */}
        <div className="space-y-6">
          {/* User Card */}
          <Card>
            <CardContent className="pt-6 text-center">
              <div className="w-20 h-20 rounded-full level-badge mx-auto mb-3 flex items-center justify-center">
                <span className="text-2xl font-bold text-white">{initials}</span>
              </div>
              <h3 className="font-bold text-lg text-foreground">{userName}</h3>
              <p className="text-sm text-muted-foreground">{userEmail}</p>
              <div className="flex items-center justify-center gap-2 mt-3">
                <Badge variant="secondary" className="bg-accent text-primary">
                  <Icons.Shield className="h-3 w-3 mr-1" />
                  Level {level}
                </Badge>
                <Badge variant="secondary" className="bg-orange-50 text-orange-600">
                  <Icons.Flame className="h-3 w-3 mr-1" />
                  {currentStreak} day streak
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground mt-3">
                {currentMilestone?.title || "Novice"} Rank
              </p>
            </CardContent>
          </Card>

          {/* Level Progress */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Level Progress</CardTitle>
              <CardDescription>
                {nextMilestone
                  ? `Next rank: ${nextMilestone.title} at Level ${nextMilestone.level}`
                  : "Maximum rank achieved!"}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-center mb-4">
                <span className="text-5xl font-bold text-primary">{level}</span>
                <p className="text-sm text-muted-foreground mt-1">Current Level</p>
              </div>
              <div className="w-full bg-border rounded-full xp-bar mb-2">
                <div
                  className="xp-bar-fill h-full rounded-full"
                  style={{ width: `${xpPercent}%` }}
                />
              </div>
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>{xpInLevel} XP</span>
                <span>{100 - xpInLevel} XP to Level {level + 1}</span>
              </div>

              <div className="mt-4 pt-4 border-t border-border space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Total XP</span>
                  <span className="font-semibold text-foreground">{totalXp.toLocaleString()}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">XP This Week</span>
                  <span className="font-semibold text-foreground">85</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Avg XP/Day</span>
                  <span className="font-semibold text-foreground">~40</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Middle: Stats + Activity */}
        <div className="lg:col-span-2 space-y-6">
          {/* Stats Grid */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {STATS.map((stat) => {
              const Icon = Icons[stat.icon as keyof typeof Icons] as React.ComponentType<{ className?: string }>;
              return (
                <Card key={stat.label} className="stat-card">
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

          {/* Activity Timeline */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Recent Activity</CardTitle>
              <CardDescription>Your latest habit completions</CardDescription>
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
                        <p className="text-xs text-muted-foreground">{activity.time}</p>
                      </div>
                      {activity.xp > 0 && (
                        <Badge variant="secondary" className="text-[10px] bg-primary/10 text-primary shrink-0">
                          +{activity.xp} XP
                        </Badge>
                      )}
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          {/* Level Milestones */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Level Milestones</CardTitle>
              <CardDescription>Rank progression roadmap</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {MILESTONES.map((milestone) => {
                  const reached = level >= milestone.level;
                  return (
                    <div
                      key={milestone.level}
                      className={cn(
                        "flex items-center gap-3 py-2 px-3 rounded-lg",
                        reached ? "bg-accent/50" : "bg-muted/30"
                      )}
                    >
                      <div className={cn(
                        "w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold",
                        reached
                          ? "level-badge text-white"
                          : "bg-border text-muted-foreground"
                      )}>
                        {milestone.level}
                      </div>
                      <div className="flex-1">
                        <p className={cn(
                          "text-sm font-medium",
                          reached ? "text-foreground" : "text-muted-foreground"
                        )}>
                          {milestone.title}
                        </p>
                        <p className="text-xs text-muted-foreground">Level {milestone.level}</p>
                      </div>
                      {reached ? (
                        <Icons.CheckCircle className="h-5 w-5 text-primary" />
                      ) : (
                        <Icons.Lock className="h-4 w-4 text-muted-foreground" />
                      )}
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
