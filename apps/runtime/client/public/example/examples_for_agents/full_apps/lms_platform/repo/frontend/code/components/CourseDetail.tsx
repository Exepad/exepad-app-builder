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
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
  Separator,
  Avatar,
  AvatarFallback,
  Icons,
  cn,
} from "@exepad/sdk";

const DEMO_COURSE = {
  id: 1,
  title: "React & TypeScript Masterclass",
  description: "Master modern React development with TypeScript. This comprehensive course covers everything from React fundamentals to advanced patterns like custom hooks, context API, performance optimization, and testing. You'll build real-world projects including a full-stack dashboard application.",
  instructor: "Sarah Chen",
  category: "programming",
  level: "intermediate",
  duration_hours: 32,
  price: 79.99,
  rating: 4.8,
  enrolled_count: 2340,
  is_published: 1,
};

const DEMO_MODULES = [
  {
    id: 1, course_id: 1, title: "Getting Started with React & TypeScript", sort_order: 1,
    description: "Set up your development environment and learn the fundamentals",
    lessons: [
      { id: 1, module_id: 1, title: "Course Overview & Setup", content_type: "video", duration_min: 12, sort_order: 1, completed: true },
      { id: 2, module_id: 1, title: "TypeScript Essentials for React", content_type: "video", duration_min: 28, sort_order: 2, completed: true },
      { id: 3, module_id: 1, title: "Your First React Component", content_type: "text", duration_min: 15, sort_order: 3, completed: true },
      { id: 4, module_id: 1, title: "Module 1 Quiz", content_type: "quiz", duration_min: 10, sort_order: 4, completed: false },
    ],
  },
  {
    id: 2, course_id: 1, title: "Component Patterns & State Management", sort_order: 2,
    description: "Learn advanced component patterns and state management with hooks",
    lessons: [
      { id: 5, module_id: 2, title: "Props, State & Lifecycle", content_type: "video", duration_min: 35, sort_order: 1, completed: true },
      { id: 6, module_id: 2, title: "Custom Hooks Deep Dive", content_type: "video", duration_min: 42, sort_order: 2, completed: false },
      { id: 7, module_id: 2, title: "Context API & useReducer", content_type: "video", duration_min: 38, sort_order: 3, completed: false },
      { id: 8, module_id: 2, title: "State Management Exercise", content_type: "text", duration_min: 20, sort_order: 4, completed: false },
    ],
  },
  {
    id: 3, course_id: 1, title: "Performance & Testing", sort_order: 3,
    description: "Optimize React apps and write comprehensive tests",
    lessons: [
      { id: 9, module_id: 3, title: "React.memo, useMemo & useCallback", content_type: "video", duration_min: 30, sort_order: 1, completed: false },
      { id: 10, module_id: 3, title: "Code Splitting & Lazy Loading", content_type: "video", duration_min: 22, sort_order: 2, completed: false },
      { id: 11, module_id: 3, title: "Testing with Vitest & Testing Library", content_type: "video", duration_min: 45, sort_order: 3, completed: false },
      { id: 12, module_id: 3, title: "Final Project & Quiz", content_type: "quiz", duration_min: 30, sort_order: 4, completed: false },
    ],
  },
];

const DEMO_REVIEWS = [
  { id: 1, name: "Alex M.", rating: 5, comment: "Best React course I've taken. Sarah explains complex concepts clearly and the projects are very practical.", date: "2026-03-10" },
  { id: 2, name: "Lisa K.", rating: 4, comment: "Great content and well-structured. The TypeScript integration throughout is really helpful.", date: "2026-02-22" },
  { id: 3, name: "Omar R.", rating: 5, comment: "The custom hooks section alone is worth the price. Highly recommended for intermediate developers.", date: "2026-01-30" },
];

const CONTENT_TYPE_ICONS: Record<string, keyof typeof Icons> = {
  video: "Play",
  text: "FileText",
  quiz: "HelpCircle",
};

export default function CourseDetail() {
  const { navigate } = useNavigation();
  const coursesModel = useModel("courses");
  const courses = (coursesModel?.data as any[] | null) ?? [DEMO_COURSE];
  const course = (courses || [DEMO_COURSE])[0] as any;
  const [enrolled, setEnrolled] = React.useState(false);

  const totalLessons = DEMO_MODULES.reduce((sum, m) => sum + m.lessons.length, 0);
  const completedLessons = DEMO_MODULES.reduce(
    (sum, m) => sum + m.lessons.filter((l) => l.completed).length, 0
  );
  const progressPct = Math.round((completedLessons / totalLessons) * 100);

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      {/* Back button */}
      <button
        onClick={() => navigate("/courses")}
        className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <Icons.ArrowLeft className="w-4 h-4" />
        Back to Courses
      </button>

      {/* Course Header */}
      <div className="flex flex-col md:flex-row gap-6">
        <div className="flex-1 space-y-4">
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="capitalize">{course.category}</Badge>
            <Badge variant={course.level === "advanced" ? "destructive" : course.level === "intermediate" ? "default" : "secondary"}>
              {course.level}
            </Badge>
          </div>
          <h1 className="text-3xl font-bold text-foreground">{course.title}</h1>
          <p className="text-muted-foreground leading-relaxed">{course.description}</p>

          <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
            <span className="flex items-center gap-1">
              <Icons.User className="w-4 h-4" />
              {course.instructor}
            </span>
            <span className="flex items-center gap-1">
              <Icons.Star className="w-4 h-4 text-amber-400 fill-amber-400" />
              {course.rating} ({(course as any).enrolled_count?.toLocaleString()} students)
            </span>
            <span className="flex items-center gap-1">
              <Icons.Clock className="w-4 h-4" />
              {course.duration_hours} hours
            </span>
            <span className="flex items-center gap-1">
              <Icons.BookOpen className="w-4 h-4" />
              {totalLessons} lessons
            </span>
          </div>

          {enrolled ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">{completedLessons} of {totalLessons} lessons completed</span>
                <span className="font-medium text-foreground">{progressPct}%</span>
              </div>
              <Progress value={progressPct} className="h-2" />
              <Button onClick={() => navigate("/lesson/6")} className="mt-2">
                <Icons.Play className="w-4 h-4 mr-2" />
                Continue Learning
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-4">
              <Button size="lg" onClick={() => setEnrolled(true)}>
                Enroll Now - ${course.price}
              </Button>
              <p className="text-xs text-muted-foreground">30-day money-back guarantee</p>
            </div>
          )}
        </div>

        {/* Course card sidebar */}
        <Card className="w-full md:w-72 shrink-0 self-start">
          <div className="h-40 bg-primary/10 flex items-center justify-center rounded-t-lg">
            <Icons.BookOpen className="w-16 h-16 text-primary/40" />
          </div>
          <CardContent className="p-4 space-y-3">
            <div className="text-3xl font-bold text-foreground">${course.price}</div>
            <Separator />
            <div className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">Duration</span><span className="font-medium">{course.duration_hours}h</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Lessons</span><span className="font-medium">{totalLessons}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Modules</span><span className="font-medium">{DEMO_MODULES.length}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Level</span><span className="font-medium capitalize">{course.level}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Certificate</span><span className="font-medium">Yes</span></div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Curriculum */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Icons.List className="w-5 h-5 text-primary" />
            Curriculum
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Accordion type="multiple" defaultValue={["mod-1"]}>
            {DEMO_MODULES.map((mod) => {
              const modCompleted = mod.lessons.filter((l) => l.completed).length;
              return (
                <AccordionItem key={mod.id} value={`mod-${mod.id}`}>
                  <AccordionTrigger className="hover:no-underline">
                    <div className="flex items-center gap-3 text-left">
                      <span className="font-semibold text-sm">{mod.title}</span>
                      <Badge variant="outline" className="text-xs">
                        {modCompleted}/{mod.lessons.length}
                      </Badge>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent>
                    <div className="space-y-1 ml-1">
                      {mod.lessons.map((lesson) => {
                        const TypeIcon = Icons[CONTENT_TYPE_ICONS[lesson.content_type]] as React.ComponentType<{ className?: string }>;
                        return (
                          <button
                            key={lesson.id}
                            onClick={() => enrolled && navigate(`/lesson/${lesson.id}`)}
                            className={cn(
                              "w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-colors",
                              enrolled ? "hover:bg-muted cursor-pointer" : "cursor-default opacity-70"
                            )}
                          >
                            {lesson.completed ? (
                              <Icons.CheckCircle className="w-4 h-4 text-green-500 shrink-0" />
                            ) : (
                              TypeIcon && <TypeIcon className="w-4 h-4 text-muted-foreground shrink-0" />
                            )}
                            <span className={cn("text-sm flex-1", lesson.completed && "text-muted-foreground line-through")}>
                              {lesson.title}
                            </span>
                            <span className="text-xs text-muted-foreground">{lesson.duration_min} min</span>
                          </button>
                        );
                      })}
                    </div>
                  </AccordionContent>
                </AccordionItem>
              );
            })}
          </Accordion>
        </CardContent>
      </Card>

      {/* Reviews */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Icons.MessageSquare className="w-5 h-5 text-primary" />
            Reviews
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {DEMO_REVIEWS.map((review) => (
            <div key={review.id} className="flex gap-3 pb-4 border-b border-border last:border-0 last:pb-0">
              <Avatar className="h-9 w-9 shrink-0">
                <AvatarFallback className="bg-secondary text-xs font-semibold">
                  {review.name.split(" ").map((n) => n[0]).join("")}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-sm font-medium text-foreground">{review.name}</span>
                  <div className="flex">
                    {[1, 2, 3, 4, 5].map((s) => (
                      <Icons.Star key={s} className={cn("w-3 h-3", s <= review.rating ? "text-amber-400 fill-amber-400" : "text-muted-foreground/30")} />
                    ))}
                  </div>
                  <span className="text-xs text-muted-foreground">{review.date}</span>
                </div>
                <p className="text-sm text-muted-foreground">{review.comment}</p>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
