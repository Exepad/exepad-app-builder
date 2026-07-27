import {
  React,
  useModel,
  useTheme,
  useAppState,
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  Badge,
  Button,
  Icons,
  cn,
} from "@exepad/sdk";
import * as D3Module from "@exepad/ext-d3";

interface GraphNode {
  id: string;
  label: string;
  group: number;
  role: string;
  x?: number;
  y?: number;
  fx?: number | null;
  fy?: number | null;
}

interface GraphLink {
  source: string | GraphNode;
  target: string | GraphNode;
  strength: number;
}

interface GraphData {
  nodes: GraphNode[];
  links: GraphLink[];
}

const DEMO_NODES: GraphNode[] = [
  { id: "n1", label: "Alice", group: 1, role: "Manager" },
  { id: "n2", label: "Bob", group: 1, role: "Engineer" },
  { id: "n3", label: "Carol", group: 1, role: "Designer" },
  { id: "n4", label: "Dan", group: 2, role: "Manager" },
  { id: "n5", label: "Eve", group: 2, role: "Engineer" },
  { id: "n6", label: "Frank", group: 2, role: "Engineer" },
  { id: "n7", label: "Grace", group: 2, role: "Analyst" },
  { id: "n8", label: "Hank", group: 3, role: "Manager" },
  { id: "n9", label: "Ivy", group: 3, role: "Designer" },
  { id: "n10", label: "Jack", group: 3, role: "Engineer" },
  { id: "n11", label: "Kim", group: 1, role: "Analyst" },
  { id: "n12", label: "Leo", group: 2, role: "Designer" },
  { id: "n13", label: "Mia", group: 3, role: "Engineer" },
  { id: "n14", label: "Nate", group: 1, role: "Engineer" },
  { id: "n15", label: "Olive", group: 3, role: "Analyst" },
];

const DEMO_LINKS: GraphLink[] = [
  { source: "n1", target: "n2", strength: 0.9 },
  { source: "n1", target: "n3", strength: 0.7 },
  { source: "n1", target: "n11", strength: 0.8 },
  { source: "n1", target: "n14", strength: 0.6 },
  { source: "n2", target: "n3", strength: 0.5 },
  { source: "n2", target: "n5", strength: 0.4 },
  { source: "n4", target: "n5", strength: 0.9 },
  { source: "n4", target: "n6", strength: 0.8 },
  { source: "n4", target: "n7", strength: 0.7 },
  { source: "n4", target: "n12", strength: 0.6 },
  { source: "n5", target: "n6", strength: 0.6 },
  { source: "n5", target: "n10", strength: 0.3 },
  { source: "n6", target: "n7", strength: 0.5 },
  { source: "n8", target: "n9", strength: 0.9 },
  { source: "n8", target: "n10", strength: 0.8 },
  { source: "n8", target: "n13", strength: 0.7 },
  { source: "n8", target: "n15", strength: 0.6 },
  { source: "n9", target: "n12", strength: 0.4 },
  { source: "n10", target: "n13", strength: 0.5 },
  { source: "n11", target: "n14", strength: 0.6 },
];

const GROUP_NAMES: Record<number, string> = {
  1: "Engineering",
  2: "Product",
  3: "Operations",
};

function ForceGraphExplorer() {
  const theme = useTheme();
  // In a real app: const { data: graphData } = useModel("graph");
  const [selectedNode, setSelectedNode] = useAppState<string | null>("selectedNode", null);
  const svgRef = React.useRef<SVGSVGElement>(null);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const simulationRef = React.useRef<any>(null);

  const isDark = theme.resolvedTheme === "dark";
  const groupColors = React.useMemo(() => {
    return D3.scaleOrdinal<number, string>()
      .domain([1, 2, 3])
      .range([
        isDark ? "#818cf8" : "#6366f1",
        isDark ? "#34d399" : "#10b981",
        isDark ? "#fb923c" : "#f97316",
      ]);
  }, [isDark]);

  React.useEffect(() => {
    if (!svgRef.current || !containerRef.current) return;

    const width = containerRef.current.clientWidth;
    const height = 500;
    const svg = D3.select(svgRef.current);
    svg.selectAll("*").remove();
    svg.attr("width", width).attr("height", height).attr("viewBox", `0 0 ${width} ${height}`);

    const g = svg.append("g");

    const zoom = D3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.3, 4])
      .on("zoom", (event: any) => {
        g.attr("transform", event.transform);
      });
    svg.call(zoom);

    const nodes: GraphNode[] = DEMO_NODES.map((d) => ({ ...d }));
    const links: GraphLink[] = DEMO_LINKS.map((d) => ({ ...d }));

    const simulation = D3.forceSimulation(nodes)
      .force("link", D3.forceLink<GraphNode, any>(links).id((d: any) => d.id).distance(80))
      .force("charge", D3.forceManyBody().strength(-200))
      .force("center", D3.forceCenter(width / 2, height / 2))
      .force("collision", D3.forceCollide().radius(30));

    simulationRef.current = simulation;

    const linkElements = g
      .append("g")
      .attr("class", "links")
      .selectAll("line")
      .data(links)
      .join("line")
      .attr("stroke", isDark ? "#374151" : "#d1d5db")
      .attr("stroke-width", (d: any) => d.strength * 3)
      .attr("stroke-opacity", 0.6);

    const nodeGroup = g
      .append("g")
      .attr("class", "nodes")
      .selectAll("g")
      .data(nodes)
      .join("g")
      .attr("cursor", "pointer")
      .on("click", (_event: any, d: GraphNode) => {
        setSelectedNode(d.id);
      });

    const drag = D3.drag<SVGGElement, GraphNode>()
      .on("start", (event: any, d: GraphNode) => {
        if (!event.active) simulation.alphaTarget(0.3).restart();
        d.fx = d.x;
        d.fy = d.y;
      })
      .on("drag", (event: any, d: GraphNode) => {
        d.fx = event.x;
        d.fy = event.y;
      })
      .on("end", (event: any, d: GraphNode) => {
        if (!event.active) simulation.alphaTarget(0);
        d.fx = null;
        d.fy = null;
      });

    nodeGroup.call(drag as any);

    nodeGroup
      .append("circle")
      .attr("r", 16)
      .attr("fill", (d: GraphNode) => groupColors(d.group))
      .attr("stroke", isDark ? "#1f2937" : "#ffffff")
      .attr("stroke-width", 2.5);

    nodeGroup
      .append("text")
      .text((d: GraphNode) => d.label)
      .attr("text-anchor", "middle")
      .attr("dy", 30)
      .attr("font-size", "11px")
      .attr("fill", isDark ? "#d1d5db" : "#374151")
      .attr("pointer-events", "none");

    simulation.on("tick", () => {
      linkElements
        .attr("x1", (d: any) => d.source.x)
        .attr("y1", (d: any) => d.source.y)
        .attr("x2", (d: any) => d.target.x)
        .attr("y2", (d: any) => d.target.y);

      nodeGroup.attr("transform", (d: GraphNode) => `translate(${d.x},${d.y})`);
    });

    return () => {
      simulation.stop();
    };
  }, [isDark, groupColors]);

  const selectedData = DEMO_NODES.find((n) => n.id === selectedNode);
  const selectedConnections = DEMO_LINKS.filter(
    (l) =>
      (typeof l.source === "string" ? l.source : l.source.id) === selectedNode ||
      (typeof l.target === "string" ? l.target : l.target.id) === selectedNode
  );

  return (
    <div className="flex flex-col lg:flex-row gap-4">
      <div className="flex-1 min-w-0">
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <Icons.Share2 className="h-5 w-5" />
                Force-Directed Network
              </CardTitle>
              <div className="flex gap-2">
                {Object.entries(GROUP_NAMES).map(([key, name]) => (
                  <Badge
                    key={key}
                    variant="outline"
                    className="text-xs"
                    style={{ borderColor: groupColors(Number(key)), color: groupColors(Number(key)) }}
                  >
                    {name}
                  </Badge>
                ))}
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div ref={containerRef} className="w-full rounded-lg border overflow-hidden bg-muted/30">
              <svg ref={svgRef} className="w-full" style={{ height: 500 }} />
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              Drag nodes to reposition. Scroll to zoom. Click a node to view details.
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="w-full lg:w-72 shrink-0">
        <Card className="h-full">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Node Details</CardTitle>
          </CardHeader>
          <CardContent>
            {selectedData ? (
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <div
                    className="h-10 w-10 rounded-full flex items-center justify-center text-white font-bold text-sm"
                    style={{ backgroundColor: groupColors(selectedData.group) }}
                  >
                    {selectedData.label.charAt(0)}
                  </div>
                  <div>
                    <p className="font-semibold">{selectedData.label}</p>
                    <p className="text-xs text-muted-foreground">{selectedData.role}</p>
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Group</span>
                    <Badge variant="secondary">{GROUP_NAMES[selectedData.group]}</Badge>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Connections</span>
                    <span className="font-medium">{selectedConnections.length}</span>
                  </div>
                </div>
                <div>
                  <p className="text-xs font-medium mb-2 text-muted-foreground">Connected to:</p>
                  <div className="flex flex-wrap gap-1">
                    {selectedConnections.map((link, i) => {
                      const otherId =
                        (typeof link.source === "string" ? link.source : link.source.id) === selectedNode
                          ? typeof link.target === "string"
                            ? link.target
                            : link.target.id
                          : typeof link.source === "string"
                          ? link.source
                          : link.source.id;
                      const other = DEMO_NODES.find((n) => n.id === otherId);
                      return (
                        <Badge
                          key={i}
                          variant="outline"
                          className="text-xs cursor-pointer"
                          onClick={() => setSelectedNode(otherId)}
                        >
                          {other?.label ?? otherId}
                        </Badge>
                      );
                    })}
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={() => setSelectedNode(null)}
                >
                  <Icons.X className="mr-2 h-3 w-3" />
                  Clear Selection
                </Button>
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                <Icons.MousePointerClick className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm">Click a node in the graph to view its details.</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default ForceGraphExplorer;
