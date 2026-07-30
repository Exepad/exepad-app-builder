import {
  React,
  useAppState,
  useTheme,
  toast,
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
  Card,
  CardContent,
  Button,
  Badge,
  ScrollArea,
  Icons,
  cn,
} from "@exepad/sdk";
import * as MonacoModule from "@exepad/ext-monaco";
// esm.sh @monaco-editor/react: default export is the Editor component, Editor is a named export

interface FileTab {
  name: string;
  language: string;
  defaultContent: string;
}

const FILES: FileTab[] = [
  {
    name: "App.tsx",
    language: "typescript",
    defaultContent: `import React, { useState } from "react";

interface Todo {
  id: number;
  text: string;
  done: boolean;
}

export default function App() {
  const [todos, setTodos] = useState<Todo[]>([
    { id: 1, text: "Learn TypeScript", done: true },
    { id: 2, text: "Build a React app", done: false },
    { id: 3, text: "Deploy to production", done: false },
  ]);
  const [input, setInput] = useState("");

  const addTodo = () => {
    if (!input.trim()) return;
    setTodos([...todos, { id: Date.now(), text: input, done: false }]);
    setInput("");
  };

  const toggleTodo = (id: number) => {
    setTodos(todos.map(t => t.id === id ? { ...t, done: !t.done } : t));
  };

  return (
    <div className="p-4 max-w-md mx-auto">
      <h1 className="text-2xl font-bold mb-4">Todo App</h1>
      <div className="flex gap-2 mb-4">
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder="Add a todo..."
          className="flex-1 border rounded px-3 py-2"
        />
        <button onClick={addTodo} className="bg-blue-500 text-white px-4 py-2 rounded">
          Add
        </button>
      </div>
      <ul className="space-y-2">
        {todos.map(todo => (
          <li
            key={todo.id}
            onClick={() => toggleTodo(todo.id)}
            className={\`p-3 border rounded cursor-pointer \${todo.done ? "line-through opacity-50" : ""}\`}
          >
            {todo.text}
          </li>
        ))}
      </ul>
    </div>
  );
}`,
  },
  {
    name: "styles.css",
    language: "css",
    defaultContent: `/* Base Styles */
:root {
  --primary: #2563eb;
  --primary-light: #60a5fa;
  --bg: #ffffff;
  --text: #1e293b;
  --border: #e2e8f0;
  --radius: 8px;
}

* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

body {
  font-family: "Inter", -apple-system, sans-serif;
  background: var(--bg);
  color: var(--text);
  line-height: 1.6;
}

.container {
  max-width: 1200px;
  margin: 0 auto;
  padding: 2rem;
}

.card {
  background: white;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 1.5rem;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
  transition: box-shadow 0.2s ease;
}

.card:hover {
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}

.btn {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 1rem;
  border-radius: var(--radius);
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}

.btn-primary {
  background: var(--primary);
  color: white;
  border: none;
}

.btn-primary:hover {
  background: var(--primary-light);
}

@media (prefers-color-scheme: dark) {
  :root {
    --bg: #0f172a;
    --text: #f8fafc;
    --border: #334155;
  }
}`,
  },
  {
    name: "utils.ts",
    language: "typescript",
    defaultContent: `// Utility functions

export function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(date);
}

export function debounce<T extends (...args: any[]) => void>(
  fn: T,
  delay: number
): (...args: Parameters<T>) => void {
  let timer: ReturnType<typeof setTimeout>;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

export function classNames(
  ...classes: (string | boolean | undefined | null)[]
): string {
  return classes.filter(Boolean).join(" ");
}

export function generateId(): string {
  return Math.random().toString(36).substring(2, 9);
}

export function groupBy<T>(
  arr: T[],
  key: keyof T
): Record<string, T[]> {
  return arr.reduce((acc, item) => {
    const group = String(item[key]);
    if (!acc[group]) acc[group] = [];
    acc[group].push(item);
    return acc;
  }, {} as Record<string, T[]>);
}

export function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 3) + "...";
}

export async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}`,
  },
];

interface ConsoleEntry {
  type: "log" | "error" | "info" | "warn";
  message: string;
  timestamp: string;
}

function CodePlayground() {
  const theme = useTheme();
  const [activeFile, setActiveFile] = useAppState<string>("activeFile", "App.tsx");
  const [fileContents, setFileContents] = React.useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    FILES.forEach((f) => {
      initial[f.name] = f.defaultContent;
    });
    return initial;
  });
  const [consoleOutput, setConsoleOutput] = React.useState<ConsoleEntry[]>([]);
  const [isRunning, setIsRunning] = React.useState(false);

  const isDark = theme.resolvedTheme === "dark";
  const currentFile = activeFile ?? "App.tsx";
  const currentFileConfig = FILES.find((f) => f.name === currentFile) ?? FILES[0];

  const handleEditorChange = React.useCallback(
    (value: string | undefined) => {
      if (value !== undefined) {
        setFileContents((prev) => ({ ...prev, [currentFile]: value }));
      }
    },
    [currentFile]
  );

  const now = () => {
    const d = new Date();
    return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}:${d.getSeconds().toString().padStart(2, "0")}`;
  };

  const handleRun = () => {
    setIsRunning(true);
    setConsoleOutput((prev) => [
      ...prev,
      { type: "info", message: `[Build] Compiling ${Object.keys(fileContents).length} files...`, timestamp: now() },
    ]);

    setTimeout(() => {
      setConsoleOutput((prev) => [
        ...prev,
        { type: "log", message: "[Build] TypeScript compilation successful.", timestamp: now() },
        { type: "log", message: "[Build] Bundle size: 14.2 KB (gzipped: 5.1 KB)", timestamp: now() },
        { type: "info", message: "[Runtime] Application started on port 3000", timestamp: now() },
        { type: "log", message: "[Runtime] Rendering App component...", timestamp: now() },
        { type: "log", message: "[Runtime] 3 todo items loaded from initial state", timestamp: now() },
      ]);
      setIsRunning(false);
      toast("Build completed successfully.");
    }, 1200);
  };

  const handleSave = () => {
    toast(`Saved ${currentFile}`);
  };

  const handleClearConsole = () => {
    setConsoleOutput([]);
  };

  const consoleTypeColor: Record<ConsoleEntry["type"], string> = {
    log: "text-foreground",
    error: "text-destructive",
    info: "text-blue-500",
    warn: "text-yellow-500",
  };

  return (
    <div className="space-y-0">
      <Card className="overflow-hidden">
        <div className="flex items-center justify-between border-b px-4 py-2 bg-muted/30">
          <div className="flex items-center gap-2">
            <Icons.Code className="h-4 w-4 text-primary" />
            <span className="font-semibold text-sm">Code Playground</span>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-xs">
              {currentFileConfig.language}
            </Badge>
            <Button variant="ghost" size="sm" onClick={handleSave}>
              <Icons.Save className="mr-1 h-3 w-3" />
              Save
            </Button>
            <Button size="sm" onClick={handleRun} disabled={isRunning}>
              {isRunning ? (
                <>
                  <Icons.Loader2 className="mr-1 h-3 w-3 animate-spin" />
                  Running...
                </>
              ) : (
                <>
                  <Icons.Play className="mr-1 h-3 w-3" />
                  Run
                </>
              )}
            </Button>
          </div>
        </div>

        <ResizablePanelGroup direction="vertical" className="min-h-[600px]">
          <ResizablePanel defaultSize={70} minSize={30}>
            <div className="h-full flex flex-col">
              <Tabs value={currentFile} onValueChange={(v: string) => setActiveFile(v)}>
                <div className="border-b bg-muted/20 px-2">
                  <TabsList className="h-9 bg-transparent">
                    {FILES.map((file) => (
                      <TabsTrigger
                        key={file.name}
                        value={file.name}
                        className="text-xs data-[state=active]:bg-background data-[state=active]:shadow-sm gap-1"
                      >
                        {file.name.endsWith(".tsx") || file.name.endsWith(".ts") ? (
                          <Icons.FileCode className="h-3 w-3" />
                        ) : (
                          <Icons.FileText className="h-3 w-3" />
                        )}
                        {file.name}
                      </TabsTrigger>
                    ))}
                  </TabsList>
                </div>
                {FILES.map((file) => (
                  <TabsContent key={file.name} value={file.name} className="flex-1 m-0 p-0">
                    {typeof MonacoEditor === "function" ? (
                      <MonacoEditor
                        height="100%"
                        language={file.language}
                        theme={isDark ? "vs-dark" : "vs"}
                        value={fileContents[file.name] ?? file.defaultContent}
                        onChange={handleEditorChange}
                        options={{
                          minimap: { enabled: false },
                          fontSize: 13,
                          lineNumbers: "on",
                          scrollBeyondLastLine: false,
                          wordWrap: "on",
                          tabSize: 2,
                          automaticLayout: true,
                          padding: { top: 8 },
                        }}
                      />
                    ) : (
                      <textarea
                        style={{ width: "100%", height: "400px", fontFamily: "monospace", fontSize: "13px", padding: "8px", border: "none", outline: "none", resize: "none", background: isDark ? "#1e1e1e" : "#ffffff", color: isDark ? "#d4d4d4" : "#1e1e1e" }}
                        value={fileContents[file.name] ?? file.defaultContent}
                        onChange={(e) => handleEditorChange(e.target.value)}
                      />
                    )}
                  </TabsContent>
                ))}
              </Tabs>
            </div>
          </ResizablePanel>

          <ResizableHandle withHandle />

          <ResizablePanel defaultSize={30} minSize={15}>
            <div className="h-full flex flex-col">
              <div className="flex items-center justify-between border-b px-3 py-1.5 bg-muted/30">
                <div className="flex items-center gap-2">
                  <Icons.Terminal className="h-3 w-3" />
                  <span className="text-xs font-medium">Console</span>
                  <Badge variant="secondary" className="text-xs h-4 px-1">
                    {consoleOutput.length}
                  </Badge>
                </div>
                <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={handleClearConsole}>
                  <Icons.Trash2 className="mr-1 h-3 w-3" />
                  Clear
                </Button>
              </div>
              <ScrollArea className="flex-1 p-2">
                {consoleOutput.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <Icons.Terminal className="h-6 w-6 mx-auto mb-2 opacity-50" />
                    <p className="text-xs">Console output will appear here. Click Run to execute.</p>
                  </div>
                ) : (
                  <div className="space-y-0.5 font-mono text-xs">
                    {consoleOutput.map((entry, i) => (
                      <div
                        key={i}
                        className={cn(
                          "flex gap-2 px-1 py-0.5 rounded hover:bg-muted/50",
                          consoleTypeColor[entry.type]
                        )}
                      >
                        <span className="text-muted-foreground shrink-0">{entry.timestamp}</span>
                        <span>{entry.message}</span>
                      </div>
                    ))}
                  </div>
                )}
              </ScrollArea>
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      </Card>
    </div>
  );
}

export default CodePlayground;
