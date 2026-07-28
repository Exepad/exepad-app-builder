import {
  React,
  Charts,
  format,
  ToggleGroup,
  ToggleGroupItem,
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  Badge,
  useAppState,
  cn,
} from "@exepad/sdk";

interface DayData {
  date: string;
  pageViews: number;
  sessions: number;
  avgDuration: number;
  bounceRate: number;
}

const generateDemoData = (): DayData[] => {
  const data: DayData[] = [];
  const baseDate = new Date(2025, 2, 1);
  for (let i = 0; i < 30; i++) {
    const date = new Date(baseDate);
    date.setDate(date.getDate() + i);
    const dayOfWeek = date.getDay();
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
    const basePV = isWeekend ? 1200 : 2800;
    const baseSessions = isWeekend ? 450 : 1100;
    data.push({
      date: format(date, "MMM dd"),
      pageViews: basePV + Math.floor(Math.random() * 800),
      sessions: baseSessions + Math.floor(Math.random() * 300),
      avgDuration: 120 + Math.floor(Math.random() * 180),
      bounceRate: 30 + Math.floor(Math.random() * 25),
    });
  }
  return data;
};

const DEMO_DATA = generateDemoData();

const SUMMARY_STATS = [
  { label: "Total Page Views", value: "72,489", trend: "+12.3%", positive: true },
  { label: "Avg. Sessions/Day", value: "1,024", trend: "+8.7%", positive: true },
  { label: "Avg. Duration", value: "3m 42s", trend: "+5.1%", positive: true },
  { label: "Bounce Rate", value: "38.2%", trend: "-2.4%", positive: true },
];

type ChartView = "pageviews" | "sessions" | "duration";

function AnalyticsDashboard() {
  const [activeView, setActiveView] = useAppState<ChartView>("analyticsView", "pageviews");

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {SUMMARY_STATS.map((stat) => (
          <Card key={stat.label}>
            <CardContent className="pt-6">
              <p className="text-sm text-muted-foreground">{stat.label}</p>
              <p className="text-2xl font-bold mt-1">{stat.value}</p>
              <Badge
                variant="secondary"
                className={cn(
                  "mt-2 text-xs",
                  stat.positive
                    ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300"
                    : "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300"
                )}
              >
                {stat.trend}
              </Badge>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <CardTitle>Traffic Overview</CardTitle>
              <CardDescription>Page views and sessions over the last 30 days</CardDescription>
            </div>
            <ToggleGroup
              type="single"
              value={activeView || "pageviews"}
              onValueChange={(val: string) => {
                if (val) setActiveView(val as ChartView);
              }}
            >
              <ToggleGroupItem value="pageviews" aria-label="Page Views">
                Page Views
              </ToggleGroupItem>
              <ToggleGroupItem value="sessions" aria-label="Sessions">
                Sessions
              </ToggleGroupItem>
              <ToggleGroupItem value="duration" aria-label="Duration">
                Duration
              </ToggleGroupItem>
            </ToggleGroup>
          </div>
        </CardHeader>
        <CardContent>
          <Charts.ResponsiveContainer width="100%" height={350}>
            {(activeView || "pageviews") === "duration" ? (
              <Charts.AreaChart data={DEMO_DATA}>
                <Charts.CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <Charts.XAxis
                  dataKey="date"
                  className="text-xs"
                  tick={{ fontSize: 11 }}
                  interval={4}
                />
                <Charts.YAxis className="text-xs" tick={{ fontSize: 11 }} />
                <Charts.Tooltip
                  formatter={(value: number) => {
                    const mins = Math.floor(value / 60);
                    const secs = value % 60;
                    return [`${mins}m ${secs}s`, "Avg Duration"];
                  }}
                />
                <Charts.Legend />
                <Charts.Area
                  type="monotone"
                  dataKey="avgDuration"
                  name="Avg Duration (s)"
                  stroke="hsl(var(--primary))"
                  fill="hsl(var(--primary))"
                  fillOpacity={0.15}
                  strokeWidth={2}
                />
              </Charts.AreaChart>
            ) : (
              <Charts.LineChart data={DEMO_DATA}>
                <Charts.CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <Charts.XAxis
                  dataKey="date"
                  className="text-xs"
                  tick={{ fontSize: 11 }}
                  interval={4}
                />
                <Charts.YAxis className="text-xs" tick={{ fontSize: 11 }} />
                <Charts.Tooltip />
                <Charts.Legend />
                {(activeView || "pageviews") === "pageviews" ? (
                  <>
                    <Charts.Line
                      type="monotone"
                      dataKey="pageViews"
                      name="Page Views"
                      stroke="hsl(var(--primary))"
                      strokeWidth={2}
                      dot={false}
                      activeDot={{ r: 4 }}
                    />
                    <Charts.Line
                      type="monotone"
                      dataKey="sessions"
                      name="Sessions"
                      stroke="hsl(var(--muted-foreground))"
                      strokeWidth={2}
                      strokeDasharray="5 5"
                      dot={false}
                      activeDot={{ r: 4 }}
                    />
                  </>
                ) : (
                  <Charts.Line
                    type="monotone"
                    dataKey="sessions"
                    name="Sessions"
                    stroke="hsl(var(--primary))"
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 4 }}
                  />
                )}
              </Charts.LineChart>
            )}
          </Charts.ResponsiveContainer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Session Duration Trend</CardTitle>
          <CardDescription>Average time spent per session across the period</CardDescription>
        </CardHeader>
        <CardContent>
          <Charts.ResponsiveContainer width="100%" height={250}>
            <Charts.AreaChart data={DEMO_DATA}>
              <Charts.CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <Charts.XAxis
                dataKey="date"
                className="text-xs"
                tick={{ fontSize: 11 }}
                interval={4}
              />
              <Charts.YAxis className="text-xs" tick={{ fontSize: 11 }} />
              <Charts.Tooltip />
              <Charts.Area
                type="monotone"
                dataKey="bounceRate"
                name="Bounce Rate (%)"
                stroke="hsl(var(--destructive))"
                fill="hsl(var(--destructive))"
                fillOpacity={0.1}
                strokeWidth={2}
              />
            </Charts.AreaChart>
          </Charts.ResponsiveContainer>
        </CardContent>
      </Card>
    </div>
  );
}

export default AnalyticsDashboard;
