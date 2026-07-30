import {
  React,
  useAppState,
  useTheme,
  toast,
  Sheet,
  SheetTrigger,
  SheetContent,
  SheetHeader,
  SheetTitle,
  Card,
  CardContent,
  Button,
  ButtonGroup,
  Input,
  Label,
  Slider,
  Icons,
  cn,
} from "@exepad/sdk";

interface Shape {
  id: string;
  type: "rect" | "circle" | "text";
  x: number;
  y: number;
  width: number;
  height: number;
  fill: string;
  rotation: number;
  text?: string;
}

const DEFAULT_SHAPES: Shape[] = [
  { id: "s1", type: "rect", x: 60, y: 60, width: 120, height: 80, fill: "#9333ea", rotation: 0 },
  { id: "s2", type: "circle", x: 300, y: 150, width: 90, height: 90, fill: "#c084fc", rotation: 0 },
  { id: "s3", type: "rect", x: 450, y: 80, width: 100, height: 100, fill: "#7c3aed", rotation: 15 },
  { id: "s4", type: "text", x: 180, y: 300, width: 200, height: 40, fill: "#9333ea", rotation: 0, text: "Hello Canvas" },
  { id: "s5", type: "circle", x: 500, y: 320, width: 70, height: 70, fill: "#a855f7", rotation: 0 },
];

type ToolType = "select" | "rect" | "circle" | "text";

function CanvasDesignTool() {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";

  const [shapes, setShapes] = useAppState<Shape[]>("canvasShapes", DEFAULT_SHAPES);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [activeTool, setActiveTool] = React.useState<ToolType>("select");
  const [isDragging, setIsDragging] = React.useState(false);
  const [dragOffset, setDragOffset] = React.useState({ x: 0, y: 0 });

  const canvasRef = React.useRef<HTMLCanvasElement>(null);

  const currentShapes = shapes ?? DEFAULT_SHAPES;
  const selectedShape = currentShapes.find((s) => s.id === selectedId) ?? null;

  const drawCanvas = React.useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Background
    ctx.fillStyle = isDark ? "#1e1033" : "#faf5ff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Grid
    ctx.strokeStyle = isDark ? "#2d1f4e" : "#ede9fe";
    ctx.lineWidth = 1;
    for (let i = 0; i <= 16; i++) {
      ctx.beginPath();
      ctx.moveTo(i * 50, 0);
      ctx.lineTo(i * 50, 500);
      ctx.stroke();
    }
    for (let i = 0; i <= 10; i++) {
      ctx.beginPath();
      ctx.moveTo(0, i * 50);
      ctx.lineTo(800, i * 50);
      ctx.stroke();
    }

    // Shapes
    currentShapes.forEach((shape) => {
      ctx.save();
      ctx.translate(shape.x + shape.width / 2, shape.y + shape.height / 2);
      ctx.rotate((shape.rotation * Math.PI) / 180);
      ctx.translate(-shape.width / 2, -shape.height / 2);

      if (selectedId === shape.id) {
        ctx.shadowBlur = 10;
        ctx.shadowColor = shape.fill;
      }

      if (shape.type === "rect") {
        ctx.fillStyle = shape.fill;
        ctx.beginPath();
        ctx.roundRect(0, 0, shape.width, shape.height, 6);
        ctx.fill();
      } else if (shape.type === "circle") {
        ctx.fillStyle = shape.fill;
        ctx.beginPath();
        ctx.arc(shape.width / 2, shape.height / 2, shape.width / 2, 0, Math.PI * 2);
        ctx.fill();
      } else if (shape.type === "text") {
        ctx.fillStyle = shape.fill;
        ctx.font = "22px Inter, sans-serif";
        ctx.fillText(shape.text || "Text", 0, 22);
      }

      ctx.restore();

      // Selection outline
      if (selectedId === shape.id) {
        ctx.save();
        ctx.strokeStyle = "#3b82f6";
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 3]);
        ctx.strokeRect(shape.x - 4, shape.y - 4, shape.width + 8, shape.height + 8);
        ctx.setLineDash([]);
        ctx.restore();
      }
    });
  }, [currentShapes, selectedId, isDark]);

  React.useEffect(() => {
    drawCanvas();
  }, [drawCanvas]);

  const getShapeAtPoint = (x: number, y: number): Shape | null => {
    for (let i = currentShapes.length - 1; i >= 0; i--) {
      const s = currentShapes[i];
      if (x >= s.x && x <= s.x + s.width && y >= s.y && y <= s.y + s.height) {
        return s;
      }
    }
    return null;
  };

  const handleCanvasMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    if (activeTool === "select") {
      const shape = getShapeAtPoint(x, y);
      if (shape) {
        setSelectedId(shape.id);
        setIsDragging(true);
        setDragOffset({ x: x - shape.x, y: y - shape.y });
      } else {
        setSelectedId(null);
      }
    } else {
      const newId = "s" + Date.now();
      const defaultFill = isDark ? "#c084fc" : "#9333ea";
      let newShape: Shape;
      if (activeTool === "rect") {
        newShape = { id: newId, type: "rect", x, y, width: 100, height: 70, fill: defaultFill, rotation: 0 };
      } else if (activeTool === "circle") {
        newShape = { id: newId, type: "circle", x, y, width: 60, height: 60, fill: defaultFill, rotation: 0 };
      } else {
        newShape = { id: newId, type: "text", x, y, width: 150, height: 30, fill: defaultFill, rotation: 0, text: "Text" };
      }
      setShapes([...currentShapes, newShape]);
      setSelectedId(newId);
      setActiveTool("select");
    }
  };

  const handleCanvasMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDragging || !selectedId) return;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = e.clientX - rect.left - dragOffset.x;
    const y = e.clientY - rect.top - dragOffset.y;
    const updated = currentShapes.map((s) =>
      s.id === selectedId ? { ...s, x, y } : s
    );
    setShapes(updated);
  };

  const handleCanvasMouseUp = () => {
    setIsDragging(false);
  };

  const updateSelectedShape = (updates: Partial<Shape>) => {
    if (!selectedId) return;
    const updated = currentShapes.map((s) =>
      s.id === selectedId ? { ...s, ...updates } : s
    );
    setShapes(updated);
  };

  const handleExportPng = () => {
    if (!canvasRef.current) return;
    try {
      const uri = canvasRef.current.toDataURL("image/png");
      const link = document.createElement("a");
      link.download = "canvas-export.png";
      link.href = uri;
      link.click();
      toast.success("Canvas exported as PNG");
    } catch {
      toast.error("Failed to export canvas");
    }
  };

  const deleteSelected = () => {
    if (!selectedId) return;
    setShapes(currentShapes.filter((s) => s.id !== selectedId));
    setSelectedId(null);
    toast("Shape deleted");
  };

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <Card>
        <CardContent className="py-3">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-3">
              <Label className="text-sm font-medium">Tool:</Label>
              <ButtonGroup>
                <Button
                  size="sm"
                  variant={activeTool === "select" ? "default" : "outline"}
                  onClick={() => setActiveTool("select")}
                >
                  <Icons.MousePointer className="h-4 w-4 mr-1" />
                  Select
                </Button>
                <Button
                  size="sm"
                  variant={activeTool === "rect" ? "default" : "outline"}
                  onClick={() => setActiveTool("rect")}
                >
                  <Icons.Square className="h-4 w-4 mr-1" />
                  Rectangle
                </Button>
                <Button
                  size="sm"
                  variant={activeTool === "circle" ? "default" : "outline"}
                  onClick={() => setActiveTool("circle")}
                >
                  <Icons.Circle className="h-4 w-4 mr-1" />
                  Circle
                </Button>
                <Button
                  size="sm"
                  variant={activeTool === "text" ? "default" : "outline"}
                  onClick={() => setActiveTool("text")}
                >
                  <Icons.Type className="h-4 w-4 mr-1" />
                  Text
                </Button>
              </ButtonGroup>
            </div>
            <div className="flex items-center gap-2">
              {selectedId && (
                <Button size="sm" variant="destructive" onClick={deleteSelected}>
                  <Icons.Trash2 className="h-4 w-4 mr-1" />
                  Delete
                </Button>
              )}
              <Sheet>
                <SheetTrigger asChild>
                  <Button size="sm" variant="outline" disabled={!selectedId}>
                    <Icons.Settings className="h-4 w-4 mr-1" />
                    Properties
                  </Button>
                </SheetTrigger>
                <SheetContent>
                  <SheetHeader>
                    <SheetTitle>Shape Properties</SheetTitle>
                  </SheetHeader>
                  {selectedShape && (
                    <div className="space-y-5 mt-6">
                      <div className="space-y-2">
                        <Label>Fill Color</Label>
                        <Input
                          type="color"
                          value={selectedShape.fill}
                          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                            updateSelectedShape({ fill: e.target.value })
                          }
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>X Position</Label>
                        <Input
                          type="number"
                          value={Math.round(selectedShape.x)}
                          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                            updateSelectedShape({ x: Number(e.target.value) })
                          }
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Y Position</Label>
                        <Input
                          type="number"
                          value={Math.round(selectedShape.y)}
                          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                            updateSelectedShape({ y: Number(e.target.value) })
                          }
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Width: {Math.round(selectedShape.width)}px</Label>
                        <Slider
                          value={[selectedShape.width]}
                          min={10}
                          max={500}
                          step={1}
                          onValueChange={(val: number[]) =>
                            updateSelectedShape({ width: val[0] })
                          }
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Height: {Math.round(selectedShape.height)}px</Label>
                        <Slider
                          value={[selectedShape.height]}
                          min={10}
                          max={500}
                          step={1}
                          onValueChange={(val: number[]) =>
                            updateSelectedShape({ height: val[0] })
                          }
                        />
                      </div>
                      {selectedShape.type === "text" && (
                        <div className="space-y-2">
                          <Label>Text Content</Label>
                          <Input
                            value={selectedShape.text ?? ""}
                            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                              updateSelectedShape({ text: e.target.value })
                            }
                          />
                        </div>
                      )}
                    </div>
                  )}
                </SheetContent>
              </Sheet>
              <Button size="sm" onClick={handleExportPng}>
                <Icons.Download className="h-4 w-4 mr-1" />
                Export PNG
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Canvas */}
      <Card className="overflow-hidden">
        <CardContent className="p-0">
          <canvas
            ref={canvasRef}
            width={800}
            height={500}
            onMouseDown={handleCanvasMouseDown}
            onMouseMove={handleCanvasMouseMove}
            onMouseUp={handleCanvasMouseUp}
            onMouseLeave={handleCanvasMouseUp}
            style={{ cursor: activeTool === "select" ? "default" : "crosshair", display: "block" }}
          />
        </CardContent>
      </Card>
    </div>
  );
}

export default CanvasDesignTool;
