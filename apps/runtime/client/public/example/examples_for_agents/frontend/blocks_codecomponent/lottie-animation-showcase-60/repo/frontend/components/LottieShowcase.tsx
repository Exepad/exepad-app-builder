import {
  React,
  useAppState,
  useTheme,
  Slider,
  Switch,
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
  ButtonGroup,
  Badge,
  Icons,
  cn,
} from "@exepad/sdk";
import * as LottieModule from "@exepad/ext-lottie";
// esm.sh may nest the lottie-react default component under .default
// Merge so both the default component and any named exports are available
// The main default export is the Lottie React component (used as <LottiePlayer />)
const LottiePlayer: any = (LottieModule as any).default?.default || (LottieModule as any).default || LottieModule;

interface AnimationPreset {
  name: string;
  icon: string;
  data: object;
}

function makeShapeAnimation(color: string, type: string): object {
  const shapes: Record<string, any> = {
    loading: {
      v: "5.7.0", fr: 30, ip: 0, op: 60, w: 200, h: 200,
      layers: [{
        ty: 4, nm: "circle", sr: 1, ks: { o: { a: 0, k: 100 }, r: { a: 1, k: [{ i: { x: [0.5], y: [1] }, o: { x: [0.5], y: [0] }, t: 0, s: [0] }, { t: 60, s: [360] }] }, p: { a: 0, k: [100, 100] }, a: { a: 0, k: [0, 0] }, s: { a: 0, k: [100, 100] } },
        shapes: [{ ty: "el", d: 1, s: { a: 0, k: [60, 60] }, p: { a: 0, k: [0, 0] } }, { ty: "st", c: { a: 0, k: hexToRgb(color) }, o: { a: 0, k: 100 }, w: { a: 0, k: 6 }, lc: 2, d: [{ n: "d", nm: "dash", v: { a: 0, k: 80 } }, { n: "g", nm: "gap", v: { a: 0, k: 40 } }, { n: "o", nm: "offset", v: { a: 1, k: [{ t: 0, s: [0] }, { t: 60, s: [120] }] } }] }],
        ip: 0, op: 60, st: 0
      }]
    },
    success: {
      v: "5.7.0", fr: 30, ip: 0, op: 40, w: 200, h: 200,
      layers: [{
        ty: 4, nm: "check", sr: 1, ks: { o: { a: 0, k: 100 }, r: { a: 0, k: 0 }, p: { a: 0, k: [100, 100] }, a: { a: 0, k: [0, 0] }, s: { a: 1, k: [{ t: 0, s: [0, 0] }, { t: 15, s: [110, 110] }, { t: 20, s: [100, 100] }] } },
        shapes: [{ ty: "el", d: 1, s: { a: 0, k: [80, 80] }, p: { a: 0, k: [0, 0] } }, { ty: "fl", c: { a: 0, k: hexToRgb(color) }, o: { a: 0, k: 100 } }],
        ip: 0, op: 40, st: 0
      }]
    },
    error: {
      v: "5.7.0", fr: 30, ip: 0, op: 30, w: 200, h: 200,
      layers: [{
        ty: 4, nm: "x", sr: 1, ks: { o: { a: 0, k: 100 }, r: { a: 1, k: [{ t: 0, s: [0] }, { t: 10, s: [-10] }, { t: 20, s: [10] }, { t: 30, s: [0] }] }, p: { a: 0, k: [100, 100] }, a: { a: 0, k: [0, 0] }, s: { a: 0, k: [100, 100] } },
        shapes: [{ ty: "el", d: 1, s: { a: 0, k: [80, 80] }, p: { a: 0, k: [0, 0] } }, { ty: "fl", c: { a: 0, k: [0.94, 0.27, 0.27, 1] }, o: { a: 0, k: 100 } }],
        ip: 0, op: 30, st: 0
      }]
    },
    empty: {
      v: "5.7.0", fr: 30, ip: 0, op: 90, w: 200, h: 200,
      layers: [{
        ty: 4, nm: "box", sr: 1, ks: { o: { a: 0, k: 100 }, r: { a: 0, k: 0 }, p: { a: 0, k: [100, 100] }, a: { a: 0, k: [0, 0] }, s: { a: 0, k: [100, 100] } },
        shapes: [{ ty: "rc", d: 1, s: { a: 1, k: [{ t: 0, s: [60, 60] }, { t: 45, s: [70, 50] }, { t: 90, s: [60, 60] }] }, p: { a: 0, k: [0, 0] }, r: { a: 0, k: 8 } }, { ty: "st", c: { a: 0, k: hexToRgb(color) }, o: { a: 0, k: 60 }, w: { a: 0, k: 3 } }],
        ip: 0, op: 90, st: 0
      }]
    },
    confetti: {
      v: "5.7.0", fr: 30, ip: 0, op: 60, w: 200, h: 200,
      layers: Array.from({ length: 5 }, (_, i) => ({
        ty: 4, nm: `p${i}`, sr: 1,
        ks: { o: { a: 1, k: [{ t: 0, s: [100] }, { t: 60, s: [0] }] }, r: { a: 1, k: [{ t: 0, s: [0] }, { t: 60, s: [360 * (i % 2 === 0 ? 1 : -1)] }] }, p: { a: 1, k: [{ t: 0, s: [100, 100] }, { t: 60, s: [40 + i * 30, 20 + i * 15] }] }, a: { a: 0, k: [0, 0] }, s: { a: 0, k: [100, 100] } },
        shapes: [{ ty: "rc", d: 1, s: { a: 0, k: [8, 8] }, p: { a: 0, k: [0, 0] }, r: { a: 0, k: 2 } }, { ty: "fl", c: { a: 0, k: [[0.94, 0.27, 0.68, 1], [0.26, 0.63, 0.96, 1], [0.98, 0.73, 0.15, 1], hexToRgb(color), [0.3, 0.87, 0.56, 1]][i] }, o: { a: 0, k: 100 } }],
        ip: 0, op: 60, st: 0
      }))
    },
    rocket: {
      v: "5.7.0", fr: 30, ip: 0, op: 60, w: 200, h: 200,
      layers: [{
        ty: 4, nm: "rocket", sr: 1,
        ks: { o: { a: 0, k: 100 }, r: { a: 0, k: -45 }, p: { a: 1, k: [{ t: 0, s: [140, 140] }, { t: 60, s: [60, 60] }] }, a: { a: 0, k: [0, 0] }, s: { a: 0, k: [100, 100] } },
        shapes: [{ ty: "rc", d: 1, s: { a: 0, k: [16, 30] }, p: { a: 0, k: [0, 0] }, r: { a: 0, k: 6 } }, { ty: "fl", c: { a: 0, k: hexToRgb(color) }, o: { a: 0, k: 100 } }],
        ip: 0, op: 60, st: 0
      }]
    },
  };
  return shapes[type] || shapes.loading;
}

function hexToRgb(hex: string): number[] {
  const h = hex.replace("#", "");
  return [
    parseInt(h.substring(0, 2), 16) / 255,
    parseInt(h.substring(2, 4), 16) / 255,
    parseInt(h.substring(4, 6), 16) / 255,
    1,
  ];
}

const ANIMATION_PRESETS: AnimationPreset[] = [
  { name: "Loading", icon: "loader", data: makeShapeAnimation("#c026d3", "loading") },
  { name: "Success", icon: "check", data: makeShapeAnimation("#22c55e", "success") },
  { name: "Error", icon: "alert", data: makeShapeAnimation("#ef4444", "error") },
  { name: "Empty State", icon: "box", data: makeShapeAnimation("#c026d3", "empty") },
  { name: "Confetti", icon: "party", data: makeShapeAnimation("#c026d3", "confetti") },
  { name: "Rocket", icon: "rocket", data: makeShapeAnimation("#c026d3", "rocket") },
];

function LottieShowcase() {
  const theme = useTheme();
  const isDark = theme.resolvedTheme === "dark";
  const [selectedIndex, setSelectedIndex] = useAppState<number>("selectedAnimation", 0);
  const [speed, setSpeed] = useAppState<number>("speed", 1);
  const [loop, setLoop] = useAppState<boolean>("loop", true);
  const [direction, setDirection] = useAppState<number>("direction", 1);

  const selected = ANIMATION_PRESETS[selectedIndex];

  return (
    <div className="flex flex-col gap-4">
      {/* Grid of animation cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {ANIMATION_PRESETS.map((preset, index) => (
          <Card
            key={preset.name}
            className={cn(
              "cursor-pointer transition-all hover:shadow-md",
              selectedIndex === index && "ring-2 ring-primary"
            )}
            onClick={() => setSelectedIndex(index)}
          >
            <CardContent className="p-3">
              <div
                className={cn(
                  "w-full aspect-square rounded-lg flex items-center justify-center mb-2",
                  isDark ? "bg-zinc-800" : "bg-gray-50"
                )}
              >
                <LottiePlayer
                  animationData={preset.data}
                  loop={true}
                  style={{ width: 64, height: 64 }}
                />
              </div>
              <p className="text-xs font-medium text-center truncate">{preset.name}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Preview & Controls */}
      <div className="flex flex-col lg:flex-row gap-4">
        {/* Large preview */}
        <Card className="flex-1">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Icons.Play className="h-4 w-4" />
              Preview: {selected.name}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div
              className={cn(
                "w-full flex items-center justify-center rounded-lg",
                isDark ? "bg-zinc-900" : "bg-gray-50"
              )}
              style={{ height: 320 }}
            >
              <LottiePlayer
                animationData={selected.data}
                loop={loop}
                autoplay={true}
                style={{ width: 200, height: 200 }}
                direction={direction as 1 | -1}
                speed={speed}
              />
            </div>
          </CardContent>
        </Card>

        {/* Controls panel */}
        <Card className="w-full lg:w-72 shrink-0">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Playback Controls</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            {/* Animation select */}
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Animation</Label>
              <Select
                value={String(selectedIndex)}
                onValueChange={(val: string) => setSelectedIndex(Number(val))}
              >
                <SelectTrigger className="h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ANIMATION_PRESETS.map((preset, i) => (
                    <SelectItem key={i} value={String(i)}>
                      {preset.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Speed */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs text-muted-foreground">Speed</Label>
                <Badge variant="secondary" className="text-[10px]">
                  {speed.toFixed(1)}x
                </Badge>
              </div>
              <Slider
                value={[speed]}
                min={0.5}
                max={3}
                step={0.1}
                onValueChange={(val: number[]) => setSpeed(val[0])}
              />
            </div>

            {/* Loop */}
            <div className="flex items-center justify-between">
              <Label className="text-xs">Loop</Label>
              <Switch
                checked={loop}
                onCheckedChange={(checked: boolean) => setLoop(checked)}
              />
            </div>

            {/* Direction */}
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Direction</Label>
              <ButtonGroup className="w-full">
                <Button
                  variant={direction === 1 ? "default" : "outline"}
                  size="sm"
                  className="flex-1"
                  onClick={() => setDirection(1)}
                >
                  <Icons.ArrowRight className="h-3.5 w-3.5 mr-1" />
                  Forward
                </Button>
                <Button
                  variant={direction === -1 ? "default" : "outline"}
                  size="sm"
                  className="flex-1"
                  onClick={() => setDirection(-1)}
                >
                  <Icons.ArrowLeft className="h-3.5 w-3.5 mr-1" />
                  Reverse
                </Button>
              </ButtonGroup>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default LottieShowcase;
