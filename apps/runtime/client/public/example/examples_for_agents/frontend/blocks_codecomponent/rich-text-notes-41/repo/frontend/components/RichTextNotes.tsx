import {
  React,
  useAppState,
  useHandler,
  toast,
  useCurrentUser,
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardFooter,
  Button,
  ButtonGroup,
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  Input,
  Label,
  Separator,
  Badge,
  Icons,
  cn,
} from "@exepad/sdk";
import * as TipTapModule from "@exepad/ext-tiptap";
// esm.sh may export tiptap APIs on default or as named exports
// Default must come last so APIs like StarterKit.configure() are not overridden

// Eagerly test whether TipTap can actually build a valid ProseMirror schema.
// On esm.sh the StarterKit sub-extensions (Document, Paragraph, Text) may be
// missing, which causes `RangeError: Schema is missing its top node type ('doc')`.
const hasTipTapCore: boolean = (() => {
  try {
    if (typeof TipTap.useEditor !== "function" || !TipTap.EditorContent) return false;
    if (!TipTap.StarterKit) return false;
    // Attempt a lightweight editor creation to surface schema errors early
    const { Editor } = TipTap;
    if (typeof Editor === "function") {
      const testEditor = new Editor({
        extensions: [TipTap.StarterKit.configure({})],
        content: "",
      });
      testEditor.destroy();
    }
    return true;
  } catch {
    return false;
  }
})();

function RichTextNotes() {
  const [savedContent, setSavedContent] = useAppState<string>(
    "noteContent",
    "<p>Start writing your notes here...</p>"
  );
  const [linkUrl, setLinkUrl] = React.useState("");
  const [linkOpen, setLinkOpen] = React.useState(false);
  const [wordCount, setWordCount] = React.useState(0);
  const [charCount, setCharCount] = React.useState(0);
  const saveNote = useHandler("saveNote");
  const currentUser = useCurrentUser();

  // Build extensions list safely — StarterKit, Placeholder, and Link come from
  // separate @tiptap packages and may not be available via esm.sh
  const extensions = React.useMemo(() => {
    const exts: any[] = [];
    try {
      if (TipTap.StarterKit) {
        exts.push(TipTap.StarterKit.configure({ heading: { levels: [1, 2, 3] } }));
      }
    } catch {}
    try {
      if (TipTap.Placeholder) {
        exts.push(TipTap.Placeholder.configure({ placeholder: "Start writing your note..." }));
      }
    } catch {}
    try {
      if (TipTap.Link) {
        exts.push(TipTap.Link.configure({ openOnClick: false, HTMLAttributes: { class: "text-primary underline cursor-pointer" } }));
      }
    } catch {}
    return exts;
  }, []);

  const editor = TipTap.useEditor({
    extensions,
    content: savedContent ?? "<p>Start writing your notes here...</p>",
    onUpdate: ({ editor: ed }: { editor: { getText: () => string; getHTML: () => string; storage: { characterCount?: { words: () => number; characters: () => number } } } }) => {
      const text = ed.getText();
      const words = text
        .trim()
        .split(/\s+/)
        .filter((w: string) => w.length > 0).length;
      setWordCount(words);
      setCharCount(text.length);
    },
  });

  const handleSave = React.useCallback(() => {
    if (!editor) return;
    const html = editor.getHTML();
    setSavedContent(html);
    saveNote({ content: html });
    toast.success("Note saved successfully!");
  }, [editor, setSavedContent, saveNote]);

  const handleInsertLink = React.useCallback(() => {
    if (!editor || !linkUrl) return;
    editor
      .chain()
      .focus()
      .extendMarkRange("link")
      .setLink({ href: linkUrl })
      .run();
    setLinkUrl("");
    setLinkOpen(false);
  }, [editor, linkUrl]);

  const handleRemoveLink = React.useCallback(() => {
    if (!editor) return;
    editor.chain().focus().unsetLink().run();
  }, [editor]);

  if (!editor) return null;

  const authorName = currentUser?.name || currentUser?.email || "Anonymous";

  return (
    <Card className="overflow-hidden">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Icons.FileText className="h-5 w-5 text-amber-600" />
            Rich Text Notes
          </CardTitle>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-xs">
              <Icons.User className="h-3 w-3 mr-1" />
              {authorName}
            </Badge>
            <Button
              onClick={handleSave}
              className="bg-amber-600 hover:bg-amber-700"
            >
              <Icons.Save className="mr-2 h-4 w-4" />
              Save
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-0">
        {/* Toolbar */}
        <div className="border-y border-border px-4 py-2 flex items-center gap-1 flex-wrap bg-muted/30">
          <ButtonGroup>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => editor.chain().focus().toggleBold().run()}
              className={cn(
                "h-8 w-8 p-0",
                editor.isActive("bold") && "bg-accent text-accent-foreground"
              )}
            >
              <Icons.Bold className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => editor.chain().focus().toggleItalic().run()}
              className={cn(
                "h-8 w-8 p-0",
                editor.isActive("italic") && "bg-accent text-accent-foreground"
              )}
            >
              <Icons.Italic className="h-4 w-4" />
            </Button>
          </ButtonGroup>

          <Separator orientation="vertical" className="h-6 mx-1" />

          <ButtonGroup>
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                editor.chain().focus().toggleHeading({ level: 1 }).run()
              }
              className={cn(
                "h-8 px-2 text-xs",
                editor.isActive("heading", { level: 1 }) &&
                  "bg-accent text-accent-foreground"
              )}
            >
              H1
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                editor.chain().focus().toggleHeading({ level: 2 }).run()
              }
              className={cn(
                "h-8 px-2 text-xs",
                editor.isActive("heading", { level: 2 }) &&
                  "bg-accent text-accent-foreground"
              )}
            >
              H2
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                editor.chain().focus().toggleHeading({ level: 3 }).run()
              }
              className={cn(
                "h-8 px-2 text-xs",
                editor.isActive("heading", { level: 3 }) &&
                  "bg-accent text-accent-foreground"
              )}
            >
              H3
            </Button>
          </ButtonGroup>

          <Separator orientation="vertical" className="h-6 mx-1" />

          <ButtonGroup>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => editor.chain().focus().toggleBulletList().run()}
              className={cn(
                "h-8 w-8 p-0",
                editor.isActive("bulletList") &&
                  "bg-accent text-accent-foreground"
              )}
            >
              <Icons.List className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => editor.chain().focus().toggleOrderedList().run()}
              className={cn(
                "h-8 w-8 p-0",
                editor.isActive("orderedList") &&
                  "bg-accent text-accent-foreground"
              )}
            >
              <Icons.ListOrdered className="h-4 w-4" />
            </Button>
          </ButtonGroup>

          <Separator orientation="vertical" className="h-6 mx-1" />

          <Button
            variant="ghost"
            size="sm"
            onClick={() => editor.chain().focus().toggleBlockquote().run()}
            className={cn(
              "h-8 w-8 p-0",
              editor.isActive("blockquote") &&
                "bg-accent text-accent-foreground"
            )}
          >
            <Icons.Quote className="h-4 w-4" />
          </Button>

          <Button
            variant="ghost"
            size="sm"
            onClick={() => editor.chain().focus().toggleCodeBlock().run()}
            className={cn(
              "h-8 w-8 p-0",
              editor.isActive("codeBlock") &&
                "bg-accent text-accent-foreground"
            )}
          >
            <Icons.Code className="h-4 w-4" />
          </Button>

          <Separator orientation="vertical" className="h-6 mx-1" />

          <Dialog open={linkOpen} onOpenChange={setLinkOpen}>
            <DialogTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className={cn(
                  "h-8 w-8 p-0",
                  editor.isActive("link") && "bg-accent text-accent-foreground"
                )}
              >
                <Icons.Link className="h-4 w-4" />
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>Insert Link</DialogTitle>
              </DialogHeader>
              <div className="space-y-3 py-4">
                <div className="space-y-2">
                  <Label htmlFor="link-url">URL</Label>
                  <Input
                    id="link-url"
                    value={linkUrl}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                      setLinkUrl(e.target.value)
                    }
                    placeholder="https://example.com"
                  />
                </div>
              </div>
              <DialogFooter className="gap-2">
                {editor.isActive("link") && (
                  <Button
                    variant="destructive"
                    onClick={handleRemoveLink}
                  >
                    Remove Link
                  </Button>
                )}
                <Button onClick={handleInsertLink}>
                  Insert Link
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        {/* Editor */}
        <div className="min-h-[400px] px-6 py-4 prose prose-sm dark:prose-invert max-w-none [&_.ProseMirror]:outline-hidden [&_.ProseMirror]:min-h-[380px]">
          <TipTap.EditorContent editor={editor} />
        </div>
      </CardContent>

      <CardFooter className="flex items-center justify-between py-2 px-4 text-sm text-muted-foreground bg-muted/30 border-t">
        <div className="flex items-center gap-3">
          <span>{wordCount} words</span>
          <span>{charCount} characters</span>
        </div>
        <Badge variant="secondary" className="text-xs">
          Rich Text Editor
        </Badge>
      </CardFooter>
    </Card>
  );
}

// Wrapper that checks for TipTap availability before rendering the editor
// (avoids calling hooks conditionally inside RichTextNotes)
function RichTextNotesGuard() {
  if (!hasTipTapCore) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          <Icons.FileText className="h-8 w-8 mx-auto mb-2 opacity-40" />
          <p className="text-sm">Rich Text Editor requires the full TipTap bundle (production mode)</p>
        </CardContent>
      </Card>
    );
  }
  return <RichTextNotes />;
}

export default RichTextNotesGuard;
