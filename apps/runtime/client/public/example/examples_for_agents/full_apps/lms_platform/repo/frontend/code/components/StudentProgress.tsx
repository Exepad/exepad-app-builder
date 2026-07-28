import {
  React,
  useModel,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Badge,
  Progress,
  Separator,
  Icons,
  cn,
  Charts,
} from "@exepad/sdk";

const { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } = Charts;

const DEMO_ENROLLMENTS = [
  { id: 1, course_title: "React & TypeScript Masterclass", progress_pct: 72, status: "active", lessons_total: 12, lessons_completed: 8, time_spent_hours: 18.5, category: "programming" },
  { id: 2, course_title: "Python for Data Science", progress_pct: 45, status: "active", lessons_total: 15, lessons_completed: 7, time_spent_hours: 12.3, category: "data-science" },
  { id: 3, course_title: "UI/UX Design Fundamentals", progress_pct: 100, status: "completed", lessons_total: 10, lessons_completed: 10, time_spent_hours: 8.2, category: "design" },
  { id: 4, course_title: "AWS Cloud Practitioner", progress_pct: 18, status: "active", lessons_total: 8, lessons_completed: 1, time_spent_hours: 2.5, category: "programming" },
  { id: 5, course_title: "Digital Marketing Strategy", progress_pct: 100, status: "completed", lessons_total: 9, lessons_completed: 9, time_spent_hours: 5.8, category: "marketing" },
];

const STREAK_DATA = [
  { week: "W1", hours: 3.2 },
  { week: "W2", hours: 5.1 },
  { week: "W3", hours: 4.8 },
  { week: "W4", hours: 7.2 },
  { week: "W5", hours: 6.5 },
  { week: "W6", hours: 8.1 },
  { week: "W7", hours: 5.9 },
  { week: "W8", hours: 9.4 },
  { week: "W9", hours: 7.8 },
  { week: "W10", hours: 6.3 },
  { week: "W11", hours: 8.7 },
  { week: "W12", hours: 10.2 },
];

const CERTIFICATES = [
  { id: 1, course: "UI/UX Design Fundamentals", date: "Dec 15, 2025", instructor: "Maria Gonzalez" },
  { id: 2, course: "Digital Marketing Strategy", date: "Jan 28, 2026", instructor: "Emily Park" },
];

const CATEGORY_COLORS: Record<string, string> = {
  programming: "bg-blue-500",
  "data-science": "bg-emerald-500",
  design: "bg-pink-500",
  marketing: "bg-purple-500",
  business: "bg-amber-500",
};

export default function StudentProgress() {
  const enrollmentsModel = useModel("enrollments");
  const enrollments = (enrollmentsModel?.data as any[] | null) ?? DEMO_ENROLLMENTS;
  const allEnrollments = (enrollments || DEMO_ENROLLMENTS) as any[];

  const totalCourses = allEnrollments.length;
  const completedCourses = allEnrollments.filter((e) => e.status === "completed").length;
  const totalHours = allEnrollments.reduce((sum, e) => sum + e.time_spent_hours, 0);
  const overallPct = Math.round(
    allEnrollments.reduce((sum, e) => sum + e.progress_pct, 0) / totalCourses
  );

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">My Progress</h1>
        <p className="text-sm text-muted-foreground">Track your learning journey</p>
      </div>

      {/* Overall Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4 text-center">
            <div className="relative inline-flex items-center justify-center w-16 h-16 mb-2">
              <svg className="w-16 h-16 -rotate-90" viewBox="0 0 64 64">
                <circle cx="32" cy="32" r="28" fill="none" stroke="hsl(var(--muted))" strokeWidth="4" />
                <circle
                  cx="32" cy="32" r="28" fill="none"
                  stroke="hsl(var(--primary))" strokeWidth="4"
                  strokeDasharray={`${(overallPct / 100) * 176} 176`}
                  strokeLinecap="round"
                />
              </svg>
              <span className="absolute text-sm font-bold text-foreground">{overallPct}%</span>
            </div>
            <p className="text-xs text-muted-foreground">Overall Completion</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <Icons.Clock className="w-8 h-8 text-amber-500 mx-auto mb-2" />
            <p className="text-2xl font-bold text-foreground">{totalHours.toFixed(0)}</p>
            <p className="text-xs text-muted-foreground">Total Hours</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <Icons.CheckCircle className="w-8 h-8 text-green-500 mx-auto mb-2" />
            <p className="text-2xl font-bold text-foreground">{completedCourses}/{totalCourses}</p>
            <p className="text-xs text-muted-foreground">Courses Completed</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <Icons.Award className="w-8 h-8 text-purple-500 mx-auto mb-2" />
            <p className="text-2xl font-bold text-foreground">{CERTIFICATES.length}</p>
            <p className="text-xs text-muted-foreground">Certificates</p>
          </CardContent>
        </Card>
      </div>

      {/* Per-Course Progress */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <Icons.BookOpen className="w-4 h-4 text-primary" />
            Course Progress
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {allEnrollments.map((enrollment: any) => (
            <div key={enrollment.id} className="flex items-center gap-4">
              <div className={cn("w-10 h-10 rounded-lg flex items-center justify-center shrink-0", CATEGORY_COLORS[enrollment.category] || "bg-gray-400")}>
                <Icons.BookOpen className="w-5 h-5 text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between mb-1">
                  <h3 className="text-sm font-medium text-foreground truncate pr-4">{enrollment.course_title}</h3>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-xs text-muted-foreground">
                      {enrollment.lessons_completed}/{enrollment.lessons_total} lessons
                    </span>
                    <Badge
                      variant={enrollment.status === "completed" ? "default" : "secondary"}
                      className={cn("text-[10px]", enrollment.status === "completed" && "bg-green-500")}
                    >
                      {enrollment.status}
                    </Badge>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="flex-1 bg-muted rounded-full h-2">
                    <div
                      className={cn(
                        "rounded-full h-2 transition-all duration-500",
                        enrollment.status === "completed" ? "bg-green-500" : "bg-primary"
                      )}
                      style={{ width: `${enrollment.progress_pct}%` }}
                    />
                  </div>
                  <span className="text-xs font-medium text-muted-foreground w-10 text-right">
                    {enrollment.progress_pct}%
                  </span>
                </div>
                <p className="text-xs text-muted-foreground mt-1">{enrollment.time_spent_hours}h spent</p>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="grid md:grid-cols-2 gap-6">
        {/* Learning Streak Chart */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <Icons.TrendingUp className="w-4 h-4 text-primary" />
              Learning Streak
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={STREAK_DATA}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="week" tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }} />
                  <YAxis tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "hsl(var(--background))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: "8px",
                      fontSize: "12px",
                    }}
                  />
                  <Line
                    type="monotone"
                    dataKey="hours"
                    stroke="hsl(var(--primary))"
                    strokeWidth={2}
                    dot={{ fill: "hsl(var(--primary))", r: 4 }}
                    activeDot={{ r: 6 }}
                    name="Hours"
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Certificates */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <Icons.Award className="w-4 h-4 text-primary" />
              Certificates Earned
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {CERTIFICATES.map((cert) => (
              <div key={cert.id} className="flex items-center gap-4 p-3 rounded-lg border border-border hover:bg-muted transition-colors">
                <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center shrink-0">
                  <Icons.Award className="w-6 h-6 text-white" />
                </div>
                <div className="flex-1 min-w-0">
                  <h4 className="text-sm font-semibold text-foreground truncate">{cert.course}</h4>
                  <p className="text-xs text-muted-foreground">Instructor: {cert.instructor}</p>
                  <p className="text-xs text-muted-foreground">Earned: {cert.date}</p>
                </div>
                <Button variant="outline" size="sm">
                  <Icons.Download className="w-3.5 h-3.5 mr-1" />
                  PDF
                </Button>
              </div>
            ))}
            {CERTIFICATES.length === 0 && (
              <div className="text-center py-8">
                <Icons.Award className="w-10 h-10 text-muted-foreground/40 mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">Complete a course to earn your first certificate!</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
