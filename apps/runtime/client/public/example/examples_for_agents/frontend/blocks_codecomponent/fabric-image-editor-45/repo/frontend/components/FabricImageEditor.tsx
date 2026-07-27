import {
  React,
  useFileUpload,
  useFileUrl,
  useHandler,
  toast,
  useAppState,
  Toggle,
  Card,
  CardContent,
  Button,
  Slider,
  Label,
  Separator,
  Icons,
  cn,
} from "@exepad/sdk";
import * as FabricM from "@exepad/ext-fabric";

type ToolMode = "select" | "draw" | "text" | "crop";

function FabricImageEditor() {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const fabricRef = React.useRef<any>(null);

  const [mode, setMode] = useAppState<ToolMode>("editorMode", "select");
  const [brightness, setBrightness] = useAppState<number>("filterBrightness", 0);
  const [contrast, setContrast] = useAppState<number>("filterContrast", 0);
  const [saturation, setSaturation] = useAppState<number>("filterSaturation", 0);
  const [imageFileId, setImageFileId] = useAppState<string | null>("editorImageId", null);

  const currentMode = mode ?? "select";
  const currentBrightness = brightness ?? 0;
  const currentContrast = contrast ?? 0;
  const currentSaturation = saturation ?? 0;

  const { upload, isUploading } = useFileUpload();
  const imageUrl = useFileUrl(imageFileId ?? undefined);
  const saveHandler = useHandler("saveEdited");

  React.useEffect(() => {
    if (!canvasRef.current || fabricRef.current) return;
    const canvas = new Fabric.Canvas(canvasRef.current, {
      width: 700,
      height: 450,
      backgroundColor: "#f8f8f8",
      selection: true,
    });
    fabricRef.current = canvas;

    // Add placeholder elements
    const rect = new Fabric.Rect({
      left: 50,
      top: 50,
      width: 200,
      height: 150,
      fill: "#db277733",
      stroke: "#db2777",
      strokeWidth: 2,
      rx: 8,
      ry: 8,
    });
    canvas.add(rect);

    const text = new Fabric.IText("Upload an image to start editing", {
      left: 180,
      top: 200,
      fontSize: 20,
      fill: "#db2777",
      fontFamily: "Inter, sans-serif",
    });
    canvas.add(text);

    const circle = new Fabric.Circle({
      left: 500,
      top: 100,
      radius: 50,
      fill: "#f472b633",
      stroke: "#f472b6",
      strokeWidth: 2,
    });
    canvas.add(circle);

    canvas.renderAll();

    return () => {
      canvas.dispose();
      fabricRef.current = null;
    };
  }, []);

  React.useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;
    if (currentMode === "draw") {
      canvas.isDrawingMode = true;
      canvas.freeDrawingBrush.color = "#db2777";
      canvas.freeDrawingBrush.width = 3;
    } else {
      canvas.isDrawingMode = false;
    }
  }, [currentMode]);

  React.useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;
    const objects = canvas.getObjects();
    const img = objects.find((o: any) => o.type === "image");
    if (!img) return;

    img.filters = [];
    if (currentBrightness !== 0) {
      img.filters.push(new Fabric.Image.filters.Brightness({ brightness: currentBrightness / 100 }));
    }
    if (currentContrast !== 0) {
      img.filters.push(new Fabric.Image.filters.Contrast({ contrast: currentContrast / 100 }));
    }
    if (currentSaturation !== 0) {
      img.filters.push(new Fabric.Image.filters.Saturation({ saturation: currentSaturation / 100 }));
    }
    img.applyFilters();
    canvas.renderAll();
  }, [currentBrightness, currentContrast, currentSaturation]);

  const handleUpload = async () => {
    try {
      const result = await upload({ accept: "image/*" });
      if (result?.fileId) {
        setImageFileId(result.fileId);
        toast.success("Image uploaded successfully");
      }
    } catch {
      toast.error("Upload failed");
    }
  };

  React.useEffect(() => {
    if (!imageUrl || !imageFileId || !fabricRef.current) return;
    const canvas = fabricRef.current;
    Fabric.Image.fromURL(imageUrl, (img: any) => {
      canvas.clear();
      canvas.setBackgroundColor("#f8f8f8", () => {});
      const scale = Math.min(700 / img.width!, 450 / img.height!, 1);
      img.set({
        scaleX: scale,
        scaleY: scale,
        left: (700 - img.width! * scale) / 2,
        top: (450 - img.height! * scale) / 2,
        selectable: true,
      });
      canvas.add(img);
      canvas.renderAll();
    });
  }, [imageUrl, imageFileId]);

  const handleAddText = () => {
    const canvas = fabricRef.current;
    if (!canvas) return;
    const text = new Fabric.IText("Edit me", {
      left: 100,
      top: 100,
      fontSize: 24,
      fill: "#db2777",
      fontFamily: "Inter, sans-serif",
    });
    canvas.add(text);
    canvas.setActiveObject(text);
    canvas.renderAll();
    setMode("select");
  };

  const handleSave = async () => {
    const canvas = fabricRef.current;
    if (!canvas) return;
    try {
      const dataUrl = canvas.toDataURL({ format: "png", quality: 1, multiplier: 2 });
      await saveHandler?.({ imageData: dataUrl });
      toast.success("Image saved successfully");
    } catch {
      toast.error("Failed to save image");
    }
  };

  const handleDeleteSelected = () => {
    const canvas = fabricRef.current;
    if (!canvas) return;
    const active = canvas.getActiveObject();
    if (active) {
      canvas.remove(active);
      canvas.renderAll();
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-4">
        {/* Left Toolbar */}
        <Card className="w-14 shrink-0">
          <CardContent className="p-2 flex flex-col gap-2 items-center">
            <Toggle
              pressed={currentMode === "select"}
              onPressedChange={() => setMode("select")}
              size="sm"
              aria-label="Select"
            >
              <Icons.MousePointer className="h-4 w-4" />
            </Toggle>
            <Toggle
              pressed={currentMode === "draw"}
              onPressedChange={() => setMode("draw")}
              size="sm"
              aria-label="Draw"
            >
              <Icons.Pencil className="h-4 w-4" />
            </Toggle>
            <Toggle
              pressed={currentMode === "text"}
              onPressedChange={() => {
                setMode("text");
                handleAddText();
              }}
              size="sm"
              aria-label="Text"
            >
              <Icons.Type className="h-4 w-4" />
            </Toggle>
            <Separator />
            <Button size="icon" variant="ghost" onClick={handleDeleteSelected} className="h-8 w-8">
              <Icons.Trash2 className="h-4 w-4" />
            </Button>
          </CardContent>
        </Card>

        {/* Canvas */}
        <Card className="flex-1 overflow-hidden">
          <CardContent className="p-0 flex items-center justify-center bg-muted/30">
            <canvas ref={canvasRef} />
          </CardContent>
        </Card>

        {/* Right Panel - Filters */}
        <Card className="w-56 shrink-0">
          <CardContent className="p-4 space-y-5">
            <div className="text-sm font-semibold flex items-center gap-2">
              <Icons.SlidersHorizontal className="h-4 w-4" />
              Filters
            </div>
            <div className="space-y-2">
              <Label className="text-xs">Brightness: {currentBrightness}</Label>
              <Slider
                value={[currentBrightness]}
                min={-100}
                max={100}
                step={1}
                onValueChange={(v: number[]) => setBrightness(v[0])}
              />
            </div>
            <div className="space-y-2">
              <Label className="text-xs">Contrast: {currentContrast}</Label>
              <Slider
                value={[currentContrast]}
                min={-100}
                max={100}
                step={1}
                onValueChange={(v: number[]) => setContrast(v[0])}
              />
            </div>
            <div className="space-y-2">
              <Label className="text-xs">Saturation: {currentSaturation}</Label>
              <Slider
                value={[currentSaturation]}
                min={-100}
                max={100}
                step={1}
                onValueChange={(v: number[]) => setSaturation(v[0])}
              />
            </div>
            <Separator />
            <Button size="sm" className="w-full" onClick={handleUpload} disabled={isUploading}>
              <Icons.Upload className="h-4 w-4 mr-2" />
              {isUploading ? "Uploading..." : "Upload Image"}
            </Button>
            <Button size="sm" variant="outline" className="w-full" onClick={handleSave}>
              <Icons.Save className="h-4 w-4 mr-2" />
              Save
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default FabricImageEditor;
