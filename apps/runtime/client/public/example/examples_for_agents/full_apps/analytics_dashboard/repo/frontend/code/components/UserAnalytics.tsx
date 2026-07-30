import {
  React,
  useModel,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  Badge,
  Charts,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  Icons,
  cn,
} from "@exepad/sdk";

const ACTIVE_USERS_DATA = Array.from({ length: 30 }, (_, i) => {
  const dau = 2800 + Math.sin(i * 0.3) * 400 + i * 12 + (Math.random() - 0.5) * 300;
  return {
    day: `Feb ${i + 1}`,
    DAU: Math.round(dau),
    WAU: Math.round(dau * 3.2 + (Math.random() - 0.5) * 500),
    MAU: Math.round(dau * 8.5 + (Math.random() - 0.5) * 800),
  };
});

const DEMO_SESSIONS = Array.from({ length: 20 }, (_, i) => ({
  id: i + 1,
  session_id: `sess-${Math.random().toString(36).slice(2, 10)}`,
  start_time: `2026-02-${String(i + 1).padStart(2, "0")}T10:00:00Z`,
  end_time: `2026-02-${String(i + 1).padStart(2, "0")}T10:30:00Z`,
  pages_viewed: Math.floor(Math.random() * 8) + 1,
  country: "US",
  device_type: ["desktop", "mobile", "tablet"][i % 3],
  is_new_user: i % 3 === 0 ? 1 : 0,
}));

const COHORT_DATA = [
  { cohort: "Jan W1", users: 1240, retention: [100, 68, 52, 41, 35, 30] },
  { cohort: "Jan W2", users: 1180, retention: [100, 72, 55, 44, 37, 32] },
  { cohort: "Jan W3", users: 1350, retention: [100, 65, 48, 38, 31, 0] },
  { cohort: "Jan W4", users: 1420, retention: [100, 70, 51, 40, 0, 0] },
  { cohort: "Feb W1", users: 1510, retention: [100, 74, 56, 0, 0, 0] },
  { cohort: "Feb W2", users: 1380, retention: [100, 71, 0, 0, 0, 0] },
];

const SEGMENT_DATA = [
  { name: "New Users", value: 35, fill: "#0ea5e9" },
  { name: "Returning", value: 45, fill: "#22c55e" },
  { name: "Power Users", value: 20, fill: "#8b5cf6" },
];

const NEW_VS_RETURNING = [
  { month: "Mar", new: 3200, returning: 4800 },
  { month: "Apr", new: 3400, returning: 5100 },
  { month: "May", new: 3100, returning: 5300 },
  { month: "Jun", new: 3600, returning: 5500 },
  { month: "Jul", new: 3800, returning: 5700 },
  { month: "Aug", new: 3500, returning: 5900 },
  { month: "Sep", new: 4000, returning: 6100 },
  { month: "Oct", new: 4200, returning: 6400 },
  { month: "Nov", new: 3900, returning: 6600 },
  { month: "Dec", new: 4500, returning: 6800 },
  { month: "Jan", new: 4300, returning: 7000 },
  { month: "Feb", new: 4600, returning: 7200 },
];

const GEO_USERS = [
  { country: "United States", users: 14820, pct: 32.8 },
  { country: "United Kingdom", users: 5940, pct: 13.2 },
  { country: "Germany", users: 4280, pct: 9.5 },
  { country: "India", users: 3860, pct: 8.6 },
  { country: "Canada", users: 3420, pct: 7.6 },
  { country: "France", users: 2940, pct: 6.5 },
  { country: "Brazil", users: 2580, pct: 5.7 },
  { country: "Australia", users: 2210, pct: 4.9 },
  { country: "Japan", users: 1890, pct: 4.2 },
  { country: "Netherlands", users: 1460, pct: 3.2 },
];

const activeUsersConfig = {
  DAU: { label: "Daily Active", color: "#0ea5e9" },
  WAU: { label: "Weekly Active", color: "#22c55e" },
  MAU: { label: "Monthly Active", color: "#8b5cf6" },
};

const segmentConfig = {
  "New Users": { label: "New Users", color: "#0ea5e9" },
  Returning: { label: "Returning", color: "#22c55e" },
  "Power Users": { label: "Power Users", color: "#8b5cf6" },
};

const stackedConfig = {
  new: { label: "New Users", color: "#0ea5e9" },
  returning: { label: "Returning", color: "#22c55e" },
};

function getCohortColor(value: number): string {
  if (value === 0) return "";
  if (value >= 50) return "cohort-high";
  if (value >= 30) return "cohort-medium";
  return "cohort-low";
}

function UserAnalytics() {
  const sessionsModel = useModel("user_sessions");
  const sessions = (sessionsModel?.data as any[] | null) ?? DEMO_SESSIONS;

  return (
    <div className="p-6 space-y-6">
      {/* Active Users Chart */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Active Users</CardTitle>
          <CardDescription>Daily, weekly, and monthly active users over 30 days</CardDescription>
        </CardHeader>
        <CardContent>
          <ChartContainer config={activeUsersConfig} className="h-[300px] w-full">
            <Charts.LineChart data={ACTIVE_USERS_DATA} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
              <Charts.CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <Charts.XAxis dataKey="day" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
              <Charts.YAxis
                tick={{ fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v: number) => `${(v / 1000).toFixed(0)}K`}
              />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Charts.Line type="monotone" dataKey="DAU" stroke="#0ea5e9" strokeWidth={2} dot={false} />
              <Charts.Line type="monotone" dataKey="WAU" stroke="#22c55e" strokeWidth={2} dot={false} />
              <Charts.Line type="monotone" dataKey="MAU" stroke="#8b5cf6" strokeWidth={2} dot={false} />
              <Charts.Legend />
            </Charts.LineChart>
          </ChartContainer>
        </CardContent>
      </Card>

      {/* Retention Cohort Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Retention Cohorts</CardTitle>
          <CardDescription>
            Weekly user retention — percentage of users returning each week after signup
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr>
                <th className="text-left p-2 font-medium border-b border-border">Cohort</th>
                <th className="text-center p-2 font-medium border-b border-border">Users</th>
                {["Week 0", "Week 1", "Week 2", "Week 3", "Week 4", "Week 5"].map((w) => (
                  <th key={w} className="text-center p-2 font-medium border-b border-border text-xs">
                    {w}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {COHORT_DATA.map((row) => (
                <tr key={row.cohort}>
                  <td className="p-2 font-medium border-b border-border whitespace-nowrap">{row.cohort}</td>
                  <td className="p-2 text-center border-b border-border text-muted-foreground">
                    {row.users.toLocaleString()}
                  </td>
                  {row.retention.map((val, i) => (
                    <td
                      key={i}
                      className={cn(
                        "cohort-cell p-2 border-b border-border text-xs font-medium",
                        val > 0 && getCohortColor(val)
                      )}
                    >
                      {val > 0 ? `${val}%` : "—"}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* User Segments Pie */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">User Segments</CardTitle>
            <CardDescription>Breakdown by user type</CardDescription>
          </CardHeader>
          <CardContent>
            <ChartContainer config={segmentConfig} className="h-[200px] w-full">
              <Charts.PieChart>
                <Charts.Pie
                  data={SEGMENT_DATA}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  innerRadius={40}
                  outerRadius={75}
                  paddingAngle={2}
                />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Charts.Legend />
              </Charts.PieChart>
            </ChartContainer>
            <div className="flex justify-center gap-4 mt-2">
              {SEGMENT_DATA.map((s) => (
                <div key={s.name} className="text-center">
                  <p className="text-lg font-bold" style={{ color: s.fill }}>{s.value}%</p>
                  <p className="text-xs text-muted-foreground">{s.name}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* New vs Returning Stacked Bar */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">New vs Returning Users</CardTitle>
            <CardDescription>Monthly breakdown of new and returning users</CardDescription>
          </CardHeader>
          <CardContent>
            <ChartContainer config={stackedConfig} className="h-[280px] w-full">
              <Charts.BarChart data={NEW_VS_RETURNING} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                <Charts.CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <Charts.XAxis dataKey="month" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                <Charts.YAxis
                  tick={{ fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v: number) => `${(v / 1000).toFixed(0)}K`}
                />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Charts.Bar dataKey="new" stackId="users" fill="#0ea5e9" radius={[0, 0, 0, 0]} />
                <Charts.Bar dataKey="returning" stackId="users" fill="#22c55e" radius={[4, 4, 0, 0]} />
                <Charts.Legend />
              </Charts.BarChart>
            </ChartContainer>
          </CardContent>
        </Card>
      </div>

      {/* Geographic Distribution */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Geographic Distribution</CardTitle>
          <CardDescription>Top 10 countries by user count</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-3">
            {GEO_USERS.map((geo, idx) => (
              <div key={geo.country} className="flex items-center gap-3">
                <span className="text-xs text-muted-foreground w-4">{idx + 1}</span>
                <div className="flex-1 space-y-1">
                  <div className="flex items-center justify-between text-sm">
                    <span>{geo.country}</span>
                    <span className="text-muted-foreground">
                      {geo.users.toLocaleString()} <span className="text-xs">({geo.pct}%)</span>
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full rounded-full bg-primary transition-all"
                      style={{ width: `${(geo.pct / 32.8) * 100}%` }}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default UserAnalytics;
