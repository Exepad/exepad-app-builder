import {
  React,
  useAppState,
  useTheme,
  Slider,
  Label,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  Button,
  Badge,
  Icons,
  cn,
} from "@exepad/sdk";

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
}

interface PresetConfig {
  name: string;
  count: number;
  speed: number;
  lifetime: number;
  size: number;
  spread: number;
  color: string;
}

const PRESETS: Record<string, PresetConfig> = {
  rain: { name: "Rain", count: 120, speed: 8, lifetime: 60, size: 2, spread: 180, color: "#60a5fa" },
  snow: { name: "Snow", count: 80, speed: 2, lifetime: 120, size: 4, spread: 160, color: "#e2e8f0" },
  fire: { name: "Fire", count: 100, speed: 5, lifetime: 40, size: 6, spread: 30, color: "#f97316" },
  sparkle: { name: "Sparkle", count: 50, speed: 3, lifetime: 50, size: 3, spread: 360, color: "#fbbf24" },
  confetti: { name: "Confetti", count: 60, speed: 4, lifetime: 80, size: 5, spread: 120, color: "#ec4899" },
};

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function ParticleStudio() {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";

  const [preset, setPreset] = useAppState<string>("particlePreset", "fire");
  const [particleCount, setParticleCount] = useAppState<number>("particleCount", 100);
  const [speed, setSpeed] = useAppState<number>("particleSpeed", 5);
  const [lifetime, setLifetime] = useAppState<number>("particleLifetime", 40);
  const [size, setSize] = useAppState<number>("particleSize", 6);
  const [spread, setSpread] = useAppState<number>("particleSpread", 30);
  const [color, setColor] = useAppState<string>("particleColor", "#f97316");
  const [running, setRunning] = useAppState<boolean>("particleRunning", true);

  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const particlesRef = React.useRef<Particle[]>([]);
  const fpsRef = React.useRef<number>(0);
  const [fps, setFps] = React.useState(0);
  const frameCountRef = React.useRef(0);
  const lastFpsTimeRef = React.useRef(Date.now());
  const animRef = React.useRef<number>(0);

  const currentCount = particleCount ?? 100;
  const currentSpeed = speed ?? 5;
  const currentLifetime = lifetime ?? 40;
  const currentSize = size ?? 6;
  const currentSpread = spread ?? 30;
  const currentColor = color ?? "#f97316";
  const isRunning = running ?? true;

  const applyPreset = (key: string) => {
    const p = PRESETS[key];
    if (p) {
      setPreset(key);
      setParticleCount(p.count);
      setSpeed(p.speed);
      setLifetime(p.lifetime);
      setSize(p.size);
      setSpread(p.spread);
      setColor(p.color);
    }
  };

  // Set canvas size
  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = 600;
    canvas.height = 400;
  }, []);

  // Animation loop using Canvas2D
  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const w = 600;
    const h = 400;

    const animate = () => {
      if (!isRunning) {
        animRef.current = requestAnimationFrame(animate);
        return;
      }

      const particles = particlesRef.current;

      // Spawn new particles
      while (particles.length < currentCount) {
        const angle = ((Math.random() - 0.5) * currentSpread * Math.PI) / 180;
        particles.push({
          x: w / 2 + (Math.random() - 0.5) * 100,
          y: h / 2,
          vx: Math.sin(angle) * currentSpeed * (0.5 + Math.random()),
          vy: -Math.cos(angle) * currentSpeed * (0.5 + Math.random()),
          life: currentLifetime,
          maxLife: currentLifetime,
          size: currentSize * (0.5 + Math.random() * 0.5),
          color: currentColor,
        });
      }

      // Trim excess
      while (particles.length > currentCount) {
        particles.pop();
      }

      // Clear canvas
      ctx.fillStyle = isDark ? "#171717" : "#f5f5f4";
      ctx.fillRect(0, 0, w, h);

      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.1; // gravity
        p.life--;

        if (p.life <= 0 || p.x < 0 || p.x > w || p.y < 0 || p.y > h) {
          const angle = ((Math.random() - 0.5) * currentSpread * Math.PI) / 180;
          p.x = w / 2 + (Math.random() - 0.5) * 100;
          p.y = h / 2;
          p.vx = Math.sin(angle) * currentSpeed * (0.5 + Math.random());
          p.vy = -Math.cos(angle) * currentSpeed * (0.5 + Math.random());
          p.life = currentLifetime;
          p.maxLife = currentLifetime;
          p.size = currentSize * (0.5 + Math.random() * 0.5);
          p.color = currentColor;
          continue;
        }

        const alpha = p.life / p.maxLife;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fillStyle = hexToRgba(p.color, alpha);
        ctx.fill();
      }

      // FPS counter
      frameCountRef.current++;
      const now = Date.now();
      if (now - lastFpsTimeRef.current >= 1000) {
        fpsRef.current = frameCountRef.current;
        setFps(frameCountRef.current);
        frameCountRef.current = 0;
        lastFpsTimeRef.current = now;
      }

      animRef.current = requestAnimationFrame(animate);
    };

    animRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animRef.current);
  }, [isRunning, currentCount, currentSpeed, currentLifetime, currentSize, currentSpread, currentColor, isDark]);

  return (
    <div className="flex flex-col lg:flex-row gap-4">
      {/* Canvas */}
      <Card className="flex-1">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Icons.Sparkles className="h-4 w-4" />
              Particle Canvas
            </CardTitle>
            <Badge variant="secondary" className="text-xs">
              {fps} FPS
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <div
            className="w-full rounded-lg overflow-hidden border"
            style={{ height: 400 }}
          >
            <canvas
              ref={canvasRef}
              style={{ width: "100%", height: "100%" }}
            />
          </div>
          <div className="flex gap-2 mt-3">
            <Button
              size="sm"
              variant={isRunning ? "destructive" : "default"}
              onClick={() => setRunning(!isRunning)}
            >
              {isRunning ? (
                <>
                  <Icons.Pause className="h-4 w-4 mr-1" />
                  Stop
                </>
              ) : (
                <>
                  <Icons.Play className="h-4 w-4 mr-1" />
                  Start
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Controls */}
      <Card className="w-full lg:w-80 shrink-0">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Emitter Controls</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* Preset */}
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Preset Effect</Label>
            <Select
              value={preset ?? "fire"}
              onValueChange={(val: string) => applyPreset(val)}
            >
              <SelectTrigger className="h-8">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(PRESETS).map(([key, p]) => (
                  <SelectItem key={key} value={key}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Particle Count */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs text-muted-foreground">Particle Count</Label>
              <Badge variant="secondary" className="text-[10px]">{currentCount}</Badge>
            </div>
            <Slider
              value={[currentCount]}
              min={10}
              max={200}
              step={5}
              onValueChange={(val: number[]) => setParticleCount(val[0])}
            />
          </div>

          {/* Speed */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs text-muted-foreground">Speed</Label>
              <Badge variant="secondary" className="text-[10px]">{currentSpeed}</Badge>
            </div>
            <Slider
              value={[currentSpeed]}
              min={1}
              max={15}
              step={0.5}
              onValueChange={(val: number[]) => setSpeed(val[0])}
            />
          </div>

          {/* Lifetime */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs text-muted-foreground">Lifetime</Label>
              <Badge variant="secondary" className="text-[10px]">{currentLifetime}f</Badge>
            </div>
            <Slider
              value={[currentLifetime]}
              min={10}
              max={200}
              step={5}
              onValueChange={(val: number[]) => setLifetime(val[0])}
            />
          </div>

          {/* Size */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs text-muted-foreground">Size</Label>
              <Badge variant="secondary" className="text-[10px]">{currentSize}px</Badge>
            </div>
            <Slider
              value={[currentSize]}
              min={1}
              max={12}
              step={0.5}
              onValueChange={(val: number[]) => setSize(val[0])}
            />
          </div>

          {/* Spread */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs text-muted-foreground">Spread Angle</Label>
              <Badge variant="secondary" className="text-[10px]">{currentSpread}deg</Badge>
            </div>
            <Slider
              value={[currentSpread]}
              min={5}
              max={360}
              step={5}
              onValueChange={(val: number[]) => setSpread(val[0])}
            />
          </div>

          {/* Color */}
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Particle Color</Label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={currentColor}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setColor(e.target.value)}
                className="w-8 h-8 rounded border cursor-pointer"
              />
              <span className="text-xs text-muted-foreground font-mono">{currentColor}</span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default ParticleStudio;
