import {
  React,
  useModel,
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

const DAILY_PAGE_VIEWS = Array.from({ length: 30 }, (_, i) => {
  const base = 2400 + Math.sin(i * 0.25) * 500 + i * 20;
  const weekend = (i % 7 === 5 || i % 7 === 6) ? 0.65 : 1;
  return {
    day: `Feb ${i + 1}`,
    views: Math.round((base + (Math.random() - 0.5) * 400) * weekend),
    unique: Math.round((base * 0.68 + (Math.random() - 0.5) * 200) * weekend),
  };
});

const DEMO_PAGE_VIEWS = DAILY_PAGE_VIEWS.map((d, i) => ({
  id: i + 1,
  page_url: "/",
  referrer: null,
  session_id: `s-${Math.random().toString(36).slice(2, 8)}`,
  user_agent: null,
  country: "US",
  city: null,
  timestamp: `2026-02-${String(i + 1).padStart(2, "0")}T12:00:00Z`,
}));

const REFERRAL_SOURCES = [
  { name: "Direct", value: 40, fill: "#0ea5e9" },
  { name: "Organic Search", value: 25, fill: "#22c55e" },
  { name: "Social Media", value: 20, fill: "#8b5cf6" },
  { name: "Referral", value: 10, fill: "#f59e0b" },
  { name: "Email", value: 5, fill: "#ef4444" },
];

const LANDING_PAGES = [
  { url: "/", sessions: 8420, bounce: 31.2, avgDuration: "3m 05s", newUsers: 42 },
  { url: "/pricing", sessions: 5830, bounce: 24.8, avgDuration: "4m 12s", newUsers: 38 },
  { url: "/blog/ai-trends-2026", sessions: 4210, bounce: 18.3, avgDuration: "5m 48s", newUsers: 61 },
  { url: "/features", sessions: 3940, bounce: 29.5, avgDuration: "2m 55s", newUsers: 35 },
  { url: "/docs/quickstart", sessions: 3120, bounce: 15.7, avgDuration: "6m 22s", newUsers: 28 },
  { url: "/blog/seo-guide", sessions: 2680, bounce: 21.4, avgDuration: "4m 45s", newUsers: 55 },
  { url: "/signup", sessions: 2340, bounce: 44.1, avgDuration: "1m 32s", newUsers: 72 },
  { url: "/case-studies", sessions: 1890, bounce: 19.8, avgDuration: "5m 10s", newUsers: 31 },
  { url: "/api-reference", sessions: 1560, bounce: 12.4, avgDuration: "7m 05s", newUsers: 18 },
  { url: "/changelog", sessions: 1240, bounce: 26.3, avgDuration: "2m 38s", newUsers: 22 },
];

const BOUNCE_RATE_TREND = Array.from({ length: 30 }, (_, i) => ({
  day: `Feb ${i + 1}`,
  rate: parseFloat((34 - i * 0.15 + Math.sin(i * 0.4) * 3 + (Math.random() - 0.5) * 2).toFixed(1)),
}));

const viewsChartConfig = {
  views: { label: "Page Views", color: "#0ea5e9" },
  unique: { label: "Unique Visitors", color: "#22c55e" },
};

const referralChartConfig = {
  Direct: { label: "Direct", color: "#0ea5e9" },
  "Organic Search": { label: "Organic Search", color: "#22c55e" },
  "Social Media": { label: "Social Media", color: "#8b5cf6" },
  Referral: { label: "Referral", color: "#f59e0b" },
  Email: { label: "Email", color: "#ef4444" },
};

const bounceChartConfig = {
  rate: { label: "Bounce Rate %", color: "#f59e0b" },
};

function TrafficAnalytics() {
  const pageViewsModel = useModel("page_views");
  const pageViews = (pageViewsModel?.data as any[] | null) ?? DEMO_PAGE_VIEWS;

  return (
    <div className="p-6 space-y-6">
      {/* Page Views Chart */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base">Page Views</CardTitle>
              <CardDescription>Daily page views and unique visitors over 30 days</CardDescription>
            </div>
            <div className="flex items-center gap-3 text-sm">
              <div className="flex items-center gap-1.5">
                <div className="w-3 h-0.5 bg-[#0ea5e9] rounded" />
                <span className="text-muted-foreground">Views</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-3 h-0.5 bg-[#22c55e] rounded" />
                <span className="text-muted-foreground">Unique</span>
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <ChartContainer config={viewsChartConfig} className="h-[300px] w-full">
            <Charts.AreaChart data={DAILY_PAGE_VIEWS} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
              <defs>
                <linearGradient id="gradViews" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#0ea5e9" stopOpacity={0.25} />
                  <stop offset="100%" stopColor="#0ea5e9" stopOpacity={0.02} />
                </linearGradient>
                <linearGradient id="gradUnique" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#22c55e" stopOpacity={0.2} />
                  <stop offset="100%" stopColor="#22c55e" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <Charts.CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <Charts.XAxis dataKey="day" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
              <Charts.YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Charts.Area
                type="monotone"
                dataKey="views"
                stroke="#0ea5e9"
                strokeWidth={2}
                fill="url(#gradViews)"
              />
              <Charts.Area
                type="monotone"
                dataKey="unique"
                stroke="#22c55e"
                strokeWidth={2}
                fill="url(#gradUnique)"
              />
            </Charts.AreaChart>
          </ChartContainer>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Referral Sources */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Referral Sources</CardTitle>
            <CardDescription>Where your traffic comes from</CardDescription>
          </CardHeader>
          <CardContent>
            <ChartContainer config={referralChartConfig} className="h-[220px] w-full">
              <Charts.PieChart>
                <Charts.Pie
                  data={REFERRAL_SOURCES}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  innerRadius={45}
                  outerRadius={80}
                  paddingAngle={2}
                />
                <ChartTooltip content={<ChartTooltipContent />} />
              </Charts.PieChart>
            </ChartContainer>
            <div className="space-y-2 mt-3">
              {REFERRAL_SOURCES.map((src) => (
                <div key={src.name} className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: src.fill }} />
                    <span>{src.name}</span>
                  </div>
                  <span className="font-medium">{src.value}%</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Landing Pages Table */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Top Landing Pages</CardTitle>
            <CardDescription>First pages visitors land on</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Page URL</TableHead>
                  <TableHead className="text-right">Sessions</TableHead>
                  <TableHead className="text-right">Bounce Rate</TableHead>
                  <TableHead className="text-right">Avg Duration</TableHead>
                  <TableHead className="text-right">New Users %</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {LANDING_PAGES.map((page) => (
                  <TableRow key={page.url}>
                    <TableCell className="font-mono text-xs max-w-[200px] truncate">{page.url}</TableCell>
                    <TableCell className="text-right">{page.sessions.toLocaleString()}</TableCell>
                    <TableCell className="text-right">
                      <span className={cn(page.bounce > 35 ? "text-destructive" : page.bounce < 20 ? "text-green-600" : "")}>
                        {page.bounce}%
                      </span>
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">{page.avgDuration}</TableCell>
                    <TableCell className="text-right">
                      <Badge variant="outline" className="text-[10px]">{page.newUsers}%</Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      {/* Bounce Rate Trend */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Bounce Rate Trend</CardTitle>
          <CardDescription>Daily bounce rate over 30 days (lower is better)</CardDescription>
        </CardHeader>
        <CardContent>
          <ChartContainer config={bounceChartConfig} className="h-[220px] w-full">
            <Charts.LineChart data={BOUNCE_RATE_TREND} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
              <Charts.CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <Charts.XAxis dataKey="day" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
              <Charts.YAxis
                tick={{ fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                domain={[20, 40]}
                tickFormatter={(v: number) => `${v}%`}
              />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Charts.Line
                type="monotone"
                dataKey="rate"
                stroke="#f59e0b"
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4 }}
              />
              <Charts.ReferenceLine y={30} stroke="#ef4444" strokeDasharray="4 4" />
            </Charts.LineChart>
          </ChartContainer>
        </CardContent>
      </Card>
    </div>
  );
}

export default TrafficAnalytics;
