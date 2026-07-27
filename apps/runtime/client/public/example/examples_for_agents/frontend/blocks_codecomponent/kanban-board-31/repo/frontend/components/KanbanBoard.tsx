import {
  React,
  useArrayState,
  useAppState,
  toast,
  Motion,
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
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
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  Label,
  ScrollArea,
  Avatar,
  AvatarFallback,
  Separator,
  Icons,
  cn,
} from "@exepad/sdk";

type Priority = "Low" | "Medium" | "High" | "Urgent";
type ColumnId = "todo" | "in-progress" | "review" | "done";

interface Task {
  id: string;
  title: string;
  description: string;
  priority: Priority;
  assignee: string;
}

const COLUMN_META: { id: ColumnId; label: string; icon: keyof typeof Icons; color: string }[] = [
  { id: "todo", label: "To Do", icon: "Circle", color: "text-muted-foreground" },
  { id: "in-progress", label: "In Progress", icon: "Timer", color: "text-blue-500" },
  { id: "review", label: "Review", icon: "Eye", color: "text-amber-500" },
  { id: "done", label: "Done", icon: "CheckCircle2", color: "text-green-500" },
];

const PRIORITY_VARIANT: Record<Priority, string> = {
  Low: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300",
  Medium: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300",
  High: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-300",
  Urgent: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300",
};

const INITIAL_TODO: Task[] = [
  { id: "t1", title: "Design landing page", description: "Create wireframes and high-fidelity mockups for the new marketing landing page with hero section and CTAs.", priority: "High", assignee: "Alice Chen" },
  { id: "t2", title: "Set up CI/CD pipeline", description: "Configure GitHub Actions workflows for automated testing, linting, and deployment to staging environment.", priority: "Medium", assignee: "Bob Martinez" },
  { id: "t3", title: "Write onboarding docs", description: "Document the onboarding flow for new team members including environment setup and coding standards.", priority: "Low", assignee: "Carol Davis" },
];

const INITIAL_INPROGRESS: Task[] = [
  { id: "t4", title: "Implement auth module", description: "Build JWT-based authentication with login, registration, password reset, and token refresh endpoints.", priority: "Urgent", assignee: "David Kim" },
  { id: "t5", title: "Database schema design", description: "Design and implement PostgreSQL schema for users, projects, and task management with proper indexes.", priority: "High", assignee: "Eve Johnson" },
  { id: "t6", title: "API rate limiting", description: "Add rate limiting middleware to all public API endpoints with configurable thresholds per route.", priority: "Medium", assignee: "Frank Wilson" },
];

const INITIAL_REVIEW: Task[] = [
  { id: "t7", title: "Payment integration", description: "Integrate Stripe for subscription billing with webhook handlers for payment events and invoice generation.", priority: "Urgent", assignee: "Grace Lee" },
  { id: "t8", title: "Unit test coverage", description: "Increase test coverage to 80% for core modules including auth, billing, and project management services.", priority: "Medium", assignee: "Henry Brown" },
  { id: "t9", title: "Accessibility audit", description: "Run full WCAG 2.1 AA compliance audit and fix all critical accessibility issues across the application.", priority: "Low", assignee: "Iris Taylor" },
];

const INITIAL_DONE: Task[] = [
  { id: "t10", title: "Project scaffolding", description: "Set up monorepo with Turborepo, configure TypeScript, ESLint, Prettier, and shared packages.", priority: "High", assignee: "Alice Chen" },
  { id: "t11", title: "Design system setup", description: "Initialize component library with Tailwind CSS, create base tokens, and build foundational UI primitives.", priority: "Medium", assignee: "Jack Anderson" },
  { id: "t12", title: "Environment config", description: "Configure development, staging, and production environments with proper secret management and env validation.", priority: "Low", assignee: "Karen White" },
];

function getInitials(name: string): string {
  return name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2);
}

function TaskCard({
  task,
  onSelect,
}: {
  task: Task;
  onSelect: (task: Task) => void;
}) {
  return (
    <Motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
    >
      <Card
        className="cursor-pointer hover:shadow-md transition-shadow mb-2"
        onClick={() => onSelect(task)}
      >
        <CardContent className="p-3 space-y-2">
          <div className="flex items-start justify-between gap-2">
            <span className="text-sm font-medium leading-tight">{task.title}</span>
            <Badge className={cn("text-[10px] shrink-0", PRIORITY_VARIANT[task.priority])}>
              {task.priority}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground line-clamp-2">{task.description}</p>
          <div className="flex items-center gap-2 pt-1">
            <Avatar className="h-5 w-5">
              <AvatarFallback className="text-[9px] bg-primary/10 text-primary">
                {getInitials(task.assignee)}
              </AvatarFallback>
            </Avatar>
            <span className="text-[11px] text-muted-foreground">{task.assignee}</span>
          </div>
        </CardContent>
      </Card>
    </Motion.div>
  );
}

function KanbanBoard() {
  const { items: todoTasks, set: setTodoTasks } = useArrayState<Task>("kanbanTodo", INITIAL_TODO);
  const { items: inProgressTasks, set: setInProgressTasks } = useArrayState<Task>("kanbanInProgress", INITIAL_INPROGRESS);
  const { items: reviewTasks, set: setReviewTasks } = useArrayState<Task>("kanbanReview", INITIAL_REVIEW);
  const { items: doneTasks, set: setDoneTasks } = useArrayState<Task>("kanbanDone", INITIAL_DONE);

  const [selectedTaskId, setSelectedTaskId] = useAppState<string | null>("kanbanSelected", null);
  const [detailOpen, setDetailOpen] = React.useState(false);
  const [addColumnId, setAddColumnId] = useAppState<ColumnId | null>("kanbanAddCol", null);
  const [addOpen, setAddOpen] = React.useState(false);
  const [newTitle, setNewTitle] = React.useState("");
  const [newDesc, setNewDesc] = React.useState("");
  const [newPriority, setNewPriority] = React.useState<Priority>("Medium");

  const columns: Record<ColumnId, { tasks: Task[]; setter: (tasks: Task[]) => void }> = {
    todo: { tasks: todoTasks ?? INITIAL_TODO, setter: setTodoTasks },
    "in-progress": { tasks: inProgressTasks ?? INITIAL_INPROGRESS, setter: setInProgressTasks },
    review: { tasks: reviewTasks ?? INITIAL_REVIEW, setter: setReviewTasks },
    done: { tasks: doneTasks ?? INITIAL_DONE, setter: setDoneTasks },
  };

  const counts: Record<ColumnId, number> = {
    todo: (todoTasks ?? INITIAL_TODO).length,
    "in-progress": (inProgressTasks ?? INITIAL_INPROGRESS).length,
    review: (reviewTasks ?? INITIAL_REVIEW).length,
    done: (doneTasks ?? INITIAL_DONE).length,
  };

  const findTaskColumn = (taskId: string): ColumnId | null => {
    for (const colId of Object.keys(columns) as ColumnId[]) {
      if (columns[colId].tasks.some((t: Task) => t.id === taskId)) return colId;
    }
    return null;
  };

  const moveTask = (task: Task, targetCol: ColumnId) => {
    const sourceCol = findTaskColumn(task.id);
    if (!sourceCol || sourceCol === targetCol) return;

    columns[sourceCol].setter(
      columns[sourceCol].tasks.filter((t: Task) => t.id !== task.id)
    );
    columns[targetCol].setter([...columns[targetCol].tasks, task]);

    const targetLabel = COLUMN_META.find((c) => c.id === targetCol)?.label || targetCol;
    toast(`Moved "${task.title}" to ${targetLabel}`);
  };

  const handleDeleteTask = (task: Task) => {
    const col = findTaskColumn(task.id);
    if (!col) return;
    columns[col].setter(columns[col].tasks.filter((t: Task) => t.id !== task.id));
    toast(`Deleted "${task.title}"`);
    setDetailOpen(false);
  };

  const handleAddTask = () => {
    if (!newTitle.trim() || !addColumnId) return;
    const newTask: Task = {
      id: "t" + Date.now(),
      title: newTitle.trim(),
      description: newDesc.trim(),
      priority: newPriority,
      assignee: "Unassigned",
    };
    columns[addColumnId].setter([...columns[addColumnId].tasks, newTask]);
    toast(`Added "${newTask.title}" to ${COLUMN_META.find((c) => c.id === addColumnId)?.label}`);
    setNewTitle("");
    setNewDesc("");
    setNewPriority("Medium");
    setAddOpen(false);
  };

  const openAddDialog = (colId: ColumnId) => {
    setAddColumnId(colId);
    setNewTitle("");
    setNewDesc("");
    setNewPriority("Medium");
    setAddOpen(true);
  };

  const openDetailDialog = (task: Task) => {
    setSelectedTaskId(task.id);
    setDetailOpen(true);
  };

  const currentTask: Task | null = (() => {
    if (!selectedTaskId) return null;
    for (const colId of Object.keys(columns) as ColumnId[]) {
      const found = columns[colId].tasks.find((t: Task) => t.id === selectedTaskId);
      if (found) return found;
    }
    return null;
  })();
  const currentTaskColumn = currentTask ? findTaskColumn(currentTask.id) : null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Kanban Board</h2>
          <p className="text-sm text-muted-foreground">
            Click a task to view details or move it between columns.
          </p>
        </div>
        <Badge variant="outline" className="text-xs">
          {counts.todo + counts["in-progress"] + counts.review + counts.done} tasks total
        </Badge>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {COLUMN_META.map((col) => {
          const Icon = Icons[col.icon] as React.ComponentType<{ className?: string }>;
          return (
            <Card key={col.id} className="flex flex-col">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {Icon && <Icon className={cn("h-4 w-4", col.color)} />}
                    <CardTitle className="text-sm font-semibold">{col.label}</CardTitle>
                    <Badge variant="secondary" className="text-xs h-5 min-w-[20px] flex items-center justify-center">
                      {counts[col.id]}
                    </Badge>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={() => openAddDialog(col.id)}
                  >
                    <Icons.Plus className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="flex-1 px-3 pb-3">
                <ScrollArea className="h-[380px] pr-2">
                  <div className="space-y-0">
                    {columns[col.id].tasks.length === 0 ? (
                      <p className="text-xs text-muted-foreground text-center py-8">
                        No tasks
                      </p>
                    ) : (
                      columns[col.id].tasks.map((task: Task) => (
                        <TaskCard
                          key={task.id}
                          task={task}
                          onSelect={openDetailDialog}
                        />
                      ))
                    )}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Task Detail Dialog */}
      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="sm:max-w-[480px]">
          {currentTask && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  {currentTask.title}
                  <Badge className={cn("text-xs", PRIORITY_VARIANT[currentTask.priority])}>
                    {currentTask.priority}
                  </Badge>
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-4 py-2">
                <div>
                  <Label className="text-xs text-muted-foreground">Description</Label>
                  <p className="text-sm mt-1">{currentTask.description}</p>
                </div>
                <Separator />
                <div className="flex items-center gap-3">
                  <Avatar className="h-7 w-7">
                    <AvatarFallback className="text-[10px] bg-primary/10 text-primary">
                      {getInitials(currentTask.assignee)}
                    </AvatarFallback>
                  </Avatar>
                  <div>
                    <Label className="text-xs text-muted-foreground">Assignee</Label>
                    <p className="text-sm font-medium">{currentTask.assignee}</p>
                  </div>
                </div>
                <Separator />
                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground">Move to column</Label>
                  <Select
                    value={currentTaskColumn || "todo"}
                    onValueChange={(value: string) => {
                      moveTask(currentTask, value as ColumnId);
                      setDetailOpen(false);
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select column" />
                    </SelectTrigger>
                    <SelectContent>
                      {COLUMN_META.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <DialogFooter className="flex-row justify-between sm:justify-between">
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => handleDeleteTask(currentTask)}
                >
                  <Icons.Trash2 className="mr-2 h-3.5 w-3.5" />
                  Delete
                </Button>
                <Button variant="outline" size="sm" onClick={() => setDetailOpen(false)}>
                  Close
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Add Task Dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>
              Add Task to {COLUMN_META.find((c) => c.id === addColumnId)?.label}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="task-title">Title</Label>
              <Input
                id="task-title"
                value={newTitle}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  setNewTitle(e.target.value)
                }
                placeholder="Enter task title"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="task-desc">Description</Label>
              <Textarea
                id="task-desc"
                value={newDesc}
                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
                  setNewDesc(e.target.value)
                }
                placeholder="Describe the task..."
                rows={3}
              />
            </div>
            <div className="space-y-2">
              <Label>Priority</Label>
              <Select
                value={newPriority}
                onValueChange={(v: string) => setNewPriority(v as Priority)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select priority" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Low">Low</SelectItem>
                  <SelectItem value="Medium">Medium</SelectItem>
                  <SelectItem value="High">High</SelectItem>
                  <SelectItem value="Urgent">Urgent</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleAddTask} disabled={!newTitle.trim()}>
              <Icons.Plus className="mr-2 h-4 w-4" />
              Add Task
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default KanbanBoard;
