import { React, Card, CardContent, CardHeader, CardTitle, Icons, cn } from "@exepad/sdk";

interface Metric {
  label: string;
  value: string;
  change: number;
  icon: keyof typeof Icons;
}

const DEMO_METRICS: Metric[] = [
  { label: "Total Revenue", value: "$45,231", change: 12.5, icon: "DollarSign" },
  { label: "Active Users", value: "2,350", change: 8.1, icon: "Users" },
  { label: "Orders", value: "1,234", change: -3.2, icon: "ShoppingCart" },
  { label: "Conversion", value: "3.2%", change: 1.4, icon: "TrendingUp" },
];

function MetricsOverview() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {DEMO_METRICS.map((metric) => {
        const Icon = Icons[metric.icon] as React.ComponentType<{ className?: string }>;
        const isPositive = metric.change >= 0;

        return (
          <Card key={metric.label}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {metric.label}
              </CardTitle>
              {Icon && <Icon className="h-4 w-4 text-muted-foreground" />}
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{metric.value}</div>
              <p
                className={cn(
                  "text-xs mt-1",
                  isPositive ? "text-green-600" : "text-red-600"
                )}
              >
                {isPositive ? "+" : ""}
                {metric.change}% from last month
              </p>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

// ... (truncated)
