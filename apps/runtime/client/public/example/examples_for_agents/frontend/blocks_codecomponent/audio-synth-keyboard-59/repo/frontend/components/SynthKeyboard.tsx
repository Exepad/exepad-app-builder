import {
  React,
  useAppState,
  useTheme,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  Slider,
  Switch,
  Label,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  Button,
  Icons,
  cn,
} from "@exepad/sdk";
import * as Tone from "@exepad/ext-tone";

interface SynthPatch {
  oscillator: string;
  attack: number;
  decay: number;
  sustain: number;
  release: number;
  reverb: boolean;
  delay: boolean;
}

const PRESETS: Record<string, SynthPatch> = {
  Piano: { oscillator: "triangle", attack: 0.01, decay: 0.3, sustain: 0.2, release: 0.8, reverb: true, delay: false },
  Organ: { oscillator: "sine", attack: 0.05, decay: 0.1, sustain: 0.9, release: 0.1, reverb: false, delay: false },
  Strings: { oscillator: "sawtooth", attack: 0.4, decay: 0.2, sustain: 0.7, release: 1.2, reverb: true, delay: true },
  Bass: { oscillator: "square", attack: 0.01, decay: 0.2, sustain: 0.4, release: 0.3, reverb: false, delay: false },
  Lead: { oscillator: "sawtooth", attack: 0.01, decay: 0.1, sustain: 0.6, release: 0.4, reverb: true, delay: true },
};

const WHITE_NOTES = ["C", "D", "E", "F", "G", "A", "B"];
const BLACK_NOTE_MAP: Record<string, string> = { C: "C#", D: "D#", F: "F#", G: "G#", A: "A#" };
const OCTAVES = [4, 5];

function SynthKeyboard() {
  const theme = useTheme();
  const isDark = theme.resolvedTheme === "dark";
  const [rawPatch, setPatch] = useAppState<SynthPatch>("synthPatch", PRESETS.Piano);
  const patch: SynthPatch = { ...PRESETS.Piano, ...(rawPatch ?? {}) };
  const synthRef = React.useRef<any>(null);
  const reverbRef = React.useRef<any>(null);
  const delayRef = React.useRef<any>(null);
  const [activeNotes, setActiveNotes] = React.useState<Set<string>>(new Set());

  React.useEffect(() => {
    const reverb = new Tone.Reverb({ decay: 2.5, wet: 0.3 }).toDestination();
    const delay = new Tone.FeedbackDelay({ delayTime: "8n", feedback: 0.3, wet: 0.2 }).toDestination();
    reverbRef.current = reverb;
    delayRef.current = delay;

    const synth = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: patch.oscillator as any },
      envelope: {
        attack: patch.attack,
        decay: patch.decay,
        sustain: patch.sustain,
        release: patch.release,
      },
    });

    const chain: any[] = [];
    if (patch.reverb) chain.push(reverb);
    if (patch.delay) chain.push(delay);
    if (chain.length > 0) {
      synth.chain(...chain, Tone.getDestination());
    } else {
      synth.toDestination();
    }

    synthRef.current = synth;

    return () => {
      synth.dispose();
      reverb.dispose();
      delay.dispose();
    };
  }, [patch]);

  const playNote = (note: string) => {
    Tone.start();
    synthRef.current?.triggerAttack(note);
    setActiveNotes((prev) => new Set(prev).add(note));
  };

  const releaseNote = (note: string) => {
    synthRef.current?.triggerRelease(note);
    setActiveNotes((prev) => {
      const next = new Set(prev);
      next.delete(note);
      return next;
    });
  };

  const updatePatch = (updates: Partial<SynthPatch>) => {
    setPatch((prev: SynthPatch) => ({ ...prev, ...updates }));
  };

  const loadPreset = (name: string) => {
    setPatch(PRESETS[name]);
  };

  const primaryColor = isDark ? "#fbbf24" : "#d97706";

  return (
    <div className="flex flex-col gap-4">
      {/* Controls */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Icons.Music className="h-5 w-5" />
              Synthesizer Keyboard
            </CardTitle>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm">
                  <Icons.ListMusic className="h-4 w-4 mr-1" />
                  Presets
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                {Object.keys(PRESETS).map((name) => (
                  <DropdownMenuItem key={name} onClick={() => loadPreset(name)}>
                    {name}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* Oscillator + Effects */}
          <div className="flex items-center gap-6 flex-wrap">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Oscillator</Label>
              <Select
                value={patch.oscillator}
                onValueChange={(val: string) => updatePatch({ oscillator: val })}
              >
                <SelectTrigger className="w-36 h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="sine">Sine</SelectItem>
                  <SelectItem value="square">Square</SelectItem>
                  <SelectItem value="sawtooth">Sawtooth</SelectItem>
                  <SelectItem value="triangle">Triangle</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <Switch
                  checked={patch.reverb}
                  onCheckedChange={(checked: boolean) => updatePatch({ reverb: checked })}
                />
                <Label className="text-xs">Reverb</Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  checked={patch.delay}
                  onCheckedChange={(checked: boolean) => updatePatch({ delay: checked })}
                />
                <Label className="text-xs">Delay</Label>
              </div>
            </div>
          </div>

          {/* ADSR Envelope */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label: "Attack", key: "attack" as const, min: 0.01, max: 2, step: 0.01 },
              { label: "Decay", key: "decay" as const, min: 0.01, max: 2, step: 0.01 },
              { label: "Sustain", key: "sustain" as const, min: 0, max: 1, step: 0.01 },
              { label: "Release", key: "release" as const, min: 0.01, max: 3, step: 0.01 },
            ].map((param) => (
              <div key={param.key} className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs text-muted-foreground">{param.label}</Label>
                  <span className="text-xs font-mono">{Number(patch[param.key] ?? 0).toFixed(2)}</span>
                </div>
                <Slider
                  value={[patch[param.key]]}
                  min={param.min}
                  max={param.max}
                  step={param.step}
                  onValueChange={(val: number[]) => updatePatch({ [param.key]: val[0] })}
                />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Keyboard */}
      <Card>
        <CardContent className="py-4">
          <div className="flex justify-center overflow-x-auto">
            <div className="relative flex">
              {OCTAVES.map((octave) =>
                WHITE_NOTES.map((note) => {
                  const fullNote = `${note}${octave}`;
                  const isActive = activeNotes.has(fullNote);
                  const hasBlack = BLACK_NOTE_MAP[note];
                  return (
                    <div key={fullNote} className="relative">
                      {/* White key */}
                      <button
                        onPointerDown={() => playNote(fullNote)}
                        onPointerUp={() => releaseNote(fullNote)}
                        onPointerLeave={() => releaseNote(fullNote)}
                        className={cn(
                          "w-12 h-40 border border-border rounded-b-md transition-colors relative z-0",
                          "hover:bg-accent active:bg-accent",
                          isActive ? "bg-accent shadow-inner" : isDark ? "bg-zinc-800" : "bg-white"
                        )}
                        style={isActive ? { backgroundColor: `${primaryColor}30` } : undefined}
                      >
                        <span className="absolute bottom-2 left-1/2 -translate-x-1/2 text-[10px] text-muted-foreground">
                          {note}{octave}
                        </span>
                      </button>
                      {/* Black key */}
                      {hasBlack && (
                        <button
                          onPointerDown={() => playNote(`${hasBlack}${octave}`)}
                          onPointerUp={() => releaseNote(`${hasBlack}${octave}`)}
                          onPointerLeave={() => releaseNote(`${hasBlack}${octave}`)}
                          className={cn(
                            "absolute top-0 -right-3.5 w-7 h-24 rounded-b-md z-10 transition-colors",
                            "hover:opacity-80",
                            activeNotes.has(`${hasBlack}${octave}`)
                              ? "opacity-80"
                              : ""
                          )}
                          style={{
                            backgroundColor: activeNotes.has(`${hasBlack}${octave}`)
                              ? primaryColor
                              : isDark
                              ? "#18181b"
                              : "#1f2937",
                          }}
                        />
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
          <p className="text-xs text-muted-foreground text-center mt-3">
            Click or tap keys to play. Use pointer hold for sustained notes.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

export default SynthKeyboard;
