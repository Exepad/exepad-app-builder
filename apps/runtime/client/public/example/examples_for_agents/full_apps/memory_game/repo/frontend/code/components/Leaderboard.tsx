import { React, useModel, Card, CardContent, CardHeader, CardTitle, Badge, Icons, cn } from "@exepad/sdk";

const DEMO_SCORES = [
  { id: "s1", player_name: "MemoryMaster", difficulty: "hard", moves: 28, time_seconds: 85, completed_at: "2026-03-27T14:30:00Z" },
  { id: "s2", player_name: "QuickFlip", difficulty: "medium", moves: 18, time_seconds: 42, completed_at: "2026-03-27T10:15:00Z" },
  { id: "s3", player_name: "CardShark", difficulty: "easy", moves: 10, time_seconds: 22, completed_at: "2026-03-26T18:45:00Z" },
  { id: "s4", player_name: "BrainStorm", difficulty: "hard", moves: 32, time_seconds: 110, completed_at: "2026-03-26T15:00:00Z" },
  { id: "s5", player_name: "PairFinder", difficulty: "medium", moves: 22, time_seconds: 55, completed_at: "2026-03-26T09:30:00Z" },
  { id: "s6", player_name: "MemoryMaster", difficulty: "medium", moves: 16, time_seconds: 38, completed_at: "2026-03-25T20:00:00Z" },
  { id: "s7", player_name: "FlipKing", difficulty: "easy", moves: 8, time_seconds: 18, completed_at: "2026-03-25T16:20:00Z" },
  { id: "s8", player_name: "NeuralNet", difficulty: "hard", moves: 30, time_seconds: 95, completed_at: "2026-03-25T11:00:00Z" },
  { id: "s9", player_name: "QuickFlip", difficulty: "easy", moves: 12, time_seconds: 28, completed_at: "2026-03-24T19:45:00Z" },
  { id: "s10", player_name: "CardShark", difficulty: "medium", moves: 20, time_seconds: 48, completed_at: "2026-03-24T14:10:00Z" },
];

const TABS = ["all", "easy", "medium", "hard"] as const;

function Leaderboard() {
  const scoresModel = useModel("game_scores");
  const scores = scoresModel?.items?.length ? scoresModel.items : DEMO_SCORES;
  const [activeTab, setActiveTab] = React.useState<string>("all");

  const filtered = activeTab === "all" ? scores : scores.filter((s: any) => s.difficulty === activeTab);
  const sorted = [...filtered].sort((a: any, b: any) => a.time_seconds - b.time_seconds);

  const formatTime = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return m > 0 ? `${m}m ${s}s` : `${s}s`;
  };

  const formatDate = (iso: string) => {
    try {
      return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
    } catch {
      return iso;
    }
  };

  const getRankBadge = (rank: number) => {
    if (rank === 0) return <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-amber-100 text-amber-700 font-bold text-sm">1st</span>;
    if (rank === 1) return <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-gray-100 text-gray-600 font-bold text-sm">2nd</span>;
    if (rank === 2) return <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-orange-100 text-orange-700 font-bold text-sm">3rd</span>;
    return <span className="inline-flex items-center justify-center w-8 h-8 text-muted-foreground text-sm">{rank + 1}</span>;
  };

  const difficultyColor = (d: string) => {
    if (d === "easy") return "bg-green-100 text-green-700";
    if (d === "medium") return "bg-amber-100 text-amber-700";
    return "bg-red-100 text-red-700";
  };

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
      <div className="text-center space-y-2">
        <h1 className="text-3xl font-bold text-foreground flex items-center justify-center gap-2">
          <Icons.Trophy className="h-8 w-8 text-primary" />
          Leaderboard
        </h1>
        <p className="text-muted-foreground">Top players ranked by fastest completion time</p>
      </div>

      {/* Tabs */}
      <div className="flex justify-center gap-2">
        {TABS.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={cn(
              "px-4 py-2 rounded-md text-sm font-medium capitalize transition-colors",
              activeTab === tab
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:text-foreground"
            )}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground w-16">Rank</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Player</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Difficulty</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Moves</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Time</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Date</th>
                </tr>
              </thead>
              <tbody>
                {sorted.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-12 text-center text-muted-foreground">
                      No scores yet for this difficulty. Be the first!
                    </td>
                  </tr>
                ) : (
                  sorted.map((s: any, i: number) => (
                    <tr
                      key={s.id || i}
                      className={cn(
                        "leaderboard-row border-b border-border last:border-0",
                        i < 3 && "bg-primary/[0.02]"
                      )}
                    >
                      <td className="px-4 py-3">{getRankBadge(i)}</td>
                      <td className="px-4 py-3 font-semibold text-foreground">{s.player_name}</td>
                      <td className="px-4 py-3">
                        <Badge className={cn("capitalize", difficultyColor(s.difficulty))} variant="secondary">
                          {s.difficulty}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{s.moves}</td>
                      <td className="px-4 py-3 font-mono text-foreground">{formatTime(s.time_seconds)}</td>
                      <td className="px-4 py-3 text-muted-foreground">{formatDate(s.completed_at)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default Leaderboard;
