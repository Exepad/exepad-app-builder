---
name: game-board
description: "DOM-based board / puzzle / card / word games with grid layouts and turn logic. Load for chess / sudoku / minesweeper / wordle / solitaire / memory-match / hangman / 2048 / crossword / tic-tac-toe / quiz games. Keywords: puzzle, board, card, word, quiz, trivia, chess, checkers, sudoku, crossword, memory, matching, typing, minesweeper, solitaire, hangman, wordle, 2048."
metadata:
  kind: domain
---
# Skill: Board, Puzzle & Card Games (DOM-based)

For puzzles, board games, card games, word games, quizzes, and memory games
rendered with DOM elements and CSS: Chess, Sudoku, Minesweeper, Wordle, Solitaire,
Memory, Hangman, 2048, Crossword, Tic-tac-toe, Connect Four, Boggle, etc.

## Walled Garden Constraints
- No npm packages — all game logic must be self-contained
- Use DOM elements + CSS Grid/Flexbox for rendering (not Canvas)
- Use React synthetic events (`onClick`, `onDragStart`, etc.) for interaction
- Use `Motion.div` from `@exepad/sdk` for animations

## Grid Layout Pattern

The core rendering pattern for board games — CSS Grid with state-driven styling:
```
interface Cell { piece?: string; selected: boolean; validMove: boolean; highlighted: boolean; }
const [board, setBoard] = useState<Cell[]>(initBoard());

<div className="grid grid-cols-8 gap-0.5 aspect-square max-w-md mx-auto select-none">
  {board.map((cell, i) => (
    <div key={i} onClick={() => handleClick(i)}
      className={`aspect-square flex items-center justify-center text-3xl font-bold
        cursor-pointer transition-all duration-200
        ${cell.selected ? 'ring-2 ring-primary bg-primary/20 scale-105' : ''}
        ${cell.validMove ? 'bg-primary/10 after:content-[""] after:w-3 after:h-3 after:rounded-full after:bg-primary/40' : ''}
        ${cell.highlighted ? 'bg-secondary/20' : 'bg-surface-container'}
        hover:bg-surface-container-high`}>
      {cell.piece && (
        <Motion.span initial={{ scale: 0 }} animate={{ scale: 1 }}
          className="drop-shadow-md">
          {cell.piece}
        </Motion.span>
      )}
    </div>
  ))}
</div>
```

### Grid sizing by game type
- Chess/Checkers: `grid-cols-8`, cells 48-64px (`max-w-md` or `max-w-lg`)
- Tic-tac-toe: `grid-cols-3`, cells 80-100px (`max-w-xs`)
- Sudoku: `grid-cols-9`, cells 40-48px (`max-w-sm`)
- Minesweeper: `grid-cols-[10-16]`, cells 32-40px
- 2048: `grid-cols-4`, cells 72-80px (`max-w-xs`)
- Crossword: `grid-cols-[N]`, cells 36-40px

### Alternating cell backgrounds (chess pattern)
```
const isDark = (row: number, col: number) => (row + col) % 2 === 1;
className={isDark(r, c) ? 'bg-surface-container-high' : 'bg-surface-container'}
```

## Card Rendering

### Card component with flip animation

CSS 3D transforms (perspective, backface-visibility, transform-style) are NOT
standard Tailwind classes — use inline `style` objects for these properties.

```
interface CardData { id: number; face: string; flipped: boolean; matched: boolean; }

function GameCard({ card, onClick }: { card: CardData; onClick: () => void }) {
  return (
    <div onClick={onClick} className="cursor-pointer" style={{ perspective: '600px' }}>
      <Motion.div
        animate={{ rotateY: card.flipped || card.matched ? 0 : 180 }}
        transition={{ duration: 0.4, ease: 'easeInOut' }}
        style={{ transformStyle: 'preserve-3d' }}
        className="relative w-20 h-28">
        {/* Front */}
        <div style={{ backfaceVisibility: 'hidden' }}
          className={`absolute inset-0 rounded-xl flex items-center justify-center
          text-3xl bg-surface-container border border-outline-variant shadow-md
          ${card.matched ? 'ring-2 ring-primary opacity-60' : ''}`}>
          {card.face}
        </div>
        {/* Back */}
        <div style={{ backfaceVisibility: 'hidden', transform: 'rotateY(180deg)' }}
          className="absolute inset-0 rounded-xl bg-primary flex items-center justify-center">
          <span className="text-on-primary text-2xl font-bold">?</span>
        </div>
      </Motion.div>
    </div>
  );
}
```

### Card layouts
- Memory game: `grid grid-cols-4 md:grid-cols-6 gap-3`
- Card hand: `flex gap-2 justify-center` with overlapping via `-ml-4`
- Deck/discard: `relative` with stacked cards using `absolute` positioning

## Drag and Drop

For tile games, card games, and reordering:
```
const [dragIdx, setDragIdx] = useState<number | null>(null);

function handleDragStart(e: React.DragEvent, idx: number) {
  setDragIdx(idx);
  e.dataTransfer.effectAllowed = 'move';
}

function handleDragOver(e: React.DragEvent) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
}

function handleDrop(e: React.DragEvent, targetIdx: number) {
  e.preventDefault();
  if (dragIdx === null || dragIdx === targetIdx) return;
  // Perform move/swap logic
  movePiece(dragIdx, targetIdx);
  setDragIdx(null);
}

// On each draggable element:
<div draggable onDragStart={(e) => handleDragStart(e, i)}
  onDragOver={handleDragOver} onDrop={(e) => handleDrop(e, i)}
  className={`cursor-grab active:cursor-grabbing ${dragIdx === i ? 'opacity-50' : ''}`}>
```

## Move Validation

Pattern for validating moves and showing legal targets:
```
const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
const [validMoves, setValidMoves] = useState<Set<number>>(new Set());

function handleClick(idx: number) {
  if (selectedIdx === null) {
    // Select a piece
    if (board[idx].piece && isPlayerPiece(board[idx].piece)) {
      setSelectedIdx(idx);
      setValidMoves(getValidMoves(board, idx));
    }
  } else if (idx === selectedIdx) {
    // Deselect
    setSelectedIdx(null);
    setValidMoves(new Set());
  } else if (validMoves.has(idx)) {
    // Execute valid move
    executeMove(selectedIdx, idx);
    setSelectedIdx(null);
    setValidMoves(new Set());
  } else {
    // Select a different piece (or invalid target — shake feedback)
    setSelectedIdx(null);
    setValidMoves(new Set());
  }
}
```

## Turn-Based Logic

```
type Player = 'human' | 'ai';
const [currentTurn, setCurrentTurn] = useState<Player>('human');
const [turnCount, setTurnCount] = useState(0);

// After human move:
setCurrentTurn('ai');
setTurnCount(t => t + 1);

// AI move (use setTimeout to create a visible "thinking" delay):
useEffect(() => {
  if (currentTurn !== 'ai') return;
  const timer = setTimeout(() => {
    const aiMove = computeAIMove(board); // minimax, random, or heuristic
    executeMove(aiMove.from, aiMove.to);
    setCurrentTurn('human');
    setTurnCount(t => t + 1);
  }, 500);
  return () => clearTimeout(timer);
}, [currentTurn]);

// Turn indicator UI:
<div className="flex items-center gap-2 text-sm font-medium">
  <div className={`w-3 h-3 rounded-full ${currentTurn === 'human' ? 'bg-primary animate-pulse' : 'bg-outline'}`} />
  <span className="text-on-surface">{currentTurn === 'human' ? 'Your turn' : 'Thinking...'}</span>
</div>
```

## Timer & Scoring

```
const [time, setTime] = useState(0);
const [moves, setMoves] = useState(0);
const timerRef = useRef<number>();

useEffect(() => {
  if (gameState !== 'playing') return;
  timerRef.current = window.setInterval(() => setTime(t => t + 1), 1000);
  return () => clearInterval(timerRef.current);
}, [gameState]);

// Format: mm:ss
const timeDisplay = `${Math.floor(time / 60).toString().padStart(2, '0')}:${(time % 60).toString().padStart(2, '0')}`;

// Score / stats bar:
<div className="flex items-center justify-between px-4 py-3 bg-surface-container rounded-xl">
  <div className="flex items-center gap-2">
    <Icons.Clock className="w-4 h-4 text-on-surface-variant" />
    <span className="font-mono text-on-surface">{timeDisplay}</span>
  </div>
  <div className="flex items-center gap-2">
    <Icons.MousePointerClick className="w-4 h-4 text-on-surface-variant" />
    <span className="font-mono text-on-surface">{moves} moves</span>
  </div>
  <div className="flex items-center gap-2">
    <Icons.Trophy className="w-4 h-4 text-primary" />
    <span className="font-mono text-primary font-bold">{score}</span>
  </div>
</div>
```

## Animations

### Piece movement
```
<Motion.div
  layout  // enables automatic position animation
  transition={{ type: 'spring', stiffness: 300, damping: 25 }}
  className="..."
/>
```

### Invalid move shake
```
const [shakeId, setShakeId] = useState<number | null>(null);
// On invalid move: setShakeId(idx); setTimeout(() => setShakeId(null), 500);

<Motion.div animate={shakeId === i ? { x: [0, -6, 6, -4, 4, 0] } : {}}
  transition={{ duration: 0.4 }} />
```

### Win celebration
```
{gameState === 'won' && (
  <Motion.div initial={{ scale: 0, opacity: 0 }}
    animate={{ scale: 1, opacity: 1 }}
    transition={{ type: 'spring', stiffness: 200, damping: 15 }}
    className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
    <div className="text-center p-8 bg-surface rounded-2xl shadow-xl border border-outline-variant">
      <Motion.div animate={{ rotate: [0, 10, -10, 0], scale: [1, 1.2, 1] }}
        transition={{ repeat: 2, duration: 0.5 }}>
        <Icons.Trophy className="w-16 h-16 text-primary mx-auto mb-4" />
      </Motion.div>
      <h2 className="text-3xl font-bold text-on-surface mb-2">You Won!</h2>
      <p className="text-on-surface-variant mb-6">Completed in {moves} moves, {timeDisplay}</p>
      <Button onClick={resetGame}>Play Again</Button>
    </div>
  </Motion.div>
)}
```

## Keyboard Input

For word games and typing-based games:
```
useEffect(() => {
  const handler = (e: KeyboardEvent) => {
    if (e.key === 'Backspace') { deleteLetter(); return; }
    if (e.key === 'Enter') { submitGuess(); return; }
    if (/^[a-zA-Z]$/.test(e.key)) { addLetter(e.key.toUpperCase()); }
  };
  window.addEventListener('keydown', handler);
  return () => window.removeEventListener('keydown', handler);
}, [currentGuess]);
```

## Visual Quality Requirements
- Board cells must have clear visual states: empty, occupied, selected (ring + scale), valid-move (tinted dot), hover
- Pieces/tiles must be large enough to read and tap — minimum 40px touch targets
- Smooth transitions (200-300ms) for all state changes (move, flip, select)
- Celebration animation on win — do not just show plain text
- Use `drop-shadow-md` on pieces/cards for depth
- Use contrasting colors for player 1 vs player 2 pieces
- Number tiles (2048, Sudoku) should have distinct background colors per value

## State via useApp
- Store high score, games won, streak counters in `useApp(s => s.key)` if other components need it
- Use local `useState` for game-internal state (board array, selected piece, current turn)

## Anti-Patterns
- NEVER use `<table>` for game boards — use CSS Grid for responsive, styled layouts
- NEVER skip visual feedback on user interactions (click should always show a response)
- NEVER leave valid moves un-highlighted when a piece is selected
- NEVER use Canvas for board/puzzle games — DOM elements with CSS are more appropriate
- NEVER use `Math.random()` in the render path — compute in state/effect
- NEVER forget to handle keyboard input for word/typing games


## Canonical implementations (load on demand)
- `load_skill_resource(skill_name='game-board', file_path='assets/example_1.tsx')` — truncated source from the `chess-game-67` reference block.

Read these only when the building plan calls for a layout / wiring pattern that closely matches one of the reference blocks. Don't load all examples up front.
