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
// ... (truncated)
