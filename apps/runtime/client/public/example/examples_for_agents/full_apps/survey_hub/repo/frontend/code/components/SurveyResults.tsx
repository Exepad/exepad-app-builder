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
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  Separator,
  useModel,
} from "@exepad/sdk";

/* ── Demo Data ── */

const SURVEYS = [
  { id: "1", title: "Customer Satisfaction Survey", responses: 142, avgTime: "3.8m" },
  { id: "2", title: "Employee Engagement Survey", responses: 87, avgTime: "4.5m" },
  { id: "3", title: "Product Feedback Survey", responses: 95, avgTime: "4.1m" },
];

type QuestionResult = {
  id: number;
  text: string;
  type: string;
  data: any;
};

const RESULTS: Record<string, QuestionResult[]> = {
  "1": [
    { id: 1, text: "How satisfied are you with our overall service?", type: "rating", data: { average: 4.2, distribution: [3, 5, 18, 52, 64] } },
    { id: 2, text: "Which aspect of our service do you value most?", type: "multiple_choice", data: { options: ["Speed of delivery", "Product quality", "Customer support", "Pricing", "Ease of use"], counts: [28, 42, 31, 18, 23], colors: ["#e11d48", "#f97316", "#eab308", "#22c55e", "#3b82f6"] } },
    { id: 3, text: "Would you recommend us to a friend or colleague?", type: "yes_no", data: { yes: 112, no: 30 } },
    { id: 4, text: "How would you rate our customer support?", type: "rating", data: { average: 3.9, distribution: [5, 8, 22, 48, 59] } },
    { id: 5, text: "What could we do better?", type: "text", data: { responses: ["Faster response times on weekends", "More payment options would be great", "Love the product, just need better mobile app", "Would appreciate a loyalty program", "Documentation could be more detailed", "Everything is great, keep it up!"] } },
  ],
  "2": [
    { id: 6, text: "How would you rate your overall job satisfaction?", type: "rating", data: { average: 3.7, distribution: [4, 8, 15, 32, 28] } },
    { id: 7, text: "Do you feel your work is recognized?", type: "yes_no", data: { yes: 58, no: 29 } },
    { id: 8, text: "Which area needs the most improvement?", type: "multiple_choice", data: { options: ["Communication", "Work-life balance", "Career growth", "Compensation", "Team collaboration"], counts: [22, 25, 18, 14, 8], colors: ["#e11d48", "#f97316", "#eab308", "#22c55e", "#3b82f6"] } },
    { id: 9, text: "How likely are you to stay for 2 years?", type: "rating", data: { average: 3.4, distribution: [6, 12, 18, 28, 23] } },
    { id: 10, text: "What changes would have the biggest impact?", type: "text", data: { responses: ["More flexible work hours", "Better career development paths", "Regular team-building activities", "Transparent promotion criteria", "Mental health support programs"] } },
  ],
  "3": [
    { id: 11, text: "How would you rate the new dashboard?", type: "rating", data: { average: 4.0, distribution: [2, 6, 16, 38, 33] } },
    { id: 12, text: "Which new feature do you use most?", type: "multiple_choice", data: { options: ["Dark mode", "Export to PDF", "Real-time collab", "Advanced filters", "API integrations"], counts: [32, 18, 22, 12, 11], colors: ["#e11d48", "#f97316", "#eab308", "#22c55e", "#3b82f6"] } },
    { id: 13, text: "Did the update improve your workflow?", type: "yes_no", data: { yes: 72, no: 23 } },
    { id: 14, text: "How intuitive is the new navigation?", type: "rating", data: { average: 3.8, distribution: [3, 8, 18, 35, 31] } },
    { id: 15, text: "What feature would you like added next?", type: "text", data: { responses: ["Keyboard shortcuts for power users", "Better search functionality", "Custom dashboard layouts", "Integration with Slack", "Offline mode support", "Batch operations on data"] } },
  ],
};

function SurveyResults({ className }: { className?: string }) {
  const [selectedSurvey, setSelectedSurvey] = React.useState("1");
  const survey = SURVEYS.find((s) => s.id === selectedSurvey) || SURVEYS[0];
  const questions = RESULTS[selectedSurvey] || RESULTS["1"];

  return (
    <div className={cn("p-6 space-y-6", className)}>
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h2 className="text-2xl font-bold text-foreground tracking-tight">Results</h2>
          <p className="text-sm text-muted-foreground mt-1">Aggregated survey responses and analytics</p>
        </div>
        <Select value={selectedSurvey} onValueChange={setSelectedSurvey}>
          <SelectTrigger className="w-[280px]">
            <SelectValue placeholder="Select a survey" />
          </SelectTrigger>
          <SelectContent>
            {SURVEYS.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.title}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Overall Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="kpi-card">
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-lg bg-accent">
                <Icons.Users className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Total Responses</p>
                <p className="text-xl font-bold text-foreground">{survey.responses}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="kpi-card">
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-lg bg-green-50">
                <Icons.CheckCircle className="h-5 w-5 text-green-500" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Completion Rate</p>
                <p className="text-xl font-bold text-foreground">78%</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="kpi-card">
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-lg bg-amber-50">
                <Icons.Clock className="h-5 w-5 text-amber-500" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Avg Completion Time</p>
                <p className="text-xl font-bold text-foreground">{survey.avgTime}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Separator />

      {/* Question Results */}
      <div className="space-y-6">
        {questions.map((q, idx) => (
          <Card key={q.id}>
            <CardHeader>
              <div className="flex items-start gap-3">
                <Badge className="bg-primary/10 text-primary border-0 text-xs shrink-0">
                  Q{idx + 1}
                </Badge>
                <div>
                  <CardTitle className="text-sm">{q.text}</CardTitle>
                  <CardDescription className="capitalize mt-0.5">
                    {q.type.replace("_", " ")}
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {/* Multiple Choice - Horizontal Bar Chart */}
              {q.type === "multiple_choice" && (
                <div className="space-y-3">
                  {q.data.options.map((opt: string, i: number) => {
                    const total = q.data.counts.reduce((a: number, b: number) => a + b, 0);
                    const pct = Math.round((q.data.counts[i] / total) * 100);
                    return (
                      <div key={i} className="space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="text-sm text-foreground">{opt}</span>
                          <span className="text-xs font-medium text-muted-foreground">
                            {q.data.counts[i]} ({pct}%)
                          </span>
                        </div>
                        <div className="w-full bg-border rounded-full h-3">
                          <div
                            className="h-3 rounded-full progress-bar"
                            style={{
                              width: `${pct}%`,
                              backgroundColor: q.data.colors[i],
                            }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Rating - Average + Distribution */}
              {q.type === "rating" && (
                <div className="space-y-4">
                  <div className="flex items-center gap-4">
                    <div className="text-center">
                      <p className="text-3xl font-bold text-foreground">{q.data.average}</p>
                      <div className="flex items-center gap-0.5 mt-1">
                        {[1, 2, 3, 4, 5].map((star) => (
                          <Icons.Star
                            key={star}
                            className={cn(
                              "h-4 w-4",
                              star <= Math.round(q.data.average)
                                ? "text-amber-400 fill-amber-400"
                                : "text-muted-foreground/20"
                            )}
                          />
                        ))}
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">out of 5</p>
                    </div>
                    <Separator orientation="vertical" className="h-16" />
                    <div className="flex-1 space-y-1.5">
                      {[5, 4, 3, 2, 1].map((star) => {
                        const count = q.data.distribution[star - 1];
                        const total = q.data.distribution.reduce((a: number, b: number) => a + b, 0);
                        const pct = Math.round((count / total) * 100);
                        return (
                          <div key={star} className="flex items-center gap-2">
                            <span className="text-xs text-muted-foreground w-3">{star}</span>
                            <Icons.Star className="h-3 w-3 text-amber-400 fill-amber-400" />
                            <div className="flex-1 bg-border rounded-full h-2">
                              <div
                                className="h-2 rounded-full bg-amber-400 progress-bar"
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                            <span className="text-[10px] text-muted-foreground w-8 text-right">{count}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}

              {/* Yes/No - Pie-like visualization */}
              {q.type === "yes_no" && (
                <div className="flex items-center gap-8 py-2">
                  <div className="flex items-center gap-6">
                    {/* Yes Circle */}
                    <div className="text-center">
                      <div className="relative w-20 h-20 mx-auto">
                        <svg viewBox="0 0 36 36" className="w-20 h-20 -rotate-90">
                          <circle cx="18" cy="18" r="15" fill="none" stroke="#e2e8f0" strokeWidth="3" />
                          <circle
                            cx="18" cy="18" r="15" fill="none" stroke="#22c55e" strokeWidth="3"
                            strokeDasharray={`${(q.data.yes / (q.data.yes + q.data.no)) * 94.2} 94.2`}
                            strokeLinecap="round"
                          />
                        </svg>
                        <div className="absolute inset-0 flex items-center justify-center">
                          <span className="text-sm font-bold text-green-600">
                            {Math.round((q.data.yes / (q.data.yes + q.data.no)) * 100)}%
                          </span>
                        </div>
                      </div>
                      <p className="text-xs font-medium text-green-600 mt-1">Yes ({q.data.yes})</p>
                    </div>

                    {/* No Circle */}
                    <div className="text-center">
                      <div className="relative w-20 h-20 mx-auto">
                        <svg viewBox="0 0 36 36" className="w-20 h-20 -rotate-90">
                          <circle cx="18" cy="18" r="15" fill="none" stroke="#e2e8f0" strokeWidth="3" />
                          <circle
                            cx="18" cy="18" r="15" fill="none" stroke="#ef4444" strokeWidth="3"
                            strokeDasharray={`${(q.data.no / (q.data.yes + q.data.no)) * 94.2} 94.2`}
                            strokeLinecap="round"
                          />
                        </svg>
                        <div className="absolute inset-0 flex items-center justify-center">
                          <span className="text-sm font-bold text-red-500">
                            {Math.round((q.data.no / (q.data.yes + q.data.no)) * 100)}%
                          </span>
                        </div>
                      </div>
                      <p className="text-xs font-medium text-red-500 mt-1">No ({q.data.no})</p>
                    </div>
                  </div>

                  <div className="text-sm text-muted-foreground">
                    <p><span className="font-medium text-foreground">{q.data.yes + q.data.no}</span> total responses</p>
                  </div>
                </div>
              )}

              {/* Text - Response List */}
              {q.type === "text" && (
                <div className="space-y-2">
                  {q.data.responses.map((resp: string, i: number) => (
                    <div
                      key={i}
                      className="response-row flex items-start gap-2 p-3 rounded-md bg-muted/30"
                    >
                      <Icons.MessageSquare className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                      <p className="text-sm text-foreground">{resp}</p>
                    </div>
                  ))}
                  <p className="text-xs text-muted-foreground text-center mt-2">
                    Showing {q.data.responses.length} of {survey.responses} responses
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

export default SurveyResults;
