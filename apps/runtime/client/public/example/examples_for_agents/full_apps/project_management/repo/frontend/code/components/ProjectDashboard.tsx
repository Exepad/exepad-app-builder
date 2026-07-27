import { React, cn, navigate, useModel, useAppState, Card, CardHeader, CardTitle, CardContent, Badge, Icons, Charts, Separator } from '@exepad/sdk';

const DEMO_TASKS = [
  { id: '1', title: 'Design system tokens', status: 'done', priority: 'high', assignee: 'Sarah Chen', due_date: '2026-03-20', project_id: '1' },
  { id: '2', title: 'User auth flow', status: 'in_progress', priority: 'urgent', assignee: 'Marcus Johnson', due_date: '2026-03-25', project_id: '1' },
  { id: '3', title: 'Dashboard wireframes', status: 'review', priority: 'high', assignee: 'Aiko Tanaka', due_date: '2026-03-22', project_id: '1' },
  { id: '4', title: 'API pagination', status: 'todo', priority: 'medium', assignee: 'James Wilson', due_date: '2026-03-28', project_id: '1' },
  { id: '5', title: 'Unit test coverage', status: 'in_progress', priority: 'medium', assignee: 'Priya Patel', due_date: '2026-03-30', project_id: '1' },
  { id: '6', title: 'Mobile responsive layout', status: 'backlog', priority: 'low', assignee: 'Emma Davis', due_date: '2026-04-05', project_id: '1' },
  { id: '7', title: 'Database migration scripts', status: 'done', priority: 'high', assignee: 'Marcus Johnson', due_date: '2026-03-18', project_id: '1' },
  { id: '8', title: 'Error boundary setup', status: 'done', priority: 'medium', assignee: 'Sarah Chen', due_date: '2026-03-15', project_id: '1' },
  { id: '9', title: 'CI/CD pipeline', status: 'review', priority: 'high', assignee: 'James Wilson', due_date: '2026-03-24', project_id: '1' },
  { id: '10', title: 'SSO integration', status: 'todo', priority: 'urgent', assignee: 'Priya Patel', due_date: '2026-03-27', project_id: '1' },
  { id: '11', title: 'Performance profiling', status: 'backlog', priority: 'medium', assignee: 'Aiko Tanaka', due_date: '2026-04-10', project_id: '1' },
  { id: '12', title: 'Accessibility audit', status: 'todo', priority: 'low', assignee: 'Emma Davis', due_date: '2026-04-02', project_id: '1' },
  { id: '13', title: 'Email notification service', status: 'in_progress', priority: 'medium', assignee: 'Marcus Johnson', due_date: '2026-03-29', project_id: '1' },
  { id: '14', title: 'File upload component', status: 'backlog', priority: 'low', assignee: 'Sarah Chen', due_date: '2026-04-08', project_id: '1' },
  { id: '15', title: 'Rate limiting middleware', status: 'done', priority: 'urgent', assignee: 'James Wilson', due_date: '2026-03-19', project_id: '1' },
  { id: '16', title: 'Search indexing', status: 'todo', priority: 'high', assignee: 'Priya Patel', due_date: '2026-04-01', project_id: '1' },
];

const DEMO_COMMENTS = [
  { id: '1', task_id: '2', content: 'JWT refresh token logic added', author: 'Marcus Johnson', created_at: '2026-03-27T09:15:00Z' },
  { id: '2', task_id: '3', content: 'Wireframes uploaded to Figma', author: 'Aiko Tanaka', created_at: '2026-03-27T08:30:00Z' },
  { id: '3', task_id: '9', content: 'Deploy preview passing all checks', author: 'James Wilson', created_at: '2026-03-26T17:45:00Z' },
  { id: '4', task_id: '5', content: 'Coverage at 72%, targeting 85%', author: 'Priya Patel', created_at: '2026-03-26T16:20:00Z' },
  { id: '5', task_id: '10', content: 'Okta SDK integration started', author: 'Priya Patel', created_at: '2026-03-26T14:00:00Z' },
];

const PRIORITY_COLORS = { urgent: '#ef4444', high: '#f59e0b', medium: '#3b82f6', low: '#6b7280' };
const STATUS_COLORS = { backlog: '#6b7280', todo: '#8b5cf6', in_progress: '#3b82f6', review: '#f59e0b', done: '#22c55e' };

export default function ProjectDashboard({ className }) {
  const { data: tasks } = useModel('tasks', { limit: 50, orderBy: { due_date: 'asc' } });
  const { data: comments } = useModel('comments', { limit: 10, orderBy: { created_at: 'desc' } });

  const taskList = (tasks?.length ? tasks : DEMO_TASKS) as any[];
  const commentList = (comments?.length ? comments : DEMO_COMMENTS) as any[];

  const totalTasks = taskList.length;
  const completed = taskList.filter(t => t.status === 'done').length;
  const inProgress = taskList.filter(t => t.status === 'in_progress').length;
  const overdue = taskList.filter(t => {
    const due = new Date(t.due_date);
    return due < new Date() && t.status !== 'done';
  }).length;

  const statusData = [
    { name: 'Backlog', value: taskList.filter(t => t.status === 'backlog').length, fill: STATUS_COLORS.backlog },
    { name: 'To Do', value: taskList.filter(t => t.status === 'todo').length, fill: STATUS_COLORS.todo },
    { name: 'In Progress', value: taskList.filter(t => t.status === 'in_progress').length, fill: STATUS_COLORS.in_progress },
    { name: 'Review', value: taskList.filter(t => t.status === 'review').length, fill: STATUS_COLORS.review },
    { name: 'Done', value: taskList.filter(t => t.status === 'done').length, fill: STATUS_COLORS.done },
  ];

  const priorityData = [
    { name: 'Urgent', count: taskList.filter(t => t.priority === 'urgent').length },
    { name: 'High', count: taskList.filter(t => t.priority === 'high').length },
    { name: 'Medium', count: taskList.filter(t => t.priority === 'medium').length },
    { name: 'Low', count: taskList.filter(t => t.priority === 'low').length },
  ];

  const kpis = [
    { label: 'Total Tasks', value: totalTasks, icon: 'ClipboardList', color: 'text-primary', bg: 'bg-primary/10' },
    { label: 'Completed', value: completed, icon: 'CheckCircle2', color: 'text-green-600', bg: 'bg-green-100 dark:bg-green-900/30' },
    { label: 'In Progress', value: inProgress, icon: 'Timer', color: 'text-blue-600', bg: 'bg-blue-100 dark:bg-blue-900/30' },
    { label: 'Overdue', value: overdue, icon: 'AlertTriangle', color: 'text-red-600', bg: 'bg-red-100 dark:bg-red-900/30' },
  ];

  return (
    <div className={cn('p-6 lg:p-8 space-y-8', className)}>
      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {kpis.map((kpi) => {
          const Icon = Icons[kpi.icon] as React.ComponentType<{ className?: string }>;
          return (
            <Card key={kpi.label} className="hover:shadow-md transition-shadow">
              <CardContent className="p-5">
                <div className="flex items-center justify-between mb-3">
                  <div className={cn('p-2 rounded-lg', kpi.bg)}>
                    {Icon && <Icon className={cn('h-5 w-5', kpi.color)} />}
                  </div>
                  <span className="text-2xl font-bold text-foreground">{kpi.value}</span>
                </div>
                <p className="text-sm text-muted-foreground font-medium">{kpi.label}</p>
                <div className="mt-2 h-1 bg-secondary rounded-full overflow-hidden">
                  <div
                    className={cn('h-full rounded-full', kpi.label === 'Overdue' ? 'bg-destructive' : 'bg-primary')}
                    style={{ width: `${totalTasks > 0 ? (kpi.value / totalTasks) * 100 : 0}%` }}
                  />
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Task Distribution Pie */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold">Task Distribution</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              <Charts.ResponsiveContainer width="100%" height="100%">
                <Charts.PieChart>
                  <Charts.Pie
                    data={statusData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={90}
                    paddingAngle={3}
                    dataKey="value"
                  >
                    {statusData.map((entry, idx) => (
                      <Charts.Cell key={idx} fill={entry.fill} />
                    ))}
                  </Charts.Pie>
                  <Charts.Tooltip
                    contentStyle={{ backgroundColor: 'var(--color-card)', border: '1px solid var(--color-border)', borderRadius: '8px', fontSize: '12px' }}
                  />
                  <Charts.Legend
                    verticalAlign="bottom"
                    height={36}
                    formatter={(value) => <span className="text-xs text-muted-foreground">{value}</span>}
                  />
                </Charts.PieChart>
              </Charts.ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Priority Bar Chart */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold">Tasks by Priority</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              <Charts.ResponsiveContainer width="100%" height="100%">
                <Charts.BarChart data={priorityData} margin={{ top: 5, right: 20, left: -10, bottom: 5 }}>
                  <Charts.CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                  <Charts.XAxis dataKey="name" tick={{ fontSize: 12 }} />
                  <Charts.YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
                  <Charts.Tooltip
                    contentStyle={{ backgroundColor: 'var(--color-card)', border: '1px solid var(--color-border)', borderRadius: '8px', fontSize: '12px' }}
                  />
                  <Charts.Bar dataKey="count" radius={[4, 4, 0, 0]}>
                    {priorityData.map((entry, idx) => (
                      <Charts.Cell key={idx} fill={Object.values(PRIORITY_COLORS)[idx]} />
                    ))}
                  </Charts.Bar>
                </Charts.BarChart>
              </Charts.ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Recent Activity */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base font-semibold">Recent Activity</CardTitle>
            <a className="text-xs font-medium text-primary hover:underline cursor-pointer" onClick={() => navigate('/tasks')}>View all tasks</a>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {commentList.slice(0, 5).map((c: any) => {
              const task = taskList.find(t => t.id === c.task_id);
              const timeAgo = (() => {
                const diff = Date.now() - new Date(c.created_at).getTime();
                const hours = Math.floor(diff / 3600000);
                return hours < 1 ? 'Just now' : hours < 24 ? `${hours}h ago` : `${Math.floor(hours / 24)}d ago`;
              })();
              return (
                <div key={c.id} className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                    <span className="text-xs font-semibold text-primary">{c.author.split(' ').map((n: string) => n[0]).join('')}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-foreground">
                      <span className="font-medium">{c.author}</span>{' '}
                      <span className="text-muted-foreground">commented on</span>{' '}
                      <span className="font-medium">{task?.title || 'a task'}</span>
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">{c.content}</p>
                  </div>
                  <span className="text-[10px] text-muted-foreground whitespace-nowrap">{timeAgo}</span>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
