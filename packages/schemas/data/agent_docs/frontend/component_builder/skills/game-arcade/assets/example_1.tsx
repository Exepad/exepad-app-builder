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
// ... (truncated)
