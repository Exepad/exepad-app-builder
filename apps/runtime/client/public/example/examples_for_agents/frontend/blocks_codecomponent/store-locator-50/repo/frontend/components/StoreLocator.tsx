import {
  React,
  useHandler,
  useAppState,
  useTheme,
  ScrollArea,
  Item,
  ItemContent,
  ItemTitle,
  ItemDescription,
  ToggleGroup,
  ToggleGroupItem,
  Input,
  Card,
  CardContent,
  Badge,
  Button,
  Icons,
  cn,
} from "@exepad/sdk";
import * as Mapbox from "@exepad/ext-mapbox";

interface Store {
  id: string;
  name: string;
  address: string;
  city: string;
  phone: string;
  hours: string;
  lng: number;
  lat: number;
  category: string;
}

const DEMO_STORES: Store[] = [
  { id: "s1", name: "Downtown Flagship", address: "123 Main St", city: "San Francisco, CA", phone: "(415) 555-0101", hours: "9am–9pm", lng: -122.4194, lat: 37.7749, category: "Flagship" },
  { id: "s2", name: "Marina District", address: "2200 Chestnut St", city: "San Francisco, CA", phone: "(415) 555-0102", hours: "10am–8pm", lng: -122.4374, lat: 37.8004, category: "Standard" },
  { id: "s3", name: "Mission Bay", address: "500 Terry Francois Blvd", city: "San Francisco, CA", phone: "(415) 555-0103", hours: "10am–7pm", lng: -122.3894, lat: 37.7699, category: "Express" },
  { id: "s4", name: "Castro Store", address: "400 Castro St", city: "San Francisco, CA", phone: "(415) 555-0104", hours: "10am–8pm", lng: -122.4350, lat: 37.7621, category: "Standard" },
  { id: "s5", name: "Hayes Valley", address: "550 Hayes St", city: "San Francisco, CA", phone: "(415) 555-0105", hours: "9am–9pm", lng: -122.4244, lat: 37.7764, category: "Standard" },
  { id: "s6", name: "Sunset Outlet", address: "1800 Irving St", city: "San Francisco, CA", phone: "(415) 555-0106", hours: "10am–6pm", lng: -122.4780, lat: 37.7635, category: "Express" },
  { id: "s7", name: "North Beach", address: "700 Columbus Ave", city: "San Francisco, CA", phone: "(415) 555-0107", hours: "10am–8pm", lng: -122.4098, lat: 37.8005, category: "Standard" },
  { id: "s8", name: "SoMa Warehouse", address: "888 Brannan St", city: "San Francisco, CA", phone: "(415) 555-0108", hours: "9am–10pm", lng: -122.4050, lat: 37.7720, category: "Flagship" },
  { id: "s9", name: "Nob Hill", address: "1200 California St", city: "San Francisco, CA", phone: "(415) 555-0109", hours: "10am–7pm", lng: -122.4137, lat: 37.7912, category: "Express" },
  { id: "s10", name: "Embarcadero Center", address: "4 Embarcadero Center", city: "San Francisco, CA", phone: "(415) 555-0110", hours: "8am–9pm", lng: -122.3990, lat: 37.7952, category: "Flagship" },
];

function StoreLocator() {
  const { resolvedTheme } = useTheme();
  const [selectedId, setSelectedId] = useAppState<string | null>("selectedStore", null);
  const [mapStyle, setMapStyle] = useAppState<string>("mapStyle", "streets");
  const [searchQuery, setSearchQuery] = useAppState<string>("storeSearch", "");
  const [popupStore, setPopupStore] = React.useState<Store | null>(null);
  const [viewport, setViewport] = useAppState("viewport", {
    longitude: -122.4194,
    latitude: 37.7749,
    zoom: 12,
  });

  const searchStores = useHandler("searchStores");

  const filteredStores = React.useMemo(() => {
    if (!searchQuery) return DEMO_STORES;
    const q = searchQuery.toLowerCase();
    return DEMO_STORES.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.address.toLowerCase().includes(q) ||
        s.category.toLowerCase().includes(q)
    );
  }, [searchQuery]);

  const handleStoreClick = (store: Store) => {
    setSelectedId(store.id);
    setPopupStore(store);
    setViewport({ longitude: store.lng, latitude: store.lat, zoom: 15 });
  };

  const mapStyleUrl =
    mapStyle === "satellite"
      ? "mapbox://styles/mapbox/satellite-streets-v12"
      : resolvedTheme === "dark"
      ? "mapbox://styles/mapbox/dark-v11"
      : "mapbox://styles/mapbox/streets-v12";

  const markerColor = resolvedTheme === "dark" ? "#4ade80" : "#16a34a";

  const categoryColors: Record<string, string> = {
    Flagship: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300",
    Standard: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300",
    Express: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-300",
  };

  return (
    <div className="flex h-[600px] rounded-lg overflow-hidden border">
      <div className="w-[60%] relative">
        <Mapbox.Map
          initialViewState={viewport}
          style={{ width: "100%", height: "100%" }}
          mapStyle={mapStyleUrl}
        >
          <Mapbox.NavigationControl position="top-right" />
          {filteredStores.map((store) => (
            <Mapbox.Marker
              key={store.id}
              longitude={store.lng}
              latitude={store.lat}
              color={selectedId === store.id ? "#facc15" : markerColor}
              onClick={() => {
                setSelectedId(store.id);
                setPopupStore(store);
              }}
            />
          ))}
          {popupStore && (
            <Mapbox.Popup
              longitude={popupStore.lng}
              latitude={popupStore.lat}
              anchor="bottom"
              onClose={() => setPopupStore(null)}
            >
              <div className="p-2 min-w-[180px]">
                <p className="font-semibold text-sm">{popupStore.name}</p>
                <p className="text-xs text-muted-foreground mt-1">{popupStore.address}</p>
                <p className="text-xs text-muted-foreground">{popupStore.city}</p>
                <p className="text-xs mt-1">{popupStore.phone}</p>
              </div>
            </Mapbox.Popup>
          )}
        </Mapbox.Map>
        <div className="absolute top-3 left-3">
          <ToggleGroup
            type="single"
            value={mapStyle}
            onValueChange={(v) => v && setMapStyle(v)}
            className="bg-background/90 backdrop-blur-sm border rounded-md"
          >
            <ToggleGroupItem value="streets" className="text-xs px-3 h-8">
              <Icons.Map className="h-3 w-3 mr-1" /> Streets
            </ToggleGroupItem>
            <ToggleGroupItem value="satellite" className="text-xs px-3 h-8">
              <Icons.Globe className="h-3 w-3 mr-1" /> Satellite
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
      </div>

      <div className="w-[40%] flex flex-col bg-background">
        <div className="p-4 border-b space-y-3">
          <h3 className="font-semibold text-lg flex items-center gap-2">
            <Icons.MapPin className="h-5 w-5 text-primary" />
            Store Locations
          </h3>
          <Input
            value={searchQuery || ""}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search stores..."
            className="h-9"
          />
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Badge variant="secondary">{filteredStores.length} stores</Badge>
          </div>
        </div>

        <ScrollArea className="flex-1">
          <div className="p-2 space-y-1">
            {filteredStores.map((store) => (
              <Item
                key={store.id}
                className={cn(
                  "cursor-pointer rounded-md transition-colors p-3",
                  selectedId === store.id
                    ? "bg-primary/10 border border-primary/30"
                    : "hover:bg-muted"
                )}
                onClick={() => handleStoreClick(store)}
              >
                <ItemContent>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <ItemTitle className="text-sm font-medium">
                        {store.name}
                      </ItemTitle>
                      <ItemDescription className="text-xs mt-0.5">
                        {store.address}, {store.city}
                      </ItemDescription>
                      <p className="text-xs text-muted-foreground mt-1">
                        <Icons.Clock className="inline h-3 w-3 mr-1" />
                        {store.hours}
                      </p>
                    </div>
                    <Badge
                      variant="outline"
                      className={cn("text-[10px] shrink-0", categoryColors[store.category])}
                    >
                      {store.category}
                    </Badge>
                  </div>
                </ItemContent>
              </Item>
            ))}
          </div>
        </ScrollArea>

        {selectedId && (
          <div className="p-4 border-t">
            <Card>
              <CardContent className="p-3">
                {(() => {
                  const s = DEMO_STORES.find((st) => st.id === selectedId);
                  if (!s) return null;
                  return (
                    <div className="space-y-2">
                      <p className="font-semibold text-sm">{s.name}</p>
                      <p className="text-xs text-muted-foreground">{s.address}</p>
                      <div className="flex items-center gap-3 text-xs">
                        <span className="flex items-center gap-1">
                          <Icons.Phone className="h-3 w-3" /> {s.phone}
                        </span>
                      </div>
                      <Button size="sm" className="w-full mt-2" variant="outline">
                        <Icons.Navigation className="h-3 w-3 mr-1" /> Get Directions
                      </Button>
                    </div>
                  );
                })()}
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}

export default StoreLocator;
