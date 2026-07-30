# Visual rendering for game-arcade

Sprite generation, background rendering, particle systems, and screen
effects. Load only when the game's plan calls for visual polish beyond
basic Canvas shapes — most arcade games benefit from at least the sprite
or particle helpers below.

## SVG Sprite Rendering

Generate rich SVG markup strings for each game entity. Convert to Image objects
at init time, then draw them on Canvas each frame. This produces much richer
visuals than manual `ctx.lineTo()` wireframes.

### Creating sprites
```
function loadSprite(svg: string): Promise<HTMLImageElement> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  });
}
```

### Example SVG sprites (adapt colors/shapes to the game's theme)
```
// Ship — triangular with radial gradient and glow
const SHIP_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48">
  <defs>
    <radialGradient id="sg" cx="50%" cy="40%">
      <stop offset="0%" stop-color="#67e8f9"/>
      <stop offset="100%" stop-color="#0891b2" stop-opacity="0.2"/>
    </radialGradient>
    <filter id="glow"><feGaussianBlur stdDeviation="2" result="blur"/>
      <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>
  <polygon points="24,4 6,44 24,34 42,44" fill="url(#sg)" stroke="#22d3ee"
    stroke-width="1.5" stroke-linejoin="round" filter="url(#glow)"/>
</svg>`;

// Asteroid — irregular polygon with rocky gradient
const ASTEROID_SVG = (size: number) => `<svg xmlns="http://www.w3.org/2000/svg"
  width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs>
    <radialGradient id="ag" cx="40%" cy="35%">
      <stop offset="0%" stop-color="#94a3b8"/><stop offset="100%" stop-color="#334155"/>
    </radialGradient>
  </defs>
  <polygon points="${generateRockPoints(size)}" fill="url(#ag)" stroke="#cbd5e1"
    stroke-width="1.5" stroke-linejoin="round"/>
</svg>`;

// Projectile — small glowing bolt
const BOLT_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 12 12">
  <defs><radialGradient id="bg"><stop offset="0%" stop-color="#fff"/>
    <stop offset="60%" stop-color="#f43f5e"/><stop offset="100%" stop-color="#f43f5e" stop-opacity="0"/>
  </radialGradient></defs>
  <circle cx="6" cy="6" r="5" fill="url(#bg)"/>
</svg>`;
```

### Loading sprites at init
```
const sprites = useRef<Record<string, HTMLImageElement>>({});

useEffect(() => {
  Promise.all([
    loadSprite(SHIP_SVG).then(img => sprites.current.ship = img),
    loadSprite(ASTEROID_SVG(80)).then(img => sprites.current.asteroidL = img),
    loadSprite(ASTEROID_SVG(50)).then(img => sprites.current.asteroidM = img),
    loadSprite(ASTEROID_SVG(30)).then(img => sprites.current.asteroidS = img),
    loadSprite(BOLT_SVG).then(img => sprites.current.bolt = img),
  ]).then(() => { /* sprites ready, can start game */ });
}, []);
```

### Drawing with rotation
```
function drawSprite(ctx: CanvasRenderingContext2D, img: HTMLImageElement,
  x: number, y: number, w: number, h: number, angle: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.drawImage(img, -w / 2, -h / 2, w, h);
  ctx.restore();
}
```

## Background Rendering

### Star field with parallax layers
```
interface Star { x: number; y: number; r: number; brightness: number; speed: number; }

function createStars(count: number, w: number, h: number, speed: number): Star[] {
  return Array.from({ length: count }, () => ({
    x: Math.random() * w, y: Math.random() * h,
    r: Math.random() * 1.5 + 0.5,
    brightness: Math.random() * 0.6 + 0.4,
    speed,
  }));
}

// Create 3 layers in init: slow (0.2), medium (0.5), fast (1.0)
// In draw(): iterate stars, draw as small filled arcs with alpha = brightness
// In update(): star.y += star.speed * scrollSpeed * dt; wrap around canvas height
```

### Cached gradient background (render once, reuse each frame)
```
// In draw(), only compute the gradient on the first frame:
const bgRef = useRef<ImageData | null>(null);
// First frame: draw gradient to canvas, store as ImageData
if (!bgRef.current) {
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, '#0a0a2e');
  grad.addColorStop(0.5, '#0f172a');
  grad.addColorStop(1, '#020617');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
  bgRef.current = ctx.getImageData(0, 0, w, h);
} else {
  ctx.putImageData(bgRef.current, 0, 0);
}
```

## Particle System

```
interface Particle {
  x: number; y: number; vx: number; vy: number;
  life: number; maxLife: number; size: number; color: string;
}

const particles = useRef<Particle[]>([]);
const MAX_PARTICLES = 150;

function spawnExplosion(x: number, y: number, color: string, count = 20) {
  for (let i = 0; i < count && particles.current.length < MAX_PARTICLES; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 50 + Math.random() * 150;
    particles.current.push({
      x, y,
      vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
      life: 0.4 + Math.random() * 0.6, maxLife: 1,
      size: 1 + Math.random() * 3, color,
    });
  }
}

// In update(dt): for each particle, move by velocity * dt, subtract dt from life.
//   Filter out dead particles: particles.current = particles.current.filter(p => p.life > 0);

// In draw(): set globalCompositeOperation = 'lighter' before drawing particles.
//   For each particle: ctx.globalAlpha = p.life / p.maxLife;
//   ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2); ctx.fill();
//   Reset: ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
```

### Thrust trail
Continuously spawn 1-2 particles behind the ship when thrusting:
```
if (ship.thrusting) {
  const ex = ship.x - Math.cos(ship.angle) * ship.radius;
  const ey = ship.y - Math.sin(ship.angle) * ship.radius;
  spawnExplosion(ex, ey, thrustColor, 2);
}
```

## Screen Effects

### Screen shake
```
const shakeRef = useRef(0);
// On collision: shakeRef.current = 8; (or 12 for heavy impacts)
// In draw() — ALWAYS save/restore to keep canvas state clean:
ctx.save();
if (shakeRef.current > 0) {
  ctx.translate(
    (Math.random() - 0.5) * shakeRef.current,
    (Math.random() - 0.5) * shakeRef.current
  );
  shakeRef.current *= 0.9; // decay
  if (shakeRef.current < 0.5) shakeRef.current = 0;
}
// ... draw everything ...
ctx.restore();
```

### Glow/bloom (for entities drawn with Canvas primitives)
```
ctx.shadowBlur = 15;
ctx.shadowColor = glowColor;
// Draw shape (the shadow creates the glow)
ctx.shadowBlur = 0; // reset after
```

### Entity trail (ring buffer)
```
interface TrailPoint { x: number; y: number; }
const trail = useRef<TrailPoint[]>([]);
// Push current position each frame (cap length to 15-20)
// Draw: iterate trail, ctx.globalAlpha = i / trail.length; draw small circle
```
