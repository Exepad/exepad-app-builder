import {
  React,
  Charts,
  cn,
  Icons,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  Badge,
  useModel,
} from "@exepad/sdk";

/* ── Demo Data ── */

const DEMO_WORKOUTS = [
  { id: "w1", type: "cardio", name: "Morning Run", duration_min: 35, calories_burned: 420, date: "2026-03-27", notes: "5K pace run" },
  { id: "w2", type: "strength", name: "Upper Body Day", duration_min: 55, calories_burned: 380, date: "2026-03-27", notes: null },
  { id: "w3", type: "cardio", name: "Cycling", duration_min: 45, calories_burned: 520, date: "2026-03-26", notes: "Hill intervals" },
  { id: "w4", type: "flexibility", name: "Yoga Flow", duration_min: 40, calories_burned: 180, date: "2026-03-26", notes: null },
  { id: "w5", type: "strength", name: "Leg Day", duration_min: 50, calories_burned: 450, date: "2026-03-25", notes: "Heavy squats" },
];

const DEMO_MEALS = [
  { id: "m1", date: "2026-03-27", meal_type: "breakfast", name: "Oatmeal with Berries", calories: 350, protein: 12, carbs: 58, fat: 8 },
  { id: "m2", date: "2026-03-27", meal_type: "breakfast", name: "Protein Shake", calories: 220, protein: 30, carbs: 15, fat: 5 },
  { id: "m3", date: "2026-03-27", meal_type: "lunch", name: "Grilled Chicken Salad", calories: 480, protein: 42, carbs: 22, fat: 24 },
  { id: "m4", date: "2026-03-27", meal_type: "lunch", name: "Brown Rice", calories: 215, protein: 5, carbs: 45, fat: 2 },
  { id: "m5", date: "2026-03-27", meal_type: "snack", name: "Greek Yogurt + Almonds", calories: 280, protein: 18, carbs: 20, fat: 14 },
  { id: "m6", date: "2026-03-27", meal_type: "dinner", name: "Salmon with Vegetables", calories: 520, protein: 38, carbs: 28, fat: 26 },
];

const WEEKLY_ACTIVITY = [
  { day: "Mon", calories: 2100 },
  { day: "Tue", calories: 2450 },
  { day: "Wed", calories: 1890 },
  { day: "Thu", calories: 2680 },
  { day: "Fri", calories: 2340 },
  { day: "Sat", calories: 1560 },
  { day: "Sun", calories: 2200 },
];

const KPI_DATA = [
  {
    label: "Calories Burned",
    value: "2,340",
    unit: "kcal",
    change: 12,
    icon: "Flame" as const,
    color: "text-orange-500",
    bgColor: "bg-orange-50",
  },
  {
    label: "Workouts This Week",
    value: "4/5",
    unit: "sessions",
    change: 8,
    icon: "Dumbbell" as const,
    color: "text-primary",
    bgColor: "bg-accent",
  },
  {
    label: "Water Intake",
    value: "2.1L",
    unit: "of 3L",
    change: -5,
    icon: "Droplets" as const,
    color: "text-blue-500",
    bgColor: "bg-blue-50",
  },
  {
    label: "Avg Sleep",
    value: "7.2h",
    unit: "avg",
    change: 3,
    icon: "Moon" as const,
    color: "text-indigo-500",
    bgColor: "bg-indigo-50",
  },
];

/* ── Component ── */

function FitnessDashboard({ className }: { className?: string }) {
  const workoutsModel = useModel("workouts");
  const workouts = (workoutsModel?.data as any[] | null) ?? DEMO_WORKOUTS;
  const mealsModel = useModel("meals");
  const meals = (mealsModel?.data as any[] | null) ?? DEMO_MEALS;

  const todayMeals = (meals || DEMO_MEALS).filter(
    (m: any) => m.date === "2026-03-27"
  );
  const todayCalories = todayMeals.reduce(
    (sum: number, m: any) => sum + m.calories,
    0
  );
  const upcomingWorkouts = (workouts || DEMO_WORKOUTS).slice(0, 3);

  return (
    <div className={cn("p-6 space-y-6", className)}>
      {/* Page Title */}
      <div>
        <h2 className="text-2xl font-bold text-foreground tracking-tight">
          Dashboard
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          Your fitness overview for today
        </p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {KPI_DATA.map((kpi) => {
          const Icon = Icons[kpi.icon] as React.ComponentType<{
            className?: string;
          }>;
          const isPositive = kpi.change >= 0;

          return (
            <Card key={kpi.label} className="kpi-card">
              <CardContent className="pt-6">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground font-medium">
                      {kpi.label}
                    </p>
                    <div className="flex items-baseline gap-1.5 mt-1">
                      <span className="text-2xl font-bold text-foreground">
                        {kpi.value}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {kpi.unit}
                      </span>
                    </div>
                    <p
                      className={cn(
                        "text-xs mt-1 font-medium",
                        isPositive ? "text-green-600" : "text-red-500"
                      )}
                    >
                      {isPositive ? "+" : ""}
                      {kpi.change}% vs last week
                    </p>
                  </div>
                  <div
                    className={cn(
                      "p-2.5 rounded-lg",
                      kpi.bgColor
                    )}
                  >
                    {Icon && <Icon className={cn("h-5 w-5", kpi.color)} />}
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Charts + Lists Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Weekly Activity Chart */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Weekly Activity</CardTitle>
            <CardDescription>Calories burned per day this week</CardDescription>
          </CardHeader>
          <CardContent>
            <Charts.ResponsiveContainer width="100%" height={280}>
              <Charts.BarChart data={WEEKLY_ACTIVITY}>
                <Charts.CartesianGrid
                  strokeDasharray="3 3"
                  className="stroke-muted"
                />
                <Charts.XAxis dataKey="day" className="text-xs" />
                <Charts.YAxis className="text-xs" />
                <Charts.Tooltip />
                <Charts.Bar
                  dataKey="calories"
                  fill="hsl(var(--primary))"
                  radius={[6, 6, 0, 0]}
                />
              </Charts.BarChart>
            </Charts.ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Today's Meals Summary */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Today's Meals</CardTitle>
              <Badge variant="secondary" className="text-xs">
                {todayCalories} kcal
              </Badge>
            </div>
            <CardDescription>
              {todayMeals.length} items logged today
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {todayMeals.map((meal: any) => {
              const typeColors: Record<string, string> = {
                breakfast: "bg-amber-100 text-amber-700",
                lunch: "bg-green-100 text-green-700",
                dinner: "bg-blue-100 text-blue-700",
                snack: "bg-purple-100 text-purple-700",
              };
              return (
                <div
                  key={meal.id}
                  className="meal-row flex items-center justify-between py-2 px-2 rounded-md"
                >
                  <div className="flex items-center gap-3">
                    <Badge
                      className={cn(
                        "text-[10px] px-1.5 py-0 capitalize border-0",
                        typeColors[meal.meal_type] || "bg-muted"
                      )}
                    >
                      {meal.meal_type}
                    </Badge>
                    <span className="text-sm text-foreground">{meal.name}</span>
                  </div>
                  <span className="text-xs font-medium text-muted-foreground">
                    {meal.calories} cal
                  </span>
                </div>
              );
            })}
          </CardContent>
        </Card>
      </div>

      {/* Upcoming Workouts */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent Workouts</CardTitle>
          <CardDescription>Your latest workout sessions</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {upcomingWorkouts.map((w: any) => {
              const typeColors: Record<string, string> = {
                cardio: "bg-red-100 text-red-700",
                strength: "bg-blue-100 text-blue-700",
                flexibility: "bg-purple-100 text-purple-700",
                sports: "bg-amber-100 text-amber-700",
              };
              return (
                <div
                  key={w.id}
                  className="workout-card flex items-center justify-between py-3 px-4 rounded-lg bg-muted/30 hover:bg-muted/60"
                >
                  <div className="flex items-center gap-3">
                    <Badge
                      className={cn(
                        "text-[10px] px-2 py-0.5 capitalize border-0",
                        typeColors[w.type] || "bg-muted"
                      )}
                    >
                      {w.type}
                    </Badge>
                    <div>
                      <p className="text-sm font-medium text-foreground">
                        {w.name}
                      </p>
                      <p className="text-xs text-muted-foreground">{w.date}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4 text-xs text-muted-foreground">
                    <div className="flex items-center gap-1">
                      <Icons.Clock className="h-3.5 w-3.5" />
                      <span>{w.duration_min} min</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <Icons.Flame className="h-3.5 w-3.5 text-orange-500" />
                      <span>{w.calories_burned} cal</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default FitnessDashboard;
