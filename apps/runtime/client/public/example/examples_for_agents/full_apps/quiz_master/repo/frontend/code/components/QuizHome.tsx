import { React, useModel, useAppState, useNavigation, useCurrentUser, Button, Card, CardContent, CardHeader, CardTitle, Badge, Icons, cn } from "@exepad/sdk";

const DEMO_QUIZZES = [
  { id: 1, title: "Science Fundamentals", description: "Test your knowledge of basic scientific concepts from physics, chemistry, and biology.", category: "science", difficulty: "easy", time_limit: 30, question_count: 5 },
  { id: 2, title: "World History Highlights", description: "Journey through pivotal moments in world history from ancient civilizations to modern era.", category: "history", difficulty: "medium", time_limit: 30, question_count: 5 },
  { id: 3, title: "Geography Challenge", description: "How well do you know the world? Test your knowledge of countries, capitals, and landmarks.", category: "geography", difficulty: "medium", time_limit: 25, question_count: 5 },
  { id: 4, title: "Tech & Computing", description: "From programming languages to internet history, test your technology knowledge.", category: "technology", difficulty: "hard", time_limit: 35, question_count: 5 },
  { id: 5, title: "Entertainment Trivia", description: "Movies, music, TV shows, and pop culture — how much do you really know?", category: "entertainment", difficulty: "easy", time_limit: 20, question_count: 5 },
  { id: 6, title: "Sports Legends", description: "From the Olympics to the World Cup, test your knowledge of sports history and records.", category: "sports", difficulty: "medium", time_limit: 25, question_count: 5 },
];

const CATEGORIES = [
  { label: "Science", slug: "science", icon: "Atom", color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300" },
  { label: "History", slug: "history", icon: "Landmark", color: "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300" },
  { label: "Geography", slug: "geography", icon: "Globe", color: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300" },
  { label: "Technology", slug: "technology", icon: "Cpu", color: "bg-violet-100 text-violet-700 dark:bg-violet-900 dark:text-violet-300" },
  { label: "Entertainment", slug: "entertainment", icon: "Film", color: "bg-pink-100 text-pink-700 dark:bg-pink-900 dark:text-pink-300" },
  { label: "Sports", slug: "sports", icon: "Trophy", color: "bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300" },
];

const RECENT_SCORES = [
  { quiz: "Science Fundamentals", score: 4, total: 5, date: "2026-03-27" },
  { quiz: "World History Highlights", score: 3, total: 5, date: "2026-03-26" },
  { quiz: "Entertainment Trivia", score: 5, total: 5, date: "2026-03-25" },
  { quiz: "Geography Challenge", score: 2, total: 5, date: "2026-03-24" },
  { quiz: "Sports Legends", score: 4, total: 5, date: "2026-03-23" },
];

const STATS = [
  { value: "6", label: "Quizzes Available", icon: "BookOpen" },
  { value: "30", label: "Questions Total", icon: "HelpCircle" },
  { value: "72%", label: "Average Score", icon: "TrendingUp" },
];

const difficultyColor = (d: string) => d === "easy" ? "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300" : d === "medium" ? "bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300" : "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300";

function QuizHome() {
  const navigation = useNavigation();
  const quizzes = useModel("quizzes")?.data ?? DEMO_QUIZZES;
  const featured = DEMO_QUIZZES[0];

  return (
    <div className="w-full">
      {/* Hero */}
      <section className="relative overflow-hidden bg-gradient-to-br from-primary/5 via-accent/30 to-secondary/50 py-16 sm:py-24">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_50%,hsl(var(--primary)/0.08),transparent_50%)]" />
        <div className="relative max-w-4xl mx-auto text-center px-4 sm:px-6">
          <Badge variant="secondary" className="mb-4 px-3 py-1 text-sm">
            <Icons.Zap className="h-3.5 w-3.5 mr-1.5" />
            Test Your Knowledge
          </Badge>
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight mb-4">
            Challenge Your{" "}
            <span className="text-primary">Knowledge</span>
          </h1>
          <p className="text-lg sm:text-xl text-muted-foreground mb-8 max-w-2xl mx-auto">
            Take quizzes across science, history, geography, technology, entertainment, and sports. Track your scores and compete on the leaderboard.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Button size="lg" onClick={() => navigation.navigate("/browse")} className="px-8">
              <Icons.Play className="h-5 w-5 mr-2" />
              Start a Quiz
            </Button>
            <Button size="lg" variant="outline" onClick={() => navigation.navigate("/leaderboard")}>
              <Icons.Trophy className="h-5 w-5 mr-2" />
              View Leaderboard
            </Button>
          </div>
        </div>
      </section>

      {/* Featured Quiz */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 py-12">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-2xl font-bold">Featured Quiz</h2>
            <p className="text-sm text-muted-foreground mt-1">Our top pick for you today</p>
          </div>
        </div>
        <Card className="overflow-hidden cursor-pointer group border-primary/20 hover:border-primary/40 transition-colors" onClick={() => navigation.navigate(`/play/${featured.id}`)}>
          <div className="relative h-48 bg-gradient-to-br from-primary/20 via-accent to-secondary flex items-center justify-center">
            <Icons.HelpCircle className="h-16 w-16 text-primary/30" />
            <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
            <div className="absolute bottom-4 left-4 right-4 text-white">
              <div className="flex items-center gap-2 mb-2">
                <Badge className={cn("text-xs", difficultyColor(featured.difficulty))}>{featured.difficulty}</Badge>
                <Badge variant="secondary" className="text-xs capitalize">{featured.category}</Badge>
              </div>
              <h3 className="text-2xl font-bold">{featured.title}</h3>
              <p className="text-sm text-white/80 mt-1">{featured.description}</p>
            </div>
          </div>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4 text-sm text-muted-foreground">
                <span className="flex items-center gap-1"><Icons.HelpCircle className="h-4 w-4" />{featured.question_count} questions</span>
                <span className="flex items-center gap-1"><Icons.Clock className="h-4 w-4" />{featured.time_limit}s per question</span>
              </div>
              <Button size="sm">
                <Icons.Play className="h-4 w-4 mr-1" />
                Play Now
              </Button>
            </div>
          </CardContent>
        </Card>
      </section>

      {/* Categories */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 py-12">
        <div className="text-center mb-8">
          <h2 className="text-2xl font-bold">Browse by Category</h2>
          <p className="text-sm text-muted-foreground mt-1">Find quizzes that match your interests</p>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
          {CATEGORIES.map((cat) => {
            const Icon = Icons[cat.icon as keyof typeof Icons] as any;
            return (
              <Card
                key={cat.slug}
                className="cursor-pointer text-center p-6 hover:border-primary/50 transition-colors"
                onClick={() => navigation.navigate("/browse")}
              >
                <div className={cn("mx-auto h-12 w-12 rounded-xl flex items-center justify-center mb-3", cat.color)}>
                  {Icon && <Icon className="h-6 w-6" />}
                </div>
                <p className="text-sm font-semibold">{cat.label}</p>
              </Card>
            );
          })}
        </div>
      </section>

      {/* Recent Scores */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 py-12">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-2xl font-bold">Recent Scores</h2>
            <p className="text-sm text-muted-foreground mt-1">Your latest quiz results</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => navigation.navigate("/leaderboard")}>
            View All <Icons.ArrowRight className="h-4 w-4 ml-1" />
          </Button>
        </div>
        <div className="space-y-3">
          {RECENT_SCORES.map((entry, idx) => (
            <Card key={idx}>
              <CardContent className="p-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className={cn(
                    "h-10 w-10 rounded-full flex items-center justify-center text-sm font-bold",
                    (entry.score / entry.total) >= 0.8 ? "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300" :
                    (entry.score / entry.total) >= 0.6 ? "bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300" :
                    "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300"
                  )}>
                    {Math.round((entry.score / entry.total) * 100)}%
                  </div>
                  <div>
                    <p className="font-medium">{entry.quiz}</p>
                    <p className="text-xs text-muted-foreground">{new Date(entry.date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</p>
                  </div>
                </div>
                <div className="text-right">
                  <span className="text-lg font-bold text-primary">{entry.score}</span>
                  <span className="text-sm text-muted-foreground">/{entry.total}</span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      {/* Stats */}
      <section className="bg-primary/5 border-y border-border py-12">
        <div className="max-w-4xl mx-auto px-4 sm:px-6">
          <div className="grid grid-cols-3 gap-8 text-center">
            {STATS.map((stat) => {
              const Icon = Icons[stat.icon as keyof typeof Icons] as any;
              return (
                <div key={stat.label} className="space-y-2">
                  {Icon && <Icon className="h-6 w-6 mx-auto text-primary" />}
                  <div className="text-3xl font-extrabold">{stat.value}</div>
                  <div className="text-sm text-muted-foreground">{stat.label}</div>
                </div>
              );
            })}
          </div>
        </div>
      </section>
    </div>
  );
}

export default QuizHome;
