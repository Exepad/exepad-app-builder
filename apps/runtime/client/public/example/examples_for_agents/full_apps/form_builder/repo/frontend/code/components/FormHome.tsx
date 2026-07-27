import {
  React,
  useModel,
  useNavigation,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Badge,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  Icons,
  cn,
} from "@exepad/sdk";

const DEMO_SUBMISSIONS = [
  { id: 1, form_type: "contact", submitted_by: "alice@example.com", status: "reviewed", created_at: "2026-03-25T10:30:00Z", data: '{"name":"Alice Johnson","subject":"General"}' },
  { id: 2, form_type: "registration", submitted_by: "bob@company.com", status: "pending", created_at: "2026-03-26T14:15:00Z", data: '{"firstName":"Bob","lastName":"Smith","company":"TechCorp"}' },
  { id: 3, form_type: "feedback", submitted_by: "carol@example.com", status: "reviewed", created_at: "2026-03-26T16:45:00Z", data: '{"rating":5,"category":"Product"}' },
  { id: 4, form_type: "contact", submitted_by: "david@startup.io", status: "pending", created_at: "2026-03-27T09:00:00Z", data: '{"name":"David Lee","subject":"Partnership"}' },
  { id: 5, form_type: "registration", submitted_by: "emma@design.co", status: "reviewed", created_at: "2026-03-27T11:20:00Z", data: '{"firstName":"Emma","lastName":"Wilson","company":"DesignCo"}' },
  { id: 6, form_type: "feedback", submitted_by: "frank@example.com", status: "archived", created_at: "2026-03-24T08:00:00Z", data: '{"rating":3,"category":"Support"}' },
  { id: 7, form_type: "contact", submitted_by: "grace@enterprise.com", status: "pending", created_at: "2026-03-28T07:30:00Z", data: '{"name":"Grace Kim","subject":"Sales"}' },
  { id: 8, form_type: "feedback", submitted_by: "henry@example.com", status: "pending", created_at: "2026-03-28T08:45:00Z", data: '{"rating":4,"category":"Feature"}' },
  { id: 9, form_type: "registration", submitted_by: "ivy@analytics.com", status: "reviewed", created_at: "2026-03-27T15:00:00Z", data: '{"firstName":"Ivy","lastName":"Chen","company":"DataAnalytics Inc"}' },
  { id: 10, form_type: "contact", submitted_by: "jack@freelance.dev", status: "archived", created_at: "2026-03-23T12:00:00Z", data: '{"name":"Jack Turner","subject":"Support"}' },
];

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300",
  reviewed: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300",
  archived: "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-300",
};

const TYPE_COLORS: Record<string, string> = {
  contact: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300",
  registration: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-300",
  feedback: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-300",
};

function FormHome() {
  const navigation = useNavigation();
  const submissionsModel = useModel("submissions");
  const submissions = (submissionsModel?.data as any[] | null) ?? DEMO_SUBMISSIONS;

  const totalCount = submissions.length;
  const pendingCount = submissions.filter((s) => s.status === "pending").length;
  const reviewedCount = submissions.filter((s) => s.status === "reviewed").length;
  const today = new Date().toISOString().split("T")[0];
  const todayCount = submissions.filter((s) => (s.created_at || "").startsWith(today)).length;

  const recentSubmissions = [...submissions]
    .sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""))
    .slice(0, 5);

  const KPI_CARDS = [
    { label: "Total Submissions", value: totalCount, icon: "FileText" as const, color: "text-blue-600" },
    { label: "Pending Review", value: pendingCount, icon: "Clock" as const, color: "text-yellow-600" },
    { label: "Reviewed", value: reviewedCount, icon: "CheckCircle" as const, color: "text-green-600" },
    { label: "Today", value: todayCount, icon: "Calendar" as const, color: "text-purple-600" },
  ];

  return (
    <div className="p-6 space-y-6">
      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {KPI_CARDS.map((kpi) => {
          const Icon = Icons[kpi.icon] as React.ComponentType<{ className?: string }>;
          return (
            <Card key={kpi.label}>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">{kpi.label}</CardTitle>
                {Icon && <Icon className={cn("h-4 w-4", kpi.color)} />}
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{kpi.value}</div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Quick Actions */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Quick Actions</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-3">
            <Button onClick={() => navigation.navigate("/contact-form")}>
              <Icons.Mail className="h-4 w-4 mr-2" />
              New Contact Form
            </Button>
            <Button variant="outline" onClick={() => navigation.navigate("/registration")}>
              <Icons.UserPlus className="h-4 w-4 mr-2" />
              New Registration
            </Button>
            <Button variant="outline" onClick={() => navigation.navigate("/feedback")}>
              <Icons.Star className="h-4 w-4 mr-2" />
              New Feedback
            </Button>
            <Button variant="ghost" onClick={() => navigation.navigate("/submissions")}>
              <Icons.ArrowRight className="h-4 w-4 mr-2" />
              View All Submissions
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Recent Submissions */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Recent Submissions</CardTitle>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigation.navigate("/submissions")}
            >
              View All <Icons.ArrowRight className="ml-1 h-3 w-3" />
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Type</TableHead>
                <TableHead>Submitted By</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {recentSubmissions.map((sub) => (
                <TableRow key={sub.id}>
                  <TableCell>
                    <Badge className={cn("text-xs capitalize", TYPE_COLORS[sub.form_type] || "")}>
                      {sub.form_type}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm">{sub.submitted_by}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {sub.created_at ? new Date(sub.created_at).toLocaleDateString() : "—"}
                  </TableCell>
                  <TableCell>
                    <Badge className={cn("text-xs capitalize", STATUS_COLORS[sub.status] || "")}>
                      {sub.status}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

export default FormHome;
