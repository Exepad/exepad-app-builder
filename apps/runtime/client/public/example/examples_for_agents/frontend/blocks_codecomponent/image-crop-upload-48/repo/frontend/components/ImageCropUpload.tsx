import {
  React,
  useFileUpload,
  useHandler,
  useAppState,
  toast,
  RadioGroup,
  RadioGroupItem,
  Slider,
  Label,
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
import * as Cropper from "@exepad/ext-cropper";


const ASPECT_RATIOS: { label: string; value: number | undefined }[] = [
  { label: "Free", value: undefined },
  { label: "1:1", value: 1 },
  { label: "16:9", value: 16 / 9 },
  { label: "4:3", value: 4 / 3 },
];

const DEMO_IMAGE =
  "data:image/svg+xml;base64," +
  btoa(
    '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600">' +
      '<defs><linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">' +
      '<stop offset="0%" style="stop-color:#8b5cf6"/>' +
      '<stop offset="50%" style="stop-color:#ec4899"/>' +
      '<stop offset="100%" style="stop-color:#f97316"/>' +
      "</linearGradient></defs>" +
      '<rect width="800" height="600" fill="url(#g)"/>' +
      '<text x="400" y="280" text-anchor="middle" fill="white" font-size="36" font-family="sans-serif">Sample Image</text>' +
      '<text x="400" y="330" text-anchor="middle" fill="rgba(255,255,255,0.7)" font-size="18" font-family="sans-serif">800 x 600</text>' +
      "</svg>"
  );

function ImageCropUpload() {
  const { resolvedTheme } = useAppState<string>("theme", "light");
  const uploadFile = useFileUpload();
  const saveHandler = useHandler("saveCroppedImage");

  const [aspectIndex, setAspectIndex] = useAppState<number>("cropAspectIndex", 0);
  const [zoom, setZoom] = useAppState<number>("cropZoom", 1);
  const [rotation, setRotation] = useAppState<number>("cropRotation", 0);
  const [croppedPreview, setCroppedPreview] = useAppState<string | null>("croppedPreview", null);

  const cropperRef = React.useRef<any>(null);
  const [cropperReady, setCropperReady] = React.useState(false);

  const currentAspect = ASPECT_RATIOS[aspectIndex ?? 0];
  const currentZoom = zoom ?? 1;
  const currentRotation = rotation ?? 0;

  const handleCropperReady = () => {
    setCropperReady(true);
    if (cropperRef.current?.cropper) {
      cropperRef.current.cropper.zoomTo(currentZoom);
    }
  };

  React.useEffect(() => {
    if (cropperReady && cropperRef.current?.cropper) {
      cropperRef.current.cropper.zoomTo(currentZoom);
    }
  }, [currentZoom, cropperReady]);

  const handleRotate = (degrees: number) => {
    setRotation(currentRotation + degrees);
  };

  const handleCrop = () => {
    if (cropperRef.current) {
      const cropper = cropperRef.current.cropper;
      if (cropper) {
        const canvas = cropper.getCroppedCanvas({ maxWidth: 1024, maxHeight: 1024 });
        if (canvas) {
          const dataUrl = canvas.toDataURL("image/png");
          setCroppedPreview(dataUrl);
          toast.success("Image cropped successfully");
        }
      }
    }
  };

  const handleUpload = async () => {
    if (!croppedPreview) {
      toast.error("Please crop an image first");
      return;
    }
    try {
      const response = await fetch(croppedPreview);
      const blob = await response.blob();
      const file = new File([blob], "cropped-image.png", { type: "image/png" });
      await uploadFile?.(file);
      toast.success("Image uploaded successfully");
    } catch {
      toast.error("Upload failed");
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Cropper Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Icons.Crop className="h-5 w-5" />
            Image Crop Tool
          </CardTitle>
          <CardDescription>
            Adjust the crop area, zoom, and rotation, then click Crop to preview.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Aspect Ratio */}
          <div className="space-y-2">
            <Label className="text-sm">Aspect Ratio</Label>
            <RadioGroup
              value={String(aspectIndex ?? 0)}
              onValueChange={(val: string) => setAspectIndex(Number(val))}
              className="flex gap-3"
            >
              {ASPECT_RATIOS.map((ar, idx) => (
                <div key={idx} className="flex items-center gap-1.5">
                  <RadioGroupItem value={String(idx)} id={`aspect-${idx}`} />
                  <Label htmlFor={`aspect-${idx}`} className="text-sm cursor-pointer">
                    {ar.label}
                  </Label>
                </div>
              ))}
            </RadioGroup>
          </div>

          {/* Zoom Slider */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-sm">Zoom</Label>
              <Badge variant="secondary" className="text-xs">
                {currentZoom.toFixed(1)}x
              </Badge>
            </div>
            <Slider
              value={[currentZoom]}
              min={0.5}
              max={3}
              step={0.1}
              onValueChange={(val: number[]) => setZoom(val[0])}
            />
          </div>

          {/* Rotate Buttons */}
          <div className="flex items-center gap-2">
            <Label className="text-sm mr-2">Rotate</Label>
            <Button variant="outline" size="sm" onClick={() => handleRotate(-90)}>
              <Icons.RotateCcw className="h-4 w-4 mr-1" />
              -90
            </Button>
            <Button variant="outline" size="sm" onClick={() => handleRotate(-15)}>
              -15
            </Button>
            <Button variant="outline" size="sm" onClick={() => handleRotate(15)}>
              +15
            </Button>
            <Button variant="outline" size="sm" onClick={() => handleRotate(90)}>
              <Icons.RotateCw className="h-4 w-4 mr-1" />
              +90
            </Button>
            <Badge variant="outline" className="ml-2">{currentRotation}deg</Badge>
          </div>

          {/* Cropper Canvas */}
          <div className="border rounded-lg overflow-hidden bg-muted/30">
            <CropperComponent
              ref={cropperRef}
              src={DEMO_IMAGE}
              style={{ height: 400, width: "100%" }}
              aspectRatio={currentAspect.value}
              rotateTo={currentRotation}
              viewMode={1}
              guides={true}
              background={true}
              responsive={true}
              autoCropArea={0.8}
              ready={handleCropperReady}
            />
          </div>

          {/* Action Buttons */}
          <div className="flex gap-2">
            <Button onClick={handleCrop}>
              <Icons.Crop className="h-4 w-4 mr-1" />
              Crop
            </Button>
            <Button variant="outline" onClick={handleUpload} disabled={!croppedPreview}>
              <Icons.Upload className="h-4 w-4 mr-1" />
              Upload
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Before / After Preview */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Icons.Image className="h-4 w-4" />
              Before (Original)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="border rounded-lg overflow-hidden bg-muted/30">
              <img src={DEMO_IMAGE} alt="Original" className="w-full h-auto max-h-48 object-contain" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Icons.Crop className="h-4 w-4" />
              After (Cropped)
            </CardTitle>
          </CardHeader>
          <CardContent>
            {croppedPreview ? (
              <div className="border rounded-lg overflow-hidden bg-muted/30">
                <img src={croppedPreview} alt="Cropped" className="w-full h-auto max-h-48 object-contain" />
              </div>
            ) : (
              <div className="border rounded-lg h-48 flex items-center justify-center bg-muted/30 text-muted-foreground">
                <div className="text-center">
                  <Icons.ImageOff className="h-8 w-8 mx-auto mb-2 opacity-40" />
                  <p className="text-sm">No cropped image yet</p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default ImageCropUpload;
