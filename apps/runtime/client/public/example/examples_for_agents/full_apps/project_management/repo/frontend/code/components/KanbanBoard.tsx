import { React, cn, useModel, useAppState, Card, CardHeader, CardTitle, CardContent, Badge, Button, Icons, Avatar, AvatarFallback, toast } from '@exepad/sdk';

const DEMO_TASKS = [
  { id: '1', title: 'Design system tokens', status: 'done', priority: 'high', assignee: 'Sarah Chen', due_date: '2026-03-20', estimated_hours: 8 },
  { id: '2', title: 'User auth flow', status: 'in_progress', priority: 'urgent', assignee: 'Marcus Johnson', due_date: '2026-03-25', estimated_hours: 16 },
  { id: '3', title: 'Dashboard wireframes', status: 'review', priority: 'high', assignee: 'Aiko Tanaka', due_date: '2026-03-22', estimated_hours: 12 },
  { id: '4', title: 'API pagination', status: 'todo', priority: 'medium', assignee: 'James Wilson', due_date: '2026-03-28', estimated_hours: 6 },
  { id: '5', title: 'Unit test coverage', status: 'in_progress', priority: 'medium', assignee: 'Priya Patel', due_date: '2026-03-30', estimated_hours: 20 },
  { id: '6', title: 'Mobile responsive layout', status: 'backlog', priority: 'low', assignee: 'Emma Davis', due_date: '2026-04-05', estimated_hours: 10 },
  { id: '7', title: 'Database migration scripts', status: 'done', priority: 'high', assignee: 'Marcus Johnson', due_date: '2026-03-18', estimated_hours: 4 },
  { id: '8', title: 'Error boundary setup', status: 'done', priority: 'medium', assignee: 'Sarah Chen', due_date: '2026-03-15', estimated_hours: 3 },
  { id: '9', title: 'CI/CD pipeline', status: 'review', priority: 'high', assignee: 'James Wilson', due_date: '2026-03-24', estimated_hours: 14 },
  { id: '10', title: 'SSO integration', status: 'todo', priority: 'urgent', assignee: 'Priya Patel', due_date: '2026-03-27', estimated_hours: 24 },
  { id: '11', title: 'Performance profiling', status: 'backlog', priority: 'medium', assignee: 'Aiko Tanaka', due_date: '2026-04-10', estimated_hours: 8 },
  { id: '12', title: 'Accessibility audit', status: 'todo', priority: 'low', assignee: 'Emma Davis', due_date: '2026-04-02', estimated_hours: 12 },
  { id: '13', title: 'Email notification service', status: 'in_progress', priority: 'medium', assignee: 'Marcus Johnson', due_date: '2026-03-29', estimated_hours: 10 },
  { id: '14', title: 'File upload component', status: 'backlog', priority: 'low', assignee: 'Sarah Chen', due_date: '2026-04-08', estimated_hours: 6 },
  { id: '15', title: 'Rate limiting middleware', status: 'done', priority: 'urgent', assignee: 'James Wilson', due_date: '2026-03-19', estimated_hours: 5 },
  { id: '16', title: 'Search indexing', status: 'todo', priority: 'high', assignee: 'Priya Patel', due_date: '2026-04-01', estimated_hours: 16 },
];

const COLUMNS = [
  { id: 'backlog', label: 'Backlog', icon: 'Inbox', color: 'text-gray-500' },
  { id: 'todo', label: 'To Do', icon: 'Circle', color: 'text-violet-500' },
  { id: 'in_progress', label: 'In Progress', icon: 'Timer', color: 'text-blue-500' },
  { id: 'review', label: 'Review', icon: 'Eye', color: 'text-amber-500' },
  { id: 'done', label: 'Done', icon: 'CheckCircle2', color: 'text-green-500' },
];

const PRIORITY_STYLES = {
  urgent: { badge: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300', border: 'priority-urgent' },
  high: { badge: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-300', border: 'priority-high' },
  medium: { badge: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300', border: 'priority-medium' },
  low: { badge: 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-300', border: 'priority-low' },
};

function getInitials(name: string): string {
  return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
}

function formatDueDate(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diff = date.getTime() - now.getTime();
  const days = Math.ceil(diff / 86400000);
  if (days < 0) return `${Math.abs(days)}d overdue`;
  if (days === 0) return 'Due today';
  if (days === 1) return 'Due tomorrow';
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export default function KanbanBoard({ className }) {
  const { data: tasks } = useModel('tasks', { limit: 50, orderBy: { due_date: 'asc' } });
  const taskList = (tasks?.length ? tasks : DEMO_TASKS) as any[];

  return (
    <div className={cn('p-6 lg:p-8', className)}>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-bold text-foreground">Kanban Board</h2>
          <p className="text-sm text-muted-foreground">{taskList.length} tasks across {COLUMNS.length} columns</p>
        </div>
        <Button size="sm">
          <Icons.Plus className="h-4 w-4 mr-1" />
          Add Task
        </Button>
      </div>

      {/* Board */}
      <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4">
        {COLUMNS.map((col) => {
          const Icon = Icons[col.icon] as React.ComponentType<{ className?: string }>;
          const colTasks = taskList.filter(t => t.status === col.id);
          return (
            <div key={col.id} className="kanban-column">
              {/* Column Header */}
              <div className="flex items-center justify-between mb-3 px-1">
                <div className="flex items-center gap-2">
                  {Icon && <Icon className={cn('h-4 w-4', col.color)} />}
                  <span className="text-sm font-semibold text-foreground">{col.label}</span>
                  <Badge variant="secondary" className="text-[10px] h-5 min-w-[20px] flex items-center justify-center">
                    {colTasks.length}
                  </Badge>
                </div>
                <Button variant="ghost" size="icon" className="h-6 w-6">
                  <Icons.Plus className="h-3.5 w-3.5" />
                </Button>
              </div>

              {/* Task Cards */}
              <div className="space-y-2">
                {colTasks.map((task: any) => {
                  const pStyle = PRIORITY_STYLES[task.priority] || PRIORITY_STYLES.medium;
                  const isOverdue = new Date(task.due_date) < new Date() && task.status !== 'done';
                  return (
                    <Card key={task.id} className={cn('task-card cursor-pointer', pStyle.border)}>
                      <CardContent className="p-3 space-y-2">
                        <div className="flex items-start justify-between gap-1">
                          <span className="text-sm font-medium leading-tight text-foreground">{task.title}</span>
                        </div>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <Badge className={cn('text-[10px] px-1.5 py-0', pStyle.badge)}>
                            {task.priority}
                          </Badge>
                          {task.estimated_hours && (
                            <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                              {task.estimated_hours}h
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center justify-between pt-1">
                          <div className="flex items-center gap-1.5">
                            <Avatar className="h-5 w-5">
                              <AvatarFallback className="text-[8px] bg-primary/10 text-primary">
                                {getInitials(task.assignee)}
                              </AvatarFallback>
                            </Avatar>
                            <span className="text-[11px] text-muted-foreground">{task.assignee.split(' ')[0]}</span>
                          </div>
                          <span className={cn('text-[10px]', isOverdue ? 'text-destructive font-medium' : 'text-muted-foreground')}>
                            {formatDueDate(task.due_date)}
                          </span>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
                {colTasks.length === 0 && (
                  <div className="py-8 text-center">
                    <p className="text-xs text-muted-foreground">No tasks</p>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
