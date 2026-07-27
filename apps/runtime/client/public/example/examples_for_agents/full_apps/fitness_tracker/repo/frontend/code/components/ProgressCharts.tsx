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
  Button,
  Tabs,
  TabsList,
  TabsTrigger,
  useModel,
} from "@exepad/sdk";

const { useState } = React;

/* ── Demo Data ── */

const generateWeightData = (days: number) => {
  const data = [];
  const baseWeight = 182;
  const startDate = new Date("2026-02-25");
  for (let i = 0; i < days; i++) {
    const date = new Date(startDate);
    date.setDate(date.getDate() + i);
    const variation = Math.sin(i * 0.3) * 1.5 + (i * -0.08);
    data.push({
      date: date.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      weight: Math.round((baseWeight + variation) * 10) / 10,
    });
  }
  return data;
};

const WEIGHT_DATA_30 = generateWeightData(30);
const WEIGHT_DATA_7 = WEIGHT_DATA_30.slice(-7);
const WEIGHT_DATA_90 = generateWeightData(90);

const DEMO_MEASUREMENTS = [
  { id: "ms1", date: "2026-03-27", weight: 179.6, body_fat_pct: 18.2, chest: 42.0, waist: 33.5, hips: 38.0 },
  { id: "ms2", date: "2026-02-27", weight: 182.0, body_fat_pct: 19.8, chest: 41.5, waist: 34.5, hips: 38.5 },
];

const WEEKLY_WORKOUT_FREQ = [
  { week: "W1", workouts: 3 },
  { week: "W2", workouts: 4 },
  { week: "W3", workouts: 5 },
  { week: "W4", workouts: 4 },
  { week: "W5", workouts: 5 },
  { week: "W6", workouts: 3 },
  { week: "W7", workouts: 4 },
  { week: "W8", workouts: 5 },
  { week: "W9", workouts: 4 },
  { week: "W10", workouts: 5 },
  { week: "W11", workouts: 4 },
  { week: "W12", workouts: 4 },
];

const PERSONAL_RECORDS = [
  { exercise: "Bench Press", record: "185 lbs", date: "Mar 20, 2026", icon: "Dumbbell" },
  { exercise: "5K Run", record: "24:30", date: "Mar 15, 2026", icon: "Timer" },
  { exercise: "Deadlift", record: "315 lbs", date: "Mar 10, 2026", icon: "Dumbbell" },
  { exercise: "Plank Hold", record: "3:45", date: "Mar 8, 2026", icon: "Timer" },
  { exercise: "Squat", record: "255 lbs", date: "Feb 28, 2026", icon: "Dumbbell" },
  { exercise: "10K Run", record: "52:15", date: "Feb 20, 2026", icon: "Timer" },
  { exercise: "Pull-ups", record: "18 reps", date: "Feb 15, 2026", icon: "Dumbbell" },
  { exercise: "Swimming 1500m", record: "28:40", date: "Feb 10, 2026", icon: "Timer" },
];

/* ── Component ── */

function ProgressCharts({ className }: { className?: string }) {
  const measurementsModel = useModel("measurements");
  const measurements = (measurementsModel?.data as any[] | null) ?? DEMO_MEASUREMENTS;
  const [period, setPeriod] = useState("30d");

  const allMeasurements = measurements || DEMO_MEASUREMENTS;
  const current = allMeasurements[0] || DEMO_MEASUREMENTS[0];
  const previous = allMeasurements[1] || DEMO_MEASUREMENTS[1];

  const weightData =
    period === "7d"
      ? WEIGHT_DATA_7
      : period === "90d"
      ? WEIGHT_DATA_90
      : WEIGHT_DATA_30;

  const bodyMetrics = [
    {
      label: "Weight",
      current: `${current.weight} lbs`,
      previous: `${previous.weight} lbs`,
      change: current.weight - previous.weight,
      unit: "lbs",
    },
    {
      label: "Body Fat",
      current: `${current.body_fat_pct}%`,
      previous: `${previous.body_fat_pct}%`,
      change: current.body_fat_pct - previous.body_fat_pct,
      unit: "%",
    },
    {
      label: "Chest",
      current: `${current.chest}"`,
      previous: `${previous.chest}"`,
      change: current.chest - previous.chest,
      unit: "in",
    },
    {
      label: "Waist",
      current: `${current.waist}"`,
      previous: `${previous.waist}"`,
      change: current.waist - previous.waist,
      unit: "in",
    },
    {
      label: "Hips",
      current: `${current.hips}"`,
      previous: `${previous.hips}"`,
      change: current.hips - previous.hips,
      unit: "in",
    },
  ];

  return (
    <div className={cn("p-6 space-y-6", className)}>
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-2xl font-bold text-foreground tracking-tight">
            Progress
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Track your fitness journey over time
          </p>
        </div>
        <Tabs value={period} onValueChange={setPeriod}>
          <TabsList>
            <TabsTrigger value="7d">7D</TabsTrigger>
            <TabsTrigger value="30d">30D</TabsTrigger>
            <TabsTrigger value="90d">90D</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {/* Weight Trend Chart */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Weight Trend</CardTitle>
          <CardDescription>
            Your weight over the past {period === "7d" ? "7 days" : period === "90d" ? "90 days" : "30 days"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Charts.ResponsiveContainer width="100%" height={300}>
            <Charts.LineChart data={weightData}>
              <Charts.CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <Charts.XAxis
                dataKey="date"
                className="text-xs"
                interval={period === "90d" ? 9 : period === "7d" ? 0 : 4}
              />
              <Charts.YAxis
                className="text-xs"
                domain={["dataMin - 2", "dataMax + 2"]}
              />
              <Charts.Tooltip />
              <Charts.Line
                type="monotone"
                dataKey="weight"
                stroke="hsl(var(--primary))"
                strokeWidth={2}
                dot={{ r: period === "90d" ? 0 : 3, fill: "hsl(var(--primary))" }}
                activeDot={{ r: 5 }}
              />
            </Charts.LineChart>
          </Charts.ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Body Measurements */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Body Measurements</CardTitle>
          <CardDescription>
            Current vs. last month comparison
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
            {bodyMetrics.map((m) => {
              const isDown = m.change < 0;
              const isUp = m.change > 0;
              const changeColor =
                m.label === "Chest"
                  ? isUp
                    ? "text-green-600"
                    : "text-red-500"
                  : isDown
                  ? "text-green-600"
                  : isUp
                  ? "text-red-500"
                  : "text-muted-foreground";

              return (
                <div
                  key={m.label}
                  className="p-4 rounded-lg bg-muted/30 text-center"
                >
                  <p className="text-xs text-muted-foreground mb-1">
                    {m.label}
                  </p>
                  <p className="text-lg font-bold text-foreground">
                    {m.current}
                  </p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    was {m.previous}
                  </p>
                  <p className={cn("text-xs font-medium mt-1", changeColor)}>
                    {m.change > 0 ? "+" : ""}
                    {Math.round(m.change * 10) / 10} {m.unit}
                  </p>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Workout Frequency */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Workout Frequency</CardTitle>
            <CardDescription>Sessions per week over 12 weeks</CardDescription>
          </CardHeader>
          <CardContent>
            <Charts.ResponsiveContainer width="100%" height={250}>
              <Charts.BarChart data={WEEKLY_WORKOUT_FREQ}>
                <Charts.CartesianGrid
                  strokeDasharray="3 3"
                  className="stroke-muted"
                />
                <Charts.XAxis dataKey="week" className="text-xs" />
                <Charts.YAxis className="text-xs" />
                <Charts.Tooltip />
                <Charts.Bar
                  dataKey="workouts"
                  fill="hsl(var(--primary))"
                  radius={[4, 4, 0, 0]}
                />
              </Charts.BarChart>
            </Charts.ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Personal Records */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Personal Records</CardTitle>
            <CardDescription>Your all-time bests</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {PERSONAL_RECORDS.map((pr) => {
                const Icon = Icons[pr.icon as keyof typeof Icons] as React.ComponentType<{
                  className?: string;
                }>;
                return (
                  <div
                    key={pr.exercise}
                    className="flex items-center justify-between py-2 px-3 rounded-lg bg-muted/30 hover:bg-muted/50"
                  >
                    <div className="flex items-center gap-3">
                      {Icon && (
                        <Icon className="h-4 w-4 text-primary" />
                      )}
                      <div>
                        <p className="text-sm font-medium text-foreground">
                          {pr.exercise}
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                          {pr.date}
                        </p>
                      </div>
                    </div>
                    <Badge
                      variant="secondary"
                      className="bg-accent text-primary font-bold"
                    >
                      {pr.record}
                    </Badge>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default ProgressCharts;
