import {
  React,
  useFileUpload,
  useFileUrl,
  useArrayState,
  toast,
  Progress,
  AspectRatio,
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  ToggleGroup,
  ToggleGroupItem,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  Skeleton,
  Button,
  Badge,
  Icons,
  cn,
} from "@exepad/sdk";

interface GalleryImage {
  id: string;
  name: string;
  fileId: string;
  uploadedAt: number;
}

const DEMO_IMAGES: GalleryImage[] = [
  { id: "1", name: "Mountain Sunrise", fileId: "demo-1", uploadedAt: Date.now() - 86400000 },
  { id: "2", name: "Ocean Waves", fileId: "demo-2", uploadedAt: Date.now() - 172800000 },
  { id: "3", name: "Forest Trail", fileId: "demo-3", uploadedAt: Date.now() - 259200000 },
  { id: "4", name: "City Skyline", fileId: "demo-4", uploadedAt: Date.now() - 345600000 },
];

const PLACEHOLDER_COLORS = [
  "bg-pink-200 dark:bg-pink-900",
  "bg-purple-200 dark:bg-purple-900",
  "bg-blue-200 dark:bg-blue-900",
  "bg-teal-200 dark:bg-teal-900",
  "bg-amber-200 dark:bg-amber-900",
  "bg-rose-200 dark:bg-rose-900",
];

function ImageThumbnail({ image, index, onClick }: { image: GalleryImage; index: number; onClick: () => void }) {
  const [loaded, setLoaded] = React.useState(false);
  const [imgError, setImgError] = React.useState(false);
  const isDemo = image.fileId.startsWith("demo-");
  const fileUrl = useFileUrl(image.fileId);
  const colorClass = PLACEHOLDER_COLORS[index % PLACEHOLDER_COLORS.length];
  // Only use fileUrl for non-demo images that loaded without error
  const effectiveUrl = !isDemo && fileUrl && !imgError ? fileUrl : null;

  return (
    <div
      className="group relative cursor-pointer overflow-hidden rounded-lg border bg-muted transition-all hover:shadow-lg"
      onClick={onClick}
    >
      <AspectRatio ratio={1}>
        {!loaded && (
          <div className={cn("absolute inset-0 flex items-center justify-center", colorClass)}>
            <Icons.Image className="h-8 w-8 text-muted-foreground opacity-50" />
          </div>
        )}
        {effectiveUrl ? (
          <img
            src={effectiveUrl}
            alt={image.name}
            className={cn(
              "h-full w-full object-cover transition-transform group-hover:scale-105",
              loaded ? "opacity-100" : "opacity-0"
            )}
            onLoad={() => setLoaded(true)}
            onError={() => setImgError(true)}
          />
        ) : (
          <div className={cn("h-full w-full flex items-center justify-center", colorClass)}>
            <div className="text-center">
              <Icons.Image className="h-10 w-10 text-muted-foreground opacity-40 mx-auto" />
              <p className="text-xs text-muted-foreground mt-1 opacity-60">{image.name}</p>
            </div>
          </div>
        )}
      </AspectRatio>
      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent p-3 opacity-0 transition-opacity group-hover:opacity-100">
        <p className="text-sm font-medium text-white truncate">{image.name}</p>
      </div>
    </div>
  );
}

function ImageListItem({ image, index, onClick }: { image: GalleryImage; index: number; onClick: () => void }) {
  const colorClass = PLACEHOLDER_COLORS[index % PLACEHOLDER_COLORS.length];
  const date = new Date(image.uploadedAt).toLocaleDateString();

  return (
    <div
      className="flex items-center gap-4 p-3 rounded-lg border bg-card hover:bg-accent cursor-pointer transition-colors"
      onClick={onClick}
    >
      <div className={cn("h-12 w-12 rounded-md flex items-center justify-center shrink-0", colorClass)}>
        <Icons.Image className="h-5 w-5 text-muted-foreground opacity-60" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{image.name}</p>
        <p className="text-xs text-muted-foreground">{date}</p>
      </div>
      <Icons.ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
    </div>
  );
}

function ImageGallery() {
  const { items: images, push: addImage } = useArrayState<GalleryImage>("galleryImages", DEMO_IMAGES);
  const [viewMode, setViewMode] = React.useState<string>("grid");
  const [uploading, setUploading] = React.useState(false);
  const [uploadProgress, setUploadProgress] = React.useState(0);
  const [selectedImage, setSelectedImage] = React.useState<GalleryImage | null>(null);
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [isDragOver, setIsDragOver] = React.useState(false);

  const { upload } = useFileUpload();

  const simulateUpload = React.useCallback(
    async (file: File) => {
      setUploading(true);
      setUploadProgress(0);

      try {
        const result = await upload(file, {
          onProgress: (progress: number) => setUploadProgress(progress),
        });

        const newImage: GalleryImage = {
          id: String(Date.now()),
          name: file.name.replace(/\.[^/.]+$/, ""),
          fileId: result?.fileId || `uploaded-${Date.now()}`,
          uploadedAt: Date.now(),
        };

        addImage(newImage);
        toast("Image uploaded successfully");
      } catch {
        // Fallback: simulate the upload for demo purposes
        for (let p = 0; p <= 100; p += 10) {
          await new Promise((resolve) => setTimeout(resolve, 80));
          setUploadProgress(p);
        }

        const newImage: GalleryImage = {
          id: String(Date.now()),
          name: file.name.replace(/\.[^/.]+$/, ""),
          fileId: `demo-uploaded-${Date.now()}`,
          uploadedAt: Date.now(),
        };

        addImage(newImage);
        toast("Image uploaded successfully (demo)");
      } finally {
        setUploading(false);
        setUploadProgress(0);
      }
    },
    [upload, addImage]
  );

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) simulateUpload(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file && file.type.startsWith("image/")) {
      simulateUpload(file);
    } else {
      toast("Please drop an image file");
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = () => {
    setIsDragOver(false);
  };

  const openPreview = (image: GalleryImage) => {
    setSelectedImage(image);
    setDialogOpen(true);
  };

  const selectedColor = selectedImage
    ? PLACEHOLDER_COLORS[
        (images || []).findIndex((img: GalleryImage) => img.id === selectedImage.id) %
          PLACEHOLDER_COLORS.length
      ]
    : "";

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Upload Image</CardTitle>
          <CardDescription>Drag and drop an image or click to browse.</CardDescription>
        </CardHeader>
        <CardContent>
          <div
            className={cn(
              "relative flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-8 transition-colors",
              isDragOver
                ? "border-primary bg-primary/5"
                : "border-muted-foreground/25 hover:border-primary/50",
              uploading && "pointer-events-none opacity-60"
            )}
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
          >
            <Icons.Upload className="h-10 w-10 text-muted-foreground mb-3" />
            <p className="text-sm font-medium">Drop your image here</p>
            <p className="text-xs text-muted-foreground mt-1">PNG, JPG, GIF up to 10MB</p>
            <label className="mt-4">
              <Button variant="outline" size="sm" asChild>
                <span>
                  <Icons.FolderOpen className="mr-2 h-4 w-4" />
                  Browse Files
                </span>
              </Button>
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleFileChange}
              />
            </label>
          </div>

          {uploading && (
            <div className="mt-4 space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Uploading...</span>
                <span className="font-medium">{uploadProgress}%</span>
              </div>
              <Progress value={uploadProgress} className="h-2" />
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="text-lg font-semibold">Gallery</h3>
          <Badge variant="secondary" className="text-xs">
            {(images || []).length} images
          </Badge>
        </div>
        <ToggleGroup
          type="single"
          value={viewMode}
          onValueChange={(val: string) => val && setViewMode(val)}
        >
          <ToggleGroupItem value="grid" aria-label="Grid view">
            <Icons.LayoutGrid className="h-4 w-4" />
          </ToggleGroupItem>
          <ToggleGroupItem value="list" aria-label="List view">
            <Icons.List className="h-4 w-4" />
          </ToggleGroupItem>
        </ToggleGroup>
      </div>

      {(images || []).length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <Icons.ImageOff className="h-12 w-12 text-muted-foreground mb-3" />
          <p className="text-sm text-muted-foreground">No images yet. Upload one to get started.</p>
        </div>
      ) : viewMode === "grid" ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          {(images || []).map((image: GalleryImage, index: number) => (
            <ImageThumbnail
              key={image.id}
              image={image}
              index={index}
              onClick={() => openPreview(image)}
            />
          ))}
        </div>
      ) : (
        <div className="space-y-2">
          {(images || []).map((image: GalleryImage, index: number) => (
            <ImageListItem
              key={image.id}
              image={image}
              index={index}
              onClick={() => openPreview(image)}
            />
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{selectedImage?.name || "Image Preview"}</DialogTitle>
          </DialogHeader>
          <div className="mt-2">
            <AspectRatio ratio={16 / 9}>
              <div
                className={cn(
                  "h-full w-full rounded-md flex items-center justify-center",
                  selectedColor
                )}
              >
                <div className="text-center">
                  <Icons.Image className="h-16 w-16 text-muted-foreground opacity-40 mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground">{selectedImage?.name}</p>
                </div>
              </div>
            </AspectRatio>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default ImageGallery;
