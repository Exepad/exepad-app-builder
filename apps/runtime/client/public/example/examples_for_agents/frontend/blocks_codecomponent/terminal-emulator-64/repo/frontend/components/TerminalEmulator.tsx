import {
  React,
  useHandler,
  useAppState,
  useTheme,
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
import * as XTermM from "@exepad/ext-xterm";

interface TerminalLine {
  text: string;
  type: "input" | "output" | "error" | "system";
}

const FILESYSTEM: Record<string, string> = {
  "readme.txt": "Welcome to ExepadOS Terminal v1.0\nThis is a simulated terminal environment.",
  "notes.txt": "TODO:\n- Build the app\n- Deploy to production\n- Celebrate!",
  "config.json": '{\n  "theme": "dark",\n  "lang": "en",\n  "version": "1.0.0"\n}',
  "hello.py": "print('Hello, World!')\nfor i in range(5):\n    print(f'Count: {i}')",
};

const HELP_TEXT = `Available commands:
  help        Show this help message
  clear       Clear the terminal
  echo <msg>  Print a message
  date        Show current date and time
  ls          List files in current directory
  cat <file>  Display file contents
  whoami      Show current user
  pwd         Print working directory
  uname       Show system information
  history     Show command history
  uptime      Show system uptime`;

function TerminalEmulator() {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const [commandHistory, setCommandHistory] = useAppState<string[]>("termHistory", []);
  const [fontSize, setFontSize] = useAppState<string>("termFontSize", "14");
  const [isFullscreen, setIsFullscreen] = useAppState<boolean>("termFullscreen", false);

  const [lines, setLines] = React.useState<TerminalLine[]>([
    { text: "ExepadOS Terminal v1.0.0", type: "system" },
    { text: "Type 'help' for available commands.\n", type: "system" },
  ]);
  const [currentInput, setCurrentInput] = React.useState("");
  const [historyIndex, setHistoryIndex] = React.useState(-1);

  const terminalRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const history = commandHistory ?? [];
  const fontSz = parseInt(fontSize ?? "14", 10);
  const fullscreen = isFullscreen ?? false;

  const scrollToBottom = React.useCallback(() => {
    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, []);

  React.useEffect(() => {
    scrollToBottom();
  }, [lines, scrollToBottom]);

  const executeCommand = React.useCallback(
    (cmd: string) => {
      const trimmed = cmd.trim();
      if (!trimmed) return;

      const newLines: TerminalLine[] = [
        ...lines,
        { text: `$ ${trimmed}`, type: "input" },
      ];

      const parts = trimmed.split(/\s+/);
      const command = parts[0].toLowerCase();
      const args = parts.slice(1);

      let output: TerminalLine[] = [];

      switch (command) {
        case "help":
          output = [{ text: HELP_TEXT, type: "output" }];
          break;
        case "clear":
          setLines([]);
          setCurrentInput("");
          setCommandHistory([...history, trimmed]);
          setHistoryIndex(-1);
          return;
        case "echo":
          output = [{ text: args.join(" ") || "", type: "output" }];
          break;
        case "date":
          output = [{ text: new Date().toString(), type: "output" }];
          break;
        case "ls":
          output = [
            {
              text: Object.keys(FILESYSTEM)
                .map((f) => `  ${f}`)
                .join("\n"),
              type: "output",
            },
          ];
          break;
        case "cat":
          if (!args[0]) {
            output = [{ text: "cat: missing operand", type: "error" }];
          } else if (FILESYSTEM[args[0]]) {
            output = [{ text: FILESYSTEM[args[0]], type: "output" }];
          } else {
            output = [{ text: `cat: ${args[0]}: No such file or directory`, type: "error" }];
          }
          break;
        case "whoami":
          output = [{ text: "exepad-user", type: "output" }];
          break;
        case "pwd":
          output = [{ text: "/home/exepad-user", type: "output" }];
          break;
        case "uname":
          output = [{ text: "ExepadOS 1.0.0 x86_64 GNU/Linux", type: "output" }];
          break;
        case "history":
          output = [
            {
              text: [...history, trimmed]
                .map((h, i) => `  ${i + 1}  ${h}`)
                .join("\n"),
              type: "output",
            },
          ];
          break;
        case "uptime":
          output = [
            {
              text: ` ${new Date().toLocaleTimeString()} up 42 days, 3:17, 1 user, load average: 0.12, 0.08, 0.05`,
              type: "output",
            },
          ];
          break;
        default:
          output = [{ text: `bash: ${command}: command not found`, type: "error" }];
      }

      setLines([...newLines, ...output]);
      setCommandHistory([...history, trimmed]);
      setHistoryIndex(-1);
      setCurrentInput("");
    },
    [lines, history, setCommandHistory]
  );

  const handleKeyDown = React.useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        executeCommand(currentInput);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        if (history.length > 0) {
          const newIndex =
            historyIndex === -1
              ? history.length - 1
              : Math.max(0, historyIndex - 1);
          setHistoryIndex(newIndex);
          setCurrentInput(history[newIndex] || "");
        }
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        if (historyIndex !== -1) {
          const newIndex = historyIndex + 1;
          if (newIndex >= history.length) {
            setHistoryIndex(-1);
            setCurrentInput("");
          } else {
            setHistoryIndex(newIndex);
            setCurrentInput(history[newIndex] || "");
          }
        }
      }
    },
    [currentInput, executeCommand, history, historyIndex]
  );

  const focusInput = () => {
    inputRef.current?.focus();
  };

  const getLineColor = (type: TerminalLine["type"]) => {
    switch (type) {
      case "input":
        return "text-green-400";
      case "error":
        return "text-red-400";
      case "system":
        return "text-yellow-400";
      default:
        return isDark ? "text-zinc-300" : "text-zinc-200";
    }
  };

  return (
    <div className={cn("space-y-4", fullscreen && "fixed inset-0 z-50 p-4 bg-background")}>
      {/* Toolbar */}
      <Card>
        <CardContent className="py-3">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-3">
              <Icons.Terminal className="h-5 w-5 text-primary" />
              <span className="font-semibold">Terminal</span>
              <Badge variant="secondary" className="text-xs">
                {history.length} commands
              </Badge>
            </div>
            <div className="flex items-center gap-2">
              <Select value={fontSize ?? "14"} onValueChange={(v: string) => setFontSize(v)}>
                <SelectTrigger className="w-[100px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="12">12px</SelectItem>
                  <SelectItem value="14">14px</SelectItem>
                  <SelectItem value="16">16px</SelectItem>
                  <SelectItem value="18">18px</SelectItem>
                  <SelectItem value="20">20px</SelectItem>
                </SelectContent>
              </Select>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setLines([]);
                }}
              >
                <Icons.Eraser className="h-4 w-4 mr-1" />
                Clear
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setIsFullscreen(!fullscreen)}
              >
                {fullscreen ? (
                  <Icons.Minimize2 className="h-4 w-4" />
                ) : (
                  <Icons.Maximize2 className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Terminal */}
      <Card className="overflow-hidden">
        <CardHeader className="py-2 px-4 bg-zinc-900 border-b border-zinc-700">
          <div className="flex items-center gap-2">
            <div className="flex gap-1.5">
              <div className="w-3 h-3 rounded-full bg-red-500" />
              <div className="w-3 h-3 rounded-full bg-yellow-500" />
              <div className="w-3 h-3 rounded-full bg-green-500" />
            </div>
            <CardTitle className="text-xs text-zinc-400 font-mono">
              exepad-user@exepadOS: ~
            </CardTitle>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div
            ref={terminalRef}
            className="bg-zinc-950 p-4 font-mono overflow-y-auto cursor-text"
            style={{
              fontSize: `${fontSz}px`,
              lineHeight: "1.6",
              minHeight: fullscreen ? "calc(100vh - 200px)" : "400px",
              maxHeight: fullscreen ? "calc(100vh - 200px)" : "500px",
            }}
            onClick={focusInput}
          >
            {lines.map((line, i) => (
              <div key={i} className={cn("whitespace-pre-wrap break-all", getLineColor(line.type))}>
                {line.text}
              </div>
            ))}
            <div className="flex items-center gap-1">
              <span className="text-green-400">$</span>
              <input
                ref={inputRef}
                type="text"
                value={currentInput}
                onChange={(e) => setCurrentInput(e.target.value)}
                onKeyDown={handleKeyDown}
                className="flex-1 bg-transparent border-none outline-hidden text-zinc-200 font-mono caret-green-400"
                style={{ fontSize: `${fontSz}px` }}
                autoFocus
                spellCheck={false}
                autoComplete="off"
              />
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default TerminalEmulator;
