import { React, useAppState, useNavigation, Button, Card, CardContent, Badge, Icons, cn, toast } from "@exepad/sdk";

const ALL_EMOJIS = ["🎮", "🎨", "🎵", "🚀", "⭐", "🌈", "🔥", "💎", "🌺", "🎯", "🦋", "🌙"];

const GRID_CONFIG: Record<string, { cols: number; rows: number; pairs: number }> = {
  easy: { cols: 4, rows: 3, pairs: 6 },
  medium: { cols: 4, rows: 4, pairs: 8 },
  hard: { cols: 6, rows: 4, pairs: 12 },
};

interface GameCard {
  id: number;
  emoji: string;
  isFlipped: boolean;
  isMatched: boolean;
}

function shuffleArray<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function GameBoard() {
  const navigation = useNavigation();
  const [difficulty] = useAppState<string>("difficulty", "medium");
  const [currentScore, setCurrentScore] = useAppState<number>("currentScore", 0);
  const config = GRID_CONFIG[difficulty] || GRID_CONFIG.medium;

  const createCards = (): GameCard[] => {
    const emojis = ALL_EMOJIS.slice(0, config.pairs);
    const pairs = [...emojis, ...emojis];
    return shuffleArray(pairs).map((emoji, i) => ({
      id: i,
      emoji,
      isFlipped: false,
      isMatched: false,
    }));
  };

  const [cards, setCards] = React.useState<GameCard[]>(() => createCards());
  const [flippedIds, setFlippedIds] = React.useState<number[]>([]);
  const [moves, setMoves] = React.useState(0);
  const [matchedPairs, setMatchedPairs] = React.useState(0);
  const [timer, setTimer] = React.useState(0);
  const [isRunning, setIsRunning] = React.useState(false);
  const [isWon, setIsWon] = React.useState(false);
  const [isLocked, setIsLocked] = React.useState(false);

  // Timer
  React.useEffect(() => {
    let interval: any;
    if (isRunning && !isWon) {
      interval = setInterval(() => setTimer((t) => t + 1), 1000);
    }
    return () => clearInterval(interval);
  }, [isRunning, isWon]);

  // Check for win
  React.useEffect(() => {
    if (matchedPairs === config.pairs && matchedPairs > 0) {
      setIsWon(true);
      setIsRunning(false);
      const score = Math.max(0, 1000 - moves * 10 - timer * 2);
      setCurrentScore(score);
      toast({ title: "Congratulations!", description: `You won in ${moves} moves and ${formatTime(timer)}!` });
    }
  }, [matchedPairs]);

  const handleCardClick = (id: number) => {
    if (isLocked || isWon) return;
    const card = cards[id];
    if (card.isFlipped || card.isMatched) return;

    if (!isRunning) setIsRunning(true);

    const newCards = cards.map((c) => (c.id === id ? { ...c, isFlipped: true } : c));
    setCards(newCards);

    const newFlipped = [...flippedIds, id];
    setFlippedIds(newFlipped);

    if (newFlipped.length === 2) {
      setMoves((m) => m + 1);
      setIsLocked(true);

      const [first, second] = newFlipped;
      if (newCards[first].emoji === newCards[second].emoji) {
        // Match!
        setTimeout(() => {
          setCards((prev) =>
            prev.map((c) =>
              c.id === first || c.id === second ? { ...c, isMatched: true } : c
            )
          );
          setMatchedPairs((p) => p + 1);
          setFlippedIds([]);
          setIsLocked(false);
        }, 400);
      } else {
        // No match — flip back
        setTimeout(() => {
          setCards((prev) =>
            prev.map((c) =>
              c.id === first || c.id === second ? { ...c, isFlipped: false } : c
            )
          );
          setFlippedIds([]);
          setIsLocked(false);
        }, 800);
      }
    }
  };

  const resetGame = () => {
    setCards(createCards());
    setFlippedIds([]);
    setMoves(0);
    setMatchedPairs(0);
    setTimer(0);
    setIsRunning(false);
    setIsWon(false);
    setIsLocked(false);
  };

  const formatTime = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  };

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 space-y-6">
      {/* Game Info Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <Badge variant="secondary" className="text-base px-3 py-1 capitalize">
            <Icons.Zap className="h-4 w-4 mr-1" />
            {difficulty}
          </Badge>
          <div className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
            <Icons.Timer className="h-4 w-4" />
            <span className="font-mono text-lg text-foreground">{formatTime(timer)}</span>
          </div>
          <div className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
            <Icons.MousePointerClick className="h-4 w-4" />
            <span className="font-mono text-lg text-foreground">{moves}</span>
            <span className="text-xs">moves</span>
          </div>
          <div className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
            <Icons.CheckCircle2 className="h-4 w-4 text-primary" />
            <span className="font-mono text-lg text-foreground">{matchedPairs}/{config.pairs}</span>
            <span className="text-xs">pairs</span>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={resetGame}>
          <Icons.RotateCcw className="h-4 w-4 mr-1" />
          Reset
        </Button>
      </div>

      {/* Game Board */}
      {!isWon ? (
        <div
          className="grid gap-3 mx-auto"
          style={{
            gridTemplateColumns: `repeat(${config.cols}, minmax(0, 1fr))`,
            maxWidth: config.cols * 90 + (config.cols - 1) * 12,
          }}
        >
          {cards.map((card) => (
            <div
              key={card.id}
              className={cn(
                "game-card aspect-square",
                (card.isFlipped || card.isMatched) && "flipped",
                card.isMatched && "matched"
              )}
              onClick={() => handleCardClick(card.id)}
            >
              <div className="game-card-inner w-full h-full">
                {/* Front (hidden side) */}
                <div className="game-card-front bg-primary/10 border-2 border-primary/20 hover:border-primary/40 transition-colors">
                  <Icons.HelpCircle className="h-8 w-8 text-primary/40" />
                </div>
                {/* Back (emoji side) */}
                <div className={cn(
                  "game-card-back border-2",
                  card.isMatched
                    ? "bg-primary/5 border-primary/30"
                    : "bg-background border-border"
                )}>
                  <span className="text-3xl sm:text-4xl select-none">{card.emoji}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        /* Win State */
        <Card className="celebrate">
          <CardContent className="pt-8 pb-8 text-center space-y-6">
            <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-primary/10">
              <Icons.Trophy className="h-10 w-10 text-primary" />
            </div>
            <div className="space-y-2">
              <h2 className="text-3xl font-bold text-foreground">Congratulations!</h2>
              <p className="text-muted-foreground text-lg">You matched all pairs!</p>
            </div>
            <div className="flex justify-center gap-6">
              <div className="text-center">
                <div className="text-3xl font-bold text-foreground">{moves}</div>
                <div className="text-sm text-muted-foreground">Moves</div>
              </div>
              <div className="text-center">
                <div className="text-3xl font-bold text-foreground">{formatTime(timer)}</div>
                <div className="text-sm text-muted-foreground">Time</div>
              </div>
              <div className="text-center">
                <div className="text-3xl font-bold text-primary">{currentScore}</div>
                <div className="text-sm text-muted-foreground">Score</div>
              </div>
            </div>
            <div className="flex justify-center gap-3">
              <Button onClick={resetGame} size="lg">
                <Icons.RotateCcw className="h-4 w-4 mr-2" />
                Play Again
              </Button>
              <Button variant="outline" size="lg" onClick={() => navigation.navigate("/leaderboard")}>
                <Icons.Trophy className="h-4 w-4 mr-2" />
                View Leaderboard
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export default GameBoard;
