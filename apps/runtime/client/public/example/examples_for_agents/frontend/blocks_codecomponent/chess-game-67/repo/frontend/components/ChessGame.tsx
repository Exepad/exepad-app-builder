import {
  React,
  useAppState,
  useHandler,
  useTheme,
  toast,
  Button,
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  Badge,
  ScrollArea,
  Icons,
  cn,
} from "@exepad/sdk";
import * as Chess from "@exepad/ext-chess";

const PIECE_UNICODE: Record<string, string> = {
  wp: "\u2659", wn: "\u2658", wb: "\u2657", wr: "\u2656", wq: "\u2655", wk: "\u2654",
  bp: "\u265F", bn: "\u265E", bb: "\u265D", br: "\u265C", bq: "\u265B", bk: "\u265A",
};

const FILES = ["a", "b", "c", "d", "e", "f", "g", "h"];
const RANKS = [8, 7, 6, 5, 4, 3, 2, 1];

interface GameState {
  fen: string;
  history: string[];
}

function ChessGame() {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const [gameState, setGameState] = useAppState<GameState>("chessState", {
    fen: "start",
    history: [],
  });

  const gs = gameState ?? { fen: "start", history: [] };

  const gameRef = React.useRef<any>(null);
  const [selectedSquare, setSelectedSquare] = React.useState<string | null>(null);
  const [legalMoves, setLegalMoves] = React.useState<string[]>([]);
  const [, forceUpdate] = React.useState(0);

  React.useEffect(() => {
    const game = new Chess.Chess(gs.fen === "start" ? undefined : gs.fen);
    gameRef.current = game;
    forceUpdate((n) => n + 1);
  }, []);

  const getGame = (): any => gameRef.current;

  const syncState = () => {
    const game = getGame();
    if (!game) return;
    setGameState({
      fen: game.fen(),
      history: game.history(),
    });
    forceUpdate((n) => n + 1);
  };

  const handleSquareClick = (square: string) => {
    const game = getGame();
    if (!game || game.isGameOver()) return;

    if (selectedSquare) {
      try {
        const move = game.move({
          from: selectedSquare,
          to: square,
          promotion: "q",
        });
        if (move) {
          setSelectedSquare(null);
          setLegalMoves([]);
          syncState();
          if (game.isCheckmate()) {
            toast.success(`Checkmate! ${game.turn() === "w" ? "Black" : "White"} wins!`);
          } else if (game.isDraw()) {
            toast.info("Game is a draw!");
          } else if (game.isCheck()) {
            toast.info("Check!");
          }
          return;
        }
      } catch {
        // Invalid move, try selecting new piece
      }
    }

    const piece = game.get(square);
    if (piece && piece.color === game.turn()) {
      setSelectedSquare(square);
      const moves = game.moves({ square, verbose: true });
      setLegalMoves(moves.map((m: any) => m.to));
    } else {
      setSelectedSquare(null);
      setLegalMoves([]);
    }
  };

  const handleNewGame = () => {
    const game = new Chess.Chess();
    gameRef.current = game;
    setSelectedSquare(null);
    setLegalMoves([]);
    setGameState({ fen: game.fen(), history: [] });
    forceUpdate((n) => n + 1);
    toast.success("New game started");
  };

  const handleUndo = () => {
    const game = getGame();
    if (!game) return;
    game.undo();
    setSelectedSquare(null);
    setLegalMoves([]);
    syncState();
    toast.info("Move undone");
  };

  const game = getGame();
  const board = game ? game.board() : [];
  const history = game ? game.history() : [];
  const turn = game ? game.turn() : "w";
  const isCheck = game ? game.isCheck() : false;
  const isCheckmate = game ? game.isCheckmate() : false;
  const isDraw = game ? game.isDraw() : false;
  const isGameOver = game ? game.isGameOver() : false;

  const getSquareColor = (rank: number, file: number) => {
    return (rank + file) % 2 === 0;
  };

  const getStatusText = () => {
    if (isCheckmate) return `Checkmate! ${turn === "w" ? "Black" : "White"} wins!`;
    if (isDraw) return "Draw!";
    if (isCheck) return `${turn === "w" ? "White" : "Black"} is in check`;
    return `${turn === "w" ? "White" : "Black"} to move`;
  };

  const lightSquare = isDark ? "bg-amber-800" : "bg-amber-200";
  const darkSquare = isDark ? "bg-amber-950" : "bg-amber-700";

  return (
    <div className="space-y-4">
      {/* Controls */}
      <Card>
        <CardContent className="py-3">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-3">
              <Icons.Crown className="h-5 w-5 text-primary" />
              <span className="font-semibold text-lg">Chess</span>
              <Badge
                variant={isGameOver ? "destructive" : isCheck ? "outline" : "secondary"}
              >
                {getStatusText()}
              </Badge>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="outline">Move {Math.ceil(history.length / 2)}</Badge>
              <Button size="sm" variant="outline" onClick={handleUndo} disabled={history.length === 0}>
                <Icons.Undo2 className="h-4 w-4 mr-1" />
                Undo
              </Button>
              <Button size="sm" onClick={handleNewGame}>
                <Icons.RotateCcw className="h-4 w-4 mr-1" />
                New Game
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Board */}
        <div className="lg:col-span-2">
          <Card className="overflow-hidden">
            <CardContent className="p-4 flex justify-center">
              <div>
                {/* Column labels top */}
                <div className="flex ml-6">
                  {FILES.map((file) => (
                    <div
                      key={`top-${file}`}
                      className="w-12 h-5 flex items-center justify-center text-xs text-muted-foreground font-mono"
                    >
                      {file}
                    </div>
                  ))}
                </div>
                {/* Board rows */}
                {RANKS.map((rank, ri) => (
                  <div key={rank} className="flex">
                    {/* Row label */}
                    <div className="w-6 h-12 flex items-center justify-center text-xs text-muted-foreground font-mono">
                      {rank}
                    </div>
                    {FILES.map((file, fi) => {
                      const square = `${file}${rank}`;
                      const piece = board[ri]?.[fi];
                      const isLight = getSquareColor(ri, fi);
                      const isSelected = selectedSquare === square;
                      const isLegal = legalMoves.includes(square);
                      const pieceKey = piece
                        ? `${piece.color}${piece.type}`
                        : null;

                      return (
                        <div
                          key={square}
                          onClick={() => handleSquareClick(square)}
                          className={cn(
                            "w-12 h-12 flex items-center justify-center cursor-pointer relative select-none transition-all",
                            isLight ? lightSquare : darkSquare,
                            isSelected && "ring-2 ring-primary ring-inset",
                            isLegal && "ring-2 ring-green-400 ring-inset"
                          )}
                        >
                          {isLegal && !piece && (
                            <div className="absolute w-3 h-3 rounded-full bg-green-400/50" />
                          )}
                          {pieceKey && (
                            <span
                              className={cn(
                                "text-3xl leading-none",
                                piece.color === "w"
                                  ? "text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]"
                                  : "text-zinc-900 drop-shadow-[0_1px_2px_rgba(255,255,255,0.4)]"
                              )}
                            >
                              {PIECE_UNICODE[pieceKey]}
                            </span>
                          )}
                        </div>
                      );
                    })}
                    {/* Row label right */}
                    <div className="w-6 h-12 flex items-center justify-center text-xs text-muted-foreground font-mono">
                      {rank}
                    </div>
                  </div>
                ))}
                {/* Column labels bottom */}
                <div className="flex ml-6">
                  {FILES.map((file) => (
                    <div
                      key={`bot-${file}`}
                      className="w-12 h-5 flex items-center justify-center text-xs text-muted-foreground font-mono"
                    >
                      {file}
                    </div>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Move History */}
        <div>
          <Card className="h-full">
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Icons.List className="h-4 w-4" />
                Move History
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[400px]">
                <div className="space-y-1 font-mono text-sm">
                  {history.length === 0 && (
                    <p className="text-muted-foreground text-center py-8">
                      No moves yet. Click a piece to start.
                    </p>
                  )}
                  {Array.from({ length: Math.ceil(history.length / 2) }).map(
                    (_, i) => (
                      <div
                        key={i}
                        className={cn(
                          "flex gap-3 px-2 py-1 rounded",
                          i % 2 === 0 ? "bg-muted/30" : ""
                        )}
                      >
                        <span className="text-muted-foreground w-8">
                          {i + 1}.
                        </span>
                        <span className="w-16">{history[i * 2]}</span>
                        <span className="w-16 text-muted-foreground">
                          {history[i * 2 + 1] || ""}
                        </span>
                      </div>
                    )
                  )}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

export default ChessGame;
