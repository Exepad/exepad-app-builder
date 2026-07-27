import { React, useModel, useNavigation, Button, Card, CardContent, Badge, Input, Icons, cn } from "@exepad/sdk";

const DEMO_QUIZZES = [
  { id: 1, title: "Science Fundamentals", description: "Test your knowledge of basic scientific concepts from physics, chemistry, and biology.", category: "science", difficulty: "easy", time_limit: 30, question_count: 5 },
  { id: 2, title: "World History Highlights", description: "Journey through pivotal moments in world history from ancient civilizations to modern era.", category: "history", difficulty: "medium", time_limit: 30, question_count: 5 },
  { id: 3, title: "Geography Challenge", description: "How well do you know the world? Test your knowledge of countries, capitals, and landmarks.", category: "geography", difficulty: "medium", time_limit: 25, question_count: 5 },
  { id: 4, title: "Tech & Computing", description: "From programming languages to internet history, test your technology knowledge.", category: "technology", difficulty: "hard", time_limit: 35, question_count: 5 },
  { id: 5, title: "Entertainment Trivia", description: "Movies, music, TV shows, and pop culture — how much do you really know?", category: "entertainment", difficulty: "easy", time_limit: 20, question_count: 5 },
  { id: 6, title: "Sports Legends", description: "From the Olympics to the World Cup, test your knowledge of sports history and records.", category: "sports", difficulty: "medium", time_limit: 25, question_count: 5 },
];

const CATEGORIES = [
  { label: "All", slug: "all" },
  { label: "Science", slug: "science", icon: "Atom" },
  { label: "History", slug: "history", icon: "Landmark" },
  { label: "Geography", slug: "geography", icon: "Globe" },
  { label: "Technology", slug: "technology", icon: "Cpu" },
  { label: "Entertainment", slug: "entertainment", icon: "Film" },
  { label: "Sports", slug: "sports", icon: "Trophy" },
];

const CATEGORY_ICONS: Record<string, string> = {
  science: "Atom", history: "Landmark", geography: "Globe",
  technology: "Cpu", entertainment: "Film", sports: "Trophy",
};

const difficultyColor = (d: string) =>
  d === "easy" ? "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300"
  : d === "medium" ? "bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300"
  : "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300";

function QuizBrowser() {
  const navigation = useNavigation();
  const quizzes = useModel("quizzes")?.data ?? DEMO_QUIZZES;
  const [search, setSearch] = React.useState("");
  const [activeCategory, setActiveCategory] = React.useState("all");

  const filtered = DEMO_QUIZZES.filter(q => {
    const matchCategory = activeCategory === "all" || q.category === activeCategory;
    const matchSearch = !search.trim() || q.title.toLowerCase().includes(search.toLowerCase()) || q.description.toLowerCase().includes(search.toLowerCase());
    return matchCategory && matchSearch;
  });

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-extrabold mb-2">Browse Quizzes</h1>
        <p className="text-muted-foreground">Find and start a quiz that interests you</p>
      </div>

      {/* Search */}
      <div className="relative mb-6">
        <Icons.Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search quizzes..."
          className="pl-10"
          value={search}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearch(e.target.value)}
        />
      </div>

      {/* Category Tabs */}
      <div className="flex flex-wrap gap-2 mb-8">
        {CATEGORIES.map((cat) => {
          const Icon = cat.icon ? Icons[cat.icon as keyof typeof Icons] as any : null;
          return (
            <button
              key={cat.slug}
              onClick={() => setActiveCategory(cat.slug)}
              className={cn(
                "flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-medium transition-colors border",
                activeCategory === cat.slug
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-background text-muted-foreground border-border hover:border-primary/50 hover:text-foreground"
              )}
            >
              {Icon && <Icon className="h-3.5 w-3.5" />}
              {cat.label}
            </button>
          );
        })}
      </div>

      {/* Quiz Grid */}
      {filtered.length === 0 ? (
        <div className="text-center py-16">
          <Icons.Search className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          <h3 className="text-lg font-semibold mb-1">No quizzes found</h3>
          <p className="text-sm text-muted-foreground">Try adjusting your search or category filter</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {filtered.map((quiz) => {
            const CatIcon = Icons[CATEGORY_ICONS[quiz.category] as keyof typeof Icons] as any;
            return (
              <Card key={quiz.id} className="overflow-hidden hover:border-primary/40 transition-colors group">
                <div className="h-32 bg-gradient-to-br from-primary/15 via-accent/40 to-secondary/30 flex items-center justify-center relative">
                  {CatIcon && <CatIcon className="h-10 w-10 text-primary/40" />}
                  <div className="absolute top-3 right-3">
                    <Badge className={cn("text-xs", difficultyColor(quiz.difficulty))}>{quiz.difficulty}</Badge>
                  </div>
                </div>
                <CardContent className="p-5">
                  <div className="flex items-center gap-2 mb-2">
                    <Badge variant="secondary" className="text-xs capitalize">{quiz.category}</Badge>
                  </div>
                  <h3 className="text-lg font-bold mb-1">{quiz.title}</h3>
                  <p className="text-sm text-muted-foreground mb-4 line-clamp-2">{quiz.description}</p>

                  <div className="flex items-center gap-4 text-xs text-muted-foreground mb-4">
                    <span className="flex items-center gap-1">
                      <Icons.HelpCircle className="h-3.5 w-3.5" />
                      {quiz.question_count} questions
                    </span>
                    <span className="flex items-center gap-1">
                      <Icons.Clock className="h-3.5 w-3.5" />
                      ~{Math.ceil(quiz.question_count * quiz.time_limit / 60)} min
                    </span>
                  </div>

                  <Button className="w-full" onClick={() => navigation.navigate(`/play/${quiz.id}`)}>
                    <Icons.Play className="h-4 w-4 mr-2" />
                    Start Quiz
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default QuizBrowser;
