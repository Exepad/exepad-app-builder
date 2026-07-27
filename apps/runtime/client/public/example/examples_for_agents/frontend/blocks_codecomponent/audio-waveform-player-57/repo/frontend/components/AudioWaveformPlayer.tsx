import {
  React,
  useFileUrl,
  useAppState,
  useTheme,
  Slider,
  Label,
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
import * as WaveSurfer from "@exepad/ext-wavesurfer";

interface Region {
  id: string;
  label: string;
  start: number;
  end: number;
  color: string;
}

const DEMO_REGIONS: Region[] = [
  { id: "r1", label: "Intro", start: 0, end: 8, color: "rgba(147, 51, 234, 0.15)" },
  { id: "r2", label: "Verse 1", start: 12, end: 32, color: "rgba(59, 130, 246, 0.15)" },
  { id: "r3", label: "Chorus", start: 35, end: 52, color: "rgba(234, 179, 8, 0.15)" },
];

const TOTAL_DURATION = 180;

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function AudioWaveformPlayer() {
  const theme = useTheme();
  const isDark = theme.resolvedTheme === "dark";
  // In a real app: const audioUrl = useFileUrl("track.mp3");
  const audioUrl = "";
  const [playbackPosition, setPlaybackPosition] = useAppState<number>("playbackPosition", 0);
  const [volume, setVolume] = useAppState<number>("volume", 75);
  const [zoom, setZoom] = useAppState<number>("zoom", 50);
  const [isPlaying, setIsPlaying] = useAppState<boolean>("isPlaying", false);
  const waveformRef = React.useRef<HTMLDivElement>(null);
  const wavesurferRef = React.useRef<any>(null);
  const readyRef = React.useRef(false);

  const primaryColor = isDark ? "#c084fc" : "#9333ea";
  const waveColor = isDark ? "#3f3f46" : "#d4d4d8";
  const progressColor = primaryColor;

  React.useEffect(() => {
    if (!waveformRef.current) return;

    const ws = WaveSurfer.default.create({
      container: waveformRef.current,
      waveColor: waveColor,
      progressColor: progressColor,
      cursorColor: primaryColor,
      cursorWidth: 2,
      barWidth: 2,
      barGap: 1,
      barRadius: 2,
      height: 128,
      normalize: true,
      backend: "WebAudio",
    });

    wavesurferRef.current = ws;

    if (audioUrl) {
      ws.load(audioUrl);
    } else {
      // Generate a demo waveform visualization with peaks
      const peaks = Array.from({ length: 500 }, (_, i) => {
        const x = i / 500;
        return (
          Math.sin(x * Math.PI * 8) * 0.3 +
          Math.sin(x * Math.PI * 16) * 0.2 +
          Math.sin(x * Math.PI * 32) * 0.1 +
          Math.random() * 0.15
        );
      });
      ws.load("", peaks, TOTAL_DURATION);
    }

    ws.on("audioprocess", (time: number) => {
      setPlaybackPosition(Math.floor(time));
    });

    ws.on("ready", () => { readyRef.current = true; });
    ws.on("play", () => setIsPlaying(true));
    ws.on("pause", () => setIsPlaying(false));
    ws.on("finish", () => {
      setIsPlaying(false);
      setPlaybackPosition(0);
    });

    return () => {
      readyRef.current = false;
      ws.destroy();
    };
  }, [isDark]);

  React.useEffect(() => {
    if (wavesurferRef.current) {
      wavesurferRef.current.setVolume(volume / 100);
    }
  }, [volume]);

  React.useEffect(() => {
    if (wavesurferRef.current && readyRef.current) {
      wavesurferRef.current.zoom(zoom);
    }
  }, [zoom]);

  const handlePlay = () => wavesurferRef.current?.playPause();
  const handleStop = () => {
    wavesurferRef.current?.stop();
    setIsPlaying(false);
    setPlaybackPosition(0);
  };

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Icons.Music className="h-5 w-5" />
              Audio Waveform Player
            </CardTitle>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="font-mono text-xs">
                {formatTime(playbackPosition)} / {formatTime(TOTAL_DURATION)}
              </Badge>
              <Badge variant={isPlaying ? "default" : "secondary"} className="text-xs">
                {isPlaying ? "Playing" : "Paused"}
              </Badge>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Waveform */}
          <div className="relative rounded-lg border overflow-hidden">
            <div ref={waveformRef} className={cn("w-full", isDark ? "bg-zinc-900" : "bg-gray-50")} />
            {/* Region overlays */}
            <div className="absolute inset-0 pointer-events-none">
              {DEMO_REGIONS.map((region) => {
                const leftPct = (region.start / TOTAL_DURATION) * 100;
                const widthPct = ((region.end - region.start) / TOTAL_DURATION) * 100;
                return (
                  <div
                    key={region.id}
                    className="absolute top-0 bottom-0 flex items-end justify-center pb-1"
                    style={{
                      left: `${leftPct}%`,
                      width: `${widthPct}%`,
                      backgroundColor: region.color,
                      borderLeft: `1px solid ${primaryColor}40`,
                      borderRight: `1px solid ${primaryColor}40`,
                    }}
                  >
                    <span className="text-[10px] text-muted-foreground font-medium px-1 rounded bg-background/60">
                      {region.label}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Transport Controls */}
          <div className="flex items-center justify-between flex-wrap gap-4">
            <ButtonGroup>
              <Button variant="outline" size="sm" onClick={handleStop}>
                <Icons.Square className="h-4 w-4" />
              </Button>
              <Button variant="default" size="sm" onClick={handlePlay}>
                {isPlaying ? (
                  <Icons.Pause className="h-4 w-4" />
                ) : (
                  <Icons.Play className="h-4 w-4" />
                )}
              </Button>
            </ButtonGroup>

            {/* Volume */}
            <div className="flex items-center gap-3 min-w-[180px]">
              <Label className="text-xs text-muted-foreground shrink-0">
                <Icons.Volume2 className="h-4 w-4" />
              </Label>
              <Slider
                value={[volume]}
                min={0}
                max={100}
                step={1}
                onValueChange={(val: number[]) => setVolume(val[0])}
                className="flex-1"
              />
              <span className="text-xs text-muted-foreground w-8 text-right">{volume}%</span>
            </div>

            {/* Zoom */}
            <div className="flex items-center gap-3 min-w-[180px]">
              <Label className="text-xs text-muted-foreground shrink-0">
                <Icons.ZoomIn className="h-4 w-4" />
              </Label>
              <Slider
                value={[zoom]}
                min={1}
                max={200}
                step={1}
                onValueChange={(val: number[]) => setZoom(val[0])}
                className="flex-1"
              />
              <span className="text-xs text-muted-foreground w-8 text-right">{zoom}x</span>
            </div>
          </div>

          {/* Regions legend */}
          <div className="flex items-center gap-3 pt-1">
            <span className="text-xs text-muted-foreground">Regions:</span>
            {DEMO_REGIONS.map((region) => (
              <Badge key={region.id} variant="outline" className="text-xs gap-1">
                <div
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: region.color.replace("0.15", "0.8") }}
                />
                {region.label} ({formatTime(region.start)} - {formatTime(region.end)})
              </Badge>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default AudioWaveformPlayer;
