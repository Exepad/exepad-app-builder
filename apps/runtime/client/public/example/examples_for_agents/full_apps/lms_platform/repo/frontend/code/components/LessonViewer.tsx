import {
  React,
  useModel,
  useNavigation,
  Card,
  CardContent,
  Button,
  Badge,
  Separator,
  ScrollArea,
  Icons,
  cn,
} from "@exepad/sdk";

const DEMO_LESSONS = [
  { id: 5, module_id: 2, title: "Props, State & Lifecycle", content_type: "video", duration_min: 35, sort_order: 1, completed: true },
  { id: 6, module_id: 2, title: "Custom Hooks Deep Dive", content_type: "video", duration_min: 42, sort_order: 2, completed: false },
  { id: 7, module_id: 2, title: "Context API & useReducer", content_type: "video", duration_min: 38, sort_order: 3, completed: false },
  { id: 8, module_id: 2, title: "State Management Exercise", content_type: "text", duration_min: 20, sort_order: 4, completed: false },
];

const CURRENT_LESSON = {
  id: 6,
  module_id: 2,
  title: "Custom Hooks Deep Dive",
  content_type: "video",
  duration_min: 42,
  sort_order: 2,
  description: "Learn how to extract reusable logic from your components into custom hooks. We'll cover the rules of hooks, common patterns like useLocalStorage, useFetch, and useDebounce, and how to properly type your custom hooks with TypeScript.",
  content: `## Custom Hooks Deep Dive

Custom hooks are one of the most powerful features in React. They let you extract component logic into reusable functions.

### Rules of Hooks
1. Only call hooks at the top level of your component or custom hook
2. Only call hooks from React functions (components or other hooks)
3. Custom hook names must start with "use"

### Building useLocalStorage

A common custom hook stores and retrieves values from localStorage:

\`\`\`typescript
function useLocalStorage<T>(key: string, initialValue: T) {
  const [storedValue, setStoredValue] = useState<T>(() => {
    try {
      const item = window.localStorage.getItem(key);
      return item ? JSON.parse(item) : initialValue;
    } catch {
      return initialValue;
    }
  });

  const setValue = (value: T | ((val: T) => T)) => {
    const valueToStore = value instanceof Function ? value(storedValue) : value;
    setStoredValue(valueToStore);
    window.localStorage.setItem(key, JSON.stringify(valueToStore));
  };

  return [storedValue, setValue] as const;
}
\`\`\`

### Building useFetch

A data fetching hook with loading and error states:

\`\`\`typescript
function useFetch<T>(url: string) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch(url, { signal: controller.signal })
      .then(res => res.json())
      .then(setData)
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [url]);

  return { data, loading, error };
}
\`\`\`

### Key Takeaways
- Custom hooks promote code reuse and separation of concerns
- Always prefix with "use" to signal hook rules apply
- Return values that make sense for consumers (arrays for simple state, objects for complex)
- Test custom hooks independently using renderHook from Testing Library`,
};

export default function LessonViewer() {
  const { navigate } = useNavigation();
  const lessonsModel = useModel("lessons");
  const lessons = (lessonsModel?.data as any[] | null) ?? DEMO_LESSONS;
  const allLessons = (lessons || DEMO_LESSONS) as any[];
  const [isCompleted, setIsCompleted] = React.useState(false);

  const currentIndex = allLessons.findIndex((l: any) => l.id === CURRENT_LESSON.id);
  const prevLesson = currentIndex > 0 ? allLessons[currentIndex - 1] : null;
  const nextLesson = currentIndex < allLessons.length - 1 ? allLessons[currentIndex + 1] : null;

  const CONTENT_TYPE_ICONS: Record<string, keyof typeof Icons> = {
    video: "Play",
    text: "FileText",
    quiz: "HelpCircle",
  };

  return (
    <div className="flex h-[calc(100vh-4rem)]">
      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Video Placeholder */}
        <div className="bg-gray-900 flex items-center justify-center relative" style={{ minHeight: "360px" }}>
          <div className="text-center">
            <div className="w-20 h-20 rounded-full bg-white/10 flex items-center justify-center mx-auto mb-4 hover:bg-white/20 cursor-pointer transition-colors">
              <Icons.Play className="w-10 h-10 text-white ml-1" />
            </div>
            <p className="text-white/60 text-sm">{CURRENT_LESSON.duration_min} min video</p>
          </div>
          <div className="absolute bottom-0 left-0 right-0 h-1 bg-white/10">
            <div className="h-full bg-primary w-[35%]" />
          </div>
        </div>

        {/* Lesson Content */}
        <ScrollArea className="flex-1">
          <div className="p-6 max-w-3xl mx-auto space-y-6">
            {/* Title & Meta */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Badge variant="secondary" className="capitalize">{CURRENT_LESSON.content_type}</Badge>
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                  <Icons.Clock className="w-3 h-3" />
                  {CURRENT_LESSON.duration_min} min
                </span>
              </div>
              <h1 className="text-2xl font-bold text-foreground">{CURRENT_LESSON.title}</h1>
              <p className="text-muted-foreground mt-2">{CURRENT_LESSON.description}</p>
            </div>

            <Separator />

            {/* Content */}
            <div className="prose prose-sm max-w-none text-foreground">
              {CURRENT_LESSON.content.split("\n\n").map((block, i) => {
                if (block.startsWith("## ")) {
                  return <h2 key={i} className="text-xl font-bold mt-6 mb-3">{block.replace("## ", "")}</h2>;
                }
                if (block.startsWith("### ")) {
                  return <h3 key={i} className="text-lg font-semibold mt-5 mb-2">{block.replace("### ", "")}</h3>;
                }
                if (block.startsWith("```")) {
                  const lines = block.split("\n");
                  const code = lines.slice(1, -1).join("\n");
                  return (
                    <pre key={i} className="bg-muted rounded-lg p-4 overflow-x-auto text-sm my-4">
                      <code className="text-foreground">{code}</code>
                    </pre>
                  );
                }
                if (block.match(/^\d\./)) {
                  return (
                    <ol key={i} className="list-decimal list-inside space-y-1 my-2 text-muted-foreground">
                      {block.split("\n").map((line, j) => (
                        <li key={j}>{line.replace(/^\d+\.\s*/, "")}</li>
                      ))}
                    </ol>
                  );
                }
                if (block.startsWith("- ")) {
                  return (
                    <ul key={i} className="list-disc list-inside space-y-1 my-2 text-muted-foreground">
                      {block.split("\n").map((line, j) => (
                        <li key={j}>{line.replace(/^-\s*/, "")}</li>
                      ))}
                    </ul>
                  );
                }
                return <p key={i} className="text-muted-foreground leading-relaxed">{block}</p>;
              })}
            </div>

            <Separator />

            {/* Actions */}
            <div className="flex items-center justify-between">
              <div className="flex gap-2">
                {prevLesson && (
                  <Button variant="outline" onClick={() => navigate(`/lesson/${prevLesson.id}`)}>
                    <Icons.ArrowLeft className="w-4 h-4 mr-2" />
                    Previous
                  </Button>
                )}
                {nextLesson && (
                  <Button onClick={() => navigate(`/lesson/${nextLesson.id}`)}>
                    Next
                    <Icons.ArrowRight className="w-4 h-4 ml-2" />
                  </Button>
                )}
              </div>
              <Button
                variant={isCompleted ? "outline" : "default"}
                onClick={() => setIsCompleted(!isCompleted)}
                className={cn(isCompleted && "text-green-600 border-green-200")}
              >
                {isCompleted ? (
                  <>
                    <Icons.CheckCircle className="w-4 h-4 mr-2" />
                    Completed
                  </>
                ) : (
                  <>
                    <Icons.Circle className="w-4 h-4 mr-2" />
                    Mark as Complete
                  </>
                )}
              </Button>
            </div>
          </div>
        </ScrollArea>
      </div>

      {/* Lesson Sidebar */}
      <div className="w-72 border-l border-border bg-background hidden lg:flex flex-col">
        <div className="p-4 border-b border-border">
          <h3 className="font-semibold text-sm text-foreground">Module: Component Patterns</h3>
          <p className="text-xs text-muted-foreground mt-1">{allLessons.filter((l: any) => l.completed).length}/{allLessons.length} completed</p>
        </div>
        <ScrollArea className="flex-1">
          <div className="p-2 space-y-0.5">
            {allLessons.map((lesson: any) => {
              const isCurrent = lesson.id === CURRENT_LESSON.id;
              const TypeIcon = Icons[CONTENT_TYPE_ICONS[lesson.content_type]] as React.ComponentType<{ className?: string }>;
              return (
                <button
                  key={lesson.id}
                  onClick={() => navigate(`/lesson/${lesson.id}`)}
                  className={cn(
                    "w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-left transition-colors text-sm",
                    isCurrent
                      ? "lesson-active bg-accent border-l-primary"
                      : "hover:bg-muted"
                  )}
                >
                  {lesson.completed ? (
                    <Icons.CheckCircle className="w-4 h-4 text-green-500 shrink-0" />
                  ) : isCurrent ? (
                    <Icons.PlayCircle className="w-4 h-4 text-primary shrink-0" />
                  ) : (
                    TypeIcon && <TypeIcon className="w-4 h-4 text-muted-foreground shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className={cn("truncate", isCurrent ? "font-medium text-foreground" : "text-muted-foreground")}>
                      {lesson.title}
                    </p>
                    <p className="text-xs text-muted-foreground">{lesson.duration_min} min</p>
                  </div>
                </button>
              );
            })}
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}
