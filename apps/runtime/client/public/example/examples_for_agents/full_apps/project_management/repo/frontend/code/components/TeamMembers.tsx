import { React, cn, useModel, Card, CardHeader, CardTitle, CardContent, Badge, Button, Input, Icons, Avatar, AvatarFallback, Separator } from '@exepad/sdk';

const DEMO_MEMBERS = [
  { id: '1', name: 'Sarah Chen', email: 'sarah.chen@taskforge.io', role: 'developer', department: 'Engineering', avatar_url: null },
  { id: '2', name: 'Marcus Johnson', email: 'marcus.j@taskforge.io', role: 'developer', department: 'Engineering', avatar_url: null },
  { id: '3', name: 'Aiko Tanaka', email: 'aiko.t@taskforge.io', role: 'designer', department: 'Design', avatar_url: null },
  { id: '4', name: 'James Wilson', email: 'james.w@taskforge.io', role: 'developer', department: 'Engineering', avatar_url: null },
  { id: '5', name: 'Priya Patel', email: 'priya.p@taskforge.io', role: 'qa', department: 'Quality', avatar_url: null },
  { id: '6', name: 'Emma Davis', email: 'emma.d@taskforge.io', role: 'pm', department: 'Management', avatar_url: null },
];

const DEMO_TASKS = [
  { id: '1', assignee: 'Sarah Chen', status: 'done' },
  { id: '2', assignee: 'Marcus Johnson', status: 'in_progress' },
  { id: '3', assignee: 'Aiko Tanaka', status: 'review' },
  { id: '4', assignee: 'James Wilson', status: 'todo' },
  { id: '5', assignee: 'Priya Patel', status: 'in_progress' },
  { id: '6', assignee: 'Emma Davis', status: 'backlog' },
  { id: '7', assignee: 'Marcus Johnson', status: 'done' },
  { id: '8', assignee: 'Sarah Chen', status: 'done' },
  { id: '9', assignee: 'James Wilson', status: 'review' },
  { id: '10', assignee: 'Priya Patel', status: 'todo' },
  { id: '11', assignee: 'Aiko Tanaka', status: 'backlog' },
  { id: '12', assignee: 'Emma Davis', status: 'todo' },
  { id: '13', assignee: 'Marcus Johnson', status: 'in_progress' },
  { id: '14', assignee: 'Sarah Chen', status: 'backlog' },
  { id: '15', assignee: 'James Wilson', status: 'done' },
  { id: '16', assignee: 'Priya Patel', status: 'todo' },
];

const ROLE_STYLES = {
  developer: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300',
  designer: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-300',
  pm: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300',
  qa: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-300',
};

const ROLE_LABELS = { developer: 'Developer', designer: 'Designer', pm: 'Project Manager', qa: 'QA Engineer' };

const AVATAR_COLORS = ['bg-indigo-500', 'bg-emerald-500', 'bg-rose-500', 'bg-amber-500', 'bg-cyan-500', 'bg-violet-500'];

function getInitials(name: string): string {
  return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
}

export default function TeamMembers({ className }) {
  const { data: members } = useModel('team_members', { limit: 20, orderBy: { name: 'asc' } });
  const { data: tasks } = useModel('tasks', { limit: 50 });
  const [searchQuery, setSearchQuery] = React.useState('');
  const [roleFilter, setRoleFilter] = React.useState('all');

  const memberList = (members?.length ? members : DEMO_MEMBERS) as any[];
  const taskList = (tasks?.length ? tasks : DEMO_TASKS) as any[];

  const filtered = memberList
    .filter(m => roleFilter === 'all' || m.role === roleFilter)
    .filter(m => !searchQuery || m.name.toLowerCase().includes(searchQuery.toLowerCase()) || m.email.toLowerCase().includes(searchQuery.toLowerCase()));

  const getTaskCounts = (name: string) => {
    const memberTasks = taskList.filter(t => t.assignee === name);
    return {
      total: memberTasks.length,
      active: memberTasks.filter(t => t.status === 'in_progress' || t.status === 'review').length,
      completed: memberTasks.filter(t => t.status === 'done').length,
    };
  };

  return (
    <div className={cn('p-6 lg:p-8 space-y-6', className)}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-foreground">Team Members</h2>
          <p className="text-sm text-muted-foreground">{memberList.length} members across {new Set(memberList.map((m: any) => m.department)).size} departments</p>
        </div>
        <Button size="sm">
          <Icons.UserPlus className="h-4 w-4 mr-1" />
          Invite Member
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Icons.Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input className="pl-9 h-9" placeholder="Search members..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
        </div>
        <div className="flex gap-1.5">
          {['all', 'developer', 'designer', 'pm', 'qa'].map((role) => (
            <Button
              key={role}
              variant={roleFilter === role ? 'default' : 'outline'}
              size="sm"
              className="text-xs h-8"
              onClick={() => setRoleFilter(role)}
            >
              {role === 'all' ? 'All Roles' : ROLE_LABELS[role] || role}
            </Button>
          ))}
        </div>
      </div>

      {/* Member Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {filtered.map((member: any, idx: number) => {
          const counts = getTaskCounts(member.name);
          const colorClass = AVATAR_COLORS[idx % AVATAR_COLORS.length];
          return (
            <Card key={member.id} className="hover:shadow-md transition-shadow">
              <CardContent className="p-5">
                <div className="flex items-start gap-4">
                  {/* Avatar */}
                  <Avatar className="h-12 w-12">
                    <AvatarFallback className={cn('text-sm font-bold text-white', colorClass)}>
                      {getInitials(member.name)}
                    </AvatarFallback>
                  </Avatar>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <h3 className="text-sm font-semibold text-foreground truncate">{member.name}</h3>
                    <Badge className={cn('text-[10px] mt-1', ROLE_STYLES[member.role] || '')}>
                      {ROLE_LABELS[member.role] || member.role}
                    </Badge>
                  </div>
                </div>

                <Separator className="my-4" />

                {/* Details */}
                <div className="space-y-2.5">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Icons.Mail className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">{member.email}</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Icons.Building2 className="h-3.5 w-3.5 shrink-0" />
                    <span>{member.department}</span>
                  </div>
                </div>

                <Separator className="my-4" />

                {/* Task Stats */}
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div>
                    <p className="text-lg font-bold text-foreground">{counts.total}</p>
                    <p className="text-[10px] text-muted-foreground font-medium">Total</p>
                  </div>
                  <div>
                    <p className="text-lg font-bold text-blue-600">{counts.active}</p>
                    <p className="text-[10px] text-muted-foreground font-medium">Active</p>
                  </div>
                  <div>
                    <p className="text-lg font-bold text-green-600">{counts.completed}</p>
                    <p className="text-[10px] text-muted-foreground font-medium">Done</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {filtered.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center">
            <Icons.Users className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">No team members match your filters</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
