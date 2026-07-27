import {
  React,
  Charts,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@exepad/sdk";

const MONTHLY_DATA = [
  { month: "Jan", sales: 4000, returns: 400 },
  { month: "Feb", sales: 3000, returns: 300 },
  { month: "Mar", sales: 5000, returns: 500 },
  { month: "Apr", sales: 4500, returns: 350 },
  { month: "May", sales: 6000, returns: 450 },
  { month: "Jun", sales: 5500, returns: 600 },
  { month: "Jul", sales: 7000, returns: 500 },
  { month: "Aug", sales: 6500, returns: 550 },
  { month: "Sep", sales: 8000, returns: 700 },
  { month: "Oct", sales: 7500, returns: 650 },
  { month: "Nov", sales: 9000, returns: 800 },
  { month: "Dec", sales: 8500, returns: 750 },
];

function SalesChart() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Monthly Sales</CardTitle>
        <CardDescription>Revenue vs. returns for the past 12 months</CardDescription>
      </CardHeader>
      <CardContent>
        <Charts.ResponsiveContainer width="100%" height={350}>
          <Charts.BarChart data={MONTHLY_DATA}>
            <Charts.CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
            <Charts.XAxis dataKey="month" className="text-xs" />
            <Charts.YAxis className="text-xs" />
            <Charts.Tooltip />
            <Charts.Legend />
            <Charts.Bar dataKey="sales" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
            <Charts.Bar dataKey="returns" fill="hsl(var(--muted-foreground))" radius={[4, 4, 0, 0]} />
          </Charts.BarChart>
        </Charts.ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

export default SalesChart;
