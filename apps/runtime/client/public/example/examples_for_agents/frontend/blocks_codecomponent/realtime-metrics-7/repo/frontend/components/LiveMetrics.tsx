import {
  React,
  Charts,
  Progress,
  Badge,
  Skeleton,
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  Icons,
  _,
  useAppState,
  cn,
} from "@exepad/sdk";

interface CpuDataPoint {
  time: string;
  usage: number;
}

interface SystemMetrics {
  cpu: number;
  memory: number;
  disk: number;
  network: number;
  requestsPerSec: number;
  activeConnections: number;
  errorRate: number;
  uptime: number;
}

function generateMetrics(): SystemMetrics {
  return {
    cpu: Math.round(35 + Math.random() * 50),
    memory: Math.round(55 + Math.random() * 30),
    disk: Math.round(40 + Math.random() * 20),
    network: Math.round(10 + Math.random() * 70),
    requestsPerSec: Math.round(800 + Math.random() * 1200),
    activeConnections: Math.round(150 + Math.random() * 350),
    errorRate: parseFloat((0.1 + Math.random() * 2.5).toFixed(2)),
    uptime: 99.97,
  };
}

function getStatusColor(value: number, thresholds: [number, number]): "default" | "secondary" | "destructive" {
  if (value >= thresholds[1]) return "destructive";
  if (value >= thresholds[0]) return "secondary";
  return "default";
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function LiveMetrics() {
  const [isLoading, setIsLoading] = React.useState(true);
  const [cpuHistory, setCpuHistory] = useAppState<CpuDataPoint[]>("cpuHistory", []);
  const [metrics, setMetrics] = useAppState<SystemMetrics>("systemMetrics", generateMetrics());

  const avgCpu = React.useMemo(
    () => {
      const history = cpuHistory || [];
      if (history.length === 0) return 0;
      return Math.round(_.meanBy(history, (p: CpuDataPoint) => p.usage));
    },
    [cpuHistory]
  );

  React.useEffect(() => {
    const timer = setTimeout(() => setIsLoading(false), 1500);
    return () => clearTimeout(timer);
  }, []);

  React.useEffect(() => {
    if (isLoading) return;

    const throttledUpdate = _.throttle(() => {
      const now = new Date();
      const newMetrics = generateMetrics();
      setMetrics(newMetrics);

      setCpuHistory((prev: CpuDataPoint[] | null) => {
        const history = prev || [];
        const next = [...history, { time: formatTime(now), usage: newMetrics.cpu }];
        return next.slice(-60);
      });
    }, 900);

    const interval = setInterval(throttledUpdate, 1000);
    return () => {
      clearInterval(interval);
      throttledUpdate.cancel();
    };
  }, [isLoading]);

  const currentMetrics = metrics || generateMetrics();

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-bold">System Metrics</h2>
          <p className="text-muted-foreground">Initializing live monitoring...</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i}>
              <CardHeader className="pb-2">
                <Skeleton className="h-4 w-24" />
              </CardHeader>
              <CardContent className="space-y-3">
                <Skeleton className="h-8 w-16" />
                <Skeleton className="h-2 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
        <Card>
          <CardHeader>
            <Skeleton className="h-5 w-40" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-[300px] w-full" />
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">System Metrics</h2>
          <p className="text-muted-foreground">
            Live monitoring dashboard — auto-refreshes every second
          </p>
        </div>
        <Badge variant={currentMetrics.uptime >= 99.9 ? "default" : "destructive"}>
          <Icons.Activity className="mr-1 h-3 w-3" />
          Uptime {currentMetrics.uptime}%
        </Badge>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              CPU Usage
            </CardTitle>
            <Badge variant={getStatusColor(currentMetrics.cpu, [60, 85])}>
              {currentMetrics.cpu}%
            </Badge>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="text-2xl font-bold">{currentMetrics.cpu}%</div>
            <Progress value={currentMetrics.cpu} className="h-2" />
            <p className="text-xs text-muted-foreground">Avg: {avgCpu}%</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Memory
            </CardTitle>
            <Badge variant={getStatusColor(currentMetrics.memory, [70, 90])}>
              {currentMetrics.memory}%
            </Badge>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="text-2xl font-bold">{currentMetrics.memory}%</div>
            <Progress value={currentMetrics.memory} className="h-2" />
            <p className="text-xs text-muted-foreground">
              {((currentMetrics.memory / 100) * 32).toFixed(1)} / 32 GB
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Disk I/O
            </CardTitle>
            <Badge variant={getStatusColor(currentMetrics.disk, [60, 80])}>
              {currentMetrics.disk}%
            </Badge>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="text-2xl font-bold">{currentMetrics.disk}%</div>
            <Progress value={currentMetrics.disk} className="h-2" />
            <p className="text-xs text-muted-foreground">
              {((currentMetrics.disk / 100) * 500).toFixed(0)} MB/s
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Network
            </CardTitle>
            <Badge variant={getStatusColor(currentMetrics.network, [60, 85])}>
              {currentMetrics.network}%
            </Badge>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="text-2xl font-bold">{currentMetrics.network}%</div>
            <Progress value={currentMetrics.network} className="h-2" />
            <p className="text-xs text-muted-foreground">
              {((currentMetrics.network / 100) * 1000).toFixed(0)} Mbps
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Requests/sec
            </CardTitle>
            <Icons.Zap className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {currentMetrics.requestsPerSec.toLocaleString()}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Active Connections
            </CardTitle>
            <Icons.Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {currentMetrics.activeConnections.toLocaleString()}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Error Rate
            </CardTitle>
            <Icons.AlertTriangle
              className={cn(
                "h-4 w-4",
                currentMetrics.errorRate > 2 ? "text-destructive" : "text-muted-foreground"
              )}
            />
          </CardHeader>
          <CardContent>
            <div
              className={cn(
                "text-2xl font-bold",
                currentMetrics.errorRate > 2 ? "text-destructive" : ""
              )}
            >
              {currentMetrics.errorRate}%
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>CPU Usage Over Time</CardTitle>
          <CardDescription>
            Rolling 60-second window — {(cpuHistory || []).length} data points collected
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Charts.ResponsiveContainer width="100%" height={300}>
            <Charts.AreaChart data={cpuHistory || []} margin={{ top: 10, right: 30, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="cpuGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                </linearGradient>
              </defs>
              <Charts.CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <Charts.XAxis
                dataKey="time"
                className="text-xs"
                interval="preserveStartEnd"
                minTickGap={40}
              />
              <Charts.YAxis domain={[0, 100]} className="text-xs" tickFormatter={(v: number) => `${v}%`} />
              <Charts.Tooltip
                formatter={(value: number) => [`${value}%`, "CPU"]}
                labelFormatter={(label: string) => `Time: ${label}`}
              />
              <Charts.Area
                type="monotone"
                dataKey="usage"
                stroke="hsl(var(--primary))"
                fill="url(#cpuGradient)"
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />
            </Charts.AreaChart>
          </Charts.ResponsiveContainer>
        </CardContent>
      </Card>
    </div>
  );
}

export default LiveMetrics;
