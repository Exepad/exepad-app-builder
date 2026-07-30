import {
  React,
  useAppState,
  useTheme,
  toast,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  RadioGroup,
  RadioGroupItem,
  Slider,
  Label,
  Card,
  CardContent,
  Button,
  Icons,
  cn,
} from "@exepad/sdk";
import * as Three from "@exepad/ext-three";

const MATERIAL_PRESETS: Record<string, { roughness: number; metalness: number; clearcoat: number }> = {
  metallic: { roughness: 0.1, metalness: 0.9, clearcoat: 0.8 },
  matte: { roughness: 0.9, metalness: 0.0, clearcoat: 0.0 },
  glass: { roughness: 0.05, metalness: 0.1, clearcoat: 1.0 },
};

const PRODUCT_COLORS: { value: string; hex: string; label: string }[] = [
  { value: "silver", hex: "#c0c0c0", label: "Silver" },
  { value: "midnight", hex: "#1e293b", label: "Midnight" },
  { value: "rose", hex: "#e11d48", label: "Rose" },
  { value: "ocean", hex: "#0891b2", label: "Ocean" },
  { value: "forest", hex: "#16a34a", label: "Forest" },
  { value: "gold", hex: "#d97706", label: "Gold" },
];

function ProductViewer3D() {
  const { resolvedTheme } = useTheme();
  const canvasRef = React.useRef<HTMLDivElement>(null);
  const rendererRef = React.useRef<Three.WebGLRenderer | null>(null);
  const sceneRef = React.useRef<Three.Scene | null>(null);
  const cameraRef = React.useRef<Three.PerspectiveCamera | null>(null);
  const controlsRef = React.useRef<{ update: () => void; dispose: () => void } | null>(null);
  const meshGroupRef = React.useRef<Three.Group | null>(null);
  const frameRef = React.useRef<number>(0);

  const [materialType, setMaterialType] = useAppState<string>("materialType", "metallic");
  const [productColor, setProductColor] = useAppState<string>("productColor", "silver");
  const [lightIntensity, setLightIntensity] = useAppState<number[]>("lightIntensity", [1.5]);

  const directionalLightRef = React.useRef<Three.DirectionalLight | null>(null);

  React.useEffect(() => {
    if (!canvasRef.current) return;

    const container = canvasRef.current;
    const width = container.clientWidth;
    const height = container.clientHeight;

    const scene = new Three.Scene();
    sceneRef.current = scene;

    const bgColor = resolvedTheme === "dark" ? 0x1e293b : 0xf1f5f9;
    scene.background = new Three.Color(bgColor);

    const camera = new Three.PerspectiveCamera(45, width / height, 0.1, 1000);
    camera.position.set(4, 3, 5);
    cameraRef.current = camera;

    const renderer = new Three.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.shadowMap.enabled = true;
    renderer.toneMapping = Three.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // Simple orbit controls (OrbitControls is in three/addons, not main package)
    let isDragging = false;
    let prevX = 0;
    let prevY = 0;
    let spherical = { theta: Math.atan2(camera.position.x, camera.position.z), phi: Math.acos(camera.position.y / camera.position.length()), radius: camera.position.length() };
    const target = new Three.Vector3(0, 0.5, 0);

    const updateCameraFromSpherical = () => {
      const { theta, phi, radius } = spherical;
      camera.position.set(
        radius * Math.sin(phi) * Math.sin(theta) + target.x,
        radius * Math.cos(phi) + target.y,
        radius * Math.sin(phi) * Math.cos(theta) + target.z
      );
      camera.lookAt(target);
    };

    const onPointerDown = (e: PointerEvent) => { isDragging = true; prevX = e.clientX; prevY = e.clientY; };
    const onPointerUp = () => { isDragging = false; };
    const onPointerMove = (e: PointerEvent) => {
      if (!isDragging) return;
      const dx = e.clientX - prevX;
      const dy = e.clientY - prevY;
      prevX = e.clientX;
      prevY = e.clientY;
      spherical.theta -= dx * 0.01;
      spherical.phi = Math.max(0.2, Math.min(Math.PI - 0.2, spherical.phi + dy * 0.01));
      updateCameraFromSpherical();
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      spherical.radius = Math.max(3, Math.min(12, spherical.radius + e.deltaY * 0.01));
      updateCameraFromSpherical();
    };

    const el = renderer.domElement;
    el.addEventListener("pointerdown", onPointerDown);
    el.addEventListener("pointerup", onPointerUp);
    el.addEventListener("pointermove", onPointerMove);
    el.addEventListener("wheel", onWheel, { passive: false });

    const controls = {
      update: () => {},
      dispose: () => {
        el.removeEventListener("pointerdown", onPointerDown);
        el.removeEventListener("pointerup", onPointerUp);
        el.removeEventListener("pointermove", onPointerMove);
        el.removeEventListener("wheel", onWheel);
      },
    };
    controlsRef.current = controls;

    const ambientLight = new Three.AmbientLight(0xffffff, 0.4);
    scene.add(ambientLight);

    const dirLight = new Three.DirectionalLight(0xffffff, 1.5);
    dirLight.position.set(5, 8, 5);
    dirLight.castShadow = true;
    scene.add(dirLight);
    directionalLightRef.current = dirLight;

    const fillLight = new Three.DirectionalLight(0xffffff, 0.3);
    fillLight.position.set(-3, 2, -3);
    scene.add(fillLight);

    const group = new Three.Group();
    meshGroupRef.current = group;

    const colorHex = PRODUCT_COLORS.find((c) => c.value === "silver")?.hex || "#c0c0c0";
    const preset = MATERIAL_PRESETS["metallic"];
    const material = new Three.MeshPhysicalMaterial({
      color: new Three.Color(colorHex),
      roughness: preset.roughness,
      metalness: preset.metalness,
      clearcoat: preset.clearcoat,
    });

    const bodyGeom = new Three.BoxGeometry(2, 0.3, 3);
    const body = new Three.Mesh(bodyGeom, material);
    body.position.y = 0.5;
    body.castShadow = true;
    group.add(body);

    const topGeom = new Three.BoxGeometry(1.8, 0.05, 2.6);
    const screenMat = new Three.MeshPhysicalMaterial({
      color: new Three.Color(0x111827),
      roughness: 0.05,
      metalness: 0.1,
      clearcoat: 1.0,
    });
    const top = new Three.Mesh(topGeom, screenMat);
    top.position.set(0, 0.68, 0);
    group.add(top);

    const sphereGeom = new Three.SphereGeometry(0.15, 32, 32);
    const accentMat = material.clone();
    const cornerPositions = [
      [-0.7, 0.5, -1.2],
      [0.7, 0.5, -1.2],
      [-0.7, 0.5, 1.2],
      [0.7, 0.5, 1.2],
    ];
    cornerPositions.forEach(([x, y, z]) => {
      const sphere = new Three.Mesh(sphereGeom, accentMat);
      sphere.position.set(x, y, z);
      sphere.castShadow = true;
      group.add(sphere);
    });

    const standGeom = new Three.CylinderGeometry(0.3, 0.5, 0.35, 32);
    const stand = new Three.Mesh(standGeom, material.clone());
    stand.position.y = 0.17;
    stand.castShadow = true;
    group.add(stand);

    scene.add(group);

    const floorGeom = new Three.PlaneGeometry(20, 20);
    const floorMat = new Three.MeshStandardMaterial({
      color: new Three.Color(resolvedTheme === "dark" ? 0x0f172a : 0xe2e8f0),
      roughness: 0.8,
    });
    const floor = new Three.Mesh(floorGeom, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);

    const animate = () => {
      frameRef.current = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    const handleResize = () => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener("resize", handleResize);

    return () => {
      cancelAnimationFrame(frameRef.current);
      window.removeEventListener("resize", handleResize);
      controls.dispose();
      renderer.dispose();
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
    };
  }, [resolvedTheme]);

  React.useEffect(() => {
    if (!meshGroupRef.current) return;
    const colorHex = PRODUCT_COLORS.find((c) => c.value === productColor)?.hex || "#c0c0c0";
    const preset = MATERIAL_PRESETS[materialType] || MATERIAL_PRESETS.metallic;

    meshGroupRef.current.children.forEach((child) => {
      if (child instanceof Three.Mesh && child.material instanceof Three.MeshPhysicalMaterial) {
        if (child.material.color.getHex() !== 0x111827) {
          child.material.color.set(colorHex);
          child.material.roughness = preset.roughness;
          child.material.metalness = preset.metalness;
          child.material.clearcoat = preset.clearcoat;
          child.material.needsUpdate = true;
        }
      }
    });
  }, [productColor, materialType]);

  React.useEffect(() => {
    if (directionalLightRef.current) {
      directionalLightRef.current.intensity = (lightIntensity ?? [1.5])[0];
    }
  }, [lightIntensity]);

  const handleScreenshot = () => {
    if (!rendererRef.current) return;
    const dataUrl = rendererRef.current.domElement.toDataURL("image/png");
    const link = document.createElement("a");
    link.download = "product-3d-screenshot.png";
    link.href = dataUrl;
    link.click();
    toast("Screenshot saved!");
  };

  return (
    <div className="flex flex-col lg:flex-row gap-4 h-[600px]">
      <div
        ref={canvasRef}
        className="flex-1 rounded-lg overflow-hidden border bg-muted min-h-[400px]"
      />

      <Card className="w-full lg:w-72 shrink-0">
        <CardContent className="p-4 space-y-6">
          <div className="space-y-2">
            <Label className="text-sm font-medium">Material</Label>
            <Select value={materialType} onValueChange={(v) => setMaterialType(v)}>
              <SelectTrigger>
                <SelectValue placeholder="Select material" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="metallic">Metallic</SelectItem>
                <SelectItem value="matte">Matte</SelectItem>
                <SelectItem value="glass">Glass</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-3">
            <Label className="text-sm font-medium">Color</Label>
            <RadioGroup
              value={productColor}
              onValueChange={(v) => setProductColor(v)}
              className="grid grid-cols-3 gap-2"
            >
              {PRODUCT_COLORS.map((c) => (
                <div key={c.value} className="flex flex-col items-center gap-1">
                  <RadioGroupItem
                    value={c.value}
                    id={`color-${c.value}`}
                    className="sr-only"
                  />
                  <Label
                    htmlFor={`color-${c.value}`}
                    className={cn(
                      "w-8 h-8 rounded-full cursor-pointer border-2 transition-all",
                      productColor === c.value
                        ? "border-primary ring-2 ring-primary/30 scale-110"
                        : "border-border hover:scale-105"
                    )}
                    style={{ backgroundColor: c.hex }}
                  />
                  <span className="text-[10px] text-muted-foreground">{c.label}</span>
                </div>
              ))}
            </RadioGroup>
          </div>

          <div className="space-y-2">
            <div className="flex justify-between">
              <Label className="text-sm font-medium">Light Intensity</Label>
              <span className="text-xs text-muted-foreground">
                {((lightIntensity ?? [1.5])[0]).toFixed(1)}
              </span>
            </div>
            <Slider
              value={lightIntensity ?? [1.5]}
              onValueChange={(v) => setLightIntensity(v)}
              min={0.2}
              max={3.0}
              step={0.1}
            />
          </div>

          <Button onClick={handleScreenshot} variant="outline" className="w-full">
            <Icons.Camera className="h-4 w-4 mr-2" />
            Take Screenshot
          </Button>

          <div className="text-xs text-muted-foreground space-y-1 pt-2 border-t">
            <p className="flex items-center gap-1">
              <Icons.Move className="h-3 w-3" /> Drag to rotate
            </p>
            <p className="flex items-center gap-1">
              <Icons.ZoomIn className="h-3 w-3" /> Scroll to zoom
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default ProductViewer3D;
