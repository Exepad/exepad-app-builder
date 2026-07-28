import {
  React,
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Badge,
  Button,
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  Input,
  Textarea,
  Label,
  Icons,
  useAppState,
  cn,
  toast,
} from "@exepad/sdk";

interface Task {
  id: string;
  title: string;
  description: string;
  status: "todo" | "in-progress" | "done";
  priority: "low" | "medium" | "high";
}

const PRIORITY_COLORS: Record<Task["priority"], string> = {
  low: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300",
  medium: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300",
  high: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300",
};

const INITIAL_TASKS: Task[] = [
  { id: "1", title: "Design homepage layout", description: "Create wireframes and mockups for the new homepage.", status: "done", priority: "high" },
  { id: "2", title: "Set up authentication", description: "Implement JWT-based login and registration.", status: "in-progress", priority: "high" },
  { id: "3", title: "Write API documentation", description: "Document all REST endpoints with examples.", status: "in-progress", priority: "medium" },
  { id: "4", title: "Add dark mode support", description: "Implement theme toggling with CSS variables.", status: "todo", priority: "low" },
  { id: "5", title: "Performance audit", description: "Run Lighthouse and fix any issues.", status: "todo", priority: "medium" },
];

function TaskCard({ task }: { task: Task }) {
  return (
    <Card className="hover:shadow-md transition-shadow">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium">{task.title}</CardTitle>
          <Badge className={cn("text-xs", PRIORITY_COLORS[task.priority])}>
            {task.priority}
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">{task.description}</p>
      </CardContent>
    </Card>
  );
}

function ProjectBoard() {
  const [tasks, setTasks] = useAppState<Task[]>("boardTasks", INITIAL_TASKS);
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [newTitle, setNewTitle] = React.useState("");
  const [newDesc, setNewDesc] = React.useState("");

  const tasksByStatus = {
    todo: (tasks || []).filter((t: Task) => t.status === "todo"),
    "in-progress": (tasks || []).filter((t: Task) => t.status === "in-progress"),
    done: (tasks || []).filter((t: Task) => t.status === "done"),
  };

  const handleAdd = () => {
    if (!newTitle.trim()) return;
    const next: Task = {
      id: String(Date.now()),
      title: newTitle.trim(),
      description: newDesc.trim(),
      status: "todo",
      priority: "medium",
    };
    setTasks([...(tasks || []), next]);
    setNewTitle("");
    setNewDesc("");
    setDialogOpen(false);
    toast("Task added");
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Project Board</h2>
          <p className="text-muted-foreground">
            {(tasks || []).length} tasks total
          </p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <Icons.Plus className="mr-2 h-4 w-4" />
              Add Task
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>New Task</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="title">Title</Label>
                <Input
                  id="title"
                  value={newTitle}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    setNewTitle(e.target.value)
                  }
                  placeholder="Task title"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="desc">Description</Label>
                <Textarea
                  id="desc"
                  value={newDesc}
                  onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
                    setNewDesc(e.target.value)
                  }
                  placeholder="Describe the task..."
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDialogOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleAdd}>Create</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Tabs defaultValue="todo">
        <TabsList>
          <TabsTrigger value="todo">
            To Do ({tasksByStatus.todo.length})
          </TabsTrigger>
          <TabsTrigger value="in-progress">
            In Progress ({tasksByStatus["in-progress"].length})
          </TabsTrigger>
          <TabsTrigger value="done">
            Done ({tasksByStatus.done.length})
          </TabsTrigger>
        </TabsList>

        {(["todo", "in-progress", "done"] as const).map((status) => (
          <TabsContent key={status} value={status} className="mt-4">
            {tasksByStatus[status].length === 0 ? (
              <p className="text-center py-8 text-muted-foreground">
                No tasks in this category.
              </p>
            ) : (
              <div className="grid gap-3">
                {tasksByStatus[status].map((task: Task) => (
                  <TaskCard key={task.id} task={task} />
                ))}
              </div>
            )}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}

export default ProjectBoard;
