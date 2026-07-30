import {
  React,
  cn,
  Icons,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Badge,
  Button,
  navigate,
  useModel,
} from "@exepad/sdk";

/* ── Demo Data ── */

const DEMO_SURVEYS = [
  { id: 1, title: "Customer Satisfaction Survey", description: "Help us understand how satisfied you are with our products and services. Your feedback drives our improvements.", status: "active", question_count: 5, category: "customer", starts_at: "2026-03-01", ends_at: "2026-04-30" },
  { id: 2, title: "Employee Engagement Survey", description: "Share your thoughts on workplace culture, management, and growth opportunities. All responses are anonymous.", status: "active", question_count: 5, category: "internal", starts_at: "2026-03-15", ends_at: "2026-04-15" },
  { id: 3, title: "Product Feedback Survey", description: "Tell us what you think about our latest product updates and what features you'd like to see next.", status: "closed", question_count: 5, category: "product", starts_at: "2026-01-10", ends_at: "2026-02-28" },
];

const RESPONSE_COUNTS: Record<number, number> = { 1: 142, 2: 87, 3: 95 };

const STATUS_STYLES: Record<string, string> = {
  active: "bg-green-100 text-green-700",
  closed: "bg-gray-100 text-gray-600",
  draft: "bg-yellow-100 text-yellow-700",
};

const CATEGORY_ICONS: Record<string, string> = {
  customer: "Users",
  internal: "Building",
  product: "Package",
};

function SurveyList({ className }: { className?: string }) {
  const [filter, setFilter] = React.useState<string>("all");
  const surveys = useModel("surveys")?.data ?? DEMO_SURVEYS;
  const allSurveys = surveys || DEMO_SURVEYS;

  const filtered = filter === "all"
    ? allSurveys
    : allSurveys.filter((s: any) => s.status === filter);

  const tabs = [
    { label: "All", value: "all", count: allSurveys.length },
    { label: "Active", value: "active", count: allSurveys.filter((s: any) => s.status === "active").length },
    { label: "Closed", value: "closed", count: allSurveys.filter((s: any) => s.status === "closed").length },
    { label: "Draft", value: "draft", count: allSurveys.filter((s: any) => s.status === "draft").length },
  ];

  return (
    <div className={cn("p-6 space-y-6", className)}>
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-foreground tracking-tight">Surveys</h2>
          <p className="text-sm text-muted-foreground mt-1">Browse and take available surveys</p>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="flex items-center gap-2 border-b border-border pb-3">
        {tabs.map((tab) => (
          <button
            key={tab.value}
            onClick={() => setFilter(tab.value)}
            className={cn(
              "px-3 py-1.5 rounded-md text-sm font-medium transition-colors",
              filter === tab.value
                ? "bg-primary text-white"
                : "text-muted-foreground hover:text-foreground hover:bg-muted"
            )}
          >
            {tab.label}
            {tab.count > 0 && (
              <span className={cn(
                "ml-1.5 text-xs",
                filter === tab.value ? "text-white/80" : "text-muted-foreground"
              )}>
                ({tab.count})
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Survey Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {filtered.map((survey: any) => {
          const responses = RESPONSE_COUNTS[survey.id] || 0;
          const CatIcon = Icons[CATEGORY_ICONS[survey.category] as keyof typeof Icons] as React.ComponentType<{ className?: string }>;

          return (
            <Card key={survey.id} className="survey-card">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2">
                    {CatIcon && (
                      <div className="w-8 h-8 rounded-lg bg-accent flex items-center justify-center">
                        <CatIcon className="h-4 w-4 text-primary" />
                      </div>
                    )}
                    <div>
                      <CardTitle className="text-sm leading-tight">{survey.title}</CardTitle>
                      <span className="text-[10px] text-muted-foreground capitalize">{survey.category}</span>
                    </div>
                  </div>
                  <Badge className={cn("border-0 text-[10px] capitalize", STATUS_STYLES[survey.status] || "bg-muted")}>
                    {survey.status}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-xs text-muted-foreground line-clamp-2">{survey.description}</p>

                <div className="flex items-center gap-4 text-xs text-muted-foreground">
                  <div className="flex items-center gap-1">
                    <Icons.HelpCircle className="h-3.5 w-3.5" />
                    <span>{survey.question_count} questions</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Icons.Users className="h-3.5 w-3.5" />
                    <span>{responses} responses</span>
                  </div>
                </div>

                {survey.starts_at && survey.ends_at && (
                  <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                    <Icons.Calendar className="h-3 w-3" />
                    <span>{survey.starts_at} - {survey.ends_at}</span>
                  </div>
                )}

                {survey.status === "active" ? (
                  <Button
                    size="sm"
                    className="w-full mt-2"
                    onClick={() => navigate(`/take/${survey.id}`)}
                  >
                    <Icons.PlayCircle className="h-4 w-4 mr-1.5" />
                    Take Survey
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    className="w-full mt-2"
                    onClick={() => navigate("/results")}
                  >
                    <Icons.BarChart3 className="h-4 w-4 mr-1.5" />
                    View Results
                  </Button>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {filtered.length === 0 && (
        <div className="text-center py-12">
          <Icons.ClipboardList className="h-12 w-12 text-muted-foreground/30 mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">No surveys found for this filter</p>
        </div>
      )}
    </div>
  );
}

export default SurveyList;
