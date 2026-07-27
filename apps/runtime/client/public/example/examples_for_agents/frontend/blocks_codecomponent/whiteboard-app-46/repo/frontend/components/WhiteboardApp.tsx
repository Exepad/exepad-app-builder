import {
  React,
  useAppState,
  useTheme,
  useCurrentUser,
  toast,
  Button,
  Alert,
  AlertDescription,
  Card,
  Badge,
  Icons,
  cn,
} from "@exepad/sdk";
import * as ExcalidrawM from "@exepad/ext-excalidraw";
const Excalidraw: any = (ExcalidrawM as any).default ? { ...ExcalidrawM, ...(ExcalidrawM as any).default } : ExcalidrawM;
const excalidrawLoadError = !Excalidraw.Excalidraw || typeof Excalidraw.Excalidraw !== 'function';

interface WhiteboardState {
  elements: any[];
  appState: Record<string, any>;
}

function WhiteboardAppGuard() {
  if (excalidrawLoadError) {
    return (
      <Card>
        <div className="py-8 text-center text-muted-foreground">
          <Icons.PenTool className="h-8 w-8 mx-auto mb-2 opacity-40" />
          <p className="text-sm">Whiteboard requires the Excalidraw library (production mode)</p>
        </div>
      </Card>
    );
  }
  return <WhiteboardApp />;
}

function WhiteboardApp() {
  const { resolvedTheme } = useTheme();
  const currentUser = useCurrentUser();
  const isDark = resolvedTheme === "dark";

  const [savedState, setSavedState] = useAppState<WhiteboardState | null>("whiteboardState", null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = React.useState(false);
  const excalidrawRef = React.useRef<any>(null);
  const lastSavedRef = React.useRef<string>("");

  const handleChange = (elements: any[], appState: any) => {
    const serialized = JSON.stringify(elements);
    if (serialized !== lastSavedRef.current && elements.length > 0) {
      setHasUnsavedChanges(true);
    }
  };

  const handleSave = () => {
    const api = excalidrawRef.current;
    if (!api) return;
    const elements = api.getSceneElements();
    const appState = api.getAppState();
    const stateToSave: WhiteboardState = {
      elements: JSON.parse(JSON.stringify(elements)),
      appState: {
        viewBackgroundColor: appState.viewBackgroundColor,
        currentItemFontFamily: appState.currentItemFontFamily,
        zoom: appState.zoom,
        scrollX: appState.scrollX,
        scrollY: appState.scrollY,
      },
    };
    setSavedState(stateToSave);
    lastSavedRef.current = JSON.stringify(elements);
    setHasUnsavedChanges(false);
    toast.success("Whiteboard saved");
  };

  const handleShare = () => {
    const api = excalidrawRef.current;
    if (!api) return;
    try {
      const elements = api.getSceneElements();
      const data = JSON.stringify({ elements });
      navigator.clipboard.writeText(data);
      toast.success("Whiteboard data copied to clipboard");
    } catch {
      toast.error("Failed to copy whiteboard data");
    }
  };

  const initialData = React.useMemo(() => {
    if (savedState) {
      return {
        elements: savedState.elements,
        appState: {
          ...savedState.appState,
          theme: isDark ? "dark" : "light",
        },
      };
    }
    return {
      elements: [
        {
          type: "rectangle",
          x: 100,
          y: 100,
          width: 200,
          height: 100,
          backgroundColor: "#4f46e510",
          strokeColor: "#4f46e5",
          fillStyle: "solid",
          id: "demo-rect-1",
          version: 1,
          versionNonce: 1,
          isDeleted: false,
          boundElements: null,
          updated: Date.now(),
          link: null,
          locked: false,
        },
        {
          type: "ellipse",
          x: 400,
          y: 80,
          width: 150,
          height: 150,
          backgroundColor: "#818cf810",
          strokeColor: "#818cf8",
          fillStyle: "solid",
          id: "demo-ellipse-1",
          version: 1,
          versionNonce: 2,
          isDeleted: false,
          boundElements: null,
          updated: Date.now(),
          link: null,
          locked: false,
        },
        {
          type: "text",
          x: 130,
          y: 260,
          text: "Welcome to the Whiteboard!",
          fontSize: 20,
          fontFamily: 1,
          strokeColor: "#4f46e5",
          id: "demo-text-1",
          version: 1,
          versionNonce: 3,
          isDeleted: false,
          boundElements: null,
          updated: Date.now(),
          link: null,
          locked: false,
          width: 260,
          height: 25,
        },
      ],
      appState: {
        theme: isDark ? "dark" : "light",
        viewBackgroundColor: isDark ? "#0f0a20" : "#fafaff",
      },
    };
  }, [isDark, savedState]);

  return (
    <div className="space-y-4">
      {/* Top Bar */}
      <Card>
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <Icons.PenTool className="h-5 w-5 text-primary" />
            <span className="font-semibold">Whiteboard</span>
            {currentUser && (
              <Badge variant="secondary" className="text-xs">
                <Icons.User className="h-3 w-3 mr-1" />
                {currentUser.displayName || currentUser.email || "User"}
              </Badge>
            )}
            {hasUnsavedChanges && (
              <Badge variant="outline" className="text-xs text-yellow-600">
                Unsaved changes
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={handleSave}>
              <Icons.Save className="h-4 w-4 mr-1" />
              Save
            </Button>
            <Button size="sm" variant="outline" onClick={handleShare}>
              <Icons.Share2 className="h-4 w-4 mr-1" />
              Share
            </Button>
          </div>
        </div>
      </Card>

      {/* Unsaved Changes Alert */}
      {hasUnsavedChanges && (
        <Alert>
          <Icons.AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            You have unsaved changes. Click <strong>Save</strong> to persist your whiteboard.
          </AlertDescription>
        </Alert>
      )}

      {/* Excalidraw Canvas */}
      <Card className="overflow-hidden">
        <div style={{ height: 600, width: "100%" }}>
          <Excalidraw.Excalidraw
            ref={excalidrawRef}
            initialData={initialData}
            theme={isDark ? "dark" : "light"}
            onChange={handleChange}
            UIOptions={{
              canvasActions: {
                saveToActiveFile: false,
                loadScene: false,
                export: { saveFileToDisk: true },
              },
            }}
          />
        </div>
      </Card>
    </div>
  );
}

export default WhiteboardAppGuard;
