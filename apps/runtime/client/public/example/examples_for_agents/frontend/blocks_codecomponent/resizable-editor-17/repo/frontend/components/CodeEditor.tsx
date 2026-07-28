import {
  React,
  useAppState,
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
  ScrollArea,
  ScrollBar,
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
  Button,
  Separator,
  Card,
  Icons,
  cn,
} from "@exepad/sdk";

interface FileNode {
  name: string;
  type: "file" | "folder";
  children?: FileNode[];
}

const FILE_TREE: FileNode[] = [
  {
    name: "src",
    type: "folder",
    children: [
      {
        name: "components",
        type: "folder",
        children: [
          { name: "Header.tsx", type: "file" },
          { name: "Footer.tsx", type: "file" },
        ],
      },
      { name: "index.tsx", type: "file" },
      { name: "styles.css", type: "file" },
      { name: "utils.ts", type: "file" },
    ],
  },
  { name: "package.json", type: "file" },
  { name: "tsconfig.json", type: "file" },
];

const FILE_CONTENTS: Record<string, string> = {
  "index.tsx": `import React from "react";
import { Header } from "./components/Header";
import { Footer } from "./components/Footer";
import "./styles.css";

export default function App() {
  return (
    <div className="app">
      <Header title="My App" />
      <main>
        <h1>Welcome</h1>
        <p>This is the main content area.</p>
      </main>
      <Footer />
    </div>
  );
}`,
  "styles.css": `.app {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  font-family: sans-serif;
}

main {
  flex: 1;
  padding: 2rem;
  max-width: 1200px;
  margin: 0 auto;
}

h1 {
  font-size: 2rem;
  margin-bottom: 1rem;
  color: var(--foreground);
}`,
  "utils.ts": `export function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(date);
}

export function debounce<T extends (...args: unknown[]) => void>(
  fn: T,
  delay: number
): T {
  let timer: ReturnType<typeof setTimeout>;
  return ((...args: unknown[]) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  }) as T;
}

export function classNames(
  ...classes: (string | false | null | undefined)[]
): string {
  return classes.filter(Boolean).join(" ");
}`,
  "Header.tsx": `import React from "react";

interface HeaderProps {
  title: string;
}

export function Header({ title }: HeaderProps) {
  return (
    <header className="header">
      <nav>
        <span className="logo">{title}</span>
        <ul>
          <li><a href="/">Home</a></li>
          <li><a href="/about">About</a></li>
          <li><a href="/contact">Contact</a></li>
        </ul>
      </nav>
    </header>
  );
}`,
  "Footer.tsx": `import React from "react";

export function Footer() {
  return (
    <footer className="footer">
      <p>&copy; 2026 My App. All rights reserved.</p>
    </footer>
  );
}`,
  "package.json": `{
  "name": "my-app",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview"
  }
}`,
  "tsconfig.json": `{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "strict": true,
    "jsx": "react-jsx",
    "moduleResolution": "bundler"
  },
  "include": ["src"]
}`,
};

function FileTreeItem({
  node,
  depth,
  selectedFile,
  onSelect,
  expandedFolders,
  onToggleFolder,
}: {
  node: FileNode;
  depth: number;
  selectedFile: string;
  onSelect: (name: string) => void;
  expandedFolders: string[];
  onToggleFolder: (name: string) => void;
}) {
  const isFolder = node.type === "folder";
  const isExpanded = expandedFolders.includes(node.name);
  const isSelected = selectedFile === node.name;

  return (
    <div>
      <button
        className={cn(
          "flex items-center gap-1.5 w-full text-left px-2 py-1 text-sm rounded-sm hover:bg-accent hover:text-accent-foreground transition-colors",
          isSelected && !isFolder && "bg-accent text-accent-foreground font-medium"
        )}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
        onClick={() => {
          if (isFolder) {
            onToggleFolder(node.name);
          } else {
            onSelect(node.name);
          }
        }}
      >
        {isFolder ? (
          isExpanded ? (
            <Icons.ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
          ) : (
            <Icons.ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
          )
        ) : (
          <Icons.File className="h-3.5 w-3.5 text-muted-foreground" />
        )}
        {isFolder ? (
          isExpanded ? (
            <Icons.FolderOpen className="h-3.5 w-3.5 text-yellow-500" />
          ) : (
            <Icons.Folder className="h-3.5 w-3.5 text-yellow-500" />
          )
        ) : null}
        <span className="truncate">{node.name}</span>
      </button>
      {isFolder && isExpanded && node.children && (
        <div>
          {node.children.map((child) => (
            <FileTreeItem
              key={child.name}
              node={child}
              depth={depth + 1}
              selectedFile={selectedFile}
              onSelect={onSelect}
              expandedFolders={expandedFolders}
              onToggleFolder={onToggleFolder}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function CodeEditor() {
  const [selectedFile, setSelectedFile] = useAppState<string>("editorSelectedFile", "index.tsx");
  const [activeTab, setActiveTab] = useAppState<string>("editorActiveTab", "index.tsx");
  const [openTabs, setOpenTabs] = useAppState<string[]>("editorOpenTabs", ["index.tsx", "styles.css", "utils.ts"]);
  const [expandedFolders, setExpandedFolders] = useAppState<string[]>("editorExpandedFolders", ["src", "components"]);
  const [rightTab, setRightTab] = useAppState<string>("editorRightTab", "preview");

  const handleSelectFile = (name: string) => {
    setSelectedFile(name);
    setActiveTab(name);
    if (!(openTabs || []).includes(name)) {
      setOpenTabs([...(openTabs || []), name]);
    }
  };

  const handleCloseTab = (name: string) => {
    const tabs = (openTabs || []).filter((t: string) => t !== name);
    setOpenTabs(tabs);
    if (activeTab === name) {
      setActiveTab(tabs.length > 0 ? tabs[tabs.length - 1] : "");
      setSelectedFile(tabs.length > 0 ? tabs[tabs.length - 1] : "");
    }
  };

  const toggleFolder = (name: string) => {
    const folders = expandedFolders || [];
    if (folders.includes(name)) {
      setExpandedFolders(folders.filter((f: string) => f !== name));
    } else {
      setExpandedFolders([...folders, name]);
    }
  };

  const currentContent = FILE_CONTENTS[selectedFile || "index.tsx"] || "// No content available";

  return (
    <Card className="overflow-hidden border">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-2 bg-muted/50">
        <Icons.Code className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium">Code Editor</span>
        <div className="flex-1" />
        <Button variant="ghost" size="sm" className="h-7 w-7 p-0">
          <Icons.Settings className="h-3.5 w-3.5" />
        </Button>
        <Button variant="ghost" size="sm" className="h-7 w-7 p-0">
          <Icons.Maximize2 className="h-3.5 w-3.5" />
        </Button>
      </div>
      <Separator />

      {/* Main Content */}
      <div style={{ height: "480px" }}>
        <ResizablePanelGroup direction="horizontal">
          {/* File Tree Panel */}
          <ResizablePanel defaultSize={20} minSize={15} maxSize={35}>
            <div className="h-full flex flex-col">
              <div className="px-3 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Explorer
              </div>
              <ScrollArea className="flex-1">
                <div className="pb-4">
                  {FILE_TREE.map((node) => (
                    <FileTreeItem
                      key={node.name}
                      node={node}
                      depth={0}
                      selectedFile={selectedFile || ""}
                      onSelect={handleSelectFile}
                      expandedFolders={expandedFolders || []}
                      onToggleFolder={toggleFolder}
                    />
                  ))}
                </div>
                <ScrollBar orientation="vertical" />
              </ScrollArea>
            </div>
          </ResizablePanel>

          <ResizableHandle withHandle />

          {/* Code Panel */}
          <ResizablePanel defaultSize={55} minSize={30}>
            <div className="h-full flex flex-col">
              <Tabs
                value={activeTab || "index.tsx"}
                onValueChange={(val: string) => {
                  setActiveTab(val);
                  setSelectedFile(val);
                }}
              >
                <div className="bg-muted/30">
                  <TabsList className="h-9 rounded-none bg-transparent p-0 border-b w-full justify-start">
                    {(openTabs || []).map((tab: string) => (
                      <TabsTrigger
                        key={tab}
                        value={tab}
                        className="relative rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-background h-9 px-3 text-xs"
                      >
                        <Icons.File className="h-3 w-3 mr-1.5 text-muted-foreground" />
                        {tab}
                        <button
                          className="ml-2 hover:bg-accent rounded-sm p-0.5"
                          onClick={(e: React.MouseEvent) => {
                            e.stopPropagation();
                            handleCloseTab(tab);
                          }}
                        >
                          <Icons.X className="h-3 w-3" />
                        </button>
                      </TabsTrigger>
                    ))}
                  </TabsList>
                </div>
                {(openTabs || []).map((tab: string) => (
                  <TabsContent key={tab} value={tab} className="m-0 p-0">
                    <ScrollArea className="h-[440px]">
                      <pre className="p-4 text-xs font-mono leading-relaxed text-foreground">
                        <code>{FILE_CONTENTS[tab] || "// Empty file"}</code>
                      </pre>
                      <ScrollBar orientation="horizontal" />
                      <ScrollBar orientation="vertical" />
                    </ScrollArea>
                  </TabsContent>
                ))}
              </Tabs>
            </div>
          </ResizablePanel>

          <ResizableHandle withHandle />

          {/* Preview Panel */}
          <ResizablePanel defaultSize={25} minSize={15} maxSize={40}>
            <div className="h-full flex flex-col">
              <Tabs
                value={rightTab || "preview"}
                onValueChange={(val: string) => setRightTab(val)}
              >
                <div className="bg-muted/30">
                  <TabsList className="h-9 rounded-none bg-transparent p-0 border-b w-full justify-start">
                    <TabsTrigger
                      value="preview"
                      className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-background h-9 px-3 text-xs"
                    >
                      <Icons.Eye className="h-3 w-3 mr-1.5" />
                      Preview
                    </TabsTrigger>
                    <TabsTrigger
                      value="console"
                      className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-background h-9 px-3 text-xs"
                    >
                      <Icons.Terminal className="h-3 w-3 mr-1.5" />
                      Console
                    </TabsTrigger>
                  </TabsList>
                </div>
                <TabsContent value="preview" className="m-0 p-0">
                  <ScrollArea className="h-[440px]">
                    <div className="p-4 space-y-3">
                      <div className="rounded-md border bg-background p-4">
                        <div className="border-b pb-2 mb-3">
                          <div className="flex items-center gap-2 text-sm">
                            <span className="font-medium">My App</span>
                            <span className="text-muted-foreground">|</span>
                            <span className="text-xs text-muted-foreground">Home</span>
                            <span className="text-xs text-muted-foreground">About</span>
                            <span className="text-xs text-muted-foreground">Contact</span>
                          </div>
                        </div>
                        <h3 className="text-lg font-bold mb-1">Welcome</h3>
                        <p className="text-sm text-muted-foreground">
                          This is the main content area.
                        </p>
                        <div className="border-t mt-3 pt-2">
                          <p className="text-xs text-muted-foreground">
                            &copy; 2026 My App. All rights reserved.
                          </p>
                        </div>
                      </div>
                    </div>
                    <ScrollBar orientation="vertical" />
                  </ScrollArea>
                </TabsContent>
                <TabsContent value="console" className="m-0 p-0">
                  <ScrollArea className="h-[440px]">
                    <div className="p-4 font-mono text-xs space-y-1">
                      <p className="text-green-600">[info] Server started on port 3000</p>
                      <p className="text-muted-foreground">[build] Compiled successfully in 243ms</p>
                      <p className="text-muted-foreground">[hmr] Connected to dev server</p>
                      <p className="text-yellow-600">[warn] React.StrictMode is enabled</p>
                      <p className="text-muted-foreground">[info] Watching for file changes...</p>
                    </div>
                    <ScrollBar orientation="vertical" />
                  </ScrollArea>
                </TabsContent>
              </Tabs>
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
    </Card>
  );
}

export default CodeEditor;
