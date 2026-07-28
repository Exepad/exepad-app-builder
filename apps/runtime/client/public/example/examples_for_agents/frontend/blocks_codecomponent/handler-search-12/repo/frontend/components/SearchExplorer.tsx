import {
  React,
  useHandler,
  useArrayState,
  useAppState,
  Command,
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandShortcut,
  CommandSeparator,
  Spinner,
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
  EmptyContent,
  ScrollArea,
  ScrollBar,
  Input,
  Button,
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  Badge,
  Icons,
  cn,
} from "@exepad/sdk";

interface SearchResult {
  id: string;
  title: string;
  description: string;
  category: string;
  relevance: number;
  url: string;
}

const DEMO_DATA: SearchResult[] = [
  { id: "1", title: "Getting Started with React Hooks", description: "Learn how to use useState, useEffect, and custom hooks to manage state and side effects in functional components.", category: "Tutorial", relevance: 95, url: "/docs/react-hooks" },
  { id: "2", title: "TypeScript Best Practices", description: "A comprehensive guide to writing type-safe TypeScript code with interfaces, generics, and utility types.", category: "Guide", relevance: 90, url: "/docs/typescript" },
  { id: "3", title: "Building REST APIs with Node.js", description: "Step-by-step tutorial on creating RESTful APIs using Express.js with authentication and validation middleware.", category: "Tutorial", relevance: 88, url: "/docs/rest-api" },
  { id: "4", title: "CSS Grid Layout Complete Guide", description: "Master CSS Grid with practical examples covering grid-template, auto-fill, minmax, and responsive design patterns.", category: "Reference", relevance: 85, url: "/docs/css-grid" },
  { id: "5", title: "Database Design Patterns", description: "Explore common database design patterns including normalization, indexing strategies, and query optimization.", category: "Guide", relevance: 82, url: "/docs/db-patterns" },
  { id: "6", title: "Authentication with JWT Tokens", description: "Implement secure authentication using JSON Web Tokens with refresh token rotation and secure cookie storage.", category: "Tutorial", relevance: 80, url: "/docs/jwt-auth" },
  { id: "7", title: "React Performance Optimization", description: "Techniques for optimizing React app performance including memoization, code splitting, and virtual scrolling.", category: "Guide", relevance: 78, url: "/docs/react-perf" },
  { id: "8", title: "Docker Container Essentials", description: "Understanding Docker containers, images, volumes, and networking for modern application deployment.", category: "Reference", relevance: 75, url: "/docs/docker" },
  { id: "9", title: "GraphQL vs REST Comparison", description: "An in-depth comparison of GraphQL and REST API architectures with pros, cons, and use case recommendations.", category: "Article", relevance: 72, url: "/docs/graphql-rest" },
  { id: "10", title: "CI/CD Pipeline Setup", description: "Configure continuous integration and deployment pipelines using GitHub Actions with automated testing and staging.", category: "Tutorial", relevance: 70, url: "/docs/cicd" },
];

const CATEGORY_COLORS: Record<string, string> = {
  Tutorial: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300",
  Guide: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300",
  Reference: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-300",
  Article: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-300",
};

function SearchExplorer() {
  const [query, setQuery] = useAppState<string>("searchQuery", "");
  const [isSearching, setIsSearching] = useAppState<boolean>("isSearching", false);
  const [results, setResults] = useAppState<SearchResult[]>("searchResults", []);
  const [hasSearched, setHasSearched] = useAppState<boolean>("hasSearched", false);
  const { items: searchHistory, push: addToHistory, remove: removeFromHistory } =
    useArrayState<string>("searchHistory", []);
  const [commandOpen, setCommandOpen] = React.useState(false);

  // useHandler simulated for search
  const search = useHandler("searchDocuments");

  // Keyboard shortcut for command palette
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setCommandOpen(true);
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  const performSearch = async (searchTerm: string) => {
    const term = searchTerm.trim();
    if (!term) return;

    setQuery(term);
    setIsSearching(true);
    setHasSearched(true);

    // Simulate async search delay
    await new Promise((resolve) => setTimeout(resolve, 800));

    // Filter demo data
    const lowerTerm = term.toLowerCase();
    const filtered = DEMO_DATA.filter(
      (item) =>
        item.title.toLowerCase().includes(lowerTerm) ||
        item.description.toLowerCase().includes(lowerTerm) ||
        item.category.toLowerCase().includes(lowerTerm)
    ).sort((a, b) => b.relevance - a.relevance);

    setResults(filtered);
    setIsSearching(false);

    // Add to history if not already present
    if (!searchHistory.includes(term)) {
      addToHistory(term);
    }
  };

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      performSearch(query || "");
    }
  };

  const handleCommandSelect = (term: string) => {
    setCommandOpen(false);
    performSearch(term);
  };

  const getRelevanceBadgeVariant = (relevance: number): "default" | "secondary" | "outline" => {
    if (relevance >= 90) return "default";
    if (relevance >= 80) return "secondary";
    return "outline";
  };

  return (
    <div className="space-y-6">
      {/* Command Dialog */}
      <CommandDialog open={commandOpen} onOpenChange={setCommandOpen}>
        <CommandInput placeholder="Type to search documentation..." />
        <CommandList>
          <CommandEmpty>No results found.</CommandEmpty>
          {searchHistory.length > 0 && (
            <CommandGroup heading="Recent Searches">
              {searchHistory.slice(-5).reverse().map((term: string, idx: number) => (
                <CommandItem
                  key={`history-${idx}`}
                  onSelect={() => handleCommandSelect(term)}
                >
                  <Icons.Clock className="mr-2 h-4 w-4 text-muted-foreground" />
                  {term}
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          <CommandSeparator />
          <CommandGroup heading="Quick Access">
            <CommandItem onSelect={() => handleCommandSelect("React")}>
              <Icons.Code className="mr-2 h-4 w-4" />
              React Documentation
              <CommandShortcut>Docs</CommandShortcut>
            </CommandItem>
            <CommandItem onSelect={() => handleCommandSelect("TypeScript")}>
              <Icons.FileText className="mr-2 h-4 w-4" />
              TypeScript Guide
              <CommandShortcut>Guide</CommandShortcut>
            </CommandItem>
            <CommandItem onSelect={() => handleCommandSelect("API")}>
              <Icons.Globe className="mr-2 h-4 w-4" />
              API Reference
              <CommandShortcut>API</CommandShortcut>
            </CommandItem>
          </CommandGroup>
        </CommandList>
      </CommandDialog>

      {/* Search Header */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Icons.Search className="h-5 w-5" />
            Search Explorer
          </CardTitle>
          <CardDescription>
            Search through documentation, tutorials, and guides.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Icons.Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={query || ""}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setQuery(e.target.value)}
                onKeyDown={handleInputKeyDown}
                placeholder="Search documentation..."
                className="pl-10"
              />
            </div>
            <Button onClick={() => performSearch(query || "")} disabled={isSearching}>
              {isSearching ? (
                <Icons.Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "Search"
              )}
            </Button>
            <Button
              variant="outline"
              onClick={() => setCommandOpen(true)}
              className="hidden sm:flex gap-2"
            >
              <Icons.Command className="h-4 w-4" />
              <kbd className="pointer-events-none inline-flex h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-xs font-medium text-muted-foreground">
                <span className="text-xs">Ctrl</span>K
              </kbd>
            </Button>
          </div>

          {/* Search History */}
          {searchHistory.length > 0 && (
            <div className="flex flex-wrap gap-2 items-center">
              <span className="text-xs text-muted-foreground">Recent:</span>
              {searchHistory.slice(-5).reverse().map((term: string, idx: number) => (
                <Badge
                  key={`badge-${idx}`}
                  variant="secondary"
                  className="cursor-pointer hover:bg-secondary/80 gap-1"
                  onClick={() => performSearch(term)}
                >
                  {term}
                  <button
                    className="ml-1 hover:text-destructive"
                    onClick={(e: React.MouseEvent) => {
                      e.stopPropagation();
                      const historyIdx = searchHistory.indexOf(term);
                      if (historyIdx !== -1) removeFromHistory(historyIdx);
                    }}
                  >
                    <Icons.X className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Results Area */}
      {isSearching && (
        <div className="flex flex-col items-center justify-center py-12 gap-3">
          <Spinner className="h-8 w-8" />
          <p className="text-sm text-muted-foreground">Searching...</p>
        </div>
      )}

      {!isSearching && hasSearched && (results || []).length === 0 && (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>No results found</EmptyTitle>
            <EmptyDescription>
              No documents match your search for &quot;{query}&quot;.
              Try different keywords or browse the quick access options.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button variant="outline" onClick={() => setCommandOpen(true)}>
              <Icons.Command className="mr-2 h-4 w-4" />
              Open Quick Access
            </Button>
          </EmptyContent>
        </Empty>
      )}

      {!isSearching && (results || []).length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              {(results || []).length} result{(results || []).length !== 1 ? "s" : ""} found
            </p>
          </div>
          <ScrollArea className="h-[500px]">
            <div className="space-y-3 pr-4">
              {(results || []).map((result: SearchResult) => (
                <Card
                  key={result.id}
                  className="hover:shadow-md transition-shadow cursor-pointer"
                >
                  <CardHeader className="pb-2">
                    <div className="flex items-start justify-between gap-3">
                      <div className="space-y-1 flex-1">
                        <CardTitle className="text-base flex items-center gap-2">
                          <Icons.FileText className="h-4 w-4 text-primary shrink-0" />
                          {result.title}
                        </CardTitle>
                        <CardDescription className="line-clamp-2">
                          {result.description}
                        </CardDescription>
                      </div>
                      <div className="flex flex-col items-end gap-1.5 shrink-0">
                        <Badge
                          variant={getRelevanceBadgeVariant(result.relevance)}
                          className="text-xs"
                        >
                          {result.relevance}% match
                        </Badge>
                        <Badge
                          variant="outline"
                          className={cn("text-xs", CATEGORY_COLORS[result.category])}
                        >
                          {result.category}
                        </Badge>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                      <Icons.Link className="h-3 w-3" />
                      {result.url}
                    </p>
                  </CardContent>
                </Card>
              ))}
            </div>
            <ScrollBar orientation="vertical" />
          </ScrollArea>
        </div>
      )}

      {/* Initial state */}
      {!isSearching && !hasSearched && (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>Start Searching</EmptyTitle>
            <EmptyDescription>
              Enter a search term above or press Ctrl+K to open the command palette.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <div className="flex flex-wrap justify-center gap-2">
              {["React", "TypeScript", "API", "Docker"].map((term) => (
                <Button
                  key={term}
                  variant="outline"
                  size="sm"
                  onClick={() => performSearch(term)}
                >
                  {term}
                </Button>
              ))}
            </div>
          </EmptyContent>
        </Empty>
      )}
    </div>
  );
}

export default SearchExplorer;
