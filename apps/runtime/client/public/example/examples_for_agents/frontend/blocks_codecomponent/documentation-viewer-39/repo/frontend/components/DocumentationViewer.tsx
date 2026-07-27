import {
  React,
  useModel,
  useNavigation,
  useTheme,
  toast,
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbPage,
  BreadcrumbSeparator,
  Card,
  CardContent,
  Button,
  ScrollArea,
  Icons,
  cn,
} from "@exepad/sdk";
import * as Highlight from "@exepad/ext-highlight";
import * as Markdown from "@exepad/ext-markdown";

interface DocPage {
  id: string;
  title: string;
  category: string;
  content: string;
}

const DOCS: DocPage[] = [
  {
    id: "getting-started",
    title: "Getting Started",
    category: "Getting Started",
    content: `# Getting Started

Welcome to the API documentation. This guide will help you set up your development environment and make your first API call.

## Installation

Install the SDK using your preferred package manager:

\`\`\`bash
npm install @example/sdk
\`\`\`

Or with yarn:

\`\`\`bash
yarn add @example/sdk
\`\`\`

## Quick Start

Initialize the client with your API key:

\`\`\`javascript
import { Client } from '@example/sdk';

const client = new Client({
  apiKey: process.env.API_KEY,
  region: 'us-east-1',
});

const result = await client.query({ table: 'users', limit: 10 });
console.log(result.data);
\`\`\`

## Authentication

All API requests require a valid API key. You can generate one from your dashboard under **Settings > API Keys**.
`,
  },
  {
    id: "api-reference",
    title: "API Reference",
    category: "API Reference",
    content: `# API Reference

## Client

The main entry point for interacting with the API.

### Constructor

\`\`\`typescript
interface ClientOptions {
  apiKey: string;
  region?: string;
  timeout?: number;
  retries?: number;
}

const client = new Client(options: ClientOptions);
\`\`\`

### Methods

#### \`query(params)\`

Execute a query against your data.

\`\`\`typescript
interface QueryParams {
  table: string;
  filter?: Record<string, unknown>;
  limit?: number;
  offset?: number;
  orderBy?: string;
}

const result = await client.query(params: QueryParams);
\`\`\`

#### \`mutate(params)\`

Insert, update, or delete records.

\`\`\`typescript
interface MutateParams {
  table: string;
  operation: 'insert' | 'update' | 'delete';
  data: Record<string, unknown>;
  where?: Record<string, unknown>;
}

const result = await client.mutate(params: MutateParams);
\`\`\`

## Response Format

All responses follow a consistent shape:

\`\`\`json
{
  "data": [],
  "meta": { "total": 100, "page": 1 },
  "error": null
}
\`\`\`
`,
  },
  {
    id: "guides-pagination",
    title: "Pagination Guide",
    category: "Guides",
    content: `# Pagination Guide

Learn how to paginate through large datasets efficiently.

## Offset-Based Pagination

The simplest approach uses \`limit\` and \`offset\`:

\`\`\`typescript
async function fetchPage(page: number, pageSize: number = 20) {
  const result = await client.query({
    table: 'products',
    limit: pageSize,
    offset: (page - 1) * pageSize,
    orderBy: 'created_at DESC',
  });

  return {
    items: result.data,
    totalPages: Math.ceil(result.meta.total / pageSize),
    currentPage: page,
  };
}
\`\`\`

## Cursor-Based Pagination

For better performance with large datasets, use cursor-based pagination:

\`\`\`typescript
async function fetchNextPage(cursor?: string) {
  const result = await client.query({
    table: 'events',
    limit: 50,
    after: cursor,
    orderBy: 'id ASC',
  });

  return {
    items: result.data,
    nextCursor: result.meta.nextCursor,
    hasMore: result.meta.hasMore,
  };
}
\`\`\`

## Best Practices

- Use cursor-based pagination for real-time data
- Cache page results when possible
- Set reasonable page sizes (20-100 items)
`,
  },
];

const DOC_TREE = [
  {
    category: "Getting Started",
    items: [{ id: "getting-started", title: "Getting Started" }],
  },
  {
    category: "API Reference",
    items: [{ id: "api-reference", title: "API Reference" }],
  },
  {
    category: "Guides",
    items: [{ id: "guides-pagination", title: "Pagination Guide" }],
  },
];

function DocumentationViewer() {
  const [activePage, setActivePage] = React.useState("getting-started");
  const navigation = useNavigation();
  const theme = useTheme();
  const model = useModel();

  const currentDoc = DOCS.find((d) => d.id === activePage) ?? DOCS[0];
  const isDark = theme?.resolvedTheme === "dark";

  const breadcrumbParts = React.useMemo(() => {
    const doc = DOCS.find((d) => d.id === activePage);
    if (!doc) return [];
    return [doc.category, doc.title];
  }, [activePage]);

  const handleCopyCode = React.useCallback((code: string) => {
    navigator.clipboard.writeText(code).then(() => {
      toast.success("Code copied to clipboard!");
    });
  }, []);

  const CodeBlock = React.useCallback(
    ({ className, children, ...props }: { className?: string; children?: React.ReactNode; [key: string]: unknown }) => {
      const match = /language-(\w+)/.exec(className || "");
      const codeString = String(children).replace(/\n$/, "");

      if (match) {
        return (
          <div className="relative group my-4">
            <div className="absolute right-2 top-2 opacity-0 group-hover:opacity-100 transition-opacity z-10">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleCopyCode(codeString)}
                className="h-7 px-2 text-xs"
              >
                <Icons.Copy className="h-3 w-3 mr-1" />
                Copy
              </Button>
            </div>
            <Highlight.default
              language={match[1]}
              style={isDark ? Highlight.oneDark : Highlight.oneLight}
              customStyle={{
                borderRadius: "0.5rem",
                padding: "1rem",
                fontSize: "0.875rem",
              }}
            >
              {codeString}
            </Highlight.default>
          </div>
        );
      }

      return (
        <code className={cn("bg-muted px-1.5 py-0.5 rounded text-sm font-mono", className)} {...props}>
          {children}
        </code>
      );
    },
    [isDark, handleCopyCode]
  );

  return (
    <div className="flex gap-6 min-h-[600px]">
      {/* Sidebar */}
      <div className="w-64 shrink-0">
        <ScrollArea className="h-[600px]">
          <div className="pr-4 space-y-1">
            <h3 className="font-semibold text-sm mb-3 flex items-center gap-2">
              <Icons.BookOpen className="h-4 w-4 text-sky-600" />
              Documentation
            </h3>
            <Accordion type="multiple" defaultValue={DOC_TREE.map((c) => c.category)}>
              {DOC_TREE.map((section) => (
                <AccordionItem key={section.category} value={section.category}>
                  <AccordionTrigger className="text-sm py-2">
                    {section.category}
                  </AccordionTrigger>
                  <AccordionContent>
                    <div className="space-y-1 pl-2">
                      {section.items.map((item) => (
                        <button
                          key={item.id}
                          onClick={() => setActivePage(item.id)}
                          className={cn(
                            "w-full text-left text-sm px-3 py-1.5 rounded-md transition-colors",
                            activePage === item.id
                              ? "bg-sky-100 text-sky-700 font-medium dark:bg-sky-900/30 dark:text-sky-300"
                              : "text-muted-foreground hover:bg-muted hover:text-foreground"
                          )}
                        >
                          {item.title}
                        </button>
                      ))}
                    </div>
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </div>
        </ScrollArea>
      </div>

      {/* Main Content */}
      <div className="flex-1 min-w-0">
        <Breadcrumb className="mb-4">
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink onClick={() => setActivePage("getting-started")}>
                Docs
              </BreadcrumbLink>
            </BreadcrumbItem>
            {breadcrumbParts.map((part, idx) => (
              <React.Fragment key={idx}>
                <BreadcrumbSeparator />
                <BreadcrumbItem>
                  {idx === breadcrumbParts.length - 1 ? (
                    <BreadcrumbPage>{part}</BreadcrumbPage>
                  ) : (
                    <BreadcrumbLink>{part}</BreadcrumbLink>
                  )}
                </BreadcrumbItem>
              </React.Fragment>
            ))}
          </BreadcrumbList>
        </Breadcrumb>

        <Card>
          <CardContent className="pt-6">
            <ScrollArea className="h-[540px] pr-4">
              <div className="prose prose-sm dark:prose-invert max-w-none">
                <Markdown.default
                  components={{
                    code: CodeBlock,
                  }}
                >
                  {currentDoc.content}
                </Markdown.default>
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default DocumentationViewer;
