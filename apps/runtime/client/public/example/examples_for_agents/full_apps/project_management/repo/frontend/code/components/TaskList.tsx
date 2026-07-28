import { React, cn, useModel, useAppState, Card, CardHeader, CardTitle, CardContent, Badge, Button, Input, Icons, Table, TableHeader, TableBody, TableRow, TableHead, TableCell, Select, SelectTrigger, SelectValue, SelectContent, SelectItem, Avatar, AvatarFallback } from '@exepad/sdk';

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

const STATUS_STYLES = {
  backlog: 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300',
  todo: 'bg-violet-100 text-violet-800 dark:bg-violet-900 dark:text-violet-300',
  in_progress: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300',
  review: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-300',
  done: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300',
};

const PRIORITY_STYLES = {
  urgent: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300',
  high: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-300',
  medium: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300',
  low: 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-300',
};

const PRIORITY_ORDER = { urgent: 0, high: 1, medium: 2, low: 3 };

function getInitials(name: string): string {
  return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
}

function formatLabel(s: string): string {
  return s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

export default function TaskList({ className }) {
  const { data: tasks } = useModel('tasks', { limit: 50, orderBy: { due_date: 'asc' } });
  const [statusFilter, setStatusFilter] = useAppState<string>('taskFilter', 'all');
  const [priorityFilter, setPriorityFilter] = React.useState('all');
  const [searchQuery, setSearchQuery] = React.useState('');
  const [sortBy, setSortBy] = React.useState<'due_date' | 'priority' | 'title'>('due_date');
  const [sortDir, setSortDir] = React.useState<'asc' | 'desc'>('asc');

  const taskList = (tasks?.length ? tasks : DEMO_TASKS) as any[];

  const filtered = taskList
    .filter(t => statusFilter === 'all' || t.status === statusFilter)
    .filter(t => priorityFilter === 'all' || t.priority === priorityFilter)
    .filter(t => !searchQuery || t.title.toLowerCase().includes(searchQuery.toLowerCase()) || t.assignee.toLowerCase().includes(searchQuery.toLowerCase()))
    .sort((a, b) => {
      let cmp = 0;
      if (sortBy === 'due_date') cmp = new Date(a.due_date).getTime() - new Date(b.due_date).getTime();
      else if (sortBy === 'priority') cmp = (PRIORITY_ORDER[a.priority] || 2) - (PRIORITY_ORDER[b.priority] || 2);
      else cmp = a.title.localeCompare(b.title);
      return sortDir === 'asc' ? cmp : -cmp;
    });

  const handleSort = (col: 'due_date' | 'priority' | 'title') => {
    if (sortBy === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortBy(col); setSortDir('asc'); }
  };

  const SortIcon = ({ col }: { col: string }) => {
    if (sortBy !== col) return <Icons.ArrowUpDown className="h-3 w-3 ml-1 opacity-30" />;
    return sortDir === 'asc' ? <Icons.ArrowUp className="h-3 w-3 ml-1" /> : <Icons.ArrowDown className="h-3 w-3 ml-1" />;
  };

  return (
    <div className={cn('p-6 lg:p-8 space-y-6', className)}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-foreground">Task List</h2>
          <p className="text-sm text-muted-foreground">Showing {filtered.length} of {taskList.length} tasks</p>
        </div>
        <Button size="sm">
          <Icons.Plus className="h-4 w-4 mr-1" />
          New Task
        </Button>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[200px]">
              <Icons.Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input className="pl-9 h-9" placeholder="Search tasks..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
            </div>
            <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v)}>
              <SelectTrigger className="w-[150px] h-9">
                <SelectValue placeholder="Status" />
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
            <Select value={priorityFilter} onValueChange={setPriorityFilter}>
              <SelectTrigger className="w-[150px] h-9">
                <SelectValue placeholder="Priority" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Priorities</SelectItem>
                <SelectItem value="urgent">Urgent</SelectItem>
                <SelectItem value="high">High</SelectItem>
                <SelectItem value="medium">Medium</SelectItem>
                <SelectItem value="low">Low</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="cursor-pointer select-none" onClick={() => handleSort('title')}>
                  <div className="flex items-center">Title <SortIcon col="title" /></div>
                </TableHead>
                <TableHead className="cursor-pointer select-none" onClick={() => handleSort('priority')}>
                  <div className="flex items-center">Priority <SortIcon col="priority" /></div>
                </TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Assignee</TableHead>
                <TableHead className="cursor-pointer select-none" onClick={() => handleSort('due_date')}>
                  <div className="flex items-center">Due Date <SortIcon col="due_date" /></div>
                </TableHead>
                <TableHead className="text-right">Hours</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((task: any) => {
                const isOverdue = new Date(task.due_date) < new Date() && task.status !== 'done';
                return (
                  <TableRow key={task.id} className="hover:bg-secondary/50">
                    <TableCell className="font-medium">{task.title}</TableCell>
                    <TableCell>
                      <Badge className={cn('text-[10px]', PRIORITY_STYLES[task.priority] || '')}>
                        {formatLabel(task.priority)}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge className={cn('text-[10px]', STATUS_STYLES[task.status] || '')}>
                        {formatLabel(task.status)}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Avatar className="h-6 w-6">
                          <AvatarFallback className="text-[9px] bg-primary/10 text-primary">{getInitials(task.assignee)}</AvatarFallback>
                        </Avatar>
                        <span className="text-sm">{task.assignee}</span>
                      </div>
                    </TableCell>
                    <TableCell className={cn(isOverdue && 'text-destructive font-medium')}>
                      {new Date(task.due_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">{task.estimated_hours}h</TableCell>
                  </TableRow>
                );
              })}
              {filtered.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                    No tasks match your filters
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
