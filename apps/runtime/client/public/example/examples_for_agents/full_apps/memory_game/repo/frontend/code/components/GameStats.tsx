import { React, useModel, useCurrentUser, Card, CardContent, CardHeader, CardTitle, Badge, Icons, cn } from "@exepad/sdk";

const DEMO_SCORES = [
  { id: "s1", player_name: "You", difficulty: "medium", moves: 18, time_seconds: 42, completed_at: "2026-03-27T10:15:00Z" },
  { id: "s2", player_name: "You", difficulty: "easy", moves: 10, time_seconds: 22, completed_at: "2026-03-26T18:45:00Z" },
  { id: "s3", player_name: "You", difficulty: "hard", moves: 30, time_seconds: 95, completed_at: "2026-03-25T11:00:00Z" },
  { id: "s4", player_name: "You", difficulty: "medium", moves: 20, time_seconds: 48, completed_at: "2026-03-24T14:10:00Z" },
  { id: "s5", player_name: "You", difficulty: "easy", moves: 8, time_seconds: 18, completed_at: "2026-03-23T16:20:00Z" },
];

const ACHIEVEMENTS = [
  { id: "first-win", label: "First Win", desc: "Complete your first game", icon: Icons.Trophy, unlocked: true },
  { id: "speed-demon", label: "Speed Demon", desc: "Complete a game in under 30 seconds", icon: Icons.Zap, unlocked: true },
  { id: "memory-master", label: "Memory Master", desc: "Complete a game with no mistakes", icon: Icons.Brain, unlocked: false },
  { id: "streak-king", label: "Streak King", desc: "Win 5 games in a row", icon: Icons.Flame, unlocked: false },
];

function GameStats() {
  const currentUser = useCurrentUser();
  const scoresModel = useModel("game_scores");
  const myScores = scoresModel?.items?.length ? scoresModel.items : DEMO_SCORES;

  const gamesPlayed = myScores.length;
  const gamesWon = myScores.length;
  const winRate = gamesPlayed > 0 ? Math.round((gamesWon / gamesPlayed) * 100) : 0;
  const bestTime = myScores.reduce((min: number, s: any) => Math.min(min, s.time_seconds), Infinity);
  const totalMoves = myScores.reduce((sum: number, s: any) => sum + s.moves, 0);

  const easyCount = myScores.filter((s: any) => s.difficulty === "easy").length;
  const mediumCount = myScores.filter((s: any) => s.difficulty === "medium").length;
  const hardCount = myScores.filter((s: any) => s.difficulty === "hard").length;
  const maxCount = Math.max(easyCount, mediumCount, hardCount, 1);

  const formatTime = (sec: number) => {
    if (!isFinite(sec)) return "--";
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return m > 0 ? `${m}m ${s}s` : `${s}s`;
  };

  const formatDate = (iso: string) => {
    try {
      return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
    } catch {
      return iso;
    }
  };

  const stats = [
    { label: "Games Played", value: gamesPlayed, icon: Icons.Gamepad2, color: "text-blue-600", bg: "bg-blue-50" },
    { label: "Win Rate", value: `${winRate}%`, icon: Icons.Target, color: "text-green-600", bg: "bg-green-50" },
    { label: "Best Time", value: formatTime(bestTime), icon: Icons.Timer, color: "text-amber-600", bg: "bg-amber-50" },
    { label: "Total Moves", value: totalMoves, icon: Icons.MousePointerClick, color: "text-purple-600", bg: "bg-purple-50" },
  ];

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-8">
      <div className="text-center space-y-2">
        <h1 className="text-3xl font-bold text-foreground flex items-center justify-center gap-2">
          <Icons.BarChart3 className="h-8 w-8 text-primary" />
          Your Statistics
        </h1>
        <p className="text-muted-foreground">
          {currentUser?.isAuthenticated ? `Stats for ${currentUser.email?.split("@")[0]}` : "Demo statistics"}
        </p>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {stats.map((s) => {
          const Icon = s.icon;
          return (
            <Card key={s.label} className="stat-card">
              <CardContent className="pt-6 text-center space-y-2">
                <div className={cn("inline-flex items-center justify-center w-12 h-12 rounded-xl", s.bg)}>
                  <Icon className={cn("h-6 w-6", s.color)} />
                </div>
                <div className="text-2xl font-bold text-foreground">{s.value}</div>
                <div className="text-sm text-muted-foreground">{s.label}</div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Performance Chart */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Icons.BarChart3 className="h-5 w-5 text-primary" />
            Games by Difficulty
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {[
            { label: "Easy", count: easyCount, color: "bg-green-500" },
            { label: "Medium", count: mediumCount, color: "bg-amber-500" },
            { label: "Hard", count: hardCount, color: "bg-red-500" },
          ].map((bar) => (
            <div key={bar.label} className="flex items-center gap-3">
              <span className="w-16 text-sm font-medium text-muted-foreground">{bar.label}</span>
              <div className="flex-1 h-8 bg-muted rounded-md overflow-hidden">
                <div
                  className={cn("h-full rounded-md flex items-center pl-3 text-white text-sm font-medium transition-all", bar.color)}
                  style={{ width: `${Math.max((bar.count / maxCount) * 100, bar.count > 0 ? 15 : 0)}%` }}
                >
                  {bar.count > 0 ? bar.count : ""}
                </div>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Achievements */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Icons.Award className="h-5 w-5 text-primary" />
            Achievements
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {ACHIEVEMENTS.map((a) => {
              const AIcon = a.icon;
              return (
                <div
                  key={a.id}
                  className={cn(
                    "achievement-badge flex items-center gap-3 p-4 rounded-lg border",
                    a.unlocked
                      ? "border-primary/20 bg-primary/5"
                      : "border-border bg-muted/50 opacity-60"
                  )}
                >
                  <div className={cn(
                    "w-10 h-10 rounded-lg flex items-center justify-center",
                    a.unlocked ? "bg-primary/10" : "bg-muted"
                  )}>
                    <AIcon className={cn("h-5 w-5", a.unlocked ? "text-primary" : "text-muted-foreground")} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-foreground text-sm">{a.label}</span>
                      {a.unlocked && (
                        <Badge variant="secondary" className="text-xs bg-primary/10 text-primary">Unlocked</Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">{a.desc}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Recent Games */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Icons.Clock className="h-5 w-5 text-primary" />
            Recent Games
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Difficulty</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Moves</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Time</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Date</th>
                </tr>
              </thead>
              <tbody>
                {myScores.slice(0, 10).map((s: any, i: number) => (
                  <tr key={s.id || i} className="border-b border-border last:border-0">
                    <td className="px-4 py-3">
                      <Badge variant="secondary" className="capitalize">{s.difficulty}</Badge>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{s.moves}</td>
                    <td className="px-4 py-3 font-mono text-foreground">{formatTime(s.time_seconds)}</td>
                    <td className="px-4 py-3 text-muted-foreground">{formatDate(s.completed_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default GameStats;
