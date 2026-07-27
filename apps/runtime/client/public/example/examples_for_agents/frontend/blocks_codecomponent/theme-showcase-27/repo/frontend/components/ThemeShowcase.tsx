import {
  React,
  useTheme,
  useAppState,
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  Badge,
  Button,
  Input,
  Switch,
  Separator,
  Label,
  Icons,
  cn,
} from "@exepad/sdk";

interface ColorSwatch {
  name: string;
  cssVar: string;
  hex: string;
}

const LIGHT_PALETTE: ColorSwatch[] = [
  { name: "Primary", cssVar: "--primary", hex: "#2563eb" },
  { name: "Primary FG", cssVar: "--primary-foreground", hex: "#ffffff" },
  { name: "Secondary", cssVar: "--secondary", hex: "#f1f5f9" },
  { name: "Secondary FG", cssVar: "--secondary-foreground", hex: "#0f172a" },
  { name: "Accent", cssVar: "--accent", hex: "#f1f5f9" },
  { name: "Background", cssVar: "--background", hex: "#ffffff" },
  { name: "Foreground", cssVar: "--foreground", hex: "#0f172a" },
  { name: "Muted", cssVar: "--muted", hex: "#f1f5f9" },
  { name: "Muted FG", cssVar: "--muted-foreground", hex: "#64748b" },
  { name: "Destructive", cssVar: "--destructive", hex: "#ef4444" },
  { name: "Border", cssVar: "--border", hex: "#e2e8f0" },
  { name: "Ring", cssVar: "--ring", hex: "#2563eb" },
];

const DARK_PALETTE: ColorSwatch[] = [
  { name: "Primary", cssVar: "--primary", hex: "#60a5fa" },
  { name: "Primary FG", cssVar: "--primary-foreground", hex: "#0f172a" },
  { name: "Secondary", cssVar: "--secondary", hex: "#1e293b" },
  { name: "Secondary FG", cssVar: "--secondary-foreground", hex: "#f8fafc" },
  { name: "Accent", cssVar: "--accent", hex: "#1e293b" },
  { name: "Background", cssVar: "--background", hex: "#0f172a" },
  { name: "Foreground", cssVar: "--foreground", hex: "#f8fafc" },
  { name: "Muted", cssVar: "--muted", hex: "#1e293b" },
  { name: "Muted FG", cssVar: "--muted-foreground", hex: "#94a3b8" },
  { name: "Destructive", cssVar: "--destructive", hex: "#7f1d1d" },
  { name: "Border", cssVar: "--border", hex: "#1e293b" },
  { name: "Ring", cssVar: "--ring", hex: "#3b82f6" },
];

const BUTTON_VARIANTS = [
  "default",
  "secondary",
  "outline",
  "ghost",
  "destructive",
  "link",
] as const;

const BORDER_RADII = ["0px", "4px", "8px", "12px", "16px", "9999px"];

function ThemeShowcase() {
  const theme = useTheme();
  const [showDark, setShowDark] = useAppState<boolean>("showDarkPalette", false);

  const palette = showDark ? DARK_PALETTE : LIGHT_PALETTE;
  const paletteLabel = showDark ? "Dark" : "Light";

  return (
    <div className="space-y-8">
      {/* Mode Indicator */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Icons.Palette className="h-5 w-5" />
                Theme Inspector
              </CardTitle>
              <CardDescription>
                Explore the active theme tokens, typography, and component variants.
              </CardDescription>
            </div>
            <Badge variant="outline" className="text-sm px-3 py-1">
              {theme.mode === "dark" ? (
                <Icons.Moon className="h-3 w-3 mr-1" />
              ) : (
                <Icons.Sun className="h-3 w-3 mr-1" />
              )}
              {theme.mode ?? "system"} mode
            </Badge>
          </div>
        </CardHeader>
      </Card>

      {/* Color Palette Section */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Color Palette</CardTitle>
              <CardDescription>
                All theme color tokens rendered as swatches with hex values.
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Label htmlFor="palette-toggle" className="text-sm">
                Light
              </Label>
              <Switch
                id="palette-toggle"
                checked={showDark ?? false}
                onCheckedChange={setShowDark}
              />
              <Label htmlFor="palette-toggle" className="text-sm">
                Dark
              </Label>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground mb-4">
            Showing <Badge variant="secondary">{paletteLabel}</Badge> palette
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
            {palette.map((swatch) => (
              <div key={swatch.name} className="flex flex-col items-center gap-2">
                <div
                  className="w-14 h-14 rounded-lg border shadow-sm"
                  style={{ backgroundColor: swatch.hex }}
                />
                <span className="text-xs font-medium text-center leading-tight">
                  {swatch.name}
                </span>
                <code className="text-[10px] text-muted-foreground font-mono">
                  {swatch.hex}
                </code>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Typography Section */}
      <Card>
        <CardHeader>
          <CardTitle>Typography</CardTitle>
          <CardDescription>
            Font families and size scale from the theme configuration.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Badge>Body Font</Badge>
              <span className="text-sm text-muted-foreground font-mono">
                {theme.fontFamily ?? "Inter, sans-serif"}
              </span>
            </div>
            <div className="space-y-1" style={{ fontFamily: theme.fontFamily ?? "inherit" }}>
              <p className="text-xs">Extra Small (12px) — The quick brown fox jumps over the lazy dog</p>
              <p className="text-sm">Small (14px) — The quick brown fox jumps over the lazy dog</p>
              <p className="text-base">Base (16px) — The quick brown fox jumps over the lazy dog</p>
              <p className="text-lg">Large (18px) — The quick brown fox jumps over the lazy dog</p>
              <p className="text-xl">XL (20px) — The quick brown fox jumps</p>
            </div>
          </div>
          <Separator />
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Badge>Heading Font</Badge>
              <span className="text-sm text-muted-foreground font-mono">
                {theme.headingFontFamily ?? "Inter, sans-serif"}
              </span>
            </div>
            <div className="space-y-1" style={{ fontFamily: theme.headingFontFamily ?? "inherit" }}>
              <h4 className="text-lg font-bold">Heading 4 — Section Title</h4>
              <h3 className="text-xl font-bold">Heading 3 — Page Section</h3>
              <h2 className="text-2xl font-bold">Heading 2 — Page Title</h2>
              <h1 className="text-3xl font-bold">Heading 1 — Hero</h1>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Border Radius Visualization */}
      <Card>
        <CardHeader>
          <CardTitle>Border Radius</CardTitle>
          <CardDescription>
            Visual comparison of border-radius values applied to boxes.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-4">
            {BORDER_RADII.map((radius) => (
              <div key={radius} className="flex flex-col items-center gap-2">
                <div
                  className="w-16 h-16 bg-primary"
                  style={{ borderRadius: radius }}
                />
                <code className="text-xs text-muted-foreground font-mono">{radius}</code>
              </div>
            ))}
          </div>
          <div className="mt-4 flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Theme borderRadius:</span>
            <Badge variant="outline" className="font-mono">
              {theme.borderRadius ?? "0.5rem"}
            </Badge>
          </div>
        </CardContent>
      </Card>

      {/* Button Variants */}
      <Card>
        <CardHeader>
          <CardTitle>Button Variants</CardTitle>
          <CardDescription>
            All available Button component variants in a grid.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3">
            {BUTTON_VARIANTS.map((variant) => (
              <div key={variant} className="flex flex-col items-center gap-2">
                <Button variant={variant} size="sm">
                  {variant}
                </Button>
                <code className="text-[10px] text-muted-foreground">{variant}</code>
              </div>
            ))}
          </div>
          <Separator className="my-4" />
          <div className="flex flex-wrap gap-3">
            <Button size="sm">
              <Icons.Plus className="mr-1 h-3 w-3" />
              Small
            </Button>
            <Button size="default">
              <Icons.Plus className="mr-1 h-4 w-4" />
              Default
            </Button>
            <Button size="lg">
              <Icons.Plus className="mr-1 h-5 w-5" />
              Large
            </Button>
            <Button size="icon" variant="outline">
              <Icons.Settings className="h-4 w-4" />
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Input Examples */}
      <Card>
        <CardHeader>
          <CardTitle>Input Styled with Theme</CardTitle>
          <CardDescription>
            Form inputs inheriting border, ring, and foreground colors.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Default Input</Label>
              <Input placeholder="Type something..." />
            </div>
            <div className="space-y-2">
              <Label>Disabled Input</Label>
              <Input placeholder="Disabled" disabled />
            </div>
            <div className="space-y-2">
              <Label>With Value</Label>
              <Input defaultValue="theme@example.com" />
            </div>
            <div className="space-y-2">
              <Label>Password</Label>
              <Input type="password" defaultValue="secretpass" />
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default ThemeShowcase;
