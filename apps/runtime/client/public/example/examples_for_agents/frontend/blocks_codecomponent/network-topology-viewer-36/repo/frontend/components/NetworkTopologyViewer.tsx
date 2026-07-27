import {
  React,
  useModel,
  useAppState,
  useTheme,
  ToggleGroup,
  ToggleGroupItem,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  Badge,
  Button,
  Icons,
  cn,
} from "@exepad/sdk";
import * as CytoscapeModule from "@exepad/ext-cytoscape";
// esm.sh exports cytoscape as the default export - resolve nested defaults
const Cytoscape: any = typeof _cyDefault === "function" ? _cyDefault : (_cyDefault.default || _cyDefault);

interface NetworkNode {
  id: string;
  label: string;
  type: "server" | "router" | "switch" | "firewall";
  status: "online" | "warning" | "offline";
  ip: string;
  load: number;
}

interface NetworkEdge {
  id: string;
  source: string;
  target: string;
  bandwidth: string;
  latency: number;
}

const DEMO_NODES: NetworkNode[] = [
  { id: "fw1", label: "Firewall-1", type: "firewall", status: "online", ip: "10.0.0.1", load: 32 },
  { id: "r1", label: "Core-Router-1", type: "router", status: "online", ip: "10.0.1.1", load: 55 },
  { id: "r2", label: "Core-Router-2", type: "router", status: "online", ip: "10.0.1.2", load: 48 },
  { id: "r3", label: "Edge-Router", type: "router", status: "warning", ip: "10.0.1.3", load: 87 },
  { id: "sw1", label: "Switch-A1", type: "switch", status: "online", ip: "10.0.2.1", load: 22 },
  { id: "sw2", label: "Switch-A2", type: "switch", status: "online", ip: "10.0.2.2", load: 18 },
  { id: "sw3", label: "Switch-B1", type: "switch", status: "online", ip: "10.0.2.3", load: 35 },
  { id: "sw4", label: "Switch-B2", type: "switch", status: "warning", ip: "10.0.2.4", load: 72 },
  { id: "s1", label: "Web-Server-1", type: "server", status: "online", ip: "10.0.3.1", load: 45 },
  { id: "s2", label: "Web-Server-2", type: "server", status: "online", ip: "10.0.3.2", load: 62 },
  { id: "s3", label: "DB-Primary", type: "server", status: "online", ip: "10.0.3.3", load: 58 },
  { id: "s4", label: "DB-Replica", type: "server", status: "online", ip: "10.0.3.4", load: 30 },
  { id: "s5", label: "Cache-Server", type: "server", status: "online", ip: "10.0.3.5", load: 15 },
  { id: "s6", label: "App-Server-1", type: "server", status: "online", ip: "10.0.3.6", load: 70 },
  { id: "s7", label: "App-Server-2", type: "server", status: "offline", ip: "10.0.3.7", load: 0 },
  { id: "s8", label: "Mail-Server", type: "server", status: "online", ip: "10.0.3.8", load: 25 },
  { id: "fw2", label: "Firewall-2", type: "firewall", status: "online", ip: "10.0.0.2", load: 28 },
  { id: "r4", label: "VPN-Router", type: "router", status: "online", ip: "10.0.1.4", load: 40 },
  { id: "sw5", label: "Switch-C1", type: "switch", status: "online", ip: "10.0.2.5", load: 12 },
  { id: "s9", label: "Monitor-Server", type: "server", status: "online", ip: "10.0.3.9", load: 38 },
];

const DEMO_EDGES: NetworkEdge[] = [
  { id: "e1", source: "fw1", target: "r1", bandwidth: "10Gbps", latency: 1 },
  { id: "e2", source: "fw1", target: "r2", bandwidth: "10Gbps", latency: 1 },
  { id: "e3", source: "r1", target: "sw1", bandwidth: "1Gbps", latency: 2 },
  { id: "e4", source: "r1", target: "sw2", bandwidth: "1Gbps", latency: 2 },
  { id: "e5", source: "r2", target: "sw3", bandwidth: "1Gbps", latency: 2 },
  { id: "e6", source: "r2", target: "sw4", bandwidth: "1Gbps", latency: 3 },
  { id: "e7", source: "sw1", target: "s1", bandwidth: "1Gbps", latency: 1 },
  { id: "e8", source: "sw1", target: "s2", bandwidth: "1Gbps", latency: 1 },
  { id: "e9", source: "sw2", target: "s3", bandwidth: "1Gbps", latency: 1 },
  { id: "e10", source: "sw2", target: "s4", bandwidth: "1Gbps", latency: 1 },
  { id: "e11", source: "sw3", target: "s5", bandwidth: "1Gbps", latency: 1 },
  { id: "e12", source: "sw3", target: "s6", bandwidth: "1Gbps", latency: 1 },
  { id: "e13", source: "sw4", target: "s7", bandwidth: "1Gbps", latency: 5 },
  { id: "e14", source: "sw4", target: "s8", bandwidth: "1Gbps", latency: 1 },
  { id: "e15", source: "r1", target: "r2", bandwidth: "10Gbps", latency: 1 },
  { id: "e16", source: "r3", target: "fw1", bandwidth: "1Gbps", latency: 4 },
  { id: "e17", source: "fw2", target: "r4", bandwidth: "1Gbps", latency: 2 },
  { id: "e18", source: "r4", target: "sw5", bandwidth: "1Gbps", latency: 2 },
  { id: "e19", source: "sw5", target: "s9", bandwidth: "1Gbps", latency: 1 },
  { id: "e20", source: "r1", target: "r3", bandwidth: "1Gbps", latency: 3 },
  { id: "e21", source: "s3", target: "s4", bandwidth: "10Gbps", latency: 1 },
  { id: "e22", source: "s1", target: "s5", bandwidth: "1Gbps", latency: 1 },
  { id: "e23", source: "s2", target: "s5", bandwidth: "1Gbps", latency: 1 },
  { id: "e24", source: "s6", target: "s3", bandwidth: "1Gbps", latency: 2 },
  { id: "e25", source: "fw1", target: "fw2", bandwidth: "10Gbps", latency: 1 },
  { id: "e26", source: "r4", target: "r2", bandwidth: "1Gbps", latency: 3 },
  { id: "e27", source: "s9", target: "r1", bandwidth: "1Gbps", latency: 2 },
  { id: "e28", source: "s9", target: "r2", bandwidth: "1Gbps", latency: 2 },
  { id: "e29", source: "s6", target: "s5", bandwidth: "1Gbps", latency: 1 },
  { id: "e30", source: "s8", target: "fw2", bandwidth: "1Gbps", latency: 2 },
];

const TYPE_SHAPES: Record<NetworkNode["type"], string> = {
  server: "rectangle",
  router: "diamond",
  switch: "ellipse",
  firewall: "hexagon",
};

const TYPE_ICONS: Record<NetworkNode["type"], keyof typeof Icons> = {
  server: "Server",
  router: "Router",
  switch: "Network",
  firewall: "Shield",
};

const STATUS_COLORS: Record<NetworkNode["status"], { bg: string; border: string }> = {
  online: { bg: "#10b981", border: "#059669" },
  warning: { bg: "#f59e0b", border: "#d97706" },
  offline: { bg: "#ef4444", border: "#dc2626" },
};

const LAYOUTS = ["breadthfirst", "circle", "cose", "grid"] as const;
type LayoutName = (typeof LAYOUTS)[number];

const HIGHLIGHT_MODES = ["none", "neighbors", "type"] as const;
type HighlightMode = (typeof HIGHLIGHT_MODES)[number];

function NetworkTopologyViewer() {
  const theme = useTheme();
  // In a real app: const { data: networkData } = useModel("network");
  const [layout, setLayout] = useAppState<LayoutName>("topoLayout", "cose");
  const [highlightMode, setHighlightMode] = useAppState<HighlightMode>("highlightMode", "none");
  const [selectedNode, setSelectedNode] = useAppState<string | null>("selectedTopoNode", null);

  const containerRef = React.useRef<HTMLDivElement>(null);
  const cyRef = React.useRef<any>(null);

  const isDark = theme.resolvedTheme === "dark";
  const activeLayout = layout ?? "cose";
  const activeHighlight = highlightMode ?? "none";

  React.useEffect(() => {
    if (!containerRef.current) return;
    let cancelled = false;

    const elements: any[] = [];
    DEMO_NODES.forEach((node) => {
      elements.push({
        data: {
          id: node.id,
          label: node.label,
          nodeType: node.type,
          status: node.status,
          ip: node.ip,
          load: node.load,
        },
      });
    });
    DEMO_EDGES.forEach((edge) => {
      elements.push({
        data: {
          id: edge.id,
          source: edge.source,
          target: edge.target,
          bandwidth: edge.bandwidth,
          latency: edge.latency,
        },
      });
    });

    const cy = Cytoscape({
      container: containerRef.current,
      elements,
      style: [
        {
          selector: "node",
          style: {
            label: "data(label)",
            "text-valign": "bottom",
            "text-halign": "center",
            "font-size": "10px",
            color: isDark ? "#d1d5db" : "#374151",
            "text-margin-y": 6,
            width: 36,
            height: 36,
            "border-width": 2,
          },
        },
        {
          selector: "node[nodeType='server']",
          style: {
            shape: "rectangle",
            "background-color": isDark ? "#6366f1" : "#818cf8",
            "border-color": isDark ? "#4f46e5" : "#6366f1",
          },
        },
        {
          selector: "node[nodeType='router']",
          style: {
            shape: "diamond",
            "background-color": isDark ? "#f59e0b" : "#fbbf24",
            "border-color": isDark ? "#d97706" : "#f59e0b",
          },
        },
        {
          selector: "node[nodeType='switch']",
          style: {
            shape: "ellipse",
            "background-color": isDark ? "#10b981" : "#34d399",
            "border-color": isDark ? "#059669" : "#10b981",
          },
        },
        {
          selector: "node[nodeType='firewall']",
          style: {
            shape: "hexagon",
            "background-color": isDark ? "#ef4444" : "#f87171",
            "border-color": isDark ? "#dc2626" : "#ef4444",
          },
        },
        {
          selector: "node[status='offline']",
          style: { opacity: 0.4 },
        },
        {
          selector: "node[status='warning']",
          style: { "border-color": "#f59e0b", "border-width": 3 },
        },
        {
          selector: "edge",
          style: {
            width: 2,
            "line-color": isDark ? "#4b5563" : "#d1d5db",
            "curve-style": "bezier",
            "target-arrow-shape": "none",
            opacity: 0.7,
          },
        },
        {
          selector: ".highlighted",
          style: {
            "border-color": isDark ? "#fbbf24" : "#f59e0b",
            "border-width": 4,
            opacity: 1,
          },
        },
        {
          selector: ".highlighted-edge",
          style: {
            "line-color": isDark ? "#fbbf24" : "#f59e0b",
            width: 3,
            opacity: 1,
          },
        },
        {
          selector: ".dimmed",
          style: { opacity: 0.15 },
        },
      ],
      layout: { name: activeLayout, animate: false } as any,
      userZoomingEnabled: true,
      userPanningEnabled: true,
      boxSelectionEnabled: false,
    });

    if (cancelled) { cy.destroy(); return; }
    cyRef.current = cy;

    cy.on("tap", "node", (evt: any) => {
      if (!cyRef.current) return;
      const nodeId = evt.target.id();
      setSelectedNode(nodeId);
    });

    cy.on("tap", (evt: any) => {
      if (!cyRef.current) return;
      if (evt.target === cy) {
        setSelectedNode(null);
      }
    });

    return () => {
      cancelled = true;
      const c = cyRef.current;
      cyRef.current = null;
      if (c) {
        try {
          c.stop();
          c.removeAllListeners();
          // Detach renderer before destroying to prevent async notify callbacks
          if (c.renderer) {
            try { c.renderer().destroy(); } catch {}
          }
          c.destroy();
        } catch {
          // already destroyed — ignore
        }
      }
    };
  }, [isDark]);

  // Handle layout changes
  React.useEffect(() => {
    if (!cyRef.current) return;
    const cy = cyRef.current;
    cy.layout({ name: activeLayout, animate: true, animationDuration: 500 } as any).run();
  }, [activeLayout]);

  // Handle highlight mode changes
  React.useEffect(() => {
    if (!cyRef.current) return;
    const cy = cyRef.current;

    cy.elements().removeClass("highlighted highlighted-edge dimmed");

    if (activeHighlight === "none" || !selectedNode) return;

    if (activeHighlight === "neighbors") {
      const node = cy.getElementById(selectedNode);
      if (node.length === 0) return;
      const neighborhood = node.neighborhood().add(node);
      cy.elements().addClass("dimmed");
      neighborhood.removeClass("dimmed");
      node.addClass("highlighted");
      node.connectedEdges().addClass("highlighted-edge");
    }

    if (activeHighlight === "type") {
      const nodeData = DEMO_NODES.find((n) => n.id === selectedNode);
      if (!nodeData) return;
      cy.elements().addClass("dimmed");
      cy.nodes().filter((n: any) => n.data("nodeType") === nodeData.type).removeClass("dimmed").addClass("highlighted");
    }
  }, [activeHighlight, selectedNode]);

  const selectedData = DEMO_NODES.find((n) => n.id === selectedNode);
  const connectedEdges = selectedNode
    ? DEMO_EDGES.filter((e) => e.source === selectedNode || e.target === selectedNode)
    : [];

  return (
    <div className="flex flex-col lg:flex-row gap-4">
      <div className="flex-1 min-w-0">
        <Card>
          <CardHeader className="pb-2">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <CardTitle className="flex items-center gap-2">
                <Icons.Network className="h-5 w-5" />
                Network Topology
              </CardTitle>
              <div className="flex flex-wrap items-center gap-2">
                <ToggleGroup
                  type="single"
                  value={activeLayout}
                  onValueChange={(v: string) => {
                    if (v) setLayout(v as LayoutName);
                  }}
                >
                  {LAYOUTS.map((l) => (
                    <ToggleGroupItem key={l} value={l} className="text-xs px-2 capitalize">
                      {l}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
                <Select value={activeHighlight} onValueChange={(v: string) => setHighlightMode(v as HighlightMode)}>
                  <SelectTrigger className="w-32 h-8">
                    <SelectValue placeholder="Highlight" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No Highlight</SelectItem>
                    <SelectItem value="neighbors">Neighbors</SelectItem>
                    <SelectItem value="type">By Type</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex gap-3 mb-3">
              {(["server", "router", "switch", "firewall"] as const).map((type) => {
                const Icon = Icons[TYPE_ICONS[type]] as React.ComponentType<{ className?: string }>;
                return (
                  <div key={type} className="flex items-center gap-1 text-xs text-muted-foreground">
                    {Icon && <Icon className="h-3 w-3" />}
                    <span className="capitalize">{type}</span>
                  </div>
                );
              })}
            </div>
            <div
              ref={containerRef}
              className="w-full rounded-lg border bg-muted/20"
              style={{ height: 500 }}
            />
            <p className="text-xs text-muted-foreground mt-2">
              Click a node to select. Scroll to zoom. Drag to pan.
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="w-full lg:w-72 shrink-0">
        <Card className="h-full">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Device Details</CardTitle>
          </CardHeader>
          <CardContent>
            {selectedData ? (
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  {(() => {
                    const Icon = Icons[TYPE_ICONS[selectedData.type]] as React.ComponentType<{ className?: string }>;
                    return Icon ? <Icon className="h-8 w-8 text-primary" /> : null;
                  })()}
                  <div>
                    <p className="font-semibold text-sm">{selectedData.label}</p>
                    <p className="text-xs text-muted-foreground">{selectedData.ip}</p>
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Type</span>
                    <Badge variant="outline" className="capitalize text-xs">{selectedData.type}</Badge>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Status</span>
                    <Badge
                      variant={selectedData.status === "online" ? "default" : selectedData.status === "warning" ? "secondary" : "destructive"}
                      className="text-xs"
                    >
                      {selectedData.status}
                    </Badge>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Load</span>
                    <span className={cn("font-medium", selectedData.load > 80 ? "text-destructive" : selectedData.load > 60 ? "text-yellow-500" : "")}>
                      {selectedData.load}%
                    </span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Connections</span>
                    <span className="font-medium">{connectedEdges.length}</span>
                  </div>
                </div>
                <div>
                  <p className="text-xs font-medium mb-2 text-muted-foreground">Connected Links:</p>
                  <div className="space-y-1">
                    {connectedEdges.slice(0, 6).map((edge) => {
                      const otherId = edge.source === selectedNode ? edge.target : edge.source;
                      const other = DEMO_NODES.find((n) => n.id === otherId);
                      return (
                        <div
                          key={edge.id}
                          className="flex items-center justify-between text-xs p-1.5 rounded bg-muted/50 cursor-pointer hover:bg-muted"
                          onClick={() => setSelectedNode(otherId)}
                        >
                          <span className="truncate">{other?.label ?? otherId}</span>
                          <span className="text-muted-foreground">{edge.latency}ms</span>
                        </div>
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
                <p className="text-sm">Click a device in the topology to view its details.</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default NetworkTopologyViewer;
