import {
  React,
  useHandler,
  useCurrentUser,
  useAppState,
  toast,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardFooter,
  Button,
  Badge,
  Kbd,
  Icons,
  cn,
} from "@exepad/sdk";
import * as CodeMirrorModule from "@exepad/ext-codemirror";
// esm.sh may export codemirror APIs on default or as named exports

const LANGUAGE_MODES = [
  { value: "javascript", label: "JavaScript", mode: CodeMirror.javascript },
  { value: "python", label: "Python", mode: CodeMirror.python },
  { value: "html", label: "HTML", mode: CodeMirror.html },
  { value: "css", label: "CSS", mode: CodeMirror.css },
];

const DEFAULT_CODE = `// Welcome to the Collaborative Editor
// Select a language and start coding!

function greet(name) {
  return \`Hello, \${name}!\`;
}

console.log(greet("World"));
`;

function CollaborativeEditor() {
  const [content, setContent] = useAppState<string>("editorContent", DEFAULT_CODE);
  const [language, setLanguage] = useAppState<string>("editorLanguage", "javascript");
  const [cursorLine, setCursorLine] = React.useState(1);
  const [cursorCol, setCursorCol] = React.useState(1);
  const [charCount, setCharCount] = React.useState(DEFAULT_CODE.length);
  const editorRef = React.useRef<HTMLDivElement>(null);
  const viewRef = React.useRef<CodeMirror.EditorView | null>(null);
  const saveSnippet = useHandler("saveSnippet");
  const currentUser = useCurrentUser();

  const activeContent = content ?? DEFAULT_CODE;
  const activeLanguage = language ?? "javascript";

  const cmAvailable = !!(CodeMirror.EditorView && CodeMirror.basicSetup);

  const selectedMode = React.useMemo(() => {
    const found = LANGUAGE_MODES.find((m) => m.value === activeLanguage);
    return found?.mode ? found.mode : CodeMirror.javascript;
  }, [activeLanguage]);

  React.useEffect(() => {
    if (!editorRef.current || !cmAvailable) return;

    const updateListener = CodeMirror.EditorView.updateListener.of(
      (update: { docChanged: boolean; state: { doc: { toString: () => string; length: number }; selection: { main: { head: number } } } }) => {
        if (update.docChanged) {
          const doc = update.state.doc.toString();
          setContent(doc);
          setCharCount(update.state.doc.length);
        }
        const pos = update.state.selection.main.head;
        const line = update.state.doc.lineAt(pos);
        setCursorLine(line.number);
        setCursorCol(pos - line.from + 1);
      }
    );

    const extensions: any[] = [CodeMirror.basicSetup, updateListener, CodeMirror.EditorView.theme({
      "&": { height: "400px", fontSize: "14px" },
      ".cm-scroller": { overflow: "auto" },
      ".cm-content": { fontFamily: "monospace" },
    })];
    if (typeof selectedMode === "function") {
      extensions.splice(1, 0, selectedMode());
    }

    const view = new CodeMirror.EditorView({
      doc: activeContent,
      extensions,
      parent: editorRef.current,
    });

    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [activeLanguage]);

  const handleSave = React.useCallback(() => {
    saveSnippet({ content: activeContent, language: activeLanguage });
    toast.success("Snippet saved successfully!");
  }, [saveSnippet, activeContent, activeLanguage]);

  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        handleSave();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleSave]);

  const lineCount = React.useMemo(() => {
    return activeContent.split("\n").length;
  }, [activeContent]);

  const authorName = currentUser?.name || currentUser?.email || "Anonymous";

  return (
    <Card className="overflow-hidden">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Icons.Code className="h-5 w-5 text-emerald-600" />
            Collaborative Editor
          </CardTitle>
          <div className="flex items-center gap-2">
            <Select
              value={activeLanguage}
              onValueChange={(val: string) => setLanguage(val)}
            >
              <SelectTrigger className="w-[160px]">
                <SelectValue placeholder="Language" />
              </SelectTrigger>
              <SelectContent>
                {LANGUAGE_MODES.map((lang) => (
                  <SelectItem key={lang.value} value={lang.value}>
                    {lang.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button onClick={handleSave} className="bg-emerald-600 hover:bg-emerald-700">
              <Icons.Save className="mr-2 h-4 w-4" />
              Save
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-0">
        {cmAvailable ? (
          <div
            ref={editorRef}
            className="border-y border-border"
          />
        ) : (
          <textarea
            className="border-y border-border w-full font-mono text-sm p-4 outline-hidden resize-none bg-background"
            style={{ height: "400px" }}
            value={activeContent}
            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => {
              setContent(e.target.value);
              setCharCount(e.target.value.length);
              const lines = e.target.value.substring(0, e.target.selectionStart).split("\n");
              setCursorLine(lines.length);
              setCursorCol(lines[lines.length - 1].length + 1);
            }}
          />
        )}
      </CardContent>

      <CardFooter className="flex items-center justify-between py-2 px-4 text-sm text-muted-foreground bg-muted/30">
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-1">
            <Icons.User className="h-3.5 w-3.5" />
            {authorName}
          </span>
          <Badge variant="outline" className="text-xs">
            {LANGUAGE_MODES.find((m) => m.value === activeLanguage)?.label ?? activeLanguage}
          </Badge>
        </div>
        <div className="flex items-center gap-4">
          <span>
            Ln {cursorLine}, Col {cursorCol}
          </span>
          <span>{charCount} chars</span>
          <span>{lineCount} lines</span>
          <span className="flex items-center gap-1">
            <Kbd>Ctrl</Kbd>+<Kbd>S</Kbd> to save
          </span>
        </div>
      </CardFooter>
    </Card>
  );
}

export default CollaborativeEditor;
