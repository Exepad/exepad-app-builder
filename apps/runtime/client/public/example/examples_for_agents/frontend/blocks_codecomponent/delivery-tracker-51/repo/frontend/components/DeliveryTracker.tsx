import {
  React,
  useModel,
  useHandler,
  useAppState,
  useTheme,
  Sheet,
  SheetTrigger,
  SheetContent,
  SheetHeader,
  SheetTitle,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Progress,
  Badge,
  Button,
  Avatar,
  AvatarFallback,
  Icons,
  cn,
} from "@exepad/sdk";
import * as LeafletModule from "@exepad/ext-leaflet";
// esm.sh may export react-leaflet components on default or as named exports
// Default must come last so react-leaflet components take priority

// Helper: create a divIcon safely. If the raw Leaflet L.divIcon is not available
// (esm.sh only ships react-leaflet, not the raw leaflet package), return undefined
// so <Marker> falls back to its default icon.
const safeDivIcon = (opts: { className?: string; html: string; iconSize: [number, number]; iconAnchor: [number, number] }) => {
  try {
    if (typeof Leaflet.divIcon === "function") {
      return Leaflet.divIcon(opts);
    }
    // Try accessing L from the global scope (leaflet may be loaded as a peer)
    if (typeof (globalThis as any).L?.divIcon === "function") {
      return (globalThis as any).L.divIcon(opts);
    }
  } catch {}
  return undefined; // Marker will use its default icon
};

interface Delivery {
  id: string;
  driverName: string;
  driverInitials: string;
  vehicle: string;
  status: "in_transit" | "arriving" | "delivered";
  progress: number;
  eta: string;
  origin: { name: string; lat: number; lng: number };
  destination: { name: string; lat: number; lng: number };
  currentPos: { lat: number; lng: number };
  orderId: string;
  items: number;
}

const DEMO_DELIVERIES: Delivery[] = [
  {
    id: "d1",
    driverName: "Alex Rivera",
    driverInitials: "AR",
    vehicle: "Van #102",
    status: "in_transit",
    progress: 65,
    eta: "12 min",
    origin: { name: "Warehouse A", lat: 37.7749, lng: -122.4194 },
    destination: { name: "123 Market St", lat: 37.7935, lng: -122.3964 },
    currentPos: { lat: 37.7842, lng: -122.4079 },
    orderId: "ORD-7821",
    items: 3,
  },
  {
    id: "d2",
    driverName: "Maria Chen",
    driverInitials: "MC",
    vehicle: "Bike #45",
    status: "arriving",
    progress: 90,
    eta: "3 min",
    origin: { name: "Hub B", lat: 37.7855, lng: -122.4094 },
    destination: { name: "456 Valencia St", lat: 37.7649, lng: -122.4214 },
    currentPos: { lat: 37.7670, lng: -122.4200 },
    orderId: "ORD-7822",
    items: 1,
  },
  {
    id: "d3",
    driverName: "James Park",
    driverInitials: "JP",
    vehicle: "Van #108",
    status: "in_transit",
    progress: 35,
    eta: "28 min",
    origin: { name: "Warehouse C", lat: 37.7600, lng: -122.4350 },
    destination: { name: "789 Geary Blvd", lat: 37.7862, lng: -122.4137 },
    currentPos: { lat: 37.7710, lng: -122.4260 },
    orderId: "ORD-7823",
    items: 5,
  },
];

const statusConfig: Record<string, { label: string; variant: "default" | "secondary" | "outline" }> = {
  in_transit: { label: "In Transit", variant: "default" },
  arriving: { label: "Arriving", variant: "secondary" },
  delivered: { label: "Delivered", variant: "outline" },
};

function DeliveryTracker() {
  const { resolvedTheme } = useTheme();
  const [selectedId, setSelectedId] = useAppState<string | null>("selectedDelivery", null);
  const deliveries = useModel("deliveries", DEMO_DELIVERIES);
  const updatePosition = useHandler("updatePosition");

  const selected = DEMO_DELIVERIES.find((d) => d.id === selectedId);
  const routeColor = resolvedTheme === "dark" ? "#60a5fa" : "#2563eb";
  const originColor = resolvedTheme === "dark" ? "#4ade80" : "#16a34a";
  const destColor = resolvedTheme === "dark" ? "#f87171" : "#ef4444";

  const tileUrl =
    resolvedTheme === "dark"
      ? "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
      : "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";

  const createIcon = (color: string) =>
    safeDivIcon({
      className: "custom-marker",
      html: `<div style="width:14px;height:14px;border-radius:50%;background:${color};border:2px solid white;box-shadow:0 1px 4px rgba(0,0,0,0.3);"></div>`,
      iconSize: [14, 14],
      iconAnchor: [7, 7],
    });

  const driverIcon = safeDivIcon({
    className: "driver-marker",
    html: `<div style="width:20px;height:20px;border-radius:50%;background:${routeColor};border:3px solid white;box-shadow:0 2px 6px rgba(0,0,0,0.4);display:flex;align-items:center;justify-content:center;">
      <svg width="10" height="10" viewBox="0 0 24 24" fill="white"><path d="M12 2L19 21H5L12 2Z"/></svg>
    </div>`,
    iconSize: [20, 20],
    iconAnchor: [10, 10],
  });

  // Guard: if MapContainer is not available, show a graceful fallback
  if (!Leaflet.MapContainer) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-muted-foreground">
          Leaflet map requires the full react-leaflet bundle (production mode).
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="relative h-[600px] rounded-lg overflow-hidden border">
      <Leaflet.MapContainer
        center={[37.7799, -122.4194]}
        zoom={13}
        style={{ width: "100%", height: "100%" }}
        zoomControl={false}
      >
        <Leaflet.TileLayer url={tileUrl} />
        <Leaflet.ZoomControl position="topright" />

        {DEMO_DELIVERIES.map((delivery) => (
          <React.Fragment key={delivery.id}>
            <Leaflet.Polyline
              positions={[
                [delivery.origin.lat, delivery.origin.lng],
                [delivery.currentPos.lat, delivery.currentPos.lng],
                [delivery.destination.lat, delivery.destination.lng],
              ]}
              pathOptions={{
                color: selectedId === delivery.id ? routeColor : `${routeColor}66`,
                weight: selectedId === delivery.id ? 4 : 2,
                dashArray: selectedId === delivery.id ? undefined : "8 4",
              }}
            />

            <Leaflet.Marker
              position={[delivery.origin.lat, delivery.origin.lng]}
              {...(createIcon(originColor) ? { icon: createIcon(originColor) } : {})}
            >
              <Leaflet.Popup>
                <div className="text-xs">
                  <p className="font-semibold">Origin</p>
                  <p>{delivery.origin.name}</p>
                </div>
              </Leaflet.Popup>
            </Leaflet.Marker>

            <Leaflet.Marker
              position={[delivery.destination.lat, delivery.destination.lng]}
              {...(createIcon(destColor) ? { icon: createIcon(destColor) } : {})}
            >
              <Leaflet.Popup>
                <div className="text-xs">
                  <p className="font-semibold">Destination</p>
                  <p>{delivery.destination.name}</p>
                </div>
              </Leaflet.Popup>
            </Leaflet.Marker>

            <Leaflet.Marker
              position={[delivery.currentPos.lat, delivery.currentPos.lng]}
              {...(driverIcon ? { icon: driverIcon } : {})}
              eventHandlers={{ click: () => setSelectedId(delivery.id) }}
            >
              <Leaflet.Popup>
                <div className="text-xs space-y-1">
                  <p className="font-semibold">{delivery.driverName}</p>
                  <p>{delivery.vehicle}</p>
                  <p>ETA: {delivery.eta}</p>
                </div>
              </Leaflet.Popup>
            </Leaflet.Marker>
          </React.Fragment>
        ))}
      </Leaflet.MapContainer>

      {selected && (
        <div className="absolute top-4 left-4 z-[1000]">
          <Card className="w-72 shadow-lg bg-background/95 backdrop-blur-sm">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm">Delivery Details</CardTitle>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0"
                  onClick={() => setSelectedId(null)}
                >
                  <Icons.X className="h-4 w-4" />
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center gap-3">
                <Avatar className="h-9 w-9">
                  <AvatarFallback className="text-xs bg-primary/10 text-primary">
                    {selected.driverInitials}
                  </AvatarFallback>
                </Avatar>
                <div>
                  <p className="text-sm font-medium">{selected.driverName}</p>
                  <p className="text-xs text-muted-foreground">{selected.vehicle}</p>
                </div>
              </div>

              <div className="flex items-center justify-between">
                <Badge variant={statusConfig[selected.status].variant}>
                  {statusConfig[selected.status].label}
                </Badge>
                <span className="text-xs font-medium">ETA: {selected.eta}</span>
              </div>

              <div className="space-y-1.5">
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">Progress</span>
                  <span className="font-medium">{selected.progress}%</span>
                </div>
                <Progress value={selected.progress} className="h-2" />
              </div>

              <div className="text-xs space-y-1 pt-1 border-t">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Order</span>
                  <span className="font-mono">{selected.orderId}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Items</span>
                  <span>{selected.items} packages</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">To</span>
                  <span>{selected.destination.name}</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      <div className="absolute bottom-4 right-4 z-[1000]">
        <Sheet>
          <SheetTrigger asChild>
            <Button className="shadow-lg">
              <Icons.List className="h-4 w-4 mr-2" />
              All Deliveries ({DEMO_DELIVERIES.length})
            </Button>
          </SheetTrigger>
          <SheetContent side="bottom" className="h-[40vh]">
            <SheetHeader>
              <SheetTitle>Active Deliveries</SheetTitle>
            </SheetHeader>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
              {DEMO_DELIVERIES.map((d) => (
                <Card
                  key={d.id}
                  className={cn(
                    "cursor-pointer transition-shadow hover:shadow-md",
                    selectedId === d.id && "ring-2 ring-primary"
                  )}
                  onClick={() => setSelectedId(d.id)}
                >
                  <CardContent className="p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Avatar className="h-8 w-8">
                          <AvatarFallback className="text-xs">
                            {d.driverInitials}
                          </AvatarFallback>
                        </Avatar>
                        <div>
                          <p className="text-sm font-medium">{d.driverName}</p>
                          <p className="text-xs text-muted-foreground">{d.vehicle}</p>
                        </div>
                      </div>
                      <Badge variant={statusConfig[d.status].variant}>
                        {statusConfig[d.status].label}
                      </Badge>
                    </div>
                    <Progress value={d.progress} className="h-1.5" />
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>{d.orderId}</span>
                      <span>ETA: {d.eta}</span>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </div>
  );
}

export default DeliveryTracker;
