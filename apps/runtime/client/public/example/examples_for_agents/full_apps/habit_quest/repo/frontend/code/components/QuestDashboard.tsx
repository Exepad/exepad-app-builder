import {
  React,
  useModel,
  useAppState,
  Icons,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  Badge,
  Button,
  cn,
  toast,
} from "@exepad/sdk";

/* Demo Data */
const DEMO_HABITS = [
  { id: "h1", name: "Exercise", description: "30 min physical activity", frequency: "daily", xp_reward: 20, icon: "Dumbbell", is_active: 1, color: "#ef4444" },
  { id: "h2", name: "Read", description: "Read 20 pages", frequency: "daily", xp_reward: 15, icon: "BookOpen", is_active: 1, color: "#3b82f6" },
  { id: "h3", name: "Meditate", description: "10 min mindfulness", frequency: "daily", xp_reward: 10, icon: "Brain", is_active: 1, color: "#8b5cf6" },
  { id: "h4", name: "Drink Water", description: "8 glasses of water", frequency: "daily", xp_reward: 10, icon: "Droplets", is_active: 1, color: "#06b6d4" },
  { id: "h5", name: "Journal", description: "Write a journal entry", frequency: "daily", xp_reward: 15, icon: "PenLine", is_active: 1, color: "#f59e0b" },
  { id: "h6", name: "Learn Language", description: "Complete one lesson", frequency: "weekly", xp_reward: 50, icon: "Languages", is_active: 1, color: "#10b981" },
];

const WEEKLY_DATA = [
  { day: "Mon", count: 4, date: "2026-03-23" },
  { day: "Tue", count: 5, date: "2026-03-24" },
  { day: "Wed", count: 3, date: "2026-03-25" },
  { day: "Thu", count: 6, date: "2026-03-26" },
  { day: "Fri", count: 4, date: "2026-03-27" },
  { day: "Sat", count: 2, date: "2026-03-28" },
  { day: "Sun", count: 0, date: "2026-03-29" },
];

function QuestDashboard({ className }: { className?: string }) {
  const [totalXp, setTotalXp] = useAppState<number>("totalXp", 280);
  const [level, setLevel] = useAppState<number>("level", 5);
  const [currentStreak, setCurrentStreak] = useAppState<number>("currentStreak", 7);
  const habitsResult = useModel("habits");
  const habits = habitsResult?.data ?? DEMO_HABITS;
  const activeHabits = (habits || DEMO_HABITS).filter((h: any) => h.is_active === 1);

  const [completedToday, setCompletedToday] = React.useState<Set<string>>(new Set(["h1", "h3"]));
  const completedCount = completedToday.size;

  const xpInLevel = totalXp % 100;
  const xpPercent = Math.round((xpInLevel / 100) * 100);

  const handleComplete = (habit: any) => {
    if (completedToday.has(habit.id)) return;
    const next = new Set(completedToday);
    next.add(habit.id);
    setCompletedToday(next);

    const newXp = totalXp + habit.xp_reward;
    const newLevel = Math.floor(newXp / 100) + 1;

    setTotalXp(newXp);
    if (newLevel > level) {
      setLevel(newLevel);
      toast({
        title: "Level Up!",
        description: `You reached Level ${newLevel}!`,
      });
    }
    setCurrentStreak(currentStreak);

    toast({
      title: `+${habit.xp_reward} XP`,
      description: `Completed: ${habit.name}`,
    });
  };

  const STATS = [
    { label: "Current Streak", value: `${currentStreak} days`, icon: "Flame", color: "text-orange-500", bgColor: "bg-orange-50" },
    { label: "Total XP", value: totalXp.toLocaleString(), icon: "Zap", color: "text-primary", bgColor: "bg-accent" },
    { label: "Level", value: level.toString(), icon: "Shield", color: "text-violet-500", bgColor: "bg-violet-50" },
    { label: "Done Today", value: `${completedCount}/${activeHabits.length}`, icon: "CheckCircle", color: "text-green-500", bgColor: "bg-green-50" },
  ];

  return (
    <div className={cn("p-6 space-y-6", className)}>
      {/* Title */}
      <div>
        <h2 className="text-2xl font-bold text-foreground tracking-tight">
          Quest Board
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          Complete your daily quests to earn XP and level up
        </p>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {STATS.map((stat) => {
          const Icon = Icons[stat.icon as keyof typeof Icons] as React.ComponentType<{ className?: string }>;
          return (
            <Card key={stat.label} className="stat-card">
              <CardContent className="pt-6">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground font-medium">{stat.label}</p>
                    <p className="text-2xl font-bold text-foreground mt-1">{stat.value}</p>
                  </div>
                  <div className={cn("p-2.5 rounded-lg", stat.bgColor)}>
                    {Icon && <Icon className={cn("h-5 w-5", stat.color)} />}
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Today's Quests */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Today's Quests</CardTitle>
              <Badge variant="secondary" className="text-xs">
                {completedCount}/{activeHabits.length} complete
              </Badge>
            </div>
            <CardDescription>Check off your habits to earn XP</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {activeHabits.map((habit: any) => {
              const Icon = Icons[habit.icon as keyof typeof Icons] as React.ComponentType<{ className?: string }>;
              const done = completedToday.has(habit.id);
              return (
                <div
                  key={habit.id}
                  className={cn(
                    "flex items-center justify-between py-3 px-4 rounded-lg",
                    done ? "bg-accent/50" : "bg-muted/30 hover:bg-muted/60"
                  )}
                >
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => handleComplete(habit)}
                      className={cn(
                        "quest-check w-6 h-6 rounded-full border-2 flex items-center justify-center",
                        done
                          ? "completed border-primary bg-primary"
                          : "border-border hover:border-primary"
                      )}
                    >
                      {done && <Icons.Check className="h-3.5 w-3.5 text-white" />}
                    </button>
                    <div
                      className="w-2 h-2 rounded-full"
                      style={{ backgroundColor: habit.color || "#8b5cf6" }}
                    />
                    {Icon && <Icon className="h-4 w-4 text-muted-foreground" />}
                    <div>
                      <p className={cn("text-sm font-medium", done ? "line-through text-muted-foreground" : "text-foreground")}>
                        {habit.name}
                      </p>
                      <p className="text-xs text-muted-foreground">{habit.description}</p>
                    </div>
                  </div>
                  <Badge
                    variant="secondary"
                    className={cn(
                      "text-xs",
                      done ? "bg-green-100 text-green-700" : "bg-primary/10 text-primary"
                    )}
                  >
                    {done ? "Done" : `+${habit.xp_reward} XP`}
                  </Badge>
                </div>
              );
            })}
          </CardContent>
        </Card>

        {/* Right Column */}
        <div className="space-y-6">
          {/* XP Progress */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Level Progress</CardTitle>
              <CardDescription>Level {level}: {xpInLevel}/100 XP</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-center mb-4">
                <div className="inline-flex items-center justify-center w-20 h-20 rounded-full level-badge mb-2">
                  <span className="text-2xl font-bold text-white">{level}</span>
                </div>
                <p className="text-xs text-muted-foreground">Current Level</p>
              </div>
              <div className="w-full bg-border rounded-full xp-bar mb-2">
                <div
                  className="xp-bar-fill h-full rounded-full"
                  style={{ width: `${xpPercent}%` }}
                />
              </div>
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>{xpInLevel} XP</span>
                <span>{100 - xpInLevel} XP to go</span>
              </div>
            </CardContent>
          </Card>

          {/* Weekly Activity */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Weekly Activity</CardTitle>
              <CardDescription>Habits completed each day</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-7 gap-2">
                {WEEKLY_DATA.map((d) => {
                  const intensity = d.count === 0 ? 0 : d.count <= 2 ? 1 : d.count <= 4 ? 2 : 3;
                  const colors = [
                    "bg-muted",
                    "bg-primary/20",
                    "bg-primary/50",
                    "bg-primary",
                  ];
                  return (
                    <div key={d.day} className="text-center">
                      <div
                        className={cn("heatmap-cell w-full aspect-square rounded-md mb-1", colors[intensity])}
                        title={`${d.day}: ${d.count} habits`}
                      />
                      <span className="text-[10px] text-muted-foreground">{d.day}</span>
                    </div>
                  );
                })}
              </div>
              <div className="flex items-center justify-end gap-1 mt-3">
                <span className="text-[10px] text-muted-foreground mr-1">Less</span>
                <div className="w-3 h-3 rounded-sm bg-muted" />
                <div className="w-3 h-3 rounded-sm bg-primary/20" />
                <div className="w-3 h-3 rounded-sm bg-primary/50" />
                <div className="w-3 h-3 rounded-sm bg-primary" />
                <span className="text-[10px] text-muted-foreground ml-1">More</span>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

export default QuestDashboard;
