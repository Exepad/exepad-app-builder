import {
  React,
  useModel,
  Charts,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  Icons,
  cn,
} from "@exepad/sdk";

interface MonthlyRevenue {
  month: string;
  revenue: number;
  deals_closed: number;
}

interface StageData {
  name: string;
  value: number;
  color: string;
}

interface FunnelData {
  stage: string;
  count: number;
  rate: string;
}

const MONTHLY_REVENUE: MonthlyRevenue[] = [
  { month: "Apr", revenue: 120000, deals_closed: 3 },
  { month: "May", revenue: 185000, deals_closed: 4 },
  { month: "Jun", revenue: 142000, deals_closed: 3 },
  { month: "Jul", revenue: 210000, deals_closed: 5 },
  { month: "Aug", revenue: 178000, deals_closed: 4 },
  { month: "Sep", revenue: 245000, deals_closed: 6 },
  { month: "Oct", revenue: 198000, deals_closed: 4 },
  { month: "Nov", revenue: 267000, deals_closed: 5 },
  { month: "Dec", revenue: 312000, deals_closed: 7 },
  { month: "Jan", revenue: 225000, deals_closed: 5 },
  { month: "Feb", revenue: 289000, deals_closed: 6 },
  { month: "Mar", revenue: 340000, deals_closed: 8 },
];

const STAGE_DISTRIBUTION: StageData[] = [
  { name: "Qualification", value: 12, color: "hsl(210, 80%, 55%)" },
  { name: "Proposal", value: 15, color: "hsl(45, 90%, 50%)" },
  { name: "Negotiation", value: 10, color: "hsl(270, 60%, 55%)" },
  { name: "Closed Won", value: 8, color: "hsl(145, 65%, 45%)" },
  { name: "Closed Lost", value: 5, color: "hsl(0, 70%, 55%)" },
];

const FUNNEL_DATA: FunnelData[] = [
  { stage: "Leads Generated", count: 320, rate: "100%" },
  { stage: "Qualified", count: 185, rate: "57.8%" },
  { stage: "Proposal Sent", count: 98, rate: "30.6%" },
  { stage: "Negotiation", count: 62, rate: "19.4%" },
  { stage: "Closed Won", count: 47, rate: "14.7%" },
];

interface SummaryCard {
  label: string;
  value: string;
  subtext: string;
  icon: keyof typeof Icons;
  trend: string;
  trendUp: boolean;
}

const SUMMARY_CARDS: SummaryCard[] = [
  { label: "Monthly Growth", value: "+17.6%", subtext: "vs last month", icon: "TrendingUp", trend: "+3.2%", trendUp: true },
  { label: "Pipeline Value", value: "$2.8M", subtext: "50 active deals", icon: "Briefcase", trend: "+$340K", trendUp: true },
  { label: "Deals Closed", value: "8", subtext: "this month", icon: "CheckCircle", trend: "+3 vs avg", trendUp: true },
  { label: "Avg Close Time", value: "32 days", subtext: "qualification to close", icon: "Clock", trend: "-4 days", trendUp: true },
];

const DEMO_REPORT_DATA = [
  { id: "1", type: "revenue", period: "2026-03" },
];

function CrmReports() {
  const reportsModel = useModel("activities");
  const reports = (reportsModel?.data as any[] | null) ?? DEMO_REPORT_DATA;

  const totalRevenue = MONTHLY_REVENUE.reduce((sum, m) => sum + m.revenue, 0);

  return (
    <div className="p-6 space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Reports & Analytics</h2>
        <p className="text-sm text-muted-foreground">
          Performance metrics and pipeline insights
        </p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {SUMMARY_CARDS.map((card) => {
          const Icon = Icons[card.icon] as React.ComponentType<{ className?: string }>;
          return (
            <Card key={card.label}>
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm text-muted-foreground">{card.label}</span>
                  {Icon && <Icon className="h-4 w-4 text-muted-foreground" />}
                </div>
                <div className="text-2xl font-bold">{card.value}</div>
                <div className="flex items-center gap-2 mt-1">
                  {card.trendUp ? (
                    <Icons.TrendingUp className="h-3 w-3 text-green-500" />
                  ) : (
                    <Icons.TrendingDown className="h-3 w-3 text-red-500" />
                  )}
                  <span className={cn("text-xs font-medium", card.trendUp ? "text-green-500" : "text-red-500")}>
                    {card.trend}
                  </span>
                  <span className="text-xs text-muted-foreground">{card.subtext}</span>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Revenue Line Chart + Deals Pie Chart */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Revenue by Month</CardTitle>
            <CardDescription>
              Last 12 months &middot; Total: ${(totalRevenue / 1000000).toFixed(1)}M
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Charts.ResponsiveContainer width="100%" height={320}>
              <Charts.LineChart data={MONTHLY_REVENUE}>
                <Charts.CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <Charts.XAxis dataKey="month" className="text-xs" />
                <Charts.YAxis
                  className="text-xs"
                  tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}K`}
                />
                <Charts.Tooltip
                  formatter={(value: number, name: string) => {
                    if (name === "revenue") return [`$${(value / 1000).toFixed(0)}K`, "Revenue"];
                    return [`${value}`, "Deals Closed"];
                  }}
                />
                <Charts.Legend />
                <Charts.Line
                  type="monotone"
                  dataKey="revenue"
                  stroke="hsl(var(--primary))"
                  strokeWidth={2}
                  dot={{ r: 3 }}
                  name="Revenue"
                />
                <Charts.Line
                  type="monotone"
                  dataKey="deals_closed"
                  stroke="hsl(var(--muted-foreground))"
                  strokeWidth={2}
                  strokeDasharray="5 5"
                  dot={{ r: 3 }}
                  name="Deals Closed"
                  yAxisId={0}
                />
              </Charts.LineChart>
            </Charts.ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Deals by Stage</CardTitle>
            <CardDescription>Current pipeline distribution</CardDescription>
          </CardHeader>
          <CardContent>
            <Charts.ResponsiveContainer width="100%" height={320}>
              <Charts.PieChart>
                <Charts.Pie
                  data={STAGE_DISTRIBUTION}
                  cx="50%"
                  cy="50%"
                  innerRadius={55}
                  outerRadius={85}
                  paddingAngle={4}
                  dataKey="value"
                  nameKey="name"
                >
                  {STAGE_DISTRIBUTION.map((entry, index) => (
                    <Charts.Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Charts.Pie>
                <Charts.Tooltip
                  formatter={(value: number, name: string) => [`${value} deals`, name]}
                />
                <Charts.Legend />
              </Charts.PieChart>
            </Charts.ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Conversion Funnel */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Conversion Funnel</CardTitle>
          <CardDescription>Lead to close conversion rates</CardDescription>
        </CardHeader>
        <CardContent>
          <Charts.ResponsiveContainer width="100%" height={280}>
            <Charts.BarChart data={FUNNEL_DATA} layout="vertical" margin={{ left: 30 }}>
              <Charts.CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <Charts.XAxis type="number" className="text-xs" />
              <Charts.YAxis type="category" dataKey="stage" className="text-xs" width={130} />
              <Charts.Tooltip
                formatter={(value: number, _name: string, props: { payload: FunnelData }) => [
                  `${value} (${props.payload.rate})`,
                  "Count",
                ]}
              />
              <Charts.Bar
                dataKey="count"
                fill="hsl(var(--primary))"
                radius={[0, 4, 4, 0]}
              />
            </Charts.BarChart>
          </Charts.ResponsiveContainer>
        </CardContent>
      </Card>
    </div>
  );
}

export default CrmReports;
