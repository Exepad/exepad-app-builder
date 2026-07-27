import {
  React,
  useModel,
  useHandler,
  useAppState,
  toast,
  ScrollArea,
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogAction,
  AlertDialogCancel,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  Card,
  CardContent,
  Button,
  Badge,
  Separator,
  Icons,
  cn,
} from "@exepad/sdk";
import * as ProseMirrorModule from "@exepad/ext-prosemirror";
// esm.sh may export prosemirror APIs on default or as named exports
// Default must come last so APIs like Schema, EditorState, EditorView are not overridden

interface WikiPage {
  id: string;
  title: string;
  status: "draft" | "published";
  lastModified: string;
  content: string;
}

const DEMO_PAGES: WikiPage[] = [
  {
    id: "w1",
    title: "Welcome to the Wiki",
    status: "published",
    lastModified: "2024-03-10",
    content: "# Welcome\n\nThis is the main wiki page. It serves as the entry point for all documentation.\n\n## Quick Links\n\n- Getting Started Guide\n- API Documentation\n- Architecture Overview\n- Contributing Guidelines\n\n> **Note:** This wiki is collaboratively edited. Please follow the style guide when making changes.",
  },
  {
    id: "w2",
    title: "Architecture Overview",
    status: "published",
    lastModified: "2024-03-08",
    content: "# Architecture Overview\n\nThe system follows a microservices architecture with the following components:\n\n## Services\n\n- **API Gateway** - Routes requests to appropriate services\n- **Auth Service** - Handles authentication and authorization\n- **Data Service** - Manages persistent storage\n- **Notification Service** - Sends emails and push notifications\n\n## Communication\n\nServices communicate via:\n1. REST APIs for synchronous requests\n2. Message queues for asynchronous processing\n3. gRPC for internal high-performance calls",
  },
  {
    id: "w3",
    title: "API Documentation",
    status: "draft",
    lastModified: "2024-03-12",
    content: "# API Documentation\n\n## Endpoints\n\n### Authentication\n\n| Method | Path | Description |\n|--------|------|-------------|\n| POST | /auth/login | User login |\n| POST | /auth/register | New user registration |\n| POST | /auth/refresh | Refresh access token |\n\n### Users\n\n| Method | Path | Description |\n|--------|------|-------------|\n| GET | /users/me | Get current user profile |\n| PUT | /users/me | Update current user |\n\n> This documentation is still in draft. Please review before publishing.",
  },
  {
    id: "w4",
    title: "Contributing Guidelines",
    status: "published",
    lastModified: "2024-03-05",
    content: "# Contributing Guidelines\n\nThank you for your interest in contributing!\n\n## Process\n\n1. Fork the repository\n2. Create a feature branch\n3. Make your changes\n4. Write or update tests\n5. Submit a pull request\n\n## Code Style\n\n- Use TypeScript for all new code\n- Follow the existing naming conventions\n- Add JSDoc comments for public APIs\n- Keep functions small and focused\n\n## Review Process\n\nAll contributions require at least one review from a maintainer before merging.",
  },
  {
    id: "w5",
    title: "Deployment Guide",
    status: "draft",
    lastModified: "2024-03-11",
    content: "# Deployment Guide\n\n## Prerequisites\n\n- Docker and Docker Compose\n- Kubernetes cluster (production)\n- CI/CD pipeline access\n\n## Development\n\n```\ndocker-compose up -d\n```\n\n## Staging\n\nStaging deployments are automatic on merge to the `develop` branch.\n\n## Production\n\nProduction deployments require:\n1. Approval from at least two team leads\n2. All CI checks passing\n3. Staging verification complete\n\n> **Warning:** Always perform a database backup before production deployments.",
  },
];

// Guard: prosemirror-view is the only loaded package; Schema, EditorState, etc.
// come from separate prosemirror packages that may not be bundled via esm.sh
const hasProseMirrorFull =
  typeof ProseMirror.Schema === "function" &&
  typeof ProseMirror.EditorState?.create === "function" &&
  typeof ProseMirror.EditorView === "function";

function WikiEditor() {
  const [activePageId, setActivePageId] = useAppState<string>("wikiActivePage", "w1");
  const [pages, setPages] = React.useState<WikiPage[]>(DEMO_PAGES);
  const [publishDialogOpen, setPublishDialogOpen] = React.useState(false);
  const editorRef = React.useRef<HTMLDivElement>(null);
  const viewRef = React.useRef<any>(null);
  const model = useModel();
  const publishPage = useHandler("publishPage");

  const currentId = activePageId ?? "w1";
  const currentPage = pages.find((p) => p.id === currentId) ?? pages[0];

  // Guard: if full ProseMirror bundle is not available, skip editor initialization
  // and show a fallback in the render below.

  // Initialize ProseMirror editor
  React.useEffect(() => {
    if (!hasProseMirrorFull) return;
    if (!editorRef.current) return;

    const schema = new ProseMirror.Schema({
      nodes: {
        doc: { content: "block+" },
        paragraph: {
          group: "block",
          content: "inline*",
          toDOM: () => ["p", { class: "my-2 leading-relaxed" }, 0],
          parseDOM: [{ tag: "p" }],
        },
        heading: {
          attrs: { level: { default: 1 } },
          content: "inline*",
          group: "block",
          defining: true,
          toDOM: (node: { attrs: { level: number } }) => {
            const classes: Record<number, string> = {
              1: "text-2xl font-bold mt-6 mb-3",
              2: "text-xl font-semibold mt-4 mb-2",
              3: "text-lg font-medium mt-3 mb-1",
            };
            return [
              "h" + node.attrs.level,
              { class: classes[node.attrs.level] || classes[1] },
              0,
            ];
          },
          parseDOM: [
            { tag: "h1", attrs: { level: 1 } },
            { tag: "h2", attrs: { level: 2 } },
            { tag: "h3", attrs: { level: 3 } },
          ],
        },
        callout: {
          content: "inline*",
          group: "block",
          toDOM: () => [
            "div",
            {
              class:
                "border-l-4 border-teal-400 bg-teal-50 dark:bg-teal-900/20 p-4 my-3 rounded-r",
            },
            0,
          ],
          parseDOM: [{ tag: "div.callout" }],
        },
        text: { group: "inline" },
      },
      marks: {
        strong: {
          toDOM: () => ["strong", 0],
          parseDOM: [{ tag: "strong" }],
        },
        em: {
          toDOM: () => ["em", 0],
          parseDOM: [{ tag: "em" }],
        },
      },
    });

    const contentLines = currentPage.content.split("\n");
    const docContent: unknown[] = [];

    contentLines.forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed) return;

      if (trimmed.startsWith("### ")) {
        docContent.push(
          schema.nodes.heading.create({ level: 3 }, [
            schema.text(trimmed.slice(4)),
          ])
        );
      } else if (trimmed.startsWith("## ")) {
        docContent.push(
          schema.nodes.heading.create({ level: 2 }, [
            schema.text(trimmed.slice(3)),
          ])
        );
      } else if (trimmed.startsWith("# ")) {
        docContent.push(
          schema.nodes.heading.create({ level: 1 }, [
            schema.text(trimmed.slice(2)),
          ])
        );
      } else if (trimmed.startsWith("> ")) {
        docContent.push(
          schema.nodes.callout.create({}, [schema.text(trimmed.slice(2))])
        );
      } else {
        const textParts: unknown[] = [];
        const boldRegex = /\*\*(.*?)\*\*/g;
        let lastIdx = 0;
        let match;
        while ((match = boldRegex.exec(trimmed)) !== null) {
          if (match.index > lastIdx) {
            textParts.push(schema.text(trimmed.slice(lastIdx, match.index)));
          }
          textParts.push(
            schema.text(match[1], [schema.marks.strong.create()])
          );
          lastIdx = match.index + match[0].length;
        }
        if (lastIdx < trimmed.length) {
          textParts.push(schema.text(trimmed.slice(lastIdx)));
        }
        if (textParts.length > 0) {
          docContent.push(schema.nodes.paragraph.create({}, textParts));
        }
      }
    });

    const doc = schema.nodes.doc.create(
      {},
      docContent.length > 0
        ? docContent
        : [schema.nodes.paragraph.create({}, [schema.text("Start writing...")])]
    );

    const state = ProseMirror.EditorState.create({
      doc,
      plugins: [
        ProseMirror.history(),
        ProseMirror.keymap({ "Mod-z": ProseMirror.undo, "Mod-y": ProseMirror.redo }),
        ProseMirror.keymap(ProseMirror.baseKeymap),
      ],
    });

    const view = new ProseMirror.EditorView(editorRef.current, {
      state,
      dispatchTransaction(tr) {
        const newState = view.state.apply(tr);
        view.updateState(newState);
      },
    });

    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [currentId]);

  const handlePublish = React.useCallback(() => {
    setPages((prev) =>
      prev.map((p) =>
        p.id === currentId ? { ...p, status: "published" as const } : p
      )
    );
    publishPage({ pageId: currentId });
    toast.success(`"${currentPage.title}" published successfully!`);
    setPublishDialogOpen(false);
  }, [currentId, currentPage, publishPage]);

  const handleSave = React.useCallback(() => {
    toast.success("Page saved!");
  }, []);

  const setBlockType = React.useCallback(
    (type: string) => {
      if (!viewRef.current) return;
      const view = viewRef.current;
      const { state } = view;
      const schema = state.schema;
      let nodeType;
      let attrs = {};

      if (type === "heading-1") {
        nodeType = schema.nodes.heading;
        attrs = { level: 1 };
      } else if (type === "heading-2") {
        nodeType = schema.nodes.heading;
        attrs = { level: 2 };
      } else if (type === "heading-3") {
        nodeType = schema.nodes.heading;
        attrs = { level: 3 };
      } else if (type === "callout") {
        nodeType = schema.nodes.callout;
      } else {
        nodeType = schema.nodes.paragraph;
      }

      if (nodeType) {
        const tr = state.tr.setBlockType(
          state.selection.from,
          state.selection.to,
          nodeType,
          attrs
        );
        view.dispatch(tr);
      }
    },
    []
  );

  return (
    <div className="flex gap-0 min-h-[600px] border rounded-lg overflow-hidden">
      {/* Sidebar - Page List */}
      <div className="w-72 border-r bg-muted/20 flex flex-col">
        <div className="p-4 border-b">
          <h3 className="font-semibold text-sm flex items-center gap-2">
            <Icons.BookOpen className="h-4 w-4 text-teal-600" />
            Wiki Pages
          </h3>
        </div>
        <ScrollArea className="flex-1">
          <div className="p-2 space-y-1">
            {pages.map((page) => (
              <button
                key={page.id}
                onClick={() => setActivePageId(page.id)}
                className={cn(
                  "w-full text-left rounded-lg p-3 transition-colors",
                  currentId === page.id
                    ? "bg-teal-100 dark:bg-teal-900/30 border border-teal-200 dark:border-teal-800"
                    : "hover:bg-muted"
                )}
              >
                <div className="flex items-center justify-between mb-1">
                  <span
                    className={cn(
                      "text-sm font-medium truncate",
                      currentId === page.id && "text-teal-700 dark:text-teal-300"
                    )}
                  >
                    {page.title}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Badge
                    variant={page.status === "published" ? "default" : "secondary"}
                    className={cn(
                      "text-xs",
                      page.status === "published"
                        ? "bg-teal-600"
                        : "bg-yellow-100 text-yellow-800"
                    )}
                  >
                    {page.status}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {page.lastModified}
                  </span>
                </div>
              </button>
            ))}
          </div>
        </ScrollArea>
      </div>

      {/* Main Editor Area */}
      <div className="flex-1 flex flex-col">
        {/* Editor Header */}
        <div className="border-b px-6 py-3 flex items-center justify-between bg-background">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-semibold">{currentPage.title}</h2>
            <Badge
              variant={currentPage.status === "published" ? "default" : "secondary"}
              className={cn(
                currentPage.status === "published"
                  ? "bg-teal-600"
                  : "bg-yellow-100 text-yellow-800"
              )}
            >
              {currentPage.status}
            </Badge>
          </div>

          <div className="flex items-center gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm">
                  <Icons.Type className="mr-1 h-4 w-4" />
                  Block Type
                  <Icons.ChevronDown className="ml-1 h-3 w-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem onClick={() => setBlockType("paragraph")}>
                  <Icons.AlignLeft className="mr-2 h-4 w-4" />
                  Paragraph
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setBlockType("heading-1")}>
                  <Icons.Heading1 className="mr-2 h-4 w-4" />
                  Heading 1
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setBlockType("heading-2")}>
                  <Icons.Heading2 className="mr-2 h-4 w-4" />
                  Heading 2
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setBlockType("heading-3")}>
                  <Icons.Heading3 className="mr-2 h-4 w-4" />
                  Heading 3
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setBlockType("callout")}>
                  <Icons.Info className="mr-2 h-4 w-4" />
                  Callout
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <Button variant="outline" size="sm" onClick={handleSave}>
              <Icons.Save className="mr-1 h-4 w-4" />
              Save
            </Button>

            <AlertDialog open={publishDialogOpen} onOpenChange={setPublishDialogOpen}>
              <AlertDialogTrigger asChild>
                <Button
                  size="sm"
                  className="bg-teal-600 hover:bg-teal-700"
                  disabled={currentPage.status === "published"}
                >
                  <Icons.Globe className="mr-1 h-4 w-4" />
                  Publish
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Publish this page?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Publishing &quot;{currentPage.title}&quot; will make it visible to
                    all wiki readers. This action can be undone by reverting to
                    draft status.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={handlePublish}
                    className="bg-teal-600 hover:bg-teal-700"
                  >
                    Publish
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>

        <Separator />

        {/* ProseMirror Editor */}
        <div className="flex-1 overflow-auto">
          {hasProseMirrorFull ? (
            <div
              ref={editorRef}
              className="min-h-[500px] px-8 py-6 prose prose-sm dark:prose-invert max-w-none [&_.ProseMirror]:outline-hidden [&_.ProseMirror]:min-h-[480px]"
            />
          ) : (
            <div className="min-h-[500px] px-8 py-6 flex items-center justify-center">
              <Card>
                <CardContent className="py-12 text-center text-muted-foreground">
                  ProseMirror editor requires the full bundle (production mode). Only prosemirror-view is loaded; Schema, EditorState, and plugins require additional packages.
                </CardContent>
              </Card>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default WikiEditor;
