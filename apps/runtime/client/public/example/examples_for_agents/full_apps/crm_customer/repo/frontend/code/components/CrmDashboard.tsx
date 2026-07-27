import {
  React,
  useModel,
  useNavigation,
  Charts,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  Badge,
  Button,
  Icons,
  cn,
} from "@exepad/sdk";

interface KpiItem {
  label: string;
  value: string;
  change: string;
  changeUp: boolean;
  icon: keyof typeof Icons;
}

interface DemoDeal {
  id: string;
  name: string;
  company: string;
  value: number;
  stage: string;
  close_date: string;
  contact_name: string;
}

interface DemoActivity {
  id: string;
  type: string;
  subject: string;
  contact_name: string;
  date: string;
}

const KPI_DATA: KpiItem[] = [
  { label: "Total Revenue", value: "$2.4M", change: "+12.3%", changeUp: true, icon: "DollarSign" },
  { label: "Active Deals", value: "47", change: "+8 this month", changeUp: true, icon: "Briefcase" },
  { label: "Win Rate", value: "34%", change: "+2.1%", changeUp: true, icon: "Target" },
  { label: "Avg Deal Size", value: "$51K", change: "-$3K", changeUp: false, icon: "TrendingUp" },
];

const PIPELINE_DATA = [
  { stage: "Qualification", deals: 12, value: 180000 },
  { stage: "Proposal", deals: 15, value: 420000 },
  { stage: "Negotiation", deals: 10, value: 650000 },
  { stage: "Closed Won", deals: 8, value: 890000 },
  { stage: "Closed Lost", deals: 5, value: 260000 },
];

const DEMO_DEALS: DemoDeal[] = [
  { id: "1", name: "Enterprise License", company: "Salesforce", value: 185000, stage: "negotiation", close_date: "2026-04-15", contact_name: "Marc Benioff" },
  { id: "2", name: "Cloud Migration", company: "Netflix", value: 142000, stage: "proposal", close_date: "2026-05-01", contact_name: "Greg Peters" },
  { id: "3", name: "API Integration", company: "Stripe", value: 128000, stage: "negotiation", close_date: "2026-04-20", contact_name: "Patrick Collison" },
  { id: "4", name: "Platform Upgrade", company: "Shopify", value: 115000, stage: "qualification", close_date: "2026-06-01", contact_name: "Tobi Lutke" },
  { id: "5", name: "Data Analytics Suite", company: "Snowflake", value: 98000, stage: "proposal", close_date: "2026-05-15", contact_name: "Frank Slootman" },
];

const RECENT_ACTIVITIES: DemoActivity[] = [
  { id: "a1", type: "call", subject: "Discovery call with Netflix team", contact_name: "Greg Peters", date: "10 min ago" },
  { id: "a2", type: "email", subject: "Proposal sent to Stripe", contact_name: "Patrick Collison", date: "1 hour ago" },
  { id: "a3", type: "meeting", subject: "QBR with Salesforce", contact_name: "Marc Benioff", date: "2 hours ago" },
  { id: "a4", type: "note", subject: "Updated deal notes for Shopify", contact_name: "Tobi Lutke", date: "3 hours ago" },
  { id: "a5", type: "email", subject: "Follow-up on pricing discussion", contact_name: "Frank Slootman", date: "5 hours ago" },
];

const STAGE_COLORS: Record<string, string> = {
  qualification: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300",
  proposal: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300",
  negotiation: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-300",
  closed_won: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300",
  closed_lost: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300",
};

const ACTIVITY_ICONS: Record<string, keyof typeof Icons> = {
  call: "Phone",
  email: "Mail",
  meeting: "Calendar",
  note: "FileText",
};

function CrmDashboard() {
  const navigation = useNavigation();
  const dealsModel = useModel("deals");
  const deals = (dealsModel?.data as any[] | null) ?? DEMO_DEALS;

  return (
    <div className="p-6 space-y-6">
      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {KPI_DATA.map((kpi) => {
          const Icon = Icons[kpi.icon] as React.ComponentType<{ className?: string }>;
          return (
            <Card key={kpi.label}>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  {kpi.label}
                </CardTitle>
                {Icon && <Icon className="h-4 w-4 text-muted-foreground" />}
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{kpi.value}</div>
                <div className="flex items-center gap-1 mt-1">
                  {kpi.changeUp ? (
                    <Icons.TrendingUp className="h-3 w-3 text-green-500" />
                  ) : (
                    <Icons.TrendingDown className="h-3 w-3 text-red-500" />
                  )}
                  <span className={cn("text-xs font-medium", kpi.changeUp ? "text-green-500" : "text-red-500")}>
                    {kpi.change}
                  </span>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Pipeline Chart + Recent Activities */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Pipeline Overview</CardTitle>
              <Button variant="ghost" size="sm" onClick={() => navigation.navigate("/pipeline")}>
                View All <Icons.ArrowRight className="ml-1 h-3 w-3" />
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <Charts.ResponsiveContainer width="100%" height={300}>
              <Charts.BarChart data={PIPELINE_DATA} layout="vertical" margin={{ left: 20 }}>
                <Charts.CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <Charts.XAxis type="number" className="text-xs" tickFormatter={(v: number) => `${v}`} />
                <Charts.YAxis type="category" dataKey="stage" className="text-xs" width={100} />
                <Charts.Tooltip
                  formatter={(value: number, name: string) => {
                    if (name === "deals") return [`${value} deals`, "Deals"];
                    return [`$${(value / 1000).toFixed(0)}K`, "Value"];
                  }}
                />
                <Charts.Bar dataKey="deals" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} />
              </Charts.BarChart>
            </Charts.ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Recent Activity</CardTitle>
              <Button variant="ghost" size="sm" onClick={() => navigation.navigate("/activities")}>
                View All <Icons.ArrowRight className="ml-1 h-3 w-3" />
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {RECENT_ACTIVITIES.map((activity) => {
                const ActIcon = Icons[ACTIVITY_ICONS[activity.type]] as React.ComponentType<{ className?: string }>;
                return (
                  <div key={activity.id} className="flex items-start gap-3">
                    <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted">
                      {ActIcon && <ActIcon className="h-4 w-4 text-muted-foreground" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{activity.subject}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-xs text-muted-foreground">{activity.contact_name}</span>
                        <span className="text-xs text-muted-foreground/60">{activity.date}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Top Deals Table */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Top Deals</CardTitle>
            <Badge variant="secondary" className="text-xs">{DEMO_DEALS.length} deals</Badge>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Deal Name</TableHead>
                <TableHead>Company</TableHead>
                <TableHead>Contact</TableHead>
                <TableHead>Value</TableHead>
                <TableHead>Stage</TableHead>
                <TableHead>Close Date</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {DEMO_DEALS.map((deal) => (
                <TableRow key={deal.id}>
                  <TableCell className="font-medium">{deal.name}</TableCell>
                  <TableCell>{deal.company}</TableCell>
                  <TableCell className="text-muted-foreground">{deal.contact_name}</TableCell>
                  <TableCell className="font-semibold">${(deal.value / 1000).toFixed(0)}K</TableCell>
                  <TableCell>
                    <Badge className={cn("text-xs capitalize", STAGE_COLORS[deal.stage])}>
                      {deal.stage.replace("_", " ")}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{deal.close_date}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

export default CrmDashboard;
