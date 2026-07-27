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

const MONTHLY_REVENUE = [
  { month: "Mar", revenue: 28400, target: 30000 },
  { month: "Apr", revenue: 31200, target: 30000 },
  { month: "May", revenue: 29800, target: 32000 },
  { month: "Jun", revenue: 34500, target: 32000 },
  { month: "Jul", revenue: 36200, target: 34000 },
  { month: "Aug", revenue: 33900, target: 34000 },
  { month: "Sep", revenue: 38100, target: 36000 },
  { month: "Oct", revenue: 41300, target: 38000 },
  { month: "Nov", revenue: 39700, target: 40000 },
  { month: "Dec", revenue: 44600, target: 42000 },
  { month: "Jan", revenue: 42800, target: 42000 },
  { month: "Feb", revenue: 46200, target: 44000 },
];

const DEMO_REVENUE = MONTHLY_REVENUE.map((d, i) => ({
  id: i + 1,
  amount: d.revenue,
  currency: "USD",
  product: "Platform",
  category: "SaaS",
  source: "direct",
  date: `2026-${String(i + 3 > 12 ? i - 9 : i + 3).padStart(2, "0")}-15`,
}));

const CATEGORY_REVENUE = [
  { category: "SaaS Subscriptions", revenue: 286400, pct: 56.8, color: "#0ea5e9" },
  { category: "Professional Services", revenue: 98200, pct: 19.5, color: "#22c55e" },
  { category: "Product Licenses", revenue: 72800, pct: 14.4, color: "#8b5cf6" },
  { category: "Add-on Features", revenue: 46600, pct: 9.3, color: "#f59e0b" },
];

const TOP_PRODUCTS = [
  { name: "Enterprise Plan", revenue: 148200, units: 42, avgPrice: 3528.57 },
  { name: "Pro Plan", revenue: 89400, units: 298, avgPrice: 300.00 },
  { name: "Consulting Package", revenue: 62800, units: 18, avgPrice: 3488.89 },
  { name: "API Access Tier", revenue: 48200, units: 156, avgPrice: 308.97 },
  { name: "Starter Plan", revenue: 38600, units: 643, avgPrice: 60.03 },
  { name: "Custom Integration", revenue: 35400, units: 8, avgPrice: 4425.00 },
  { name: "Training Workshops", revenue: 24800, units: 32, avgPrice: 775.00 },
  { name: "Data Export Add-on", revenue: 18200, units: 210, avgPrice: 86.67 },
];

const revenueChartConfig = {
  revenue: { label: "Revenue", color: "#0ea5e9" },
  target: { label: "Target", color: "#94a3b8" },
};

function MetricCard({
  title,
  value,
  change,
  changeLabel,
  icon,
  iconColor,
}: {
  title: string;
  value: string;
  change: number;
  changeLabel: string;
  icon: keyof typeof Icons;
  iconColor: string;
}) {
  const Icon = Icons[icon] as React.ComponentType<{ className?: string }>;
  const isPositive = change >= 0;

  return (
    <Card className="metric-card">
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-2">
          <div
            className="flex h-10 w-10 items-center justify-center rounded-lg"
            style={{ backgroundColor: `${iconColor}15` }}
          >
            {Icon && <Icon className="h-5 w-5" style={{ color: iconColor }} />}
          </div>
          <Badge variant={isPositive ? "default" : "destructive"} className="text-[10px] px-1.5 py-0">
            {isPositive ? "+" : ""}{change}%
          </Badge>
        </div>
        <p className="text-sm text-muted-foreground">{title}</p>
        <p className="text-2xl font-bold mt-0.5">{value}</p>
        <p className="text-xs text-muted-foreground mt-1">{changeLabel}</p>
      </CardContent>
    </Card>
  );
}

function RevenueReports() {
  const revenueModel = useModel("revenue_entries");
  const revenueEntries = (revenueModel?.data as any[] | null) ?? DEMO_REVENUE;

  return (
    <div className="p-6 space-y-6">
      {/* MRR / ARR / Growth Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          title="Monthly Recurring Revenue"
          value="$42.0K"
          change={7.8}
          changeLabel="vs last month $38.9K"
          icon="TrendingUp"
          iconColor="#0ea5e9"
        />
        <MetricCard
          title="Annual Recurring Revenue"
          value="$504K"
          change={12.4}
          changeLabel="projected from current MRR"
          icon="DollarSign"
          iconColor="#22c55e"
        />
        <MetricCard
          title="Growth Rate"
          value="14.2%"
          change={2.1}
          changeLabel="month-over-month growth"
          icon="BarChart3"
          iconColor="#8b5cf6"
        />
        <MetricCard
          title="Avg Revenue Per User"
          value="$128"
          change={5.3}
          changeLabel="across 328 paying accounts"
          icon="Users"
          iconColor="#f59e0b"
        />
      </div>

      {/* Revenue Bar + Line Chart */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Monthly Revenue vs Target</CardTitle>
          <CardDescription>Revenue performance against monthly targets over 12 months</CardDescription>
        </CardHeader>
        <CardContent>
          <ChartContainer config={revenueChartConfig} className="h-[320px] w-full">
            <Charts.ComposedChart data={MONTHLY_REVENUE} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
              <Charts.CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <Charts.XAxis dataKey="month" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
              <Charts.YAxis
                tick={{ fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}K`}
              />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Charts.Bar
                dataKey="revenue"
                fill="#0ea5e9"
                radius={[4, 4, 0, 0]}
                barSize={28}
              />
              <Charts.Line
                type="monotone"
                dataKey="target"
                stroke="#94a3b8"
                strokeWidth={2}
                strokeDasharray="5 5"
                dot={false}
              />
              <Charts.Legend />
            </Charts.ComposedChart>
          </ChartContainer>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Revenue by Category */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Revenue by Category</CardTitle>
            <CardDescription>Breakdown by product category</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {CATEGORY_REVENUE.map((cat) => (
              <div key={cat.category} className="space-y-1.5">
                <div className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded" style={{ backgroundColor: cat.color }} />
                    <span>{cat.category}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium">${(cat.revenue / 1000).toFixed(1)}K</span>
                    <span className="text-xs text-muted-foreground">({cat.pct}%)</span>
                  </div>
                </div>
                <div className="h-2.5 rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{ width: `${cat.pct}%`, backgroundColor: cat.color }}
                  />
                </div>
              </div>
            ))}
            <div className="pt-2 border-t border-border">
              <div className="flex items-center justify-between text-sm font-medium">
                <span>Total Revenue</span>
                <span>$504.0K</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Top Products Table */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Top Products</CardTitle>
            <CardDescription>Revenue contribution by product</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead>
                  <TableHead className="text-right">Revenue</TableHead>
                  <TableHead className="text-right">Units</TableHead>
                  <TableHead className="text-right">Avg Price</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {TOP_PRODUCTS.map((product) => (
                  <TableRow key={product.name}>
                    <TableCell className="font-medium text-sm">{product.name}</TableCell>
                    <TableCell className="text-right">${(product.revenue / 1000).toFixed(1)}K</TableCell>
                    <TableCell className="text-right text-muted-foreground">{product.units}</TableCell>
                    <TableCell className="text-right">${product.avgPrice.toFixed(0)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default RevenueReports;
