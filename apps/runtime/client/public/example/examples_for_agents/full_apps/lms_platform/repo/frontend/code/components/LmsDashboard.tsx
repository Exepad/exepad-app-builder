import {
  React,
  useModel,
  useNavigation,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Button,
  Badge,
  Progress,
  Icons,
  cn,
} from "@exepad/sdk";

const DEMO_ENROLLMENTS = [
  { id: 1, course_id: 1, progress_pct: 72, status: "active", enrolled_at: "2026-01-15T10:00:00Z", course_title: "React & TypeScript Masterclass", next_lesson: "Custom Hooks Deep Dive", instructor: "Sarah Chen" },
  { id: 2, course_id: 3, progress_pct: 45, status: "active", enrolled_at: "2026-02-01T10:00:00Z", course_title: "Python for Data Science", next_lesson: "Pandas DataFrames", instructor: "Dr. James Liu" },
  { id: 3, course_id: 5, progress_pct: 100, status: "completed", enrolled_at: "2025-11-10T10:00:00Z", course_title: "UI/UX Design Fundamentals", next_lesson: null, instructor: "Maria Gonzalez" },
  { id: 4, course_id: 7, progress_pct: 18, status: "active", enrolled_at: "2026-03-05T10:00:00Z", course_title: "AWS Cloud Practitioner", next_lesson: "IAM & Security", instructor: "Alex Kumar" },
  { id: 5, course_id: 9, progress_pct: 100, status: "completed", enrolled_at: "2025-10-20T10:00:00Z", course_title: "Digital Marketing Strategy", next_lesson: null, instructor: "Emily Park" },
];

const KPI_CARDS = [
  { label: "Enrolled Courses", value: "5", icon: "BookOpen" as const, color: "text-blue-500", bg: "bg-blue-50" },
  { label: "Completed", value: "2", icon: "CheckCircle" as const, color: "text-green-500", bg: "bg-green-50" },
  { label: "Hours Learned", value: "47", icon: "Clock" as const, color: "text-amber-500", bg: "bg-amber-50" },
  { label: "Certificates", value: "2", icon: "Award" as const, color: "text-purple-500", bg: "bg-purple-50" },
];

const DEADLINES = [
  { id: 1, title: "React Hooks Quiz", course: "React & TypeScript Masterclass", due: "Mar 28, 2026", urgent: true },
  { id: 2, title: "Data Visualization Project", course: "Python for Data Science", due: "Apr 2, 2026", urgent: false },
  { id: 3, title: "IAM Lab Assignment", course: "AWS Cloud Practitioner", due: "Apr 5, 2026", urgent: false },
];

const ACHIEVEMENTS = [
  { id: 1, title: "Fast Learner", icon: "Zap" as const, description: "Complete 5 lessons in a day" },
  { id: 2, title: "Quiz Master", icon: "Trophy" as const, description: "Score 100% on 3 quizzes" },
  { id: 3, title: "Streak Hero", icon: "Flame" as const, description: "7-day learning streak" },
  { id: 4, title: "First Steps", icon: "Footprints" as const, description: "Complete your first course" },
  { id: 5, title: "Social Learner", icon: "Users" as const, description: "Join 3 study groups" },
];

export default function LmsDashboard() {
  const { navigate } = useNavigation();
  const enrollmentsModel = useModel("enrollments");
  const enrollments = (enrollmentsModel?.data as any[] | null) ?? DEMO_ENROLLMENTS;
  const allEnrollments = enrollments || DEMO_ENROLLMENTS;
  const activeCourses = allEnrollments.filter((e: any) => e.status === "active");
  const continueCourse = activeCourses[0];

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Welcome Card */}
      <Card className="bg-gradient-to-r from-primary to-blue-700 text-primary-foreground border-0">
        <CardContent className="p-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold mb-1">Welcome back, Jane!</h1>
            <p className="text-blue-100 text-sm">
              You have {activeCourses.length} active courses. Keep up the great work!
            </p>
            <Button
              variant="secondary"
              size="sm"
              className="mt-4"
              onClick={() => continueCourse && navigate(`/course/${continueCourse.course_id}`)}
            >
              <Icons.Play className="w-4 h-4 mr-2" />
              Continue Learning
            </Button>
          </div>
          <div className="hidden md:flex items-center">
            <div className="w-24 h-24 rounded-full bg-white/10 flex items-center justify-center">
              <Icons.GraduationCap className="w-12 h-12 text-blue-100" />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Continue Learning */}
      {continueCourse && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <Icons.Play className="w-4 h-4 text-primary" />
              Continue Learning
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-4">
              <div className="w-16 h-16 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                <Icons.BookOpen className="w-8 h-8 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="font-semibold text-foreground truncate">{continueCourse.course_title}</h3>
                <p className="text-sm text-muted-foreground">
                  Next: {(continueCourse as any).next_lesson}
                </p>
                <div className="flex items-center gap-3 mt-2">
                  <div className="flex-1 bg-muted rounded-full h-2">
                    <div
                      className="bg-primary rounded-full h-2 transition-all"
                      style={{ width: `${continueCourse.progress_pct}%` }}
                    />
                  </div>
                  <span className="text-xs font-medium text-muted-foreground">{continueCourse.progress_pct}%</span>
                </div>
              </div>
              <Button size="sm" onClick={() => navigate(`/course/${continueCourse.course_id}`)}>
                Resume
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {KPI_CARDS.map((kpi) => {
          const Icon = Icons[kpi.icon] as React.ComponentType<{ className?: string }>;
          return (
            <Card key={kpi.label}>
              <CardContent className="p-4 flex items-center gap-3">
                <div className={cn("w-10 h-10 rounded-lg flex items-center justify-center", kpi.bg)}>
                  {Icon && <Icon className={cn("w-5 h-5", kpi.color)} />}
                </div>
                <div>
                  <p className="text-2xl font-bold text-foreground">{kpi.value}</p>
                  <p className="text-xs text-muted-foreground">{kpi.label}</p>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        {/* Upcoming Deadlines */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <Icons.Calendar className="w-4 h-4 text-primary" />
              Upcoming Deadlines
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {DEADLINES.map((deadline) => (
                <div key={deadline.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted transition-colors">
                  <div className={cn(
                    "w-2 h-2 rounded-full shrink-0",
                    deadline.urgent ? "bg-destructive" : "bg-amber-400"
                  )} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{deadline.title}</p>
                    <p className="text-xs text-muted-foreground">{deadline.course}</p>
                  </div>
                  <Badge variant={deadline.urgent ? "destructive" : "secondary"} className="text-xs shrink-0">
                    {deadline.due}
                  </Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Achievement Badges */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <Icons.Award className="w-4 h-4 text-primary" />
              Achievements
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-5 gap-3">
              {ACHIEVEMENTS.map((achievement) => {
                const Icon = Icons[achievement.icon] as React.ComponentType<{ className?: string }>;
                return (
                  <div key={achievement.id} className="flex flex-col items-center text-center group cursor-pointer">
                    <div className="w-12 h-12 rounded-full bg-secondary flex items-center justify-center group-hover:bg-primary/10 transition-colors">
                      {Icon && <Icon className="w-5 h-5 text-primary" />}
                    </div>
                    <p className="text-[10px] font-medium text-muted-foreground mt-1.5 leading-tight">
                      {achievement.title}
                    </p>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
