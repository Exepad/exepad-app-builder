import {
  React,
  useNavigation,
  useModel,
  useAppState,
  useArrayState,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Badge,
  Separator,
  Checkbox,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  Icons,
  cn,
} from "@exepad/sdk";

interface Property {
  id: string;
  title: string;
  price: number;
  property_type: string;
  bedrooms: number;
  bathrooms: number;
  sqft: number;
  address: string;
  city: string;
  state: string;
  status: string;
}

const DEMO_PROPERTIES: Property[] = [
  { id: "1", title: "Modern Craftsman in Capitol Hill", price: 875000, property_type: "house", bedrooms: 4, bathrooms: 3, sqft: 2850, address: "1247 Pine Street", city: "Seattle", state: "WA", status: "active" },
  { id: "2", title: "Luxury Penthouse with Bay Views", price: 1250000, property_type: "condo", bedrooms: 3, bathrooms: 2, sqft: 2100, address: "580 Battery Street #PH4", city: "San Francisco", state: "CA", status: "active" },
  { id: "7", title: "Family Home with Mountain Views", price: 685000, property_type: "house", bedrooms: 4, bathrooms: 3, sqft: 2400, address: "5678 Ridge Road", city: "Boulder", state: "CO", status: "active" },
  { id: "8", title: "Sleek Condo in South Lake Union", price: 620000, property_type: "condo", bedrooms: 2, bathrooms: 2, sqft: 1200, address: "345 Fairview Ave N #801", city: "Seattle", state: "WA", status: "active" },
];

const DEMO_FAVORITE_IDS = ["1", "2", "7", "8"];

function formatPrice(price: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(price);
}

function FavoritesList() {
  const navigation = useNavigation();
  const { data: modelProperties } = useModel<Property>("properties", { limit: 50 });
  const { items: favoriteIds, remove: removeFavoriteItem } = useArrayState<string>("favoriteIds", DEMO_FAVORITE_IDS);

  const [compareIds, setCompareIds] = React.useState<string[]>([]);
  const [showCompare, setShowCompare] = React.useState(false);

  const favIds = favoriteIds ?? DEMO_FAVORITE_IDS;
  const allProperties = modelProperties && modelProperties.length > 0 ? modelProperties : DEMO_PROPERTIES;
  const favoriteProperties = allProperties.filter((p) => favIds.includes(p.id));

  const toggleCompare = (id: string) => {
    setCompareIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= 3) return prev;
      return [...prev, id];
    });
  };

  const removeFromFavorites = (id: string) => {
    const idx = favIds.indexOf(id);
    if (idx >= 0) removeFavoriteItem(idx);
    setCompareIds((prev) => prev.filter((x) => x !== id));
  };

  const compareProperties = favoriteProperties.filter((p) => compareIds.includes(p.id));

  if (favoriteProperties.length === 0) {
    return (
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-16 text-center">
        <div className="max-w-md mx-auto">
          <div className="flex h-20 w-20 items-center justify-center rounded-full bg-muted mx-auto mb-5">
            <Icons.Heart className="h-10 w-10 text-muted-foreground/40" />
          </div>
          <h2 className="text-2xl font-bold mb-2">No Favorites Yet</h2>
          <p className="text-muted-foreground mb-6">
            Start browsing properties and tap the heart icon to save your favorites here.
          </p>
          <Button onClick={() => navigation.navigate("/listings")} className="gap-2">
            <Icons.Search className="h-4 w-4" />
            Browse Listings
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold">My Favorites</h1>
          <p className="text-sm text-muted-foreground mt-1">{favoriteProperties.length} saved properties</p>
        </div>
        <div className="flex items-center gap-3">
          {compareIds.length >= 2 && (
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setShowCompare(!showCompare)}>
              <Icons.Columns className="h-4 w-4" />
              {showCompare ? "Hide" : "Compare"} ({compareIds.length})
            </Button>
          )}
          {compareIds.length > 0 && (
            <Button variant="ghost" size="sm" onClick={() => setCompareIds([])} className="text-xs">
              Clear Selection
            </Button>
          )}
        </div>
      </div>

      {/* Comparison Table */}
      {showCompare && compareProperties.length >= 2 && (
        <Card className="mb-8">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Icons.Columns className="h-4 w-4" />
              Property Comparison
            </CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[140px]">Feature</TableHead>
                  {compareProperties.map((p) => (
                    <TableHead key={p.id} className="min-w-[160px]">{p.title}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow>
                  <TableCell className="font-medium">Price</TableCell>
                  {compareProperties.map((p) => (
                    <TableCell key={p.id} className="price-display font-semibold text-primary">{formatPrice(p.price)}</TableCell>
                  ))}
                </TableRow>
                <TableRow>
                  <TableCell className="font-medium">Type</TableCell>
                  {compareProperties.map((p) => (
                    <TableCell key={p.id} className="capitalize">{p.property_type}</TableCell>
                  ))}
                </TableRow>
                <TableRow>
                  <TableCell className="font-medium">Bedrooms</TableCell>
                  {compareProperties.map((p) => (
                    <TableCell key={p.id}>{p.bedrooms}</TableCell>
                  ))}
                </TableRow>
                <TableRow>
                  <TableCell className="font-medium">Bathrooms</TableCell>
                  {compareProperties.map((p) => (
                    <TableCell key={p.id}>{p.bathrooms}</TableCell>
                  ))}
                </TableRow>
                <TableRow>
                  <TableCell className="font-medium">Sq Ft</TableCell>
                  {compareProperties.map((p) => (
                    <TableCell key={p.id}>{p.sqft.toLocaleString()}</TableCell>
                  ))}
                </TableRow>
                <TableRow>
                  <TableCell className="font-medium">Location</TableCell>
                  {compareProperties.map((p) => (
                    <TableCell key={p.id}>{p.city}, {p.state}</TableCell>
                  ))}
                </TableRow>
                <TableRow>
                  <TableCell className="font-medium">Price/sqft</TableCell>
                  {compareProperties.map((p) => (
                    <TableCell key={p.id}>${Math.round(p.price / p.sqft)}</TableCell>
                  ))}
                </TableRow>
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Favorites Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
        {favoriteProperties.map((property) => {
          const isComparing = compareIds.includes(property.id);
          return (
            <Card key={property.id} className={cn("property-card overflow-hidden group", isComparing && "ring-2 ring-primary")}>
              <div className="relative h-40 bg-gradient-to-br from-primary/20 to-accent/40 flex items-center justify-center cursor-pointer" onClick={() => navigation.navigate(`/property/${property.id}`)}>
                <Icons.Home className="h-10 w-10 text-primary/30" />
                <Badge className="absolute top-3 left-3 capitalize">{property.property_type}</Badge>
                <button
                  onClick={(e) => { e.stopPropagation(); removeFromFavorites(property.id); }}
                  className="favorite-btn active absolute top-3 right-3 p-1.5 rounded-full bg-white/80 hover:bg-white"
                >
                  <Icons.Heart className="h-4 w-4 fill-current" />
                </button>
              </div>
              <CardContent className="p-4">
                <p className="price-display text-lg font-bold text-primary">{formatPrice(property.price)}</p>
                <h3 className="font-semibold text-sm mt-1 truncate cursor-pointer group-hover:text-primary transition-colors" onClick={() => navigation.navigate(`/property/${property.id}`)}>
                  {property.title}
                </h3>
                <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                  <Icons.MapPin className="h-3 w-3" /> {property.city}, {property.state}
                </p>
                <Separator className="my-3" />
                <div className="flex items-center gap-3 text-xs text-muted-foreground mb-3">
                  <span className="flex items-center gap-1"><Icons.BedDouble className="h-3.5 w-3.5" />{property.bedrooms} bd</span>
                  <span className="flex items-center gap-1"><Icons.Bath className="h-3.5 w-3.5" />{property.bathrooms} ba</span>
                  <span className="flex items-center gap-1"><Icons.Maximize2 className="h-3.5 w-3.5" />{property.sqft.toLocaleString()}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Checkbox
                    checked={isComparing}
                    onCheckedChange={() => toggleCompare(property.id)}
                    disabled={!isComparing && compareIds.length >= 3}
                  />
                  <span className="text-xs text-muted-foreground">Compare</span>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {compareIds.length > 0 && compareIds.length < 2 && (
        <p className="text-center text-sm text-muted-foreground mt-6">
          Select at least 2 properties to compare (up to 3)
        </p>
      )}
    </div>
  );
}

export default FavoritesList;
