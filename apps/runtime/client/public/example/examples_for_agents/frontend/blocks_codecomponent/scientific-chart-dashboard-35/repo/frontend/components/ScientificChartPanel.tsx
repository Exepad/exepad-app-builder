import {
  React,
  useHandler,
  useAppState,
  useTheme,
  toast,
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  Button,
  Badge,
  Icons,
  cn,
} from "@exepad/sdk";
import * as PlotlyModule from "@exepad/ext-plotly";
// esm.sh exports the main API as the default export

interface DataPoint {
  id: number;
  temperature: number;
  pressure: number;
  humidity: number;
  windSpeed: number;
}

function generateDemoData(): DataPoint[] {
  const data: DataPoint[] = [];
  for (let i = 0; i < 50; i++) {
    data.push({
      id: i + 1,
      temperature: 15 + Math.sin(i * 0.3) * 10 + Math.random() * 5,
      pressure: 1013 + Math.cos(i * 0.2) * 15 + Math.random() * 8,
      humidity: 40 + Math.sin(i * 0.15) * 25 + Math.random() * 10,
      windSpeed: 5 + Math.abs(Math.sin(i * 0.25)) * 20 + Math.random() * 3,
    });
  }
  return data;
}

const VARIABLES = ["temperature", "pressure", "humidity", "windSpeed"] as const;
type Variable = (typeof VARIABLES)[number];

const VARIABLE_LABELS: Record<Variable, string> = {
  temperature: "Temperature (\u00b0C)",
  pressure: "Pressure (hPa)",
  humidity: "Humidity (%)",
  windSpeed: "Wind Speed (m/s)",
};

function computeCorrelation(a: number[], b: number[]): number {
  const n = a.length;
  const meanA = a.reduce((s, v) => s + v, 0) / n;
  const meanB = b.reduce((s, v) => s + v, 0) / n;
  let num = 0;
  let denA = 0;
  let denB = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i] - meanA;
    const db = b[i] - meanB;
    num += da * db;
    denA += da * da;
    denB += db * db;
  }
  const den = Math.sqrt(denA * denB);
  return den === 0 ? 0 : num / den;
}

function ScientificChartPanel() {
  const theme = useTheme();
  // In a real app: const { data, loading } = useHandler("loadDataset", { autoRun: true });
  const [chartTab, setChartTab] = useAppState<string>("chartTab", "scatter");
  const [xAxis, setXAxis] = useAppState<Variable>("xAxis", "temperature");
  const [yAxis, setYAxis] = useAppState<Variable>("yAxis", "pressure");

  const data = React.useMemo(() => generateDemoData(), []);

  const scatterRef = React.useRef<HTMLDivElement>(null);
  const heatmapRef = React.useRef<HTMLDivElement>(null);
  const surfaceRef = React.useRef<HTMLDivElement>(null);

  const isDark = theme.resolvedTheme === "dark";

  const plotlyLayout = React.useMemo(
    () => ({
      paper_bgcolor: "transparent",
      plot_bgcolor: "transparent",
      font: { color: isDark ? "#e2e8f0" : "#1e293b", size: 12 },
      margin: { t: 40, r: 20, b: 50, l: 60 },
      xaxis: {
        gridcolor: isDark ? "#334155" : "#e2e8f0",
        zerolinecolor: isDark ? "#475569" : "#cbd5e1",
      },
      yaxis: {
        gridcolor: isDark ? "#334155" : "#e2e8f0",
        zerolinecolor: isDark ? "#475569" : "#cbd5e1",
      },
    }),
    [isDark]
  );

  const activeX = xAxis ?? "temperature";
  const activeY = yAxis ?? "pressure";
  const activeTab = chartTab ?? "scatter";

  // Scatter plot
  React.useEffect(() => {
    if (!scatterRef.current || activeTab !== "scatter") return;
    const xVals = data.map((d) => d[activeX]);
    const yVals = data.map((d) => d[activeY]);
    const trace = {
      x: xVals,
      y: yVals,
      mode: "markers" as const,
      type: "scatter" as const,
      marker: {
        color: isDark ? "#818cf8" : "#6366f1",
        size: 8,
        opacity: 0.7,
        line: { width: 1, color: isDark ? "#c7d2fe" : "#4338ca" },
      },
      text: data.map((d) => `ID: ${d.id}`),
      hovertemplate: `${VARIABLE_LABELS[activeX]}: %{x:.1f}<br>${VARIABLE_LABELS[activeY]}: %{y:.1f}<extra></extra>`,
    };
    const layout = {
      ...plotlyLayout,
      title: { text: `${VARIABLE_LABELS[activeX]} vs ${VARIABLE_LABELS[activeY]}`, font: { size: 14 } },
      xaxis: { ...plotlyLayout.xaxis, title: VARIABLE_LABELS[activeX] },
      yaxis: { ...plotlyLayout.yaxis, title: VARIABLE_LABELS[activeY] },
      dragmode: "lasso" as const,
      height: 420,
    };
    Plotly.newPlot(scatterRef.current, [trace], layout, { responsive: true, displayModeBar: true });
  }, [data, activeX, activeY, isDark, activeTab, plotlyLayout]);

  // Heatmap
  React.useEffect(() => {
    if (!heatmapRef.current || activeTab !== "heatmap") return;
    const matrix: number[][] = [];
    for (const v1 of VARIABLES) {
      const row: number[] = [];
      for (const v2 of VARIABLES) {
        const a = data.map((d) => d[v1]);
        const b = data.map((d) => d[v2]);
        row.push(Math.round(computeCorrelation(a, b) * 100) / 100);
      }
      matrix.push(row);
    }
    const labels = VARIABLES.map((v) => VARIABLE_LABELS[v]);
    const trace = {
      z: matrix,
      x: labels,
      y: labels,
      type: "heatmap" as const,
      colorscale: isDark
        ? [
            [0, "#312e81"],
            [0.5, "#1e293b"],
            [1, "#10b981"],
          ]
        : [
            [0, "#dbeafe"],
            [0.5, "#f8fafc"],
            [1, "#059669"],
          ],
      hovertemplate: "%{y} vs %{x}: %{z:.2f}<extra></extra>",
      showscale: true,
    };
    const layout = {
      ...plotlyLayout,
      title: { text: "Correlation Matrix", font: { size: 14 } },
      height: 420,
    };
    Plotly.newPlot(heatmapRef.current, [trace], layout, { responsive: true });
  }, [data, isDark, activeTab, plotlyLayout]);

  // 3D Surface
  React.useEffect(() => {
    if (!surfaceRef.current || activeTab !== "surface") return;
    const gridSize = 20;
    const xRange = data.map((d) => d[activeX]);
    const yRange = data.map((d) => d[activeY]);
    const xMin = Math.min(...xRange);
    const xMax = Math.max(...xRange);
    const yMin = Math.min(...yRange);
    const yMax = Math.max(...yRange);
    const zData: number[][] = [];
    for (let i = 0; i < gridSize; i++) {
      const row: number[] = [];
      for (let j = 0; j < gridSize; j++) {
        const xVal = xMin + (xMax - xMin) * (j / (gridSize - 1));
        const yVal = yMin + (yMax - yMin) * (i / (gridSize - 1));
        row.push(Math.sin(xVal * 0.3) * Math.cos(yVal * 0.2) * 10 + 20);
      }
      zData.push(row);
    }
    const trace = {
      z: zData,
      type: "surface" as const,
      colorscale: "Viridis",
      showscale: false,
    };
    const layout = {
      ...plotlyLayout,
      title: { text: "3D Surface Plot", font: { size: 14 } },
      height: 420,
      scene: {
        xaxis: { title: VARIABLE_LABELS[activeX], gridcolor: isDark ? "#334155" : "#e2e8f0" },
        yaxis: { title: VARIABLE_LABELS[activeY], gridcolor: isDark ? "#334155" : "#e2e8f0" },
        zaxis: { title: "Z Value", gridcolor: isDark ? "#334155" : "#e2e8f0" },
        bgcolor: "transparent",
      },
    };
    Plotly.newPlot(surfaceRef.current, [trace], layout, { responsive: true });
  }, [data, activeX, activeY, isDark, activeTab, plotlyLayout]);

  const handleExport = () => {
    toast("Dataset exported as CSV (50 data points).");
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Icons.BarChart3 className="h-5 w-5" />
                Scientific Chart Dashboard
              </CardTitle>
              <CardDescription>Interactive data exploration with Plotly charts</CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="secondary">{data.length} points</Badge>
              <Badge variant="outline">{VARIABLES.length} variables</Badge>
              <Button variant="outline" size="sm" onClick={handleExport}>
                <Icons.Download className="mr-2 h-3 w-3" />
                Export
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-3 mb-4">
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">X Axis:</span>
              <Select value={activeX} onValueChange={(v: string) => setXAxis(v as Variable)}>
                <SelectTrigger className="w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {VARIABLES.map((v) => (
                    <SelectItem key={v} value={v}>
                      {VARIABLE_LABELS[v]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Y Axis:</span>
              <Select value={activeY} onValueChange={(v: string) => setYAxis(v as Variable)}>
                <SelectTrigger className="w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {VARIABLES.map((v) => (
                    <SelectItem key={v} value={v}>
                      {VARIABLE_LABELS[v]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <Tabs value={activeTab} onValueChange={(v: string) => setChartTab(v)}>
            <TabsList>
              <TabsTrigger value="scatter">
                <Icons.ScatterChart className="mr-1 h-4 w-4" />
                Scatter
              </TabsTrigger>
              <TabsTrigger value="heatmap">
                <Icons.Grid3X3 className="mr-1 h-4 w-4" />
                Heatmap
              </TabsTrigger>
              <TabsTrigger value="surface">
                <Icons.Box className="mr-1 h-4 w-4" />
                3D Surface
              </TabsTrigger>
            </TabsList>
            <TabsContent value="scatter">
              <div ref={scatterRef} className="w-full rounded-lg border bg-muted/20" />
            </TabsContent>
            <TabsContent value="heatmap">
              <div ref={heatmapRef} className="w-full rounded-lg border bg-muted/20" />
            </TabsContent>
            <TabsContent value="surface">
              <div ref={surfaceRef} className="w-full rounded-lg border bg-muted/20" />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}

export default ScientificChartPanel;
