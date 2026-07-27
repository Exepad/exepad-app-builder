import {
  React,
  cn,
  Icons,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  Badge,
  Button,
  navigate,
  useModel,
} from "@exepad/sdk";

/* ── Demo Data ── */

const DEMO_SURVEYS = [
  { id: 1, title: "Customer Satisfaction Survey", description: "Help us understand how satisfied you are with our products and services.", status: "active", question_count: 5, category: "customer", starts_at: "2026-03-01", ends_at: "2026-04-30" },
  { id: 2, title: "Employee Engagement Survey", description: "Share your thoughts on workplace culture and growth opportunities.", status: "active", question_count: 5, category: "internal", starts_at: "2026-03-15", ends_at: "2026-04-15" },
  { id: 3, title: "Product Feedback Survey", description: "Tell us about our latest product updates.", status: "closed", question_count: 5, category: "product", starts_at: "2026-01-10", ends_at: "2026-02-28" },
];

const DEMO_RESPONSES = [
  { id: 1, survey_id: 1, completed_at: "2026-03-27T14:23:00Z", email: "alice@example.com" },
  { id: 2, survey_id: 1, completed_at: "2026-03-27T11:05:00Z", email: "bob@example.com" },
  { id: 3, survey_id: 2, completed_at: "2026-03-26T16:42:00Z", email: "carol@example.com" },
  { id: 4, survey_id: 1, completed_at: "2026-03-26T09:18:00Z", email: "dave@example.com" },
  { id: 5, survey_id: 2, completed_at: "2026-03-25T13:55:00Z", email: "eve@example.com" },
  { id: 6, survey_id: 3, completed_at: "2026-02-20T10:30:00Z", email: "frank@example.com" },
];

const RESPONSE_TARGETS: Record<number, number> = { 1: 200, 2: 150, 3: 100 };
const RESPONSE_COUNTS: Record<number, number> = { 1: 142, 2: 87, 3: 95 };

const KPI_DATA = [
  { label: "Active Surveys", value: "2", change: 0, icon: "ClipboardList" as const, color: "text-primary", bgColor: "bg-accent" },
  { label: "Total Responses", value: "284", change: 18, icon: "Users" as const, color: "text-blue-500", bgColor: "bg-blue-50" },
  { label: "Completion Rate", value: "78%", change: 5, icon: "CheckCircle" as const, color: "text-green-500", bgColor: "bg-green-50" },
  { label: "Avg Response Time", value: "4.2m", change: -12, icon: "Clock" as const, color: "text-amber-500", bgColor: "bg-amber-50" },
];

function SurveyDashboard({ className }: { className?: string }) {
  const surveys = useModel("surveys")?.data ?? DEMO_SURVEYS;
  const activeSurveys = (surveys || DEMO_SURVEYS).filter((s: any) => s.status === "active");

  return (
    <div className={cn("p-6 space-y-6", className)}>
      <div>
        <h2 className="text-2xl font-bold text-foreground tracking-tight">Dashboard</h2>
        <p className="text-sm text-muted-foreground mt-1">Overview of your survey activity</p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {KPI_DATA.map((kpi) => {
          const Icon = Icons[kpi.icon as keyof typeof Icons] as React.ComponentType<{ className?: string }>;
          const isPositive = kpi.change >= 0;
          return (
            <Card key={kpi.label} className="kpi-card">
              <CardContent className="pt-6">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground font-medium">{kpi.label}</p>
                    <p className="text-2xl font-bold text-foreground mt-1">{kpi.value}</p>
                    {kpi.change !== 0 && (
                      <p className={cn("text-xs mt-1 font-medium", isPositive ? "text-green-600" : "text-red-500")}>
                        {isPositive ? "+" : ""}{kpi.change}% vs last month
                      </p>
                    )}
                  </div>
                  <div className={cn("p-2.5 rounded-lg", kpi.bgColor)}>
                    {Icon && <Icon className={cn("h-5 w-5", kpi.color)} />}
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Active Surveys with Progress */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Active Surveys</CardTitle>
            <CardDescription>Response progress for each active survey</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {activeSurveys.map((survey: any) => {
              const target = RESPONSE_TARGETS[survey.id] || 100;
              const count = RESPONSE_COUNTS[survey.id] || 0;
              const pct = Math.min(Math.round((count / target) * 100), 100);
              return (
                <div key={survey.id} className="survey-card p-4 rounded-lg border border-border">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-semibold text-foreground">{survey.title}</h3>
                      <Badge className="bg-green-100 text-green-700 border-0 text-[10px]">Active</Badge>
                    </div>
                    <span className="text-xs text-muted-foreground">{count}/{target} responses</span>
                  </div>
                  <div className="w-full bg-border rounded-full h-2.5 mb-2">
                    <div
                      className="bg-primary h-2.5 rounded-full progress-bar"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">{survey.question_count} questions</span>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-xs text-primary hover:bg-accent h-7"
                      onClick={() => navigate(`/take/${survey.id}`)}
                    >
                      Take Survey
                      <Icons.ArrowRight className="h-3.5 w-3.5 ml-1" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>

        {/* Recent Responses + Quick Actions */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Recent Responses</CardTitle>
              <CardDescription>Latest survey submissions</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {DEMO_RESPONSES.slice(0, 5).map((resp) => {
                const survey = DEMO_SURVEYS.find((s) => s.id === resp.survey_id);
                const timeAgo = getTimeAgo(resp.completed_at);
                return (
                  <div key={resp.id} className="response-row flex items-center gap-3 py-2 px-2 rounded-md">
                    <div className="w-8 h-8 rounded-full bg-accent flex items-center justify-center shrink-0">
                      <Icons.User className="h-4 w-4 text-primary" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-foreground truncate">{resp.email}</p>
                      <p className="text-xs text-muted-foreground truncate">{survey?.title || "Survey"}</p>
                    </div>
                    <span className="text-[10px] text-muted-foreground whitespace-nowrap">{timeAgo}</span>
                  </div>
                );
              })}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Quick Actions</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <Button
                className="w-full justify-start gap-2"
                variant="outline"
                onClick={() => navigate("/surveys")}
              >
                <Icons.ClipboardList className="h-4 w-4" />
                Browse Surveys
              </Button>
              <Button
                className="w-full justify-start gap-2"
                variant="outline"
                onClick={() => navigate("/results")}
              >
                <Icons.BarChart3 className="h-4 w-4" />
                View Results
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function getTimeAgo(dateStr: string): string {
  const now = new Date("2026-03-28T12:00:00Z");
  const date = new Date(dateStr);
  const diffMs = now.getTime() - date.getTime();
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  if (diffHours < 1) return "Just now";
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays === 1) return "Yesterday";
  return `${diffDays}d ago`;
}

export default SurveyDashboard;
