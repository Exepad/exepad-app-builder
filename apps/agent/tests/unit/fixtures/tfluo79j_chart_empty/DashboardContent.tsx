import {
  React,
  LightDOMContainer,
  Charts,
  Icons,
  useHandler,
  useModel,
  Spinner,
  Alert,
  AlertDescription,
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Skeleton,
} from "@exepad/sdk";

function DashboardContent() {
  // Fetch high-level metrics
  const { data: metrics, loading: metricsLoading, error: metricsError } = useHandler("getDashboardMetrics");
  
  // Fetch occupancy trend for the middle row chart
  const { data: trend, loading: trendLoading } = useHandler("getOccupancyTrend", {
    params: { days: 30 }
  });

  // Fetch rooms with 'dirty' status for Urgent Housekeeping list
  const { data: dirtyRooms, loading: roomsLoading } = useModel("rooms", {
    filters: { status: "dirty" },
    limit: 5
  });

  // Fetch recent housekeeping activity for the activity feed
  const { data: recentTasks, loading: tasksLoading } = useModel("housekeeping_tasks", {
    orderBy: { updated_at: "desc" },
    limit: 5
  });

  if (metricsError) {
    return (
      <LightDOMContainer>
        <div className="p-10">
          <Alert variant="destructive">
            <Icons.AlertCircle className="h-4 w-4" />
            <AlertDescription>Failed to load dashboard data. Please try again later.</AlertDescription>
          </Alert>
        </div>
      </LightDOMContainer>
    );
  }

  return (
    <LightDOMContainer>
      <div className="flex flex-col p-6 lg:p-10 space-y-8 animate-in fade-in-0" style={{ animationDuration: 'var(--animation-duration)' }}>
        
        {/* Top Row: KPI Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <StatCard 
            title="Total Occupancy" 
            value={metrics?.occupancyRate ? `${(parseFloat(metrics.occupancyRate) * 100).toFixed(1)}%` : "--"} 
            icon={<Icons.Hotel className="w-5 h-5" />}
            loading={metricsLoading}
          />
          <StatCard 
            title="Today's Arrivals" 
            value={metrics?.arrivalsToday ?? "0"} 
            icon={<Icons.LogIn className="w-5 h-5" />}
            loading={metricsLoading}
          />
          <StatCard 
            title="Today's Departures" 
            value={metrics?.departuresToday ?? "0"} 
            icon={<Icons.LogOut className="w-5 h-5" />}
            loading={metricsLoading}
          />
          <StatCard 
            title="Pending Tasks" 
            value={metrics?.pendingTasksCount ?? "0"} 
            icon={<Icons.ClipboardList className="w-5 h-5" />}
            loading={metricsLoading}
          />
        </div>

        {/* Middle Row: Occupancy Trend Chart */}
        <Card className="bg-surface border-outline-variant/20 shadow-sm overflow-hidden">
          <CardHeader className="pb-2">
            <CardTitle className="font-headline text-xl text-primary flex items-center gap-2">
              <Icons.TrendingUp className="w-5 h-5 text-secondary" />
              Occupancy Rate Trend (30 Days)
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-4">
            <div className="h-80 w-full">
              {trendLoading ? (
                <div className="flex items-center justify-center h-full">
                  <Spinner className="w-8 h-8 text-primary" />
                </div>
              ) : (
                <Charts.ResponsiveContainer width="100%" height="100%">
                  <Charts.AreaChart data={trend?.trendData ?? []} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                    <defs>
                      <linearGradient id="occGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="var(--color-secondary)" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="var(--color-secondary)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <Charts.CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--color-outline-variant)" opacity={0.2} />
                    <Charts.XAxis 
                      dataKey="date" 
                      tick={{ fontSize: 10, fill: 'var(--color-on-surface-variant)', fontWeight: 700 }}
                      tickLine={false} 
                      axisLine={false}
                      tickFormatter={(str) => {
                        const d = new Date(str);
                        return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                      }}
                    />
                    <Charts.YAxis 
                      tick={{ fontSize: 10, fill: 'var(--color-on-surface-variant)' }} 
                      tickLine={false} 
                      axisLine={false}
                      tickFormatter={(val: number) => `${(val * 100).toFixed(0)}%`}
                    />
                    <Charts.Tooltip 
                      contentStyle={{ 
                        backgroundColor: 'var(--color-surface)', 
                        border: '1px solid var(--color-outline-variant)', 
                        borderRadius: '8px', 
                        fontSize: '12px', 
                        fontWeight: 600 
                      }}
                      formatter={(val: number) => [`${(val * 100).toFixed(1)}%`, 'Occupancy']}
                    />
                    <Charts.Area 
                      type="monotone" 
                      dataKey="rate" 
                      stroke="var(--color-secondary)" 
                      strokeWidth={3} 
                      fill="url(#occGradient)"
                      activeDot={{ r: 6, fill: 'var(--color-secondary)', stroke: 'var(--color-surface)', strokeWidth: 2 }}
                    />
                  </Charts.AreaChart>
                </Charts.ResponsiveContainer>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Bottom Row: Housekeeping & Activity */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Urgent Housekeeping */}
          <Card className="bg-surface border-outline-variant/20 shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="font-headline text-lg text-primary flex items-center gap-2">
                <Icons.Sparkles className="w-5 h-5 text-tertiary" />
                Urgent Housekeeping
              </CardTitle>
              <Badge className="bg-error/30 text-error border-none font-bold text-[10px] uppercase tracking-wider">
                Priority: Dirty
              </Badge>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {roomsLoading ? (
                  Array(3).fill(0).map((_, i) => <Skeleton key={i} className="h-14 w-full rounded-xl" />)
                ) : (dirtyRooms ?? []).length > 0 ? (
                  (dirtyRooms ?? []).map((room) => (
                    <div key={room.id} className="flex items-center justify-between p-4 rounded-xl bg-surface-container-low border border-outline-variant/10 hover:border-outline-variant/30 transition-colors">
                      <div className="flex items-center gap-4">
                        <div className="w-10 h-10 rounded-lg bg-primary/30 flex items-center justify-center font-mono font-bold text-primary">
                          {room.room_number}
                        </div>
                        <div>
                          <p className="text-sm font-bold text-on-surface uppercase tracking-tight">{room.type}</p>
                          <p className="text-[11px] text-on-surface-variant font-medium">Last occupied 2h ago</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="w-2 h-2 rounded-full bg-error animate-pulse" />
                        <span className="text-[10px] font-bold text-error uppercase tracking-widest">Needs Service</span>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="py-8 text-center">
                    <Icons.CheckCircle2 className="w-12 h-12 text-secondary mx-auto mb-3" />
                    <p className="text-on-surface-variant text-sm font-medium">All rooms are currently serviced</p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Recent Activity */}
          <Card className="bg-surface border-outline-variant/20 shadow-sm">
            <CardHeader>
              <CardTitle className="font-headline text-lg text-primary flex items-center gap-2">
                <Icons.Activity className="w-5 h-5 text-primary" />
                Recent Activity
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="relative space-y-6 before:absolute before:left-[11px] before:top-2 before:bottom-2 before:w-[2px] before:bg-outline-variant/30">
                {tasksLoading ? (
                  Array(3).fill(0).map((_, i) => <Skeleton key={i} className="h-16 w-full rounded-xl" />)
                ) : (recentTasks ?? []).length > 0 ? (
                  (recentTasks ?? []).map((task) => (
                    <div key={task.id} className="relative pl-8">
                      <div className={`absolute left-0 top-1 w-6 h-6 rounded-full flex items-center justify-center border-2 border-surface ${
                        task.status === 'completed' ? 'bg-secondary text-on-secondary' : 'bg-surface-container text-on-surface-variant'
                      }`}>
                        {task.status === 'completed' ? <Icons.Check className="w-3 h-3" /> : <Icons.Clock className="w-3 h-3" />}
                      </div>
                      <div>
                        <div className="flex items-center justify-between">
                          <p className="text-sm font-bold text-on-surface">{task.task_description}</p>
                          <span className="text-[10px] font-medium text-on-surface-variant">
                            {new Date(task.updated_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                        <p className="text-xs text-on-surface-variant mt-1">
                          Room {task.room_id} &bull; Status: <span className="capitalize">{task.status.replace('_', ' ')}</span>
                        </p>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="py-8 text-center">
                    <p className="text-on-surface-variant text-sm italic">No recent activity to display</p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </LightDOMContainer>
  );
}

function StatCard({ title, value, icon, loading }: { title: string, value: string | number, icon: React.ReactNode, loading?: boolean }) {
  return (
    <div className="bg-surface p-6 rounded-2xl shadow-sm border border-outline-variant/10 relative overflow-hidden group hover:shadow-md transition-all">
      <div className="flex justify-between items-start mb-4">
        <div className="p-2.5 bg-primary-container/30 rounded-xl text-primary">
          {icon}
        </div>
        <span className="text-[10px] font-black text-secondary uppercase tracking-[0.2em]">Live Status</span>
      </div>
      <h2 className="font-bold text-on-surface-variant text-xs mb-1 uppercase tracking-wider">{title}</h2>
      {loading ? (
        <Skeleton className="h-9 w-24 mt-2" />
      ) : (
        <div className="flex items-baseline gap-2">
          <span className="text-3xl font-bold text-on-surface font-mono tracking-tighter">{value}</span>
        </div>
      )}
      <div className="absolute -right-4 -top-4 w-24 h-24 bg-primary/30 rounded-full blur-2xl group-hover:bg-primary/30 transition-colors" />
    </div>
  );
}

export default DashboardContent;