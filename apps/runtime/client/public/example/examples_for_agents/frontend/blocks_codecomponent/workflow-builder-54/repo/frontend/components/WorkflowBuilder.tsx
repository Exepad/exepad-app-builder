import {
  React,
  useAppState,
  useHandler,
  toast,
  Sheet,
  SheetTrigger,
  SheetContent,
  SheetHeader,
  SheetTitle,
  Drawer,
  DrawerTrigger,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  Card,
  CardContent,
  Button,
  Input,
  Label,
  Badge,
  Separator,
  Icons,
  cn,
} from "@exepad/sdk";
import * as ReactFlowM from "@exepad/ext-reactflow";

interface WorkflowNode {
  type: "trigger" | "action" | "condition";
  label: string;
  description: string;
  icon: string;
}

const NODE_TEMPLATES: WorkflowNode[] = [
  { type: "trigger", label: "HTTP Trigger", description: "Start on HTTP request", icon: "Globe" },
  { type: "trigger", label: "Schedule Trigger", description: "Run on a cron schedule", icon: "Clock" },
  { type: "action", label: "Send Email", description: "Send an email notification", icon: "Mail" },
  { type: "action", label: "API Call", description: "Make an external API request", icon: "Zap" },
  { type: "action", label: "Transform Data", description: "Map and transform data", icon: "Shuffle" },
  { type: "condition", label: "If/Else", description: "Branch based on condition", icon: "GitBranch" },
  { type: "condition", label: "Switch", description: "Multi-way branching", icon: "GitFork" },
];

const nodeColors: Record<string, { bg: string; border: string; badge: string }> = {
  trigger: {
    bg: "bg-green-50 dark:bg-green-950/30",
    border: "border-green-300 dark:border-green-700",
    badge: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300",
  },
  action: {
    bg: "bg-blue-50 dark:bg-blue-950/30",
    border: "border-blue-300 dark:border-blue-700",
    badge: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300",
  },
  condition: {
    bg: "bg-yellow-50 dark:bg-yellow-950/30",
    border: "border-yellow-300 dark:border-yellow-700",
    badge: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-300",
  },
};

const initialNodes: ReactFlow.Node[] = [
  {
    id: "n1",
    type: "workflowNode",
    position: { x: 250, y: 0 },
    data: { label: "HTTP Trigger", nodeType: "trigger", icon: "Globe", description: "Incoming webhook" },
  },
  {
    id: "n2",
    type: "workflowNode",
    position: { x: 250, y: 120 },
    data: { label: "Validate Input", nodeType: "condition", icon: "GitBranch", description: "Check payload schema" },
  },
  {
    id: "n3",
    type: "workflowNode",
    position: { x: 250, y: 240 },
    data: { label: "Process Data", nodeType: "action", icon: "Shuffle", description: "Transform and enrich" },
  },
  {
    id: "n4",
    type: "workflowNode",
    position: { x: 250, y: 360 },
    data: { label: "Send Notification", nodeType: "action", icon: "Mail", description: "Email stakeholders" },
  },
  {
    id: "n5",
    type: "workflowNode",
    position: { x: 250, y: 480 },
    data: { label: "Complete", nodeType: "action", icon: "CheckCircle", description: "Mark as done" },
  },
];

const initialEdges: ReactFlow.Edge[] = [
  { id: "e1-2", source: "n1", target: "n2", animated: true },
  { id: "e2-3", source: "n2", target: "n3" },
  { id: "e3-4", source: "n3", target: "n4" },
  { id: "e4-5", source: "n4", target: "n5" },
];

function WorkflowNodeComponent({ data }: { data: any }) {
  const colors = nodeColors[data.nodeType] || nodeColors.action;
  const IconComp = (Icons as any)[data.icon];

  return (
    <div
      className={cn(
        "px-4 py-3 rounded-lg border-2 min-w-[180px] shadow-sm",
        colors.bg,
        colors.border
      )}
    >
      <ReactFlow.Handle
        type="target"
        position={ReactFlow.Position.Top}
        className="!bg-muted-foreground !w-2 !h-2"
      />
      <div className="flex items-center gap-2 mb-1">
        {IconComp && <IconComp className="h-4 w-4 text-foreground/70" />}
        <span className="text-sm font-semibold">{data.label}</span>
      </div>
      <p className="text-xs text-muted-foreground">{data.description}</p>
      <div className="mt-2">
        <Badge variant="outline" className={cn("text-[10px]", colors.badge)}>
          {data.nodeType}
        </Badge>
      </div>
      <ReactFlow.Handle
        type="source"
        position={ReactFlow.Position.Bottom}
        className="!bg-muted-foreground !w-2 !h-2"
      />
    </div>
  );
}

const nodeTypes = { workflowNode: WorkflowNodeComponent };

function WorkflowBuilder() {
  const [nodes, setNodes, onNodesChange] = ReactFlow.useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = ReactFlow.useEdgesState(initialEdges);
  const [selectedNode, setSelectedNode] = useAppState<string | null>("selectedWorkflowNode", null);
  const [workflowName, setWorkflowName] = useAppState<string>("workflowName", "My Workflow");
  const deployWorkflow = useHandler("deployWorkflow");

  const onConnect = React.useCallback(
    (params: ReactFlow.Connection) => {
      setEdges((eds) => ReactFlow.addEdge(params, eds));
    },
    [setEdges]
  );

  const onNodeClick = React.useCallback(
    (_: React.MouseEvent, node: ReactFlow.Node) => {
      setSelectedNode(node.id);
    },
    [setSelectedNode]
  );

  const handleSave = () => {
    toast("Workflow saved successfully!");
  };

  const handleDeploy = () => {
    toast("Workflow deployed! It is now active and processing events.");
  };

  const handleValidate = () => {
    const triggers = nodes.filter((n) => n.data?.nodeType === "trigger");
    if (triggers.length === 0) {
      toast("Validation failed: workflow must have at least one trigger node.");
      return;
    }
    const orphans = nodes.filter((n) => {
      const hasIncoming = edges.some((e) => e.target === n.id);
      const hasOutgoing = edges.some((e) => e.source === n.id);
      return !hasIncoming && !hasOutgoing;
    });
    if (orphans.length > 0) {
      toast(`Validation warning: ${orphans.length} disconnected node(s) found.`);
      return;
    }
    toast("Workflow is valid! All nodes are connected.");
  };

  const addNodeFromTemplate = (template: WorkflowNode) => {
    const newId = `n${Date.now()}`;
    const newNode: ReactFlow.Node = {
      id: newId,
      type: "workflowNode",
      position: { x: 100 + Math.random() * 200, y: 100 + Math.random() * 300 },
      data: {
        label: template.label,
        nodeType: template.type,
        icon: template.icon,
        description: template.description,
      },
    };
    setNodes((nds) => [...nds, newNode]);
  };

  const selectedNodeData = nodes.find((n) => n.id === selectedNode);

  const updateNodeLabel = (newLabel: string) => {
    if (!selectedNode) return;
    setNodes((nds) =>
      nds.map((n) =>
        n.id === selectedNode ? { ...n, data: { ...n.data, label: newLabel } } : n
      )
    );
  };

  const updateNodeDescription = (newDesc: string) => {
    if (!selectedNode) return;
    setNodes((nds) =>
      nds.map((n) =>
        n.id === selectedNode ? { ...n, data: { ...n.data, description: newDesc } } : n
      )
    );
  };

  const deleteSelectedNode = () => {
    if (!selectedNode) return;
    setNodes((nds) => nds.filter((n) => n.id !== selectedNode));
    setEdges((eds) => eds.filter((e) => e.source !== selectedNode && e.target !== selectedNode));
    setSelectedNode(null);
  };

  return (
    <div className="h-[600px] rounded-lg overflow-hidden border flex flex-col">
      <div className="flex items-center justify-between p-3 border-b bg-background">
        <div className="flex items-center gap-3">
          <Icons.GitBranch className="h-5 w-5 text-primary" />
          <Input
            value={workflowName || ""}
            onChange={(e) => setWorkflowName(e.target.value)}
            className="h-8 w-48 font-semibold text-sm"
          />
          <Badge variant="secondary" className="text-xs">
            {nodes.length} nodes
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          <Sheet>
            <SheetTrigger asChild>
              <Button variant="outline" size="sm">
                <Icons.Plus className="h-4 w-4 mr-1" /> Add Node
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-80">
              <SheetHeader>
                <SheetTitle>Node Templates</SheetTitle>
              </SheetHeader>
              <div className="space-y-2 mt-4">
                {(["trigger", "action", "condition"] as const).map((type) => (
                  <React.Fragment key={type}>
                    <Label className="text-xs uppercase text-muted-foreground tracking-wide">
                      {type}s
                    </Label>
                    {NODE_TEMPLATES.filter((t) => t.type === type).map((template) => {
                      const IconC = (Icons as any)[template.icon];
                      const colors = nodeColors[type];
                      return (
                        <Card
                          key={template.label}
                          className={cn(
                            "cursor-pointer hover:shadow-md transition-shadow",
                            colors.bg,
                            "border",
                            colors.border
                          )}
                          onClick={() => addNodeFromTemplate(template)}
                        >
                          <CardContent className="p-3 flex items-center gap-3">
                            {IconC && <IconC className="h-4 w-4 shrink-0" />}
                            <div>
                              <p className="text-sm font-medium">{template.label}</p>
                              <p className="text-xs text-muted-foreground">
                                {template.description}
                              </p>
                            </div>
                          </CardContent>
                        </Card>
                      );
                    })}
                    <Separator className="my-2" />
                  </React.Fragment>
                ))}
              </div>
            </SheetContent>
          </Sheet>

          <Separator orientation="vertical" className="h-6" />

          <Button variant="outline" size="sm" onClick={handleValidate}>
            <Icons.CheckCircle className="h-4 w-4 mr-1" /> Validate
          </Button>
          <Button variant="outline" size="sm" onClick={handleSave}>
            <Icons.Save className="h-4 w-4 mr-1" /> Save
          </Button>
          <Button size="sm" onClick={handleDeploy}>
            <Icons.Rocket className="h-4 w-4 mr-1" /> Deploy
          </Button>
        </div>
      </div>

      <div className="flex-1 relative">
        <ReactFlow.ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeClick={onNodeClick}
          nodeTypes={nodeTypes}
          fitView
          className="bg-muted/30"
        >
          <ReactFlow.Background gap={16} size={1} />
          <ReactFlow.Controls className="!bg-background !border-border !shadow-sm" />
          <ReactFlow.MiniMap
            className="!bg-background !border-border"
            nodeColor={(n) => {
              const t = n.data?.nodeType;
              if (t === "trigger") return "#16a34a";
              if (t === "condition") return "#eab308";
              return "#3b82f6";
            }}
          />
        </ReactFlow.ReactFlow>

        {selectedNodeData && (
          <Drawer>
            <DrawerTrigger asChild>
              <Button
                size="sm"
                variant="secondary"
                className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 shadow-md"
              >
                <Icons.Settings className="h-4 w-4 mr-1" />
                Edit: {selectedNodeData.data?.label}
              </Button>
            </DrawerTrigger>
            <DrawerContent>
              <DrawerHeader>
                <DrawerTitle>Node Properties</DrawerTitle>
              </DrawerHeader>
              <div className="p-4 pb-8 space-y-4 max-w-md mx-auto">
                <div className="space-y-2">
                  <Label className="text-sm">Label</Label>
                  <Input
                    value={selectedNodeData.data?.label || ""}
                    onChange={(e) => updateNodeLabel(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-sm">Description</Label>
                  <Input
                    value={selectedNodeData.data?.description || ""}
                    onChange={(e) => updateNodeDescription(e.target.value)}
                  />
                </div>
                <div className="flex items-center gap-2">
                  <Label className="text-sm">Type</Label>
                  <Badge
                    variant="outline"
                    className={cn(nodeColors[selectedNodeData.data?.nodeType]?.badge)}
                  >
                    {selectedNodeData.data?.nodeType}
                  </Badge>
                </div>
                <Separator />
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={deleteSelectedNode}
                  className="w-full"
                >
                  <Icons.Trash2 className="h-4 w-4 mr-1" /> Delete Node
                </Button>
              </div>
            </DrawerContent>
          </Drawer>
        )}
      </div>
    </div>
  );
}

export default WorkflowBuilder;
