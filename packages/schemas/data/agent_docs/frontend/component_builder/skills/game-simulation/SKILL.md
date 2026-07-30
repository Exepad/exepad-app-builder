---
name: game-simulation
description: "Idle clickers, city builders, tower defense, farming sims, economy / trading games with tick systems and resource management. Load for cookie-clicker / tamagotchi / lemonade-stand / dungeon-crawler / space-trader-style components. Keywords: idle, clicker, simulation, strategy, tower-defense, city-builder, farming, economy, resource, upgrade, tycoon, management, tamagotchi, trading."
metadata:
  kind: domain
---
# Skill: Simulation & Strategy Games (Tick-based)

For idle/clicker games, city builders, tower defense, farming sims, economy/trading,
tycoon games, virtual pets, text adventures, and dungeon crawlers: Cookie Clicker,
Tamagotchi, Lemonade Stand, Tower Defense, City Builder, Space Trader, etc.

## Walled Garden Constraints
- No npm packages — all game logic must be self-contained
- Use DOM elements + CSS for most UI, optional Canvas overlay for effects
- Use `setInterval` for tick-based game loops (not `requestAnimationFrame`)
- Use `requestAnimationFrame` ONLY for Canvas-rendered overlays (e.g., tower defense projectiles)

## Tick System Pattern

The core mechanic — a 1-second game tick separate from rendering:
```
const [tick, setTick] = useState(0);
const gameState = useRef({ resources: { gold: 100, wood: 50 }, generators: [] });

useEffect(() => {
  const interval = window.setInterval(() => {
    // Process all generators/income sources
    const gs = gameState.current;
    gs.generators.forEach(gen => {
      gs.resources[gen.resource] += gen.rate;
    });
    setTick(t => t + 1); // trigger re-render
  }, 1000);
  return () => clearInterval(interval);
}, []);
```

### Tick rate considerations
- Idle/clicker: 1000ms ticks (1/s) for readable income counters
- Farming sim: 1000ms ticks with multi-second crop timers
- Tower defense: 100-200ms ticks for enemy movement, plus `requestAnimationFrame` for smooth rendering
- Text adventure: no ticks — event-driven

## Resource Management

```
interface Resources {
  [key: string]: number;
}

interface Generator {
  id: string;
  name: string;
  resource: string;
  rate: number;
  count: number;
  baseCost: number;
  costMultiplier: number;
}

const [resources, setResources] = useState<Resources>({ gold: 100, wood: 0, food: 50 });
const [generators, setGenerators] = useState<Generator[]>([
  { id: 'mine', name: 'Gold Mine', resource: 'gold', rate: 1, count: 0, baseCost: 10, costMultiplier: 1.15 },
  { id: 'farm', name: 'Farm', resource: 'food', rate: 2, count: 0, baseCost: 25, costMultiplier: 1.12 },
]);

function getCost(gen: Generator): number {
  return Math.floor(gen.baseCost * Math.pow(gen.costMultiplier, gen.count));
}

function buyGenerator(id: string) {
  const gen = generators.find(g => g.id === id);
  if (!gen) return;
  const cost = getCost(gen);
  // Check affordability with current resources (not inside a stale closure)
  if (resources[gen.resource] < cost) return;
  setResources(r => ({ ...r, [gen.resource]: r[gen.resource] - cost }));
  setGenerators(prev => prev.map(g =>
    g.id === id ? { ...g, count: g.count + 1, rate: g.rate * 1.05 } : g
  ));
}
```

### Resource display bar
```
<div className="flex items-center gap-6 px-4 py-3 bg-surface-container rounded-xl">
  {Object.entries(resources).map(([key, value]) => {
    const rate = generators.filter(g => g.resource === key).reduce((sum, g) => sum + g.rate * g.count, 0);
    return (
      <div key={key} className="flex items-center gap-2">
        <Icons.Coins className="w-5 h-5 text-primary" />
        <span className="font-mono text-lg font-bold text-on-surface">{Math.floor(value).toLocaleString()}</span>
        {rate > 0 && <span className="text-xs text-primary font-medium">+{rate.toFixed(1)}/s</span>}
      </div>
    );
  })}
</div>
```

### Insufficient resource feedback
```
const [flashResource, setFlashResource] = useState<string | null>(null);
// On failed purchase: setFlashResource('gold'); setTimeout(() => setFlashResource(null), 600);

<Motion.div animate={flashResource === key ? { x: [0, -4, 4, -2, 2, 0] } : {}}
  transition={{ duration: 0.4 }}
  className={flashResource === key ? 'text-error' : ''}>
```

## Grid Placement (City Builder / Tower Defense)

```
interface GridCell {
  terrain: 'grass' | 'water' | 'mountain';
  building: string | null;
  level: number;
}

const GRID_SIZE = 8;
const [grid, setGrid] = useState<GridCell[][]>(initGrid());
const [selectedBuilding, setSelectedBuilding] = useState<string | null>(null);
const [hoveredCell, setHoveredCell] = useState<{r: number; c: number} | null>(null);

function canPlace(r: number, c: number): boolean {
  return grid[r][c].building === null && grid[r][c].terrain === 'grass';
}

<div className="grid gap-0.5 aspect-square max-w-lg mx-auto"
  style={{ gridTemplateColumns: `repeat(${GRID_SIZE}, 1fr)` }}>
  {grid.flatMap((row, r) => row.map((cell, c) => {
    const isHovered = hoveredCell?.r === r && hoveredCell?.c === c;
    const valid = selectedBuilding && canPlace(r, c);
    return (
      <div key={`${r}-${c}`}
        onMouseEnter={() => setHoveredCell({ r, c })}
        onMouseLeave={() => setHoveredCell(null)}
        onClick={() => selectedBuilding && valid && placeBuilding(r, c)}
        className={`aspect-square flex items-center justify-center text-2xl
          transition-colors duration-150 cursor-pointer relative
          ${cell.terrain === 'water' ? 'bg-blue-200' : cell.terrain === 'mountain' ? 'bg-stone-400' : 'bg-emerald-100'}
          ${isHovered && valid ? 'ring-2 ring-primary bg-primary/20' : ''}
          ${isHovered && selectedBuilding && !valid ? 'ring-2 ring-error bg-error/10' : ''}
          ${cell.building ? 'shadow-inner' : ''}`}>
        {cell.building && <span className="drop-shadow-md">{getBuildingEmoji(cell.building)}</span>}
        {isHovered && selectedBuilding && valid && !cell.building && (
          <span className="opacity-50">{getBuildingEmoji(selectedBuilding)}</span>
        )}
      </div>
    );
  }))}
</div>
```

## Upgrade Tree Pattern

```
interface Upgrade {
  id: string;
  name: string;
  description: string;
  level: number;
  maxLevel: number;
  baseCost: number;
  costMultiplier: number;
  effect: string;
  unlocked: boolean;
  requires?: string; // id of prerequisite upgrade
}

function UpgradeCard({ upgrade, onBuy, canAfford }: { upgrade: Upgrade; onBuy: () => void; canAfford: boolean }) {
  const cost = Math.floor(upgrade.baseCost * Math.pow(upgrade.costMultiplier, upgrade.level));
  const maxed = upgrade.level >= upgrade.maxLevel;

  return (
    <div className={`p-4 rounded-xl border transition-all
      ${!upgrade.unlocked ? 'opacity-40 grayscale border-outline/30' : ''}
      ${maxed ? 'border-primary/50 bg-primary/5' : 'border-outline-variant bg-surface-container'}
      ${canAfford && !maxed ? 'hover:border-primary hover:shadow-md cursor-pointer' : ''}`}
      onClick={() => canAfford && !maxed && upgrade.unlocked && onBuy()}>
      <div className="flex items-center justify-between mb-2">
        <h3 className="font-bold text-on-surface">{upgrade.name}</h3>
        <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full font-medium">
          Lv.{upgrade.level}/{upgrade.maxLevel}
        </span>
      </div>
      <p className="text-sm text-on-surface-variant mb-3">{upgrade.description}</p>
      {!maxed && (
        <div className={`flex items-center gap-1 text-sm font-medium
          ${canAfford ? 'text-primary' : 'text-error'}`}>
          <Icons.Coins className="w-4 h-4" />
          <span>{cost.toLocaleString()}</span>
        </div>
      )}
      {maxed && <span className="text-xs text-primary font-bold uppercase">Maxed</span>}
    </div>
  );
}
```

## Enemy Wave System (Tower Defense)

```
interface Enemy {
  id: number;
  type: string;
  hp: number;
  maxHp: number;
  speed: number;
  pathIndex: number; // current waypoint index
  x: number;
  y: number;
}

interface Wave {
  enemies: { type: string; count: number; interval: number }[];
  delay: number; // seconds before wave starts
}

const WAVES: Wave[] = [
  { delay: 3, enemies: [{ type: 'basic', count: 5, interval: 1 }] },
  { delay: 5, enemies: [{ type: 'basic', count: 8, interval: 0.8 }, { type: 'fast', count: 3, interval: 0.5 }] },
];

// HP bar on enemies:
<div className="relative">
  <div className="absolute -top-2 left-0 right-0 h-1 bg-surface-container-high rounded-full overflow-hidden">
    <div className="h-full bg-error transition-all duration-200 rounded-full"
      style={{ width: `${(enemy.hp / enemy.maxHp) * 100}%` }} />
  </div>
  <span className="text-xl">{getEnemyEmoji(enemy.type)}</span>
</div>
```

## Economy Display

Rate-of-change indicators and progress visualization:
```
// Income rate with trend arrow
<div className="flex items-center gap-1">
  <span className="text-lg font-bold font-mono text-on-surface">{gold.toLocaleString()}</span>
  <span className="text-xs text-primary font-medium flex items-center">
    <Icons.TrendingUp className="w-3 h-3 mr-0.5" />+{goldRate}/s
  </span>
</div>

// Progress bar for build timer
<div className="h-2 bg-surface-container-high rounded-full overflow-hidden">
  <Motion.div className="h-full bg-primary rounded-full"
    animate={{ width: `${(elapsed / duration) * 100}%` }}
    transition={{ duration: 0.3 }} />
</div>

// Milestone markers
<div className="relative h-2 bg-surface-container-high rounded-full">
  {milestones.map(m => (
    <div key={m.value} className="absolute top-1/2 -translate-y-1/2 w-1.5 h-4 bg-primary/40 rounded-full"
      style={{ left: `${(m.value / maxValue) * 100}%` }} />
  ))}
  <div className="h-full bg-primary rounded-full" style={{ width: `${(current / maxValue) * 100}%` }} />
</div>
```

## Animations

### Floating resource gain popup
```
function FloatingNumber({ value, color }: { value: string; color: string }) {
  return (
    <Motion.div initial={{ opacity: 1, y: 0 }} animate={{ opacity: 0, y: -40 }}
      transition={{ duration: 1.2 }} className={`absolute text-sm font-bold ${color} pointer-events-none`}>
      {value}
    </Motion.div>
  );
}
// Usage: on click/purchase, render <FloatingNumber value="+10" color="text-primary" /> at the event position
```

### Building placement bounce
```
<Motion.div initial={{ scale: 0, rotate: -10 }}
  animate={{ scale: 1, rotate: 0 }}
  transition={{ type: 'spring', stiffness: 400, damping: 15 }}>
  {buildingContent}
</Motion.div>
```

## Persistence

Use `useApp` with `$persist` state for save-game across sessions:
```
// In frontend.logic.state config (set by Creator):
// { "gold": { "initial": 100, "$persist": true }, "upgrades": { "initial": {}, "$persist": true } }

const gold = useApp(s => s.gold);
const setState = useApp(s => s.setState);
// On purchase: setState('gold', gold - cost);
```

For complex game state, serialize to a single JSON string:
```
const saveData = useApp(s => s.saveData);
const setState = useApp(s => s.setState);
// Save: setState('saveData', JSON.stringify(gameState));
// Load: const loaded = JSON.parse(saveData || '{}');
```

## State via useApp
- Store persistent data (gold, upgrades, wave progress) in `useApp` with `$persist`
- Use local `useState` / `useRef` for transient game state (animations, hover, timers)

## Anti-Patterns
- NEVER use `requestAnimationFrame` for tick-based simulations — use `setInterval` at 1s intervals
- NEVER show resource counts without rate-of-change context ("+N/s" indicator)
- NEVER make upgrade costs linear — use exponential scaling (`baseCost * Math.pow(multiplier, level)`)
- NEVER forget cleanup for intervals in useEffect return
- NEVER show a bare number for resources — include an icon and label
- NEVER skip hover preview for grid placement — users need visual feedback before clicking
- NEVER use `Math.random()` in the render path — compute in state/effect
