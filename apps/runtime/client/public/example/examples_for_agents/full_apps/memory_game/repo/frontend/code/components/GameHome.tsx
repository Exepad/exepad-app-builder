import { React, useAppState, useNavigation, useModel, Button, Card, CardContent, CardHeader, CardTitle, Badge, Icons, cn } from "@exepad/sdk";

const DEMO_SCORES = [
  { id: "s1", player_name: "MemoryMaster", difficulty: "hard", moves: 28, time_seconds: 85, completed_at: "2026-03-27T14:30:00Z" },
  { id: "s2", player_name: "QuickFlip", difficulty: "medium", moves: 18, time_seconds: 42, completed_at: "2026-03-27T10:15:00Z" },
  { id: "s3", player_name: "FlipKing", difficulty: "easy", moves: 8, time_seconds: 18, completed_at: "2026-03-25T16:20:00Z" },
  { id: "s4", player_name: "CardShark", difficulty: "easy", moves: 10, time_seconds: 22, completed_at: "2026-03-26T18:45:00Z" },
  { id: "s5", player_name: "MemoryMaster", difficulty: "medium", moves: 16, time_seconds: 38, completed_at: "2026-03-25T20:00:00Z" },
];

const DIFFICULTIES = [
  { key: "easy", label: "Easy", grid: "4 x 3", pairs: 6, desc: "Perfect for beginners. 6 pairs to match on a 4x3 grid.", color: "text-green-600", bg: "bg-green-50", border: "border-green-200" },
  { key: "medium", label: "Medium", grid: "4 x 4", pairs: 8, desc: "A balanced challenge. 8 pairs on a 4x4 grid.", color: "text-amber-600", bg: "bg-amber-50", border: "border-amber-200" },
  { key: "hard", label: "Hard", grid: "6 x 4", pairs: 12, desc: "Test your limits. 12 pairs on a 6x4 grid.", color: "text-red-600", bg: "bg-red-50", border: "border-red-200" },
];

function GameHome() {
  const navigation = useNavigation();
  const [difficulty, setDifficulty] = useAppState<string>("difficulty", "medium");
  const scoresModel = useModel("game_scores");
  const scores = scoresModel?.items?.length ? scoresModel.items : DEMO_SCORES;
  const topScores = [...scores].sort((a: any, b: any) => a.time_seconds - b.time_seconds).slice(0, 5);

  const selectDifficulty = (key: string) => {
    setDifficulty(key);
  };

  const startGame = () => {
    navigation.navigate("/play");
  };

  const formatTime = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return m > 0 ? `${m}m ${s}s` : `${s}s`;
  };

  return (
    <div className="max-w-6xl mx-auto px-4 py-8 space-y-12">
      {/* Hero */}
      <div className="text-center space-y-4">
        <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-primary/10 mb-2">
          <Icons.Brain className="h-10 w-10 text-primary" />
        </div>
        <h1 className="text-4xl sm:text-5xl font-bold text-foreground">Test Your Memory</h1>
        <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
          Flip cards, find matching pairs, and challenge yourself across three difficulty levels. How fast can you clear the board?
        </p>
      </div>

      {/* Difficulty Selector */}
      <div className="space-y-4">
        <h2 className="text-2xl font-semibold text-foreground text-center">Choose Your Challenge</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {DIFFICULTIES.map((d) => (
            <Card
              key={d.key}
              className={cn(
                "difficulty-card cursor-pointer border-2 transition-all",
                difficulty === d.key ? `${d.border} ${d.bg}` : "border-border hover:border-muted-foreground/30"
              )}
              onClick={() => selectDifficulty(d.key)}
            >
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className={cn("text-lg", difficulty === d.key ? d.color : "text-foreground")}>
                    {d.label}
                  </CardTitle>
                  <Badge variant={difficulty === d.key ? "default" : "secondary"}>{d.grid}</Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-2">
                <p className="text-sm text-muted-foreground">{d.desc}</p>
                <div className="flex items-center gap-2 text-sm">
                  <Icons.Grid3x3 className="h-4 w-4 text-muted-foreground" />
                  <span className="text-muted-foreground">{d.pairs} pairs</span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
        <div className="text-center pt-2">
          <Button size="lg" onClick={startGame} className="px-8 text-lg">
            <Icons.Play className="h-5 w-5 mr-2" />
            Start Game
          </Button>
        </div>
      </div>

      {/* Recent Top Scores */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-semibold text-foreground">Recent Top Scores</h2>
          <Button variant="ghost" size="sm" onClick={() => navigation.navigate("/leaderboard")}>
            View All <Icons.ArrowRight className="h-4 w-4 ml-1" />
          </Button>
        </div>
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">#</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Player</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Difficulty</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Moves</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Time</th>
                  </tr>
                </thead>
                <tbody>
                  {topScores.map((s: any, i: number) => (
                    <tr key={s.id || i} className="leaderboard-row border-b border-border last:border-0">
                      <td className="px-4 py-3 font-medium">
                        {i === 0 ? <span className="text-amber-500">&#x1F947;</span> : i === 1 ? <span className="text-gray-400">&#x1F948;</span> : i === 2 ? <span className="text-orange-600">&#x1F949;</span> : i + 1}
                      </td>
                      <td className="px-4 py-3 font-medium text-foreground">{s.player_name}</td>
                      <td className="px-4 py-3">
                        <Badge variant="secondary" className="capitalize">{s.difficulty}</Badge>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{s.moves}</td>
                      <td className="px-4 py-3 text-muted-foreground">{formatTime(s.time_seconds)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* How to Play */}
      <div className="space-y-4">
        <h2 className="text-2xl font-semibold text-foreground text-center">How to Play</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {[
            { icon: Icons.MousePointerClick, title: "1. Flip Cards", desc: "Click on any card to reveal the emoji hidden underneath." },
            { icon: Icons.Scan, title: "2. Find Pairs", desc: "Remember card positions and match two cards with the same emoji." },
            { icon: Icons.Timer, title: "3. Beat the Clock", desc: "Complete the board in fewer moves and less time to top the leaderboard." },
          ].map((step, i) => {
            const StepIcon = step.icon;
            return (
              <Card key={i} className="text-center">
                <CardContent className="pt-6 space-y-3">
                  <div className="inline-flex items-center justify-center w-14 h-14 rounded-xl bg-primary/10">
                    <StepIcon className="h-7 w-7 text-primary" />
                  </div>
                  <h3 className="text-lg font-semibold text-foreground">{step.title}</h3>
                  <p className="text-sm text-muted-foreground">{step.desc}</p>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default GameHome;
