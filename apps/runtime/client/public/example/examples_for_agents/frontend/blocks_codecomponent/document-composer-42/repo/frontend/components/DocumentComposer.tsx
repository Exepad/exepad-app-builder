import {
  React,
  useAppState,
  useFileUpload,
  useTheme,
  Popover,
  PopoverTrigger,
  PopoverContent,
  Sheet,
  SheetTrigger,
  SheetContent,
  SheetHeader,
  SheetTitle,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  Card,
  CardContent,
  Button,
  Progress,
  Icons,
  cn,
} from "@exepad/sdk";
import * as SlateModule from "@exepad/ext-slate";
// esm.sh may export slate APIs on default or as named exports
// Default must come last so APIs like createEditor, Transforms, etc. are not overridden

type CustomElement =
  | { type: "paragraph"; children: CustomText[] }
  | { type: "heading"; level: number; children: CustomText[] }
  | { type: "blockquote"; children: CustomText[] }
  | { type: "code-block"; children: CustomText[] };

type CustomText = {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
};

const INITIAL_VALUE: CustomElement[] = [
  {
    type: "heading",
    level: 1,
    children: [{ text: "Document Composer" }],
  },
  {
    type: "paragraph",
    children: [
      { text: "Welcome to the " },
      { text: "Document Composer", bold: true },
      { text: ". This is a rich document editor built with " },
      { text: "Slate.js", italic: true },
      { text: ". Start editing to see it in action." },
    ],
  },
  {
    type: "heading",
    level: 2,
    children: [{ text: "Features" }],
  },
  {
    type: "paragraph",
    children: [
      { text: "The editor supports multiple block types including paragraphs, headings, blockquotes, and code blocks. Text can be formatted with " },
      { text: "bold", bold: true },
      { text: ", " },
      { text: "italic", italic: true },
      { text: ", and " },
      { text: "underline", underline: true },
      { text: " styles." },
    ],
  },
  {
    type: "blockquote",
    children: [
      {
        text: "The best way to predict the future is to invent it. - Alan Kay",
      },
    ],
  },
  {
    type: "code-block",
    children: [
      {
        text: 'const editor = createEditor();\nconst value = editor.children;\nconsole.log("Document ready!");',
      },
    ],
  },
  {
    type: "heading",
    level: 2,
    children: [{ text: "Getting Started" }],
  },
  {
    type: "paragraph",
    children: [
      { text: "Select text to see the hovering toolbar. Use the block type dropdown to change element types. Open the outline panel to navigate through headings." },
    ],
  },
];

const BLOCK_TYPES = [
  { value: "paragraph", label: "Paragraph" },
  { value: "heading-1", label: "Heading 1" },
  { value: "heading-2", label: "Heading 2" },
  { value: "heading-3", label: "Heading 3" },
  { value: "blockquote", label: "Blockquote" },
  { value: "code-block", label: "Code Block" },
];

// Guard: createEditor and Transforms come from the base 'slate' package,
// while slate-react provides Slate, Editable, withReact, etc.
// If the base slate APIs are missing, show a graceful fallback.
const hasSlateCore =
  typeof Slate.createEditor === "function" &&
  typeof Slate.withReact === "function" &&
  Slate.Slate &&
  Slate.Editable;

function DocumentComposer() {
  const [docState, setDocState] = useAppState<string>(
    "composerContent",
    JSON.stringify(INITIAL_VALUE)
  );
  const [saveProgress, setSaveProgress] = React.useState(0);
  const [isSaving, setIsSaving] = React.useState(false);
  const [lastSaved, setLastSaved] = React.useState<Date | null>(null);
  const fileUpload = useFileUpload();
  const theme = useTheme();

  const parsedValue = React.useMemo(() => {
    try {
      return JSON.parse(docState ?? JSON.stringify(INITIAL_VALUE));
    } catch {
      return INITIAL_VALUE;
    }
  }, [docState]);

  const editorRef = React.useRef<Slate.Editor | null>(null);
  if (!editorRef.current) {
    editorRef.current = Slate.withReact(Slate.createEditor());
  }
  const editor = editorRef.current;

  const isDark = theme?.resolvedTheme === "dark";

  const outline = React.useMemo(() => {
    return parsedValue
      .filter((node: CustomElement) => node.type === "heading")
      .map((node: CustomElement & { level: number }, idx: number) => ({
        id: idx,
        text: node.children.map((c: CustomText) => c.text).join(""),
        level: node.level || 1,
      }));
  }, [parsedValue]);

  const handleChange = React.useCallback(
    (value: CustomElement[]) => {
      const content = JSON.stringify(value);
      setDocState(content);
    },
    [setDocState]
  );

  // Autosave simulation
  React.useEffect(() => {
    const timer = setTimeout(() => {
      setIsSaving(true);
      setSaveProgress(0);
      let progress = 0;
      const interval = setInterval(() => {
        progress += 25;
        setSaveProgress(progress);
        if (progress >= 100) {
          clearInterval(interval);
          setIsSaving(false);
          setLastSaved(new Date());
        }
      }, 200);
    }, 2000);
    return () => clearTimeout(timer);
  }, [docState]);

  const renderElement = React.useCallback(
    (props: { attributes: Record<string, unknown>; children: React.ReactNode; element: CustomElement }) => {
      switch (props.element.type) {
        case "heading": {
          const el = props.element as CustomElement & { level: number };
          const Tag = `h${el.level}` as keyof JSX.IntrinsicElements;
          const sizes: Record<number, string> = {
            1: "text-3xl font-bold mt-6 mb-3",
            2: "text-2xl font-semibold mt-5 mb-2",
            3: "text-xl font-medium mt-4 mb-2",
          };
          return (
            <Tag {...props.attributes} className={sizes[el.level] || sizes[1]}>
              {props.children}
            </Tag>
          );
        }
        case "blockquote":
          return (
            <blockquote
              {...props.attributes}
              className="border-l-4 border-rose-300 pl-4 py-2 my-3 italic text-muted-foreground bg-muted/30 rounded-r"
            >
              {props.children}
            </blockquote>
          );
        case "code-block":
          return (
            <pre
              {...props.attributes}
              className="bg-muted rounded-lg p-4 my-3 font-mono text-sm overflow-auto"
            >
              <code>{props.children}</code>
            </pre>
          );
        default:
          return (
            <p {...props.attributes} className="my-2 leading-relaxed">
              {props.children}
            </p>
          );
      }
    },
    []
  );

  const renderLeaf = React.useCallback(
    (props: { attributes: Record<string, unknown>; children: React.ReactNode; leaf: CustomText }) => {
      let { children } = props;
      if (props.leaf.bold) {
        children = <strong>{children}</strong>;
      }
      if (props.leaf.italic) {
        children = <em>{children}</em>;
      }
      if (props.leaf.underline) {
        children = <u>{children}</u>;
      }
      return <span {...props.attributes}>{children}</span>;
    },
    []
  );

  const toggleMark = React.useCallback(
    (mark: "bold" | "italic" | "underline") => {
      const isActive = Slate.Editor.marks(editor)?.[mark] === true;
      if (isActive) {
        Slate.Editor.removeMark(editor, mark);
      } else {
        Slate.Editor.addMark(editor, mark, true);
      }
    },
    [editor]
  );

  const isMarkActive = React.useCallback(
    (mark: "bold" | "italic" | "underline") => {
      const marks = Slate.Editor.marks(editor);
      return marks ? marks[mark] === true : false;
    },
    [editor]
  );

  const handleBlockChange = React.useCallback(
    (value: string) => {
      if (value.startsWith("heading-")) {
        const level = parseInt(value.split("-")[1], 10);
        Slate.Transforms.setNodes(editor, { type: "heading", level } as Partial<CustomElement>);
      } else {
        Slate.Transforms.setNodes(editor, { type: value as CustomElement["type"] } as Partial<CustomElement>);
      }
    },
    [editor]
  );

  const handleFileUpload = React.useCallback(() => {
    if (fileUpload) {
      fileUpload.open();
    }
  }, [fileUpload]);

  return (
    <div className="space-y-4">
      {/* Top Toolbar */}
      <Card>
        <CardContent className="py-3 px-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Select onValueChange={handleBlockChange}>
                <SelectTrigger className="w-[150px] h-8">
                  <SelectValue placeholder="Block type" />
                </SelectTrigger>
                <SelectContent>
                  {BLOCK_TYPES.map((bt) => (
                    <SelectItem key={bt.value} value={bt.value}>
                      {bt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <div className="flex items-center border rounded-md">
                <Button
                  variant="ghost"
                  size="sm"
                  onMouseDown={(e: React.MouseEvent) => {
                    e.preventDefault();
                    toggleMark("bold");
                  }}
                  className={cn(
                    "h-8 w-8 p-0 rounded-none",
                    isMarkActive("bold") && "bg-accent"
                  )}
                >
                  <Icons.Bold className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onMouseDown={(e: React.MouseEvent) => {
                    e.preventDefault();
                    toggleMark("italic");
                  }}
                  className={cn(
                    "h-8 w-8 p-0 rounded-none",
                    isMarkActive("italic") && "bg-accent"
                  )}
                >
                  <Icons.Italic className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onMouseDown={(e: React.MouseEvent) => {
                    e.preventDefault();
                    toggleMark("underline");
                  }}
                  className={cn(
                    "h-8 w-8 p-0 rounded-none",
                    isMarkActive("underline") && "bg-accent"
                  )}
                >
                  <Icons.Underline className="h-4 w-4" />
                </Button>
              </div>

              <Button
                variant="outline"
                size="sm"
                onClick={handleFileUpload}
                className="h-8"
              >
                <Icons.Image className="mr-1 h-4 w-4" />
                Image
              </Button>
            </div>

            <div className="flex items-center gap-3">
              {isSaving && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Icons.Loader2 className="h-3 w-3 animate-spin" />
                  Saving...
                  <Progress value={saveProgress} className="w-16 h-1.5" />
                </div>
              )}
              {!isSaving && lastSaved && (
                <span className="text-xs text-muted-foreground">
                  Saved {lastSaved.toLocaleTimeString()}
                </span>
              )}

              <Sheet>
                <SheetTrigger asChild>
                  <Button variant="outline" size="sm" className="h-8">
                    <Icons.List className="mr-1 h-4 w-4" />
                    Outline
                  </Button>
                </SheetTrigger>
                <SheetContent>
                  <SheetHeader>
                    <SheetTitle>Document Outline</SheetTitle>
                  </SheetHeader>
                  <div className="mt-4 space-y-1">
                    {outline.length === 0 ? (
                      <p className="text-sm text-muted-foreground py-4">
                        No headings found. Add headings to see the outline.
                      </p>
                    ) : (
                      outline.map(
                        (item: { id: number; text: string; level: number }) => (
                          <button
                            key={item.id}
                            className={cn(
                              "w-full text-left text-sm px-3 py-2 rounded-md hover:bg-muted transition-colors",
                              item.level === 1 && "font-semibold",
                              item.level === 2 && "pl-6",
                              item.level === 3 && "pl-9 text-muted-foreground"
                            )}
                          >
                            {item.text}
                          </button>
                        )
                      )
                    )}
                  </div>
                </SheetContent>
              </Sheet>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Editor */}
      <Card className="overflow-hidden">
        <CardContent className="p-0">
          <div className={cn(
            "min-h-[500px] px-8 py-6",
            isDark ? "bg-background" : "bg-white"
          )}>
            <Slate.Slate
              editor={editor}
              initialValue={parsedValue}
              onChange={handleChange}
            >
              <Slate.Editable
                renderElement={renderElement}
                renderLeaf={renderLeaf}
                placeholder="Start composing your document..."
                className="outline-hidden min-h-[480px]"
                spellCheck
              />
            </Slate.Slate>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// Wrapper that checks for Slate availability before rendering the editor
// (avoids calling hooks conditionally inside DocumentComposer)
function DocumentComposerGuard() {
  if (!hasSlateCore) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-muted-foreground">
          Slate editor requires the full bundle (production mode). Only slate-react is loaded; createEditor and core APIs require the base slate package.
        </CardContent>
      </Card>
    );
  }
  return <DocumentComposer />;
}

export default DocumentComposerGuard;
