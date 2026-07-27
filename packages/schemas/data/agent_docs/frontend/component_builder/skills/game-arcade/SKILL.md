---
name: game-arcade
description: "Canvas arcade / action games with SVG sprites, particle effects, physics, visual polish via the @exepad/sdk game helpers (useGameLoop, useKeys, useAudio, aabb, clamp, seededRandom, <Sprite>, <Joystick>). Load for action / shooter / runner / racing / classic-arcade games. Keywords: arcade, action, shooter, physics, space, platformer, racing, particles, snake, breakout, pong, tetris, asteroids, invaders, frogger, runner, flappy, pac-man."
metadata:
  kind: domain
---
# Skill: Arcade & Action Games (Canvas + SVG Sprites)

For real-time action games rendered on HTML5 Canvas: shooters, platformers, racing,
Snake, Breakout, Tetris, Asteroids, Pac-Man, Pong, Frogger, endless runners, etc.

## SDK Game Helpers (PREFER THESE)

The platform SDK exports a `game/` namespace with the boilerplate every
arcade game otherwise re-implements. **Use them instead of writing the
loop / keyboard / audio / mobile-pad code from scratch.** Each helper is
~10-30 lines lighter than the inline version and avoids the bug classes
that have shipped in past games (forgotten RAF cleanup, stuck-key after
alt-tab, race condition between `<img>` load and `drawImage`).

```tsx
import {
  useGameLoop,    // RAF loop with delta time + auto cleanup
  useKeys,        // {left,right,up,down,jump,action} ref — read in the loop
  useAudio,       // SFX pool — useAudio({jump:'/x.mp3'}); audio.play('jump')
  aabb,           // axis-aligned box collision: aabb(player, goomba)
  clamp,          // clamp(value, min, max)
  lerp,           // linear interpolate(a, b, t)
  seededRandom,   // deterministic RNG: const rng = seededRandom(42); rng()
  Sprite,         // <Sprite svg={MARIO_SVG} x y rotation /> — no img/onload race
  Joystick,       // mobile <Joystick onDirection={} onJump={} />
} from "@exepad/sdk";
```

Canonical platformer skeleton — replaces ~80 LOC of boilerplate. Note:
entity boxes use `{x, y, width, height}` (the SDK's `Box` shape) so they
compose with `aabb()`; canvas colors are resolved via `getComputedStyle`
because Canvas 2D does not understand `var(--…)`; HUD numbers are mirrored
into `useState` because `ref.current` mutations don't re-render.

```tsx
import { aabb, clamp, useGameLoop, useKeys, useApp } from "@exepad/sdk";
const { useRef, useState, useEffect } = React;

interface Player extends Box { vx: number; vy: number; }

const keys = useKeys();
const stateRef = useRef<Player>({ x: 60, y: 320, width: 32, height: 32, vx: 0, vy: 0 });

// HUD mirror — refs don't trigger re-render; copy into state every ~6 frames.
const [hud, setHud] = useState({ score: 0, coins: 0 });
const hudTickRef = useRef(0);

// Theme colors — resolve once on mount; canvas can't read CSS variables.
const colorsRef = useRef<Record<string, string>>({});
useEffect(() => {
  const styles = getComputedStyle(canvasRef.current!);
  colorsRef.current = {
    primary: styles.getPropertyValue('--color-primary').trim(),
    secondary: styles.getPropertyValue('--color-secondary').trim(),
  };
}, []);

useGameLoop((dt) => {
  const s = stateRef.current;
  if (keys.current.left) s.vx = -200;
  else if (keys.current.right) s.vx = 200;
  else s.vx = 0;
  if (keys.current.jump && s.y >= 380) s.vy = -450;
  s.vy += 1500 * dt;
  s.x += s.vx * dt;
  s.y = clamp(s.y + s.vy * dt, 0, 380);

  // Collision: pass the entity to aabb() — it expects {x,y,width,height}.
  for (const b of blocks.current) if (aabb(s, b)) { /* resolve */ }

  // Mirror HUD ~10 Hz (every 6 frames at 60Hz).
  if (++hudTickRef.current >= 6) { hudTickRef.current = 0; setHud({ score: scoreRef.current, coins: coinsRef.current }); }

  // ctx.fillStyle = colorsRef.current.primary;  ← never `var(--color-primary)`
  // ...draw to canvas...
});
```

Use the SDK helpers UNLESS you need behaviour outside what they expose
(rare). Don't reinvent `requestAnimationFrame` cleanup, `keydown`/`keyup`
listeners, or `Audio()` pooling in your own component code.

## Walled Garden Constraints
- No npm packages — all game logic must be self-contained
- Use Canvas 2D API for rendering, SVG strings for entity sprites
- Use `useGameLoop` (preferred) — or `requestAnimationFrame` with cleanup if you have a reason
- NEVER use `setInterval` for game loops

## Common Pitfalls

### Untyped empty arrays infer `never[]` and break

NEVER write `useRef([])` or `useState([])` without an explicit generic.
TypeScript infers `never[]` and any `.push(...)` fails with
`tsc.2345: Argument of type X is not assignable to parameter of type 'never'`.

| ✗ Bad | ✓ Good |
|---|---|
| `const blocks = useRef([]);` | `const blocks = useRef<Block[]>([]);` |
| `const [enemies, setEnemies] = useState([]);` | `const [enemies, setEnemies] = useState<Enemy[]>([]);` |

Always declare an interface for game entities and use the generic. See
"Platformer Entities" below for the canonical pattern; the same shape
applies to any list of game objects (projectiles, particles, pickups,
power-ups, NPCs).

## Canvas Setup

CRITICAL: Canvas bitmap dimensions default to 300x150 (HTML spec). You MUST resize
the canvas to match its container BEFORE any game logic reads canvas.width/height.
Use a SEPARATE mount-time useEffect for resizing — do NOT put resize inside the
game loop effect, because startGame() may read canvas dimensions before that effect fires.

```
const canvasRef = useRef<HTMLCanvasElement>(null);
const containerRef = useRef<HTMLDivElement>(null);

// STEP 1: Resize canvas on mount (runs BEFORE game loop)
useEffect(() => {
  const canvas = canvasRef.current;
  const container = containerRef.current;
  if (!canvas || !container) return;
  const resize = () => {
    canvas.width = container.clientWidth;
    canvas.height = container.clientHeight;
  };
  resize();
  window.addEventListener('resize', resize);
  return () => window.removeEventListener('resize', resize);
}, []);

// STEP 2: Game loop (separate effect, depends on gameState)
useEffect(() => {
  if (gameState !== 'playing') return;
  const canvas = canvasRef.current;
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  let lastTime = 0;
  let animId: number;
  const loop = (time: number) => {
    const dt = lastTime ? (time - lastTime) / 1000 : 0.016;
    lastTime = time;
    update(dt);
    draw(ctx, canvas.width, canvas.height);
    animId = requestAnimationFrame(loop);
  };
  animId = requestAnimationFrame(loop);

  return () => cancelAnimationFrame(animId);
}, [gameState]);
```

Canvas container JSX: `<div ref={containerRef} className="relative w-full h-screen"><canvas ref={canvasRef} className="block w-full h-full" /></div>`

## Canvas Colors from Theme

Canvas 2D context does NOT understand CSS `var()`. **Never write
`ctx.fillStyle = "var(--color-primary)"`** — Canvas treats it as an
invalid color and silently falls back to black, so your blocks/enemies/
player render invisible against a black background. Resolve theme
tokens once on mount and store them in a ref:

```
const colorsRef = useRef<Record<string, string>>({});
useEffect(() => {
  const styles = getComputedStyle(canvasRef.current!);
  colorsRef.current = {
    primary:   styles.getPropertyValue('--color-primary').trim(),
    secondary: styles.getPropertyValue('--color-secondary').trim(),
    error:     styles.getPropertyValue('--color-error').trim(),
  };
}, []);

// In the game loop / draw fn:
ctx.fillStyle = colorsRef.current.primary;  // resolved hex/rgb
```

## HUD reactivity from refs

Game state lives in `useRef` to avoid per-frame re-renders. But that
means `{playerRef.current.score}` in JSX **never updates** — refs don't
trigger re-render. Mirror the values you need on screen into `useState`
on a slow tick (every ~6 frames at 60Hz = ~10 Hz, plenty for a HUD):

```
const [hud, setHud] = useState({ score: 0, coins: 0, time: 60 });
const hudTickRef = useRef(0);

useGameLoop((dt) => {
  // ...physics mutates playerRef.current.score / coins...

  if (++hudTickRef.current >= 6) {
    hudTickRef.current = 0;
    const p = playerRef.current;
    setHud({ score: p.score, coins: p.coins, time: timeLeftRef.current });
  }
});

return <div>Score: {hud.score} · Coins: {hud.coins}</div>;
```

**NEVER bind `{ref.current.foo}` to JSX directly** — the rendered text
will freeze at its initial value for the lifetime of the component.

## Timers in `useGameLoop`

For countdowns, spawn cadences, and invincibility windows, accumulate
`dt` and tick when ≥ 1 second has elapsed. **NEVER use `Math.random() <
0.016`** as a "once per second" heuristic — it's frame-rate dependent,
non-deterministic, and burns 1.6% of frames on a setState that nobody
asked for.

```
const timeAccRef = useRef(0);
const [timeLeft, setTimeLeft] = useState(60);

useGameLoop((dt) => {
  timeAccRef.current += dt;
  while (timeAccRef.current >= 1) {
    timeAccRef.current -= 1;
    setTimeLeft(prev => Math.max(0, prev - 1));
  }

  // Per-entity timers — decrement by dt directly:
  player.invincible = Math.max(0, player.invincible - dt);
});
```

## Visual rendering helpers (sprites, background, particles, effects)

For SVG sprite generation, parallax/star-field/gradient backgrounds, particle systems (explosions, thrust trails), and screen effects (shake, glow, motion trails), call:

    load_skill_resource(skill_name='game-arcade', file_path='references/visual-effects.md')

Load it whenever the game's plan calls for visual polish beyond bare Canvas shapes — most arcade games benefit from at least sprites or particles.

## Platformer Entities (TYPED)

For platformer games (Mario-style, Sonic-style, Donkey-Kong-style),
declare typed interfaces for level entities and store them in typed
refs. The arrays are mutated in-place by the game loop, so `useRef` is
preferred over `useState` (no re-render churn per frame).

**Field-name convention: use `{x, y, width, height}` — NOT `{x, y, w, h}`.**
Entities should `extends Box` (the SDK's collision shape) so `aabb()`
type-checks. `aabb({w, h})` silently produces `false` every call because
the helper reads `.width` / `.height` — your collisions never fire.

```
import { aabb, Box } from "@exepad/sdk";

interface Block extends Box {
  type: 'ground' | 'pipe' | 'brick' | 'question';
}
interface Enemy extends Box {
  vx: number;
  type: 'goomba' | 'koopa';
  alive: boolean;
}
interface Pickup extends Box {
  type: 'coin' | 'mushroom' | 'star';
  collected: boolean;
}

const blocks = useRef<Block[]>([]);
const enemies = useRef<Enemy[]>([]);
const pickups = useRef<Pickup[]>([]);

blocks.current.push({ x: 0, y: 240, width: 32, height: 32, type: 'ground' });
enemies.current.push({ x: 200, y: 220, width: 28, height: 28, vx: -30, type: 'goomba', alive: true });
```

Tile-collision: call SDK `aabb()` against `blocks.current` each frame.
Spawn enemies at level start by reading a level data array; despawn
(filter out) when offscreen or `alive === false`.

```
import { aabb } from "@exepad/sdk";

// Player vs block — pass the entities to aabb(); both must be Box-shaped.
for (const b of blocks.current) {
  if (aabb(player, b)) {
    // resolve collision (set vy = 0 on landing, snap player.y, etc.)
  }
}
```

**Don't write the manual `player.x < b.x + b.w && …` unroll** — it's
verbose and easy to get wrong (off-by-one on the `<` vs `<=`, or the
wrong axis order). Use `aabb()`.

Player physics: gravity (`vy += 980 * dt`), jump (`vy = -380` on key
press while grounded), horizontal acceleration with friction. Camera
follows player.x; render only blocks within the visible window.

## Entity Sizing
- Ship: 36-48px sprite
- Large asteroids: 60-80px, Medium: 40-50px, Small: 25-35px
- Projectiles: 8-12px sprite with glow trail
- All entities must be clearly visible at canvas scale

## Game Loop Best Practices

### Frame-rate independent physics
```
// WRONG — speed varies with frame rate:
velocity *= 0.99;
// CORRECT — consistent across all frame rates:
velocity *= Math.pow(0.99, dt * 60);
```

### Safe collection iteration
NEVER use `splice()` inside `forEach` or `for...of` — it skips/double-processes elements.
```
// WRONG:
asteroids.forEach((a, i) => { if (hit) asteroids.splice(i, 1); });
// CORRECT — filter to new array:
asteroids.current = asteroids.current.filter(a => !a.destroyed);
// Or collect results first, apply after:
const toRemove = new Set<number>();
asteroids.forEach((a, i) => { if (hit) toRemove.add(i); });
asteroids.current = asteroids.current.filter((_, i) => !toRemove.has(i));
```

### Respawn invincibility
After losing a life, grant 2-3 seconds of invincibility with blinking visual:
```
const invincibleUntil = useRef(0);
// On death: invincibleUntil.current = performance.now() + 2000;
// In update: skip ship-vs-enemy collision if performance.now() < invincibleUntil.current
// In draw: if invincible, draw ship at 50% alpha every other frame (blink effect)
```

### Fullscreen canvas
The game canvas MUST fill the viewport: use `h-screen` or `h-[100dvh]` on the container,
not partial heights like `85vh`.

### FPS display
If showing FPS, calculate it from frame timestamps — NEVER hardcode "60 FPS":
```
frameCount++; if (time - lastFpsTime > 1000) { fps = frameCount; frameCount = 0; lastFpsTime = time; }
```

## Keyboard Input
Prefer the SDK `useKeys()` helper — it tracks key state AND suppresses
default scrolling for you. If you hand-roll a listener, you MUST call
`e.preventDefault()` for the control keys (Arrows + Space), or the page
scrolls every time the player jumps or moves:
```
const GAME_KEYS = new Set(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Space']);
const keys = useRef(new Set<string>());
useEffect(() => {
  const down = (e: KeyboardEvent) => {
    keys.current.add(e.code);
    if (GAME_KEYS.has(e.code)) e.preventDefault(); // stop arrow/space page scroll
  };
  const up = (e: KeyboardEvent) => keys.current.delete(e.code);
  window.addEventListener('keydown', down);
  window.addEventListener('keyup', up);
  return () => {
    window.removeEventListener('keydown', down);
    window.removeEventListener('keyup', up);
  };
}, []);
// In update: if (keys.current.has('ArrowLeft')) { ... }
```

## State via useApp
- Store game score, high score, level, and status in `useApp(s => s.key)` if other components need it
- Use local `useState` / `useRef` for game-internal state (positions, velocities, entities)

## Anti-Patterns
- NEVER draw entities as plain wireframe outlines only — use SVG sprites or gradient-filled shapes
- NEVER use `setInterval` for the game loop — use `requestAnimationFrame`
- NEVER use `splice()` inside `forEach` or `for...of` — use `filter()` for a new array
- NEVER hardcode "60 FPS" text — calculate from frame timestamps or omit
- NEVER set game canvas to partial height (e.g., `85vh`) — use `h-screen`
- NEVER use `Math.random()` in the render path — compute in state/effect
- NEVER assign `var(--color-*)` directly to `ctx.fillStyle`/`ctx.strokeStyle` — resolve via `getComputedStyle()` first (renders invisible — Canvas falls back to black)
- NEVER define entity boxes with `{x, y, w, h}` — use `{x, y, width, height}` (extend `Box`). `aabb()` reads `.width` / `.height`; the short form makes every collision return `false`
- NEVER bind `{ref.current.foo}` to JSX for live HUD numbers — refs don't re-render. Mirror into `useState` on a 6-frame tick
- NEVER tick countdowns with `Math.random() < 0.016` — accumulate `dt` and `while (acc >= 1) { acc -= 1; tick(); }`
- NEVER forget cleanup for event listeners and animation frames
- NEVER read `canvas.width`/`canvas.height` before resizing — HTML defaults are 300x150, which breaks spawn logic. Resize the canvas in a separate mount-time `useEffect`, not inside the game loop effect
- NEVER use unbounded `while`/`do-while` loops for spawn placement — always add a max iteration safety valve:
```
// WRONG — infinite loop if canvas is too small for the safe distance:
do { x = Math.random() * w; y = Math.random() * h; }
while (Math.hypot(x - cx, y - cy) < 200);

// CORRECT — bail out after N attempts:
let attempts = 0;
do { x = Math.random() * w; y = Math.random() * h; attempts++; }
while (Math.hypot(x - cx, y - cy) < safeDistance && attempts < 50);
```


## Canonical implementations (load on demand)
- `load_skill_resource(skill_name='game-arcade', file_path='assets/example_1.tsx')` — truncated source from the `particle-effects-studio-53` reference block.

Read these only when the building plan calls for a layout / wiring pattern that closely matches one of the reference blocks. Don't load all examples up front.
