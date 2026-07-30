import {
  React,
  useModel,
  useAppState,
  useTheme,
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  Input,
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationPrevious,
  PaginationNext,
  Icons,
  cn,
} from "@exepad/sdk";
import * as PrismModule from "@exepad/ext-prism";
// esm.sh may export SyntaxHighlighter as default
const prismOneDark: any = (PrismModule as any).oneDark || {};
const prismOneLight: any = (PrismModule as any).oneLight || {};

interface Snippet {
  id: string;
  title: string;
  language: string;
  code: string;
  tags: string[];
}

const SNIPPETS: Snippet[] = [
  { id: "s1", title: "Debounce Function", language: "javascript", code: `function debounce(fn, delay) {\n  let timer;\n  return (...args) => {\n    clearTimeout(timer);\n    timer = setTimeout(() => fn(...args), delay);\n  };\n}`, tags: ["utility", "performance"] },
  { id: "s2", title: "Binary Search", language: "python", code: `def binary_search(arr, target):\n    lo, hi = 0, len(arr) - 1\n    while lo <= hi:\n        mid = (lo + hi) // 2\n        if arr[mid] == target:\n            return mid\n        elif arr[mid] < target:\n            lo = mid + 1\n        else:\n            hi = mid - 1\n    return -1`, tags: ["algorithm", "search"] },
  { id: "s3", title: "Generic Stack", language: "typescript", code: `class Stack<T> {\n  private items: T[] = [];\n  push(item: T): void { this.items.push(item); }\n  pop(): T | undefined { return this.items.pop(); }\n  peek(): T | undefined { return this.items[this.items.length - 1]; }\n  get size(): number { return this.items.length; }\n  isEmpty(): boolean { return this.items.length === 0; }\n}`, tags: ["data-structure", "generics"] },
  { id: "s4", title: "HTTP Server", language: "go", code: `package main\n\nimport (\n\t"fmt"\n\t"net/http"\n)\n\nfunc handler(w http.ResponseWriter, r *http.Request) {\n\tfmt.Fprintf(w, "Hello, %s!", r.URL.Path[1:])\n}\n\nfunc main() {\n\thttp.HandleFunc("/", handler)\n\thttp.ListenAndServe(":8080", nil)\n}`, tags: ["server", "web"] },
  { id: "s5", title: "Fibonacci Iterator", language: "rust", code: `struct Fibonacci {\n    a: u64,\n    b: u64,\n}\n\nimpl Iterator for Fibonacci {\n    type Item = u64;\n    fn next(&mut self) -> Option<u64> {\n        let result = self.a;\n        let next = self.a + self.b;\n        self.a = self.b;\n        self.b = next;\n        Some(result)\n    }\n}`, tags: ["iterator", "math"] },
  { id: "s6", title: "Promise.all Polyfill", language: "javascript", code: `function promiseAll(promises) {\n  return new Promise((resolve, reject) => {\n    const results = [];\n    let count = 0;\n    promises.forEach((p, i) => {\n      Promise.resolve(p).then(val => {\n        results[i] = val;\n        if (++count === promises.length) resolve(results);\n      }).catch(reject);\n    });\n  });\n}`, tags: ["async", "polyfill"] },
  { id: "s7", title: "Merge Sort", language: "python", code: `def merge_sort(arr):\n    if len(arr) <= 1:\n        return arr\n    mid = len(arr) // 2\n    left = merge_sort(arr[:mid])\n    right = merge_sort(arr[mid:])\n    return merge(left, right)\n\ndef merge(l, r):\n    result = []\n    i = j = 0\n    while i < len(l) and j < len(r):\n        if l[i] <= r[j]:\n            result.append(l[i]); i += 1\n        else:\n            result.append(r[j]); j += 1\n    return result + l[i:] + r[j:]`, tags: ["algorithm", "sorting"] },
  { id: "s8", title: "Type Guard", language: "typescript", code: `interface Cat { meow(): void; whiskers: number; }\ninterface Dog { bark(): void; tail: boolean; }\n\nfunction isCat(animal: Cat | Dog): animal is Cat {\n  return 'meow' in animal;\n}\n\nfunction handleAnimal(animal: Cat | Dog) {\n  if (isCat(animal)) {\n    animal.meow();\n  } else {\n    animal.bark();\n  }\n}`, tags: ["types", "narrowing"] },
  { id: "s9", title: "Goroutine Worker Pool", language: "go", code: `func workerPool(jobs <-chan int, results chan<- int, n int) {\n\tvar wg sync.WaitGroup\n\tfor i := 0; i < n; i++ {\n\t\twg.Add(1)\n\t\tgo func() {\n\t\t\tdefer wg.Done()\n\t\t\tfor job := range jobs {\n\t\t\t\tresults <- job * 2\n\t\t\t}\n\t\t}()\n\t}\n\twg.Wait()\n\tclose(results)\n}`, tags: ["concurrency", "goroutine"] },
  { id: "s10", title: "Smart Pointer", language: "rust", code: `use std::rc::Rc;\nuse std::cell::RefCell;\n\nstruct Node {\n    value: i32,\n    next: Option<Rc<RefCell<Node>>>,\n}\n\nfn main() {\n    let a = Rc::new(RefCell::new(Node { value: 1, next: None }));\n    let b = Rc::new(RefCell::new(Node { value: 2, next: Some(Rc::clone(&a)) }));\n    println!("b -> a: {}", a.borrow().value);\n}`, tags: ["memory", "ownership"] },
  { id: "s11", title: "Event Emitter", language: "javascript", code: `class EventEmitter {\n  constructor() { this.events = {}; }\n  on(event, fn) {\n    (this.events[event] ||= []).push(fn);\n    return () => this.off(event, fn);\n  }\n  off(event, fn) {\n    this.events[event] = (this.events[event] || []).filter(f => f !== fn);\n  }\n  emit(event, ...args) {\n    (this.events[event] || []).forEach(fn => fn(...args));\n  }\n}`, tags: ["pattern", "pubsub"] },
  { id: "s12", title: "Decorator Pattern", language: "python", code: `import functools\nimport time\n\ndef timer(func):\n    @functools.wraps(func)\n    def wrapper(*args, **kwargs):\n        start = time.perf_counter()\n        result = func(*args, **kwargs)\n        elapsed = time.perf_counter() - start\n        print(f"{func.__name__} took {elapsed:.4f}s")\n        return result\n    return wrapper\n\n@timer\ndef slow_function():\n    time.sleep(1)\n    return "done"`, tags: ["decorator", "timing"] },
];

const LANGUAGES = ["All", "JavaScript", "Python", "TypeScript", "Go", "Rust"];
const LANG_MAP: Record<string, string> = { javascript: "JavaScript", python: "Python", typescript: "TypeScript", go: "Go", rust: "Rust" };
const LANG_COLORS: Record<string, string> = { javascript: "bg-yellow-100 text-yellow-800", python: "bg-blue-100 text-blue-800", typescript: "bg-sky-100 text-sky-800", go: "bg-cyan-100 text-cyan-800", rust: "bg-orange-100 text-orange-800" };
const PAGE_SIZE = 6;

function SnippetGallery() {
  const [search, setSearch] = useAppState<string>("snippetSearch", "");
  const [selectedLang, setSelectedLang] = useAppState<string>("snippetLang", "All");
  const [currentPage, setCurrentPage] = React.useState(1);
  const model = useModel();
  const theme = useTheme();

  const query = search ?? "";
  const lang = selectedLang ?? "All";
  const isDark = theme?.resolvedTheme === "dark";

  const filtered = React.useMemo(() => {
    let result = SNIPPETS;
    if (lang !== "All") {
      result = result.filter((s) => LANG_MAP[s.language] === lang);
    }
    if (query) {
      const q = query.toLowerCase();
      result = result.filter(
        (s) =>
          s.title.toLowerCase().includes(q) ||
          s.language.toLowerCase().includes(q) ||
          s.tags.some((t) => t.toLowerCase().includes(q))
      );
    }
    return result;
  }, [query, lang]);

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const paged = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  React.useEffect(() => {
    setCurrentPage(1);
  }, [query, lang]);

  const handleCopy = React.useCallback((code: string) => {
    navigator.clipboard.writeText(code);
  }, []);

  const handleDownload = React.useCallback((snippet: Snippet) => {
    const ext: Record<string, string> = { javascript: "js", python: "py", typescript: "ts", go: "go", rust: "rs" };
    const blob = new Blob([snippet.code], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${snippet.title.replace(/\s+/g, "_").toLowerCase()}.${ext[snippet.language] || "txt"}`;
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <Icons.Code2 className="h-6 w-6 text-violet-600" />
            Snippet Gallery
          </h2>
          <p className="text-muted-foreground mt-1">
            Browse and discover code snippets across languages
          </p>
        </div>
        <div className="flex items-center gap-3 w-full sm:w-auto">
          <div className="relative flex-1 sm:flex-initial">
            <Icons.Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search snippets..."
              value={query}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearch(e.target.value)}
              className="pl-9 w-full sm:w-[240px]"
            />
          </div>
        </div>
      </div>

      {/* Language Filter */}
      <div className="flex flex-wrap gap-2">
        {LANGUAGES.map((l) => (
          <Button
            key={l}
            variant={lang === l ? "default" : "outline"}
            size="sm"
            onClick={() => setSelectedLang(l)}
            className={cn(lang === l && "bg-violet-600 hover:bg-violet-700")}
          >
            {l}
          </Button>
        ))}
        <Badge variant="secondary" className="ml-auto">
          {filtered.length} snippets
        </Badge>
      </div>

      {/* Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {paged.map((snippet) => (
          <Card key={snippet.id} className="overflow-hidden flex flex-col">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-semibold">{snippet.title}</CardTitle>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0">
                      <Icons.MoreVertical className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => handleCopy(snippet.code)}>
                      <Icons.Copy className="mr-2 h-4 w-4" />
                      Copy Code
                    </DropdownMenuItem>
                    <DropdownMenuItem>
                      <Icons.Share className="mr-2 h-4 w-4" />
                      Share
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => handleDownload(snippet)}>
                      <Icons.Download className="mr-2 h-4 w-4" />
                      Download
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              <div className="flex items-center gap-2 mt-1">
                <Badge className={cn("text-xs", LANG_COLORS[snippet.language])}>
                  {LANG_MAP[snippet.language]}
                </Badge>
                {snippet.tags.map((tag) => (
                  <Badge key={tag} variant="outline" className="text-xs">
                    {tag}
                  </Badge>
                ))}
              </div>
            </CardHeader>
            <CardContent className="flex-1 pt-0">
              <div className="rounded-lg overflow-hidden text-sm">
                {typeof PrismHighlighter === "function" ? (
                  <PrismHighlighter
                    language={snippet.language}
                    style={isDark ? prismOneDark : prismOneLight}
                    customStyle={{
                      margin: 0,
                      borderRadius: "0.5rem",
                      fontSize: "0.75rem",
                      maxHeight: "200px",
                      overflow: "auto",
                    }}
                    showLineNumbers
                  >
                    {snippet.code}
                  </PrismHighlighter>
                ) : (
                  <pre
                    style={{
                      margin: 0,
                      borderRadius: "0.5rem",
                      fontSize: "0.75rem",
                      maxHeight: "200px",
                      overflow: "auto",
                      padding: "1rem",
                      background: isDark ? "#1e1e1e" : "#fafafa",
                    }}
                  >
                    <code>{snippet.code}</code>
                  </pre>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {filtered.length === 0 && (
        <div className="text-center py-16 text-muted-foreground">
          <Icons.SearchX className="h-12 w-12 mx-auto mb-3 opacity-50" />
          <p className="text-lg">No snippets found</p>
          <p className="text-sm">Try adjusting your search or filter</p>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <Pagination>
          <PaginationContent>
            <PaginationItem>
              <PaginationPrevious
                onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
                className={cn(currentPage === 1 && "pointer-events-none opacity-50")}
              />
            </PaginationItem>
            {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
              <PaginationItem key={page}>
                <PaginationLink
                  onClick={() => setCurrentPage(page)}
                  isActive={page === currentPage}
                >
                  {page}
                </PaginationLink>
              </PaginationItem>
            ))}
            <PaginationItem>
              <PaginationNext
                onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
                className={cn(currentPage === totalPages && "pointer-events-none opacity-50")}
              />
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      )}
    </div>
  );
}

export default SnippetGallery;
