import {
  React,
  useModel,
  useNavigation,
  Card,
  CardContent,
  Button,
  Badge,
  Input,
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  Icons,
  cn,
} from "@exepad/sdk";

const DEMO_COURSES = [
  { id: 1, title: "React & TypeScript Masterclass", description: "Build production-ready apps with React 18, TypeScript, and modern tooling", instructor: "Sarah Chen", category: "programming", level: "intermediate", duration_hours: 32, price: 79.99, rating: 4.8, enrolled: 2340, is_published: 1 },
  { id: 2, title: "Node.js Backend Development", description: "REST APIs, authentication, databases, and deployment with Node.js and Express", instructor: "Michael Torres", category: "programming", level: "intermediate", duration_hours: 28, price: 69.99, rating: 4.6, enrolled: 1890, is_published: 1 },
  { id: 3, title: "Python for Data Science", description: "NumPy, Pandas, Matplotlib, and Scikit-learn for data analysis and ML", instructor: "Dr. James Liu", category: "data-science", level: "beginner", duration_hours: 40, price: 89.99, rating: 4.9, enrolled: 3120, is_published: 1 },
  { id: 4, title: "Machine Learning A-Z", description: "Supervised and unsupervised learning, neural networks, and deep learning fundamentals", instructor: "Dr. Priya Sharma", category: "data-science", level: "advanced", duration_hours: 52, price: 129.99, rating: 4.7, enrolled: 1560, is_published: 1 },
  { id: 5, title: "UI/UX Design Fundamentals", description: "User research, wireframing, prototyping, and usability testing with Figma", instructor: "Maria Gonzalez", category: "design", level: "beginner", duration_hours: 24, price: 59.99, rating: 4.8, enrolled: 2780, is_published: 1 },
  { id: 6, title: "Advanced CSS & Animations", description: "CSS Grid, Flexbox, custom properties, keyframe animations, and responsive design", instructor: "Tom Wilson", category: "design", level: "intermediate", duration_hours: 18, price: 49.99, rating: 4.5, enrolled: 1340, is_published: 1 },
  { id: 7, title: "AWS Cloud Practitioner", description: "Cloud computing fundamentals, AWS services, security, and pricing for certification prep", instructor: "Alex Kumar", category: "programming", level: "beginner", duration_hours: 20, price: 49.99, rating: 4.7, enrolled: 4200, is_published: 1 },
  { id: 8, title: "Business Strategy & Analytics", description: "Data-driven decision making, market analysis, and competitive strategy", instructor: "Prof. Robert Kim", category: "business", level: "intermediate", duration_hours: 30, price: 79.99, rating: 4.4, enrolled: 980, is_published: 1 },
  { id: 9, title: "Digital Marketing Strategy", description: "SEO, content marketing, social media, email campaigns, and analytics", instructor: "Emily Park", category: "marketing", level: "beginner", duration_hours: 22, price: 59.99, rating: 4.6, enrolled: 2100, is_published: 1 },
  { id: 10, title: "Full-Stack JavaScript", description: "Build complete web apps with React, Node.js, PostgreSQL, and deploy to the cloud", instructor: "David Lee", category: "programming", level: "advanced", duration_hours: 60, price: 149.99, rating: 4.9, enrolled: 1780, is_published: 1 },
  { id: 11, title: "Product Management Essentials", description: "Roadmapping, user stories, sprint planning, and stakeholder management", instructor: "Jessica Brown", category: "business", level: "beginner", duration_hours: 16, price: 44.99, rating: 4.3, enrolled: 870, is_published: 1 },
  { id: 12, title: "Growth Hacking & Viral Marketing", description: "Acquisition funnels, A/B testing, referral programs, and retention strategies", instructor: "Ryan Patel", category: "marketing", level: "advanced", duration_hours: 14, price: 39.99, rating: 4.5, enrolled: 650, is_published: 1 },
];

const CATEGORIES = ["all", "programming", "design", "business", "data-science", "marketing"];
const LEVELS = ["all", "beginner", "intermediate", "advanced"];

const CATEGORY_COLORS: Record<string, string> = {
  programming: "bg-blue-500",
  design: "bg-pink-500",
  business: "bg-amber-500",
  "data-science": "bg-emerald-500",
  marketing: "bg-purple-500",
};

const LEVEL_VARIANTS: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  beginner: "secondary",
  intermediate: "default",
  advanced: "destructive",
};

function StarRating({ rating }: { rating: number }) {
  return (
    <div className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map((star) => (
        <Icons.Star
          key={star}
          className={cn(
            "w-3.5 h-3.5",
            star <= Math.floor(rating) ? "text-amber-400 fill-amber-400" : "text-muted-foreground/30"
          )}
        />
      ))}
      <span className="text-xs font-medium text-muted-foreground ml-1">{rating}</span>
    </div>
  );
}

export default function CoursesCatalog() {
  const { navigate } = useNavigation();
  const coursesModel = useModel("courses");
  const courses = (coursesModel?.data as any[] | null) ?? DEMO_COURSES;
  const allCourses = courses || DEMO_COURSES;

  const [category, setCategory] = React.useState("all");
  const [level, setLevel] = React.useState("all");
  const [search, setSearch] = React.useState("");

  const filtered = (allCourses as any[]).filter((c) => {
    if (category !== "all" && c.category !== category) return false;
    if (level !== "all" && c.level !== level) return false;
    if (search && !c.title.toLowerCase().includes(search.toLowerCase()) && !c.instructor.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Course Catalog</h1>
          <p className="text-sm text-muted-foreground">{filtered.length} courses available</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative">
            <Icons.Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search courses..."
              value={search}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearch(e.target.value)}
              className="pl-9 w-64"
            />
          </div>
          <Select value={level} onValueChange={setLevel}>
            <SelectTrigger className="w-40">
              <SelectValue placeholder="All Levels" />
            </SelectTrigger>
            <SelectContent>
              {LEVELS.map((l) => (
                <SelectItem key={l} value={l}>
                  {l === "all" ? "All Levels" : l.charAt(0).toUpperCase() + l.slice(1)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Category Tabs */}
      <Tabs value={category} onValueChange={setCategory}>
        <TabsList>
          {CATEGORIES.map((cat) => (
            <TabsTrigger key={cat} value={cat} className="capitalize">
              {cat === "all" ? "All" : cat === "data-science" ? "Data Science" : cat}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {/* Course Grid */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
        {filtered.map((course: any) => (
          <Card
            key={course.id}
            className="course-card overflow-hidden cursor-pointer group"
            onClick={() => navigate(`/course/${course.id}`)}
          >
            {/* Thumbnail */}
            <div className={cn("h-36 flex items-center justify-center", CATEGORY_COLORS[course.category] || "bg-gray-400")}>
              <Icons.BookOpen className="w-12 h-12 text-white/60" />
            </div>
            <CardContent className="p-4 space-y-3">
              <div className="flex items-center justify-between">
                <Badge variant={LEVEL_VARIANTS[course.level] || "secondary"} className="text-[10px]">
                  {course.level}
                </Badge>
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                  <Icons.Clock className="w-3 h-3" />
                  {course.duration_hours}h
                </span>
              </div>
              <h3 className="font-semibold text-foreground text-sm leading-snug line-clamp-2 group-hover:text-primary transition-colors">
                {course.title}
              </h3>
              <p className="text-xs text-muted-foreground">{course.instructor}</p>
              <StarRating rating={course.rating} />
              <div className="flex items-center justify-between pt-1">
                <span className="text-lg font-bold text-foreground">${course.price}</span>
                <Button size="sm" variant="default" onClick={(e: React.MouseEvent) => { e.stopPropagation(); navigate(`/course/${course.id}`); }}>
                  Enroll
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {filtered.length === 0 && (
        <div className="text-center py-16">
          <Icons.SearchX className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
          <p className="text-muted-foreground">No courses found matching your filters.</p>
        </div>
      )}
    </div>
  );
}
