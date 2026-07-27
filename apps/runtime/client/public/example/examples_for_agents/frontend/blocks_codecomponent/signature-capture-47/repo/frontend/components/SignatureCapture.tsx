import {
  React,
  useHandler,
  useAppState,
  useTheme,
  toast,
  RadioGroup,
  RadioGroupItem,
  Slider,
  Label,
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  Button,
  Separator,
  Icons,
  cn,
} from "@exepad/sdk";
import * as SignaturePadM from "@exepad/ext-signature";

// signature_pad is a vanilla JS class, resolve it from the module

function SignatureCapture() {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const submitHandler = useHandler("submitSignature");

  const [capturedSignature, setCapturedSignature] = useAppState<string | null>("signatureDataUrl", null);
  const [penColor, setPenColor] = useAppState<string>("signaturePenColor", "black");
  const [strokeWidth, setStrokeWidth] = useAppState<number>("signatureStrokeWidth", 2);
  const [confirmOpen, setConfirmOpen] = React.useState(false);

  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const sigPadInstanceRef = React.useRef<any>(null);
  const currentPenColor = penColor ?? "black";
  const currentStrokeWidth = strokeWidth ?? 2;

  const colorMap: Record<string, string> = {
    black: isDark ? "#e2e8f0" : "#1e293b",
    blue: "#2563eb",
    red: "#dc2626",
  };

  // Initialize SignaturePad instance on the canvas
  React.useEffect(() => {
    if (!canvasRef.current) return;
    const canvas = canvasRef.current;

    // Set canvas resolution
    canvas.width = 600;
    canvas.height = 200;

    const instance = new SignaturePadClass(canvas, {
      penColor: colorMap[currentPenColor] ?? colorMap.black,
      minWidth: currentStrokeWidth * 0.5,
      maxWidth: currentStrokeWidth * 1.5,
      backgroundColor: isDark ? "#0f172a" : "#ffffff",
    });

    sigPadInstanceRef.current = instance;

    // Fill background
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.fillStyle = isDark ? "#0f172a" : "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    return () => {
      instance.off();
      sigPadInstanceRef.current = null;
    };
  }, [isDark]);

  // Update pen settings when they change
  React.useEffect(() => {
    const instance = sigPadInstanceRef.current;
    if (!instance) return;
    instance.penColor = colorMap[currentPenColor] ?? colorMap.black;
    instance.minWidth = currentStrokeWidth * 0.5;
    instance.maxWidth = currentStrokeWidth * 1.5;
  }, [currentPenColor, currentStrokeWidth, isDark]);

  const handleClear = () => {
    const instance = sigPadInstanceRef.current;
    if (instance) {
      instance.clear();
      // Re-fill background after clear
      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.fillStyle = isDark ? "#0f172a" : "#ffffff";
          ctx.fillRect(0, 0, canvas.width, canvas.height);
        }
      }
    }
  };

  const handleUndo = () => {
    const instance = sigPadInstanceRef.current;
    if (instance) {
      const data = instance.toData();
      if (data && data.length > 0) {
        data.pop();
        instance.fromData(data);
      }
    }
  };

  const handleCapture = () => {
    const instance = sigPadInstanceRef.current;
    if (instance) {
      if (instance.isEmpty()) {
        toast.error("Please draw your signature first");
        return;
      }
      const dataUrl = instance.toDataURL("image/png");
      setCapturedSignature(dataUrl);
      toast.success("Signature captured");
    }
  };

  const handleSubmit = async () => {
    if (!capturedSignature) {
      toast.error("No signature captured");
      return;
    }
    try {
      await submitHandler?.({ signatureData: capturedSignature });
      toast.success("Signature submitted successfully");
      setConfirmOpen(false);
    } catch {
      toast.error("Failed to submit signature");
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Signature Pad Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Icons.PenTool className="h-5 w-5" />
            Signature Capture
          </CardTitle>
          <CardDescription>
            Draw your signature below using your mouse or touch input.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Pen Options */}
          <div className="flex flex-wrap items-end gap-6">
            <div className="space-y-2">
              <Label className="text-sm">Pen Color</Label>
              <RadioGroup
                value={currentPenColor}
                onValueChange={(val: string) => setPenColor(val)}
                className="flex gap-3"
              >
                <div className="flex items-center gap-1.5">
                  <RadioGroupItem value="black" id="color-black" />
                  <Label htmlFor="color-black" className="text-sm cursor-pointer">
                    <span className={cn("inline-block w-4 h-4 rounded-full border", isDark ? "bg-slate-200" : "bg-slate-800")} />
                  </Label>
                </div>
                <div className="flex items-center gap-1.5">
                  <RadioGroupItem value="blue" id="color-blue" />
                  <Label htmlFor="color-blue" className="text-sm cursor-pointer">
                    <span className="inline-block w-4 h-4 rounded-full bg-blue-600" />
                  </Label>
                </div>
                <div className="flex items-center gap-1.5">
                  <RadioGroupItem value="red" id="color-red" />
                  <Label htmlFor="color-red" className="text-sm cursor-pointer">
                    <span className="inline-block w-4 h-4 rounded-full bg-red-600" />
                  </Label>
                </div>
              </RadioGroup>
            </div>
            <div className="space-y-2 min-w-[160px]">
              <Label className="text-sm">Stroke Width: {currentStrokeWidth}px</Label>
              <Slider
                value={[currentStrokeWidth]}
                min={1}
                max={6}
                step={0.5}
                onValueChange={(val: number[]) => setStrokeWidth(val[0])}
              />
            </div>
          </div>

          {/* Signature Canvas */}
          <div
            className={cn(
              "border-2 border-dashed rounded-lg overflow-hidden",
              isDark ? "border-slate-600 bg-slate-900" : "border-slate-300 bg-white"
            )}
          >
            <canvas
              ref={canvasRef}
              style={{ width: "100%", height: "200px" }}
              className="w-full"
            />
          </div>

          {/* Action Buttons */}
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={handleClear}>
              <Icons.Eraser className="h-4 w-4 mr-1" />
              Clear
            </Button>
            <Button variant="outline" size="sm" onClick={handleUndo}>
              <Icons.Undo className="h-4 w-4 mr-1" />
              Undo
            </Button>
            <Button size="sm" onClick={handleCapture}>
              <Icons.Camera className="h-4 w-4 mr-1" />
              Capture
            </Button>
            <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
              <DialogTrigger asChild>
                <Button size="sm" variant="default" disabled={!capturedSignature}>
                  <Icons.Send className="h-4 w-4 mr-1" />
                  Submit
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Confirm Submission</DialogTitle>
                </DialogHeader>
                <p className="text-sm text-muted-foreground py-2">
                  Are you sure you want to submit this signature? This action cannot be undone.
                </p>
                {capturedSignature && (
                  <div className="border rounded-lg p-2 bg-muted/30">
                    <img
                      src={capturedSignature}
                      alt="Signature preview"
                      className="w-full h-auto max-h-24 object-contain"
                    />
                  </div>
                )}
                <DialogFooter>
                  <Button variant="outline" onClick={() => setConfirmOpen(false)}>
                    Cancel
                  </Button>
                  <Button onClick={handleSubmit}>
                    <Icons.Check className="h-4 w-4 mr-1" />
                    Confirm Submit
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </CardContent>
      </Card>

      <Separator />

      {/* Preview */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Icons.Image className="h-4 w-4" />
            Captured Signature Preview
          </CardTitle>
        </CardHeader>
        <CardContent>
          {capturedSignature ? (
            <div className={cn("border rounded-lg p-4", isDark ? "bg-slate-900" : "bg-slate-50")}>
              <img
                src={capturedSignature}
                alt="Captured signature"
                className="w-full h-auto max-h-32 object-contain"
              />
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              <Icons.FileSignature className="h-10 w-10 mx-auto mb-2 opacity-40" />
              <p className="text-sm">No signature captured yet. Draw and click Capture.</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default SignatureCapture;
