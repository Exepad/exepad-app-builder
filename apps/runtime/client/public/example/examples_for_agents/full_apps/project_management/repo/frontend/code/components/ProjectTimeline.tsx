import { React, cn, useModel, Card, CardHeader, CardTitle, CardContent, Badge, Button, Icons, Select, SelectTrigger, SelectValue, SelectContent, SelectItem, Progress, Separator } from '@exepad/sdk';

const DEMO_TASKS = [
  { id: '1', title: 'Design system tokens', status: 'done', priority: 'high', assignee: 'Sarah Chen', due_date: '2026-03-20', estimated_hours: 8, project_id: '1' },
  { id: '2', title: 'User auth flow', status: 'in_progress', priority: 'urgent', assignee: 'Marcus Johnson', due_date: '2026-03-25', estimated_hours: 16, project_id: '1' },
  { id: '3', title: 'Dashboard wireframes', status: 'review', priority: 'high', assignee: 'Aiko Tanaka', due_date: '2026-03-22', estimated_hours: 12, project_id: '1' },
  { id: '4', title: 'API pagination', status: 'todo', priority: 'medium', assignee: 'James Wilson', due_date: '2026-03-28', estimated_hours: 6, project_id: '1' },
  { id: '5', title: 'Unit test coverage', status: 'in_progress', priority: 'medium', assignee: 'Priya Patel', due_date: '2026-03-30', estimated_hours: 20, project_id: '1' },
  { id: '6', title: 'Mobile responsive layout', status: 'backlog', priority: 'low', assignee: 'Emma Davis', due_date: '2026-04-05', estimated_hours: 10, project_id: '1' },
  { id: '7', title: 'Database migration scripts', status: 'done', priority: 'high', assignee: 'Marcus Johnson', due_date: '2026-03-18', estimated_hours: 4, project_id: '1' },
  { id: '8', title: 'Error boundary setup', status: 'done', priority: 'medium', assignee: 'Sarah Chen', due_date: '2026-03-15', estimated_hours: 3, project_id: '1' },
  { id: '9', title: 'CI/CD pipeline', status: 'review', priority: 'high', assignee: 'James Wilson', due_date: '2026-03-24', estimated_hours: 14, project_id: '1' },
  { id: '10', title: 'SSO integration', status: 'todo', priority: 'urgent', assignee: 'Priya Patel', due_date: '2026-03-27', estimated_hours: 24, project_id: '1' },
  { id: '11', title: 'Performance profiling', status: 'backlog', priority: 'medium', assignee: 'Aiko Tanaka', due_date: '2026-04-10', estimated_hours: 8, project_id: '1' },
  { id: '12', title: 'Accessibility audit', status: 'todo', priority: 'low', assignee: 'Emma Davis', due_date: '2026-04-02', estimated_hours: 12, project_id: '1' },
  { id: '13', title: 'Email notification service', status: 'in_progress', priority: 'medium', assignee: 'Marcus Johnson', due_date: '2026-03-29', estimated_hours: 10, project_id: '1' },
  { id: '14', title: 'File upload component', status: 'backlog', priority: 'low', assignee: 'Sarah Chen', due_date: '2026-04-08', estimated_hours: 6, project_id: '1' },
  { id: '15', title: 'Rate limiting middleware', status: 'done', priority: 'urgent', assignee: 'James Wilson', due_date: '2026-03-19', estimated_hours: 5, project_id: '1' },
  { id: '16', title: 'Search indexing', status: 'todo', priority: 'high', assignee: 'Priya Patel', due_date: '2026-04-01', estimated_hours: 16, project_id: '1' },
];

const STATUS_COLORS = {
  backlog: { bar: 'bg-gray-400', text: 'text-gray-600', badge: 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300' },
  todo: { bar: 'bg-violet-500', text: 'text-violet-600', badge: 'bg-violet-100 text-violet-800 dark:bg-violet-900 dark:text-violet-300' },
  in_progress: { bar: 'bg-blue-500', text: 'text-blue-600', badge: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300' },
  review: { bar: 'bg-amber-500', text: 'text-amber-600', badge: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-300' },
  done: { bar: 'bg-green-500', text: 'text-green-600', badge: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300' },
};

const STATUS_PROGRESS = { backlog: 0, todo: 10, in_progress: 50, review: 80, done: 100 };

function formatLabel(s: string): string {
  return s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

export default function ProjectTimeline({ className }) {
  const { data: tasks } = useModel('tasks', { limit: 50, orderBy: { due_date: 'asc' } });
  const [statusFilter, setStatusFilter] = React.useState('all');

  const taskList = (tasks?.length ? tasks : DEMO_TASKS) as any[];

  // Compute timeline range
  const allDates = taskList.map(t => new Date(t.due_date).getTime());
  const minDate = Math.min(...allDates);
  const maxDate = Math.max(...allDates);
  const rangeMs = maxDate - minDate || 1;

  // Generate week markers
  const weeks: string[] = [];
  const weekStart = new Date(minDate);
  weekStart.setDate(weekStart.getDate() - weekStart.getDay());
  while (weekStart.getTime() <= maxDate + 7 * 86400000) {
    weeks.push(weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));
    weekStart.setDate(weekStart.getDate() + 7);
  }

  const filtered = taskList
    .filter(t => statusFilter === 'all' || t.status === statusFilter)
    .sort((a, b) => new Date(a.due_date).getTime() - new Date(b.due_date).getTime());

  // Today marker position
  const todayMs = Date.now();
  const todayPercent = Math.max(0, Math.min(100, ((todayMs - minDate) / rangeMs) * 100));

  return (
    <div className={cn('p-6 lg:p-8 space-y-6', className)}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-foreground">Project Timeline</h2>
          <p className="text-sm text-muted-foreground">
            {filtered.length} tasks &middot; {new Date(minDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - {new Date(maxDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
          </p>
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[160px] h-9">
            <SelectValue placeholder="Filter status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="backlog">Backlog</SelectItem>
            <SelectItem value="todo">To Do</SelectItem>
            <SelectItem value="in_progress">In Progress</SelectItem>
            <SelectItem value="review">Review</SelectItem>
            <SelectItem value="done">Done</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-4">
        {Object.entries(STATUS_COLORS).map(([status, colors]) => (
          <div key={status} className="flex items-center gap-1.5">
            <div className={cn('w-3 h-3 rounded-sm', colors.bar)} />
            <span className="text-xs text-muted-foreground">{formatLabel(status)}</span>
          </div>
        ))}
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-0.5 bg-destructive" />
          <span className="text-xs text-muted-foreground">Today</span>
        </div>
      </div>

      {/* Timeline */}
      <Card>
        <CardContent className="p-0">
          {/* Week Headers */}
          <div className="flex border-b border-border px-4 py-2 bg-secondary/50">
            <div className="w-48 shrink-0 text-xs font-semibold text-muted-foreground">Task</div>
            <div className="flex-1 relative">
              <div className="flex justify-between">
                {weeks.slice(0, 6).map((w, i) => (
                  <span key={i} className="text-[10px] text-muted-foreground font-medium">{w}</span>
                ))}
              </div>
            </div>
          </div>

          {/* Task Rows */}
          <div className="divide-y divide-border">
            {filtered.map((task: any) => {
              const dueMs = new Date(task.due_date).getTime();
              const durationDays = task.estimated_hours ? Math.ceil(task.estimated_hours / 8) : 3;
              const startMs = dueMs - durationDays * 86400000;
              const leftPercent = Math.max(0, ((startMs - minDate) / rangeMs) * 100);
              const widthPercent = Math.max(5, (durationDays * 86400000 / rangeMs) * 100);
              const colors = STATUS_COLORS[task.status] || STATUS_COLORS.backlog;
              const progress = STATUS_PROGRESS[task.status] || 0;
              const isOverdue = dueMs < todayMs && task.status !== 'done';

              return (
                <div key={task.id} className="flex items-center px-4 py-3 hover:bg-secondary/30 transition-colors">
                  {/* Task Label */}
                  <div className="w-48 shrink-0 pr-4">
                    <p className="text-sm font-medium text-foreground truncate">{task.title}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[10px] text-muted-foreground">{task.assignee.split(' ')[0]}</span>
                      <Badge className={cn('text-[9px] px-1 py-0', colors.badge)}>
                        {formatLabel(task.status)}
                      </Badge>
                    </div>
                  </div>

                  {/* Gantt Bar */}
                  <div className="flex-1 relative h-8">
                    {/* Today line */}
                    <div
                      className="absolute top-0 bottom-0 w-px bg-destructive/40 z-10"
                      style={{ left: `${todayPercent}%` }}
                    />
                    {/* Bar */}
                    <div
                      className={cn('absolute top-1 h-6 rounded-md flex items-center px-2 overflow-hidden', isOverdue ? 'ring-1 ring-destructive/50' : '')}
                      style={{ left: `${leftPercent}%`, width: `${Math.min(widthPercent, 100 - leftPercent)}%` }}
                    >
                      {/* Background */}
                      <div className={cn('absolute inset-0 opacity-20', colors.bar)} />
                      {/* Progress fill */}
                      <div className={cn('absolute left-0 top-0 bottom-0 opacity-40', colors.bar)} style={{ width: `${progress}%` }} />
                      {/* Label */}
                      <span className="relative text-[10px] font-medium text-foreground truncate z-10">
                        {new Date(task.due_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {filtered.length === 0 && (
            <div className="py-12 text-center">
              <Icons.Calendar className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">No tasks to display on timeline</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Summary Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {Object.entries(STATUS_COLORS).filter(([s]) => s !== 'backlog').map(([status, colors]) => {
          const count = taskList.filter(t => t.status === status).length;
          return (
            <Card key={status}>
              <CardContent className="p-4 text-center">
                <div className={cn('w-3 h-3 rounded-full mx-auto mb-2', colors.bar)} />
                <p className="text-xl font-bold text-foreground">{count}</p>
                <p className="text-xs text-muted-foreground">{formatLabel(status)}</p>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
