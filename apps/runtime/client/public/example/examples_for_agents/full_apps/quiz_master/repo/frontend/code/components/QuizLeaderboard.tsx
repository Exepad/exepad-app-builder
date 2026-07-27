import { React, useModel, useNavigation, useCurrentUser, Button, Card, CardContent, CardHeader, CardTitle, Badge, Icons, cn } from "@exepad/sdk";

const LEADERBOARD_DATA = [
  { rank: 1, player: "Sarah Chen", quiz: "Science Fundamentals", category: "science", score: 5, total: 5, time: 42, date: "2026-03-27" },
  { rank: 2, player: "Alex Rivera", quiz: "Entertainment Trivia", category: "entertainment", score: 5, total: 5, time: 38, date: "2026-03-27" },
  { rank: 3, player: "Jordan Park", quiz: "Tech & Computing", category: "technology", score: 5, total: 5, time: 55, date: "2026-03-26" },
  { rank: 4, player: "Emma Wilson", quiz: "Geography Challenge", category: "geography", score: 4, total: 5, time: 48, date: "2026-03-26" },
  { rank: 5, player: "Mike Johnson", quiz: "World History Highlights", category: "history", score: 4, total: 5, time: 52, date: "2026-03-26" },
  { rank: 6, player: "Lisa Wang", quiz: "Sports Legends", category: "sports", score: 4, total: 5, time: 45, date: "2026-03-25" },
  { rank: 7, player: "Chris Taylor", quiz: "Science Fundamentals", category: "science", score: 4, total: 5, time: 60, date: "2026-03-25" },
  { rank: 8, player: "Nina Patel", quiz: "Entertainment Trivia", category: "entertainment", score: 4, total: 5, time: 35, date: "2026-03-24" },
  { rank: 9, player: "David Kim", quiz: "Geography Challenge", category: "geography", score: 3, total: 5, time: 50, date: "2026-03-24" },
  { rank: 10, player: "Rachel Green", quiz: "Tech & Computing", category: "technology", score: 3, total: 5, time: 68, date: "2026-03-23" },
  { rank: 11, player: "Tom Brown", quiz: "World History Highlights", category: "history", score: 3, total: 5, time: 55, date: "2026-03-23" },
  { rank: 12, player: "Amy Lee", quiz: "Sports Legends", category: "sports", score: 3, total: 5, time: 47, date: "2026-03-22" },
];

const PERSONAL_BESTS = [
  { quiz: "Science Fundamentals", score: 4, total: 5, time: 58, date: "2026-03-27" },
  { quiz: "Entertainment Trivia", score: 5, total: 5, time: 40, date: "2026-03-25" },
  { quiz: "Geography Challenge", score: 3, total: 5, time: 52, date: "2026-03-24" },
];

const CATEGORY_FILTERS = [
  { label: "All", slug: "all" },
  { label: "Science", slug: "science" },
  { label: "History", slug: "history" },
  { label: "Geography", slug: "geography" },
  { label: "Technology", slug: "technology" },
  { label: "Entertainment", slug: "entertainment" },
  { label: "Sports", slug: "sports" },
];

function QuizLeaderboard() {
  const navigation = useNavigation();
  const currentUser = useCurrentUser();
  const [activeCategory, setActiveCategory] = React.useState("all");

  const filtered = activeCategory === "all"
    ? LEADERBOARD_DATA
    : LEADERBOARD_DATA.filter(e => e.category === activeCategory);

  const getMedal = (rank: number) => {
    if (rank === 1) return { icon: "Medal", color: "text-yellow-500", bg: "bg-yellow-100 dark:bg-yellow-900" };
    if (rank === 2) return { icon: "Medal", color: "text-gray-400", bg: "bg-gray-100 dark:bg-gray-800" };
    if (rank === 3) return { icon: "Medal", color: "text-amber-600", bg: "bg-amber-100 dark:bg-amber-900" };
    return null;
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-extrabold mb-2">Leaderboard</h1>
        <p className="text-muted-foreground">See how you compare against other quiz players</p>
      </div>

      {/* Category Filter */}
      <div className="flex flex-wrap gap-2 mb-8">
        {CATEGORY_FILTERS.map((cat) => (
          <button
            key={cat.slug}
            onClick={() => setActiveCategory(cat.slug)}
            className={cn(
              "px-4 py-2 rounded-full text-sm font-medium transition-colors border",
              activeCategory === cat.slug
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-background text-muted-foreground border-border hover:border-primary/50 hover:text-foreground"
            )}
          >
            {cat.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Main Leaderboard */}
        <div className="lg:col-span-2">
          {/* Top 3 Podium */}
          <div className="grid grid-cols-3 gap-4 mb-8">
            {filtered.slice(0, 3).map((entry, idx) => {
              const medal = getMedal(idx + 1);
              const order = idx === 0 ? "order-2" : idx === 1 ? "order-1" : "order-3";
              const height = idx === 0 ? "pt-0" : "pt-8";
              return (
                <div key={entry.rank} className={cn("text-center", order, height)}>
                  <Card className={cn("border-2", idx === 0 ? "border-yellow-400" : idx === 1 ? "border-gray-300" : "border-amber-500")}>
                    <CardContent className="p-4">
                      <div className={cn("h-12 w-12 rounded-full flex items-center justify-center mx-auto mb-2", medal?.bg)}>
                        <span className={cn("text-lg font-extrabold", medal?.color)}>#{idx + 1}</span>
                      </div>
                      <p className="font-bold text-sm truncate">{entry.player}</p>
                      <p className="text-xs text-muted-foreground truncate mb-2">{entry.quiz}</p>
                      <div className="text-2xl font-extrabold text-primary">{Math.round((entry.score / entry.total) * 100)}%</div>
                      <p className="text-xs text-muted-foreground">{entry.score}/{entry.total} in {formatTime(entry.time)}</p>
                    </CardContent>
                  </Card>
                </div>
              );
            })}
          </div>

          {/* Full Table */}
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Rank</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Player</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Quiz</th>
                      <th className="text-center px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Score</th>
                      <th className="text-center px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Time</th>
                      <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((entry, idx) => {
                      const medal = getMedal(idx + 1);
                      return (
                        <tr key={idx} className="border-b border-border last:border-0 hover:bg-muted/50">
                          <td className="px-4 py-3">
                            {medal ? (
                              <div className={cn("h-8 w-8 rounded-full flex items-center justify-center text-xs font-bold", medal.bg)}>
                                <span className={medal.color}>#{idx + 1}</span>
                              </div>
                            ) : (
                              <span className="text-sm text-muted-foreground font-medium pl-2">#{idx + 1}</span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <span className="text-sm font-medium">{entry.player}</span>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <span className="text-sm">{entry.quiz}</span>
                              <Badge variant="secondary" className="text-xs capitalize">{entry.category}</Badge>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-center">
                            <span className="text-sm font-bold text-primary">{entry.score}/{entry.total}</span>
                          </td>
                          <td className="px-4 py-3 text-center">
                            <span className="text-sm text-muted-foreground">{formatTime(entry.time)}</span>
                          </td>
                          <td className="px-4 py-3 text-right">
                            <span className="text-xs text-muted-foreground">{new Date(entry.date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Personal Best Sidebar */}
        <div>
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Icons.Star className="h-5 w-5 text-primary" />
                Personal Bests
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {currentUser?.isAuthenticated ? (
                PERSONAL_BESTS.map((entry, idx) => (
                  <div key={idx} className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                    <div>
                      <p className="text-sm font-medium">{entry.quiz}</p>
                      <p className="text-xs text-muted-foreground">{formatTime(entry.time)} - {new Date(entry.date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</p>
                    </div>
                    <div className="text-right">
                      <span className="text-lg font-bold text-primary">{entry.score}</span>
                      <span className="text-sm text-muted-foreground">/{entry.total}</span>
                    </div>
                  </div>
                ))
              ) : (
                <div className="text-center py-6">
                  <Icons.Lock className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
                  <p className="text-sm text-muted-foreground mb-3">Sign in to see your personal bests</p>
                  <Button size="sm" onClick={() => navigation.navigate("/login")}>
                    <Icons.LogIn className="h-4 w-4 mr-1.5" />
                    Sign In
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="mt-6">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Icons.TrendingUp className="h-5 w-5 text-primary" />
                Quick Stats
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Total Players</span>
                <span className="text-sm font-bold">248</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Quizzes Completed</span>
                <span className="text-sm font-bold">1,432</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Average Score</span>
                <span className="text-sm font-bold text-primary">72%</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Perfect Scores</span>
                <span className="text-sm font-bold">89</span>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

export default QuizLeaderboard;
