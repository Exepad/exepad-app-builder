import {
  React,
  useAppState,
  toast,
  Card,
  CardHeader,
  CardTitle,
  CardContent,
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
  Button,
  Badge,
  Avatar,
  AvatarFallback,
  ScrollArea,
  Label,
  Icons,
  cn,
} from "@exepad/sdk";
import * as DndKitM from "@exepad/ext-dnd-kit";
const DndKit: any = (DndKitM as any).default ? { ...DndKitM, ...(DndKitM as any).default } : DndKitM;

interface Task {
  id: string;
  title: string;
  description: string;
  priority: "low" | "medium" | "high";
  assignee: string;
  column: "todo" | "in-progress" | "done";
}

const DEMO_TASKS: Task[] = [
  { id: "t1", title: "Design landing page", description: "Create wireframes and high-fidelity mockups for the new landing page.", priority: "high", assignee: "Alice", column: "todo" },
  { id: "t2", title: "Set up CI/CD pipeline", description: "Configure GitHub Actions for automated testing and deployment.", priority: "high", assignee: "Bob", column: "todo" },
  { id: "t3", title: "Write API docs", description: "Document REST API endpoints using OpenAPI spec.", priority: "medium", assignee: "Carol", column: "todo" },
  { id: "t4", title: "Implement auth flow", description: "Build login, registration, and password reset with JWT.", priority: "high", assignee: "Dave", column: "in-progress" },
  { id: "t5", title: "Database migration", description: "Migrate user data from legacy system to new PostgreSQL schema.", priority: "medium", assignee: "Eve", column: "in-progress" },
  { id: "t6", title: "Add unit tests", description: "Write unit tests for core business logic with 80%+ coverage.", priority: "medium", assignee: "Frank", column: "in-progress" },
  { id: "t7", title: "Fix mobile layout", description: "Resolve responsive design issues on tablet and mobile viewports.", priority: "low", assignee: "Grace", column: "done" },
  { id: "t8", title: "Performance audit", description: "Run Lighthouse and optimize bundle size, LCP, and CLS.", priority: "low", assignee: "Hank", column: "done" },
  { id: "t9", title: "Update dependencies", description: "Upgrade all npm packages to latest stable versions.", priority: "low", assignee: "Ivy", column: "done" },
];

const COLUMNS: { id: "todo" | "in-progress" | "done"; title: string; icon: keyof typeof Icons }[] = [
  { id: "todo", title: "To Do", icon: "Circle" },
  { id: "in-progress", title: "In Progress", icon: "Clock" },
  { id: "done", title: "Done", icon: "CheckCircle" },
];

const PRIORITY_COLORS: Record<string, string> = {
  high: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  medium: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400",
  low: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
};

function SortableTaskCard({ task }: { task: Task }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = DndKit.useSortable({
    id: task.id,
    data: { task },
  });

  const style: React.CSSProperties = {
    transform: transform
      ? `translate3d(${transform.x}px, ${transform.y}px, 0)`
      : undefined,
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 50 : "auto",
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <Card className={cn("cursor-grab active:cursor-grabbing hover:shadow-md transition-shadow", isDragging && "ring-2 ring-primary")}>
        <CardContent className="p-3 space-y-2">
          <div className="flex items-start justify-between gap-2">
            <span className="font-medium text-sm leading-tight">{task.title}</span>
            <Badge className={cn("text-[10px] shrink-0", PRIORITY_COLORS[task.priority])}>
              {task.priority}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground line-clamp-2">{task.description}</p>
          <div className="flex items-center gap-1.5">
            <Avatar className="h-5 w-5">
              <AvatarFallback className="text-[10px]">
                {task.assignee.slice(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <span className="text-xs text-muted-foreground">{task.assignee}</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function DroppableColumn({
  column,
  tasks,
  onAddTask,
}: {
  column: (typeof COLUMNS)[number];
  tasks: Task[];
  onAddTask: (columnId: string) => void;
}) {
  const { setNodeRef, isOver } = DndKit.useDroppable({ id: column.id });
  const ColIcon = Icons[column.icon] as React.ComponentType<{ className?: string }>;
  const taskIds = tasks.map((t) => t.id);

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex-1 min-w-[280px] rounded-xl border bg-muted/30 p-3 transition-colors",
        isOver && "bg-primary/5 border-primary/30"
      )}
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          {ColIcon && <ColIcon className="h-4 w-4 text-muted-foreground" />}
          <span className="font-semibold text-sm">{column.title}</span>
          <Badge variant="secondary" className="text-xs">
            {tasks.length}
          </Badge>
        </div>
        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => onAddTask(column.id)}>
          <Icons.Plus className="h-4 w-4" />
        </Button>
      </div>
      <ScrollArea className="h-[420px]">
        <DndKit.SortableContext items={taskIds} strategy={DndKit.verticalListSortingStrategy}>
          <div className="space-y-2">
            {tasks.map((task) => (
              <SortableTaskCard key={task.id} task={task} />
            ))}
            {tasks.length === 0 && (
              <div className="text-center py-8 text-muted-foreground text-xs">
                <Icons.Inbox className="h-6 w-6 mx-auto mb-1 opacity-40" />
                Drop tasks here
              </div>
            )}
          </div>
        </DndKit.SortableContext>
      </ScrollArea>
    </div>
  );
}

function DndKanbanBoardGuard() {
  if (!DndKit.DndContext || !DndKit.SortableContext || !DndKit.useSortable) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          <Icons.LayoutDashboard className="h-8 w-8 mx-auto mb-2 opacity-40" />
          <p className="text-sm">DnD Kanban Board requires the full dnd-kit bundle (production mode)</p>
        </CardContent>
      </Card>
    );
  }
  return <DndKanbanBoard />;
}

function DndKanbanBoard() {
  const [tasks, setTasks] = useAppState<Task[]>("kanbanTasks", DEMO_TASKS);
  const [activeId, setActiveId] = React.useState<string | null>(null);
  const [addDialogOpen, setAddDialogOpen] = React.useState(false);
  const [addToColumn, setAddToColumn] = React.useState<string>("todo");
  const [newTitle, setNewTitle] = React.useState("");
  const [newDesc, setNewDesc] = React.useState("");
  const [newPriority, setNewPriority] = React.useState<string>("medium");
  const [newAssignee, setNewAssignee] = React.useState("");

  const currentTasks = tasks ?? DEMO_TASKS;

  const sensors = DndKit.useSensors(
    DndKit.useSensor(DndKit.PointerSensor, { activationConstraint: { distance: 5 } }),
    DndKit.useSensor(DndKit.KeyboardSensor, { coordinateGetter: DndKit.sortableKeyboardCoordinates })
  );

  const activeTask = activeId ? currentTasks.find((t) => t.id === activeId) : null;

  const handleDragStart = (event: any) => {
    setActiveId(event.active.id as string);
  };

  const handleDragOver = (event: any) => {
    const { active, over } = event;
    if (!over) return;

    const activeTask2 = currentTasks.find((t) => t.id === active.id);
    if (!activeTask2) return;

    let targetColumn: string | null = null;
    const overTask = currentTasks.find((t) => t.id === over.id);
    if (overTask) {
      targetColumn = overTask.column;
    } else if (COLUMNS.some((c) => c.id === over.id)) {
      targetColumn = over.id as string;
    }

    if (targetColumn && activeTask2.column !== targetColumn) {
      const updated = currentTasks.map((t) =>
        t.id === active.id ? { ...t, column: targetColumn as Task["column"] } : t
      );
      setTasks(updated);
    }
  };

  const handleDragEnd = (event: any) => {
    const { active, over } = event;
    setActiveId(null);

    if (!over) return;

    const activeIdx = currentTasks.findIndex((t) => t.id === active.id);
    const overIdx = currentTasks.findIndex((t) => t.id === over.id);

    if (activeIdx !== -1 && overIdx !== -1 && activeIdx !== overIdx) {
      const reordered = DndKit.arrayMove(currentTasks, activeIdx, overIdx);
      setTasks(reordered);
      toast("Task moved");
    }
  };

  const handleAddTask = (columnId: string) => {
    setAddToColumn(columnId);
    setNewTitle("");
    setNewDesc("");
    setNewPriority("medium");
    setNewAssignee("");
    setAddDialogOpen(true);
  };

  const handleCreateTask = () => {
    if (!newTitle.trim()) {
      toast.error("Title is required");
      return;
    }
    const task: Task = {
      id: "t" + Date.now(),
      title: newTitle.trim(),
      description: newDesc.trim(),
      priority: newPriority as Task["priority"],
      assignee: newAssignee.trim() || "Unassigned",
      column: addToColumn as Task["column"],
    };
    setTasks([...currentTasks, task]);
    setAddDialogOpen(false);
    toast.success("Task added to " + COLUMNS.find((c) => c.id === addToColumn)?.title);
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2">
            <Icons.LayoutDashboard className="h-5 w-5" />
            Kanban Board
            <Badge variant="secondary">{currentTasks.length} tasks</Badge>
          </CardTitle>
        </CardHeader>
      </Card>

      <DndKit.DndContext
        sensors={sensors}
        collisionDetection={DndKit.closestCenter}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
      >
        <div className="flex gap-4 overflow-x-auto pb-2">
          {COLUMNS.map((column) => {
            const columnTasks = currentTasks.filter((t) => t.column === column.id);
            return (
              <DroppableColumn
                key={column.id}
                column={column}
                tasks={columnTasks}
                onAddTask={handleAddTask}
              />
            );
          })}
        </div>

        <DndKit.DragOverlay>
          {activeTask && (
            <Card className="cursor-grabbing shadow-xl ring-2 ring-primary w-[280px]">
              <CardContent className="p-3 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <span className="font-medium text-sm">{activeTask.title}</span>
                  <Badge className={cn("text-[10px] shrink-0", PRIORITY_COLORS[activeTask.priority])}>
                    {activeTask.priority}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground line-clamp-2">{activeTask.description}</p>
                <div className="flex items-center gap-1.5">
                  <Avatar className="h-5 w-5">
                    <AvatarFallback className="text-[10px]">
                      {activeTask.assignee.slice(0, 2).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <span className="text-xs text-muted-foreground">{activeTask.assignee}</span>
                </div>
              </CardContent>
            </Card>
          )}
        </DndKit.DragOverlay>
      </DndKit.DndContext>

      {/* Add Task Dialog */}
      <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Add Task to {COLUMNS.find((c) => c.id === addToColumn)?.title}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Title</Label>
              <Input
                placeholder="Task title..."
                value={newTitle}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewTitle(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Textarea
                placeholder="Task description..."
                value={newDesc}
                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setNewDesc(e.target.value)}
                rows={3}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Priority</Label>
                <Select value={newPriority} onValueChange={setNewPriority}>
                  <SelectTrigger>
                    <SelectValue placeholder="Priority" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Low</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Assignee</Label>
                <Input
                  placeholder="Name..."
                  value={newAssignee}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewAssignee(e.target.value)}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreateTask}>
              <Icons.Plus className="h-4 w-4 mr-1" />
              Add Task
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default DndKanbanBoardGuard;
