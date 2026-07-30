import {
  React,
  useModel,
  useAppState,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  Badge,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Charts,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  Icons,
  cn,
} from "@exepad/sdk";

const DAILY_VISITORS = Array.from({ length: 30 }, (_, i) => {
  const base = 1200 + Math.sin(i * 0.3) * 300 + i * 15;
  return {
    day: `Feb ${i + 1}`,
    visitors: Math.round(base + (Math.random() - 0.5) * 200),
    sessions: Math.round(base * 1.3 + (Math.random() - 0.5) * 250),
  };
});

const DEMO_PAGE_VIEWS = DAILY_VISITORS.map((d) => ({
  id: Math.random(),
  page_url: "/",
  referrer: null,
  session_id: `s-${Math.random().toString(36).slice(2, 8)}`,
  user_agent: null,
  country: "US",
  city: null,
  timestamp: `2026-02-${String(DAILY_VISITORS.indexOf(d) + 1).padStart(2, "0")}T12:00:00Z`,
}));

const KPI_DATA = [
  {
    label: "Visitors",
    value: "45.2K",
    change: +12.3,
    icon: "Users" as keyof typeof Icons,
    spark: [820, 932, 1050, 980, 1120, 1280, 1350, 1190, 1420, 1510],
    color: "#0ea5e9",
  },
  {
    label: "Revenue",
    value: "$124K",
    change: +8.1,
    icon: "DollarSign" as keyof typeof Icons,
    spark: [3200, 3500, 3400, 3800, 4100, 3900, 4200, 4500, 4400, 4800],
    color: "#22c55e",
  },
  {
    label: "Conversion",
    value: "3.2%",
    change: -0.5,
    icon: "TrendingUp" as keyof typeof Icons,
    spark: [3.5, 3.4, 3.6, 3.3, 3.1, 3.2, 3.0, 3.2, 3.1, 3.2],
    color: "#f59e0b",
  },
  {
    label: "Avg Order",
    value: "$86",
    change: +3.2,
    icon: "ShoppingCart" as keyof typeof Icons,
    spark: [78, 80, 82, 79, 84, 83, 85, 86, 84, 86],
    color: "#8b5cf6",
  },
];

const TOP_PAGES = [
  { url: "/", views: 12840, unique: 8920, bounce: 32.1, avgTime: "2m 45s" },
  { url: "/pricing", views: 8430, unique: 6210, bounce: 28.4, avgTime: "3m 12s" },
  { url: "/features", views: 6215, unique: 4830, bounce: 35.7, avgTime: "2m 18s" },
  { url: "/blog/ai-trends", views: 4890, unique: 3920, bounce: 22.6, avgTime: "4m 52s" },
  { url: "/docs/getting-started", views: 3640, unique: 2810, bounce: 18.3, avgTime: "5m 30s" },
  { url: "/about", views: 2950, unique: 2340, bounce: 41.2, avgTime: "1m 55s" },
  { url: "/contact", views: 2180, unique: 1870, bounce: 38.9, avgTime: "1m 42s" },
];

const GEO_DATA = [
  { country: "United States", visitors: 18240, pct: 40.4 },
  { country: "United Kingdom", visitors: 6320, pct: 14.0 },
  { country: "Germany", visitors: 4510, pct: 10.0 },
  { country: "Canada", visitors: 3680, pct: 8.1 },
  { country: "Australia", visitors: 2940, pct: 6.5 },
];

const DEVICE_DATA = [
  { name: "Desktop", value: 62, fill: "#0ea5e9" },
  { name: "Mobile", value: 30, fill: "#22c55e" },
  { name: "Tablet", value: 8, fill: "#f59e0b" },
];

const deviceChartConfig = {
  Desktop: { label: "Desktop", color: "#0ea5e9" },
  Mobile: { label: "Mobile", color: "#22c55e" },
  Tablet: { label: "Tablet", color: "#f59e0b" },
};

const trafficChartConfig = {
  visitors: { label: "Visitors", color: "#0ea5e9" },
  sessions: { label: "Sessions", color: "#38bdf8" },
};

function MiniAreaSparkline({ data, color }: { data: number[]; color: string }) {
  const sparkData = data.map((v, i) => ({ idx: i, val: v }));
  const cfg = { val: { label: "Value", color } };
  return (
    <ChartContainer config={cfg} className="h-[50px] w-full">
      <Charts.AreaChart data={sparkData} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
        <defs>
          <linearGradient id={`grad-${color.replace("#", "")}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.3} />
            <stop offset="100%" stopColor={color} stopOpacity={0.05} />
          </linearGradient>
        </defs>
        <Charts.Area
          type="monotone"
          dataKey="val"
          stroke={color}
          strokeWidth={1.5}
          fill={`url(#grad-${color.replace("#", "")})`}
        />
      </Charts.AreaChart>
    </ChartContainer>
  );
}

function AnalyticsOverview() {
  const pageViewsModel = useModel("page_views");
  const pageViews = (pageViewsModel?.data as any[] | null) ?? DEMO_PAGE_VIEWS;
  const [selectedMetric, setSelectedMetric] = useAppState<string>("selectedMetric", "visitors");

  return (
    <div className="p-6 space-y-6">
      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {KPI_DATA.map((kpi) => {
          const Icon = Icons[kpi.icon] as React.ComponentType<{ className?: string }>;
          const isPositive = kpi.change >= 0;
          return (
            <Card
              key={kpi.label}
              className={cn(
                "metric-card cursor-pointer transition-all",
                (selectedMetric ?? "visitors") === kpi.label.toLowerCase() && "ring-2 ring-primary"
              )}
              onClick={() => setSelectedMetric(kpi.label.toLowerCase())}
            >
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <div
                      className="flex h-8 w-8 items-center justify-center rounded-lg"
                      style={{ backgroundColor: `${kpi.color}15` }}
                    >
                      {Icon && <Icon className="h-4 w-4" style={{ color: kpi.color }} />}
                    </div>
                    <span className="text-sm text-muted-foreground">{kpi.label}</span>
                  </div>
                  <Badge variant={isPositive ? "default" : "destructive"} className="text-[10px] px-1.5 py-0">
                    {isPositive ? "+" : ""}{kpi.change}%
                  </Badge>
                </div>
                <div className="text-2xl font-bold mb-2">{kpi.value}</div>
                <MiniAreaSparkline data={kpi.spark} color={kpi.color} />
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Traffic Trend Chart */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Traffic Trend</CardTitle>
          <CardDescription>Visitors and sessions over the last 30 days</CardDescription>
        </CardHeader>
        <CardContent>
          <ChartContainer config={trafficChartConfig} className="h-[280px] w-full">
            <Charts.LineChart data={DAILY_VISITORS} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
              <Charts.CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <Charts.XAxis dataKey="day" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
              <Charts.YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Charts.Line
                type="monotone"
                dataKey="visitors"
                stroke="#0ea5e9"
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4 }}
              />
              <Charts.Line
                type="monotone"
                dataKey="sessions"
                stroke="#38bdf8"
                strokeWidth={2}
                strokeDasharray="5 5"
                dot={false}
              />
              <Charts.Legend />
            </Charts.LineChart>
          </ChartContainer>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Top Pages Table */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Top Pages</CardTitle>
            <CardDescription>Most visited pages with engagement metrics</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Page URL</TableHead>
                  <TableHead className="text-right">Views</TableHead>
                  <TableHead className="text-right">Unique</TableHead>
                  <TableHead className="text-right">Bounce</TableHead>
                  <TableHead className="text-right">Avg Time</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {TOP_PAGES.map((page) => (
                  <TableRow key={page.url}>
                    <TableCell className="font-mono text-xs">{page.url}</TableCell>
                    <TableCell className="text-right">{page.views.toLocaleString()}</TableCell>
                    <TableCell className="text-right">{page.unique.toLocaleString()}</TableCell>
                    <TableCell className="text-right">
                      <span className={cn(page.bounce > 35 ? "text-destructive" : "text-green-600")}>
                        {page.bounce}%
                      </span>
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">{page.avgTime}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Right Column: Geo + Device */}
        <div className="space-y-6">
          {/* Geographic Distribution */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Top Countries</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {GEO_DATA.map((geo) => (
                <div key={geo.country} className="space-y-1">
                  <div className="flex items-center justify-between text-sm">
                    <span>{geo.country}</span>
                    <span className="text-muted-foreground">{geo.visitors.toLocaleString()} ({geo.pct}%)</span>
                  </div>
                  <div className="h-2 rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full rounded-full bg-primary transition-all"
                      style={{ width: `${(geo.pct / 40.4) * 100}%` }}
                    />
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Device Breakdown */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Device Breakdown</CardTitle>
            </CardHeader>
            <CardContent>
              <ChartContainer config={deviceChartConfig} className="h-[180px] w-full">
                <Charts.PieChart>
                  <Charts.Pie
                    data={DEVICE_DATA}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius={40}
                    outerRadius={70}
                    paddingAngle={2}
                  />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Charts.Legend />
                </Charts.PieChart>
              </ChartContainer>
              <div className="flex justify-center gap-4 mt-2">
                {DEVICE_DATA.map((d) => (
                  <div key={d.name} className="flex items-center gap-1.5 text-xs">
                    <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: d.fill }} />
                    <span className="text-muted-foreground">{d.name}</span>
                    <span className="font-medium">{d.value}%</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

export default AnalyticsOverview;
