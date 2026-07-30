import {
  React,
  useNavigation,
  useModel,
  useAppState,
  useArrayState,
  Button,
  Card,
  CardContent,
  Input,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  Badge,
  Separator,
  ToggleGroup,
  ToggleGroupItem,
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
  zip: string;
  status: string;
}

const DEMO_PROPERTIES: Property[] = [
  { id: "1", title: "Modern Craftsman in Capitol Hill", price: 875000, property_type: "house", bedrooms: 4, bathrooms: 3, sqft: 2850, address: "1247 Pine Street", city: "Seattle", state: "WA", zip: "98122", status: "active" },
  { id: "2", title: "Luxury Penthouse with Bay Views", price: 1250000, property_type: "condo", bedrooms: 3, bathrooms: 2, sqft: 2100, address: "580 Battery Street #PH4", city: "San Francisco", state: "CA", zip: "94111", status: "active" },
  { id: "3", title: "Charming Bungalow near Pearl District", price: 525000, property_type: "house", bedrooms: 3, bathrooms: 2, sqft: 1650, address: "923 NW Lovejoy Street", city: "Portland", state: "OR", zip: "97209", status: "active" },
  { id: "4", title: "Downtown Loft with Exposed Brick", price: 389000, property_type: "apartment", bedrooms: 1, bathrooms: 1, sqft: 950, address: "412 S Main Street #305", city: "Denver", state: "CO", zip: "80209", status: "active" },
  { id: "5", title: "Waterfront Estate on Lake Washington", price: 2450000, property_type: "house", bedrooms: 5, bathrooms: 4, sqft: 4200, address: "8901 Lake Shore Blvd", city: "Seattle", state: "WA", zip: "98118", status: "pending" },
  { id: "6", title: "Cozy Studio near Pioneer Square", price: 275000, property_type: "apartment", bedrooms: 1, bathrooms: 1, sqft: 550, address: "201 1st Ave S #412", city: "Seattle", state: "WA", zip: "98104", status: "active" },
  { id: "7", title: "Family Home with Mountain Views", price: 685000, property_type: "house", bedrooms: 4, bathrooms: 3, sqft: 2400, address: "5678 Ridge Road", city: "Boulder", state: "CO", zip: "80302", status: "active" },
  { id: "8", title: "Sleek Condo in South Lake Union", price: 620000, property_type: "condo", bedrooms: 2, bathrooms: 2, sqft: 1200, address: "345 Fairview Ave N #801", city: "Seattle", state: "WA", zip: "98109", status: "active" },
  { id: "9", title: "Historic Victorian in Nob Hill", price: 1875000, property_type: "house", bedrooms: 5, bathrooms: 3, sqft: 3400, address: "1023 Clay Street", city: "San Francisco", state: "CA", zip: "94108", status: "sold" },
  { id: "10", title: "Modern Apartment in Pearl District", price: 445000, property_type: "apartment", bedrooms: 2, bathrooms: 2, sqft: 1100, address: "1120 NW Couch Street #607", city: "Portland", state: "OR", zip: "97209", status: "active" },
  { id: "11", title: "Scenic Land Parcel in Cascade Foothills", price: 195000, property_type: "land", bedrooms: 0, bathrooms: 0, sqft: 43560, address: "Lot 14, Mountain View Road", city: "Leavenworth", state: "WA", zip: "98826", status: "active" },
  { id: "12", title: "Renovated Townhome in RiNo", price: 575000, property_type: "condo", bedrooms: 3, bathrooms: 2, sqft: 1800, address: "2934 Larimer Street", city: "Denver", state: "CO", zip: "80205", status: "active" },
  { id: "13", title: "Beachside Cottage in Cannon Beach", price: 725000, property_type: "house", bedrooms: 2, bathrooms: 1, sqft: 1200, address: "456 Hemlock Street", city: "Cannon Beach", state: "OR", zip: "97110", status: "pending" },
  { id: "14", title: "Luxury High-Rise in Financial District", price: 985000, property_type: "condo", bedrooms: 2, bathrooms: 2, sqft: 1450, address: "101 California Street #3201", city: "San Francisco", state: "CA", zip: "94111", status: "active" },
];

function formatPrice(price: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(price);
}

const STATUS_COLORS: Record<string, string> = {
  active: "bg-green-100 text-green-800",
  pending: "bg-yellow-100 text-yellow-800",
  sold: "bg-red-100 text-red-800",
};

function PropertyListings() {
  const navigation = useNavigation();
  const { data: modelProperties } = useModel<Property>("properties", { limit: 50 });
  const { items: favoriteIds, push: addFavorite, remove: removeFavoriteItem } = useArrayState<string>("favoriteIds", []);
  const [viewMode, setViewMode] = useAppState<string>("viewMode", "grid");

  const [minPrice, setMinPrice] = React.useState("");
  const [maxPrice, setMaxPrice] = React.useState("");
  const [typeFilter, setTypeFilter] = React.useState("");
  const [bedsFilter, setBedsFilter] = React.useState("");
  const [bathsFilter, setBathsFilter] = React.useState("");
  const [cityFilter, setCityFilter] = React.useState("");
  const [currentPage, setCurrentPage] = React.useState(1);
  const perPage = 6;

  const allProperties = modelProperties && modelProperties.length > 0 ? modelProperties : DEMO_PROPERTIES;
  const favIds = favoriteIds ?? [];

  const filtered = allProperties.filter((p) => {
    if (minPrice && p.price < Number(minPrice)) return false;
    if (maxPrice && p.price > Number(maxPrice)) return false;
    if (typeFilter && p.property_type !== typeFilter) return false;
    if (bedsFilter && p.bedrooms < Number(bedsFilter)) return false;
    if (bathsFilter && p.bathrooms < Number(bathsFilter)) return false;
    if (cityFilter && !p.city.toLowerCase().includes(cityFilter.toLowerCase())) return false;
    return true;
  });

  const totalPages = Math.ceil(filtered.length / perPage);
  const paginated = filtered.slice((currentPage - 1) * perPage, currentPage * perPage);

  const toggleFavorite = (id: string) => {
    const idx = favIds.indexOf(id);
    if (idx >= 0) {
      removeFavoriteItem(idx);
    } else {
      addFavorite(id);
    }
  };

  const clearFilters = () => {
    setMinPrice(""); setMaxPrice(""); setTypeFilter(""); setBedsFilter(""); setBathsFilter(""); setCityFilter("");
    setCurrentPage(1);
  };

  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold">Property Listings</h1>
          <p className="text-sm text-muted-foreground mt-1">{filtered.length} properties found</p>
        </div>
        <ToggleGroup type="single" value={viewMode ?? "grid"} onValueChange={(v: string) => v && setViewMode(v)}>
          <ToggleGroupItem value="grid" aria-label="Grid view">
            <Icons.LayoutGrid className="h-4 w-4" />
          </ToggleGroupItem>
          <ToggleGroupItem value="list" aria-label="List view">
            <Icons.List className="h-4 w-4" />
          </ToggleGroupItem>
        </ToggleGroup>
      </div>

      {/* Filter Bar */}
      <Card className="mb-6">
        <CardContent className="p-4">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <Input placeholder="Min Price" type="number" value={minPrice} onChange={(e: React.ChangeEvent<HTMLInputElement>) => { setMinPrice(e.target.value); setCurrentPage(1); }} className="h-9 text-sm" />
            <Input placeholder="Max Price" type="number" value={maxPrice} onChange={(e: React.ChangeEvent<HTMLInputElement>) => { setMaxPrice(e.target.value); setCurrentPage(1); }} className="h-9 text-sm" />
            <Select value={typeFilter} onValueChange={(v: string) => { setTypeFilter(v); setCurrentPage(1); }}>
              <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Type" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="house">House</SelectItem>
                <SelectItem value="apartment">Apartment</SelectItem>
                <SelectItem value="condo">Condo</SelectItem>
                <SelectItem value="land">Land</SelectItem>
              </SelectContent>
            </Select>
            <Select value={bedsFilter} onValueChange={(v: string) => { setBedsFilter(v); setCurrentPage(1); }}>
              <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Beds" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="1">1+ Bed</SelectItem>
                <SelectItem value="2">2+ Beds</SelectItem>
                <SelectItem value="3">3+ Beds</SelectItem>
                <SelectItem value="4">4+ Beds</SelectItem>
              </SelectContent>
            </Select>
            <Select value={bathsFilter} onValueChange={(v: string) => { setBathsFilter(v); setCurrentPage(1); }}>
              <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Baths" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="1">1+ Bath</SelectItem>
                <SelectItem value="2">2+ Baths</SelectItem>
                <SelectItem value="3">3+ Baths</SelectItem>
              </SelectContent>
            </Select>
            <Input placeholder="City" value={cityFilter} onChange={(e: React.ChangeEvent<HTMLInputElement>) => { setCityFilter(e.target.value); setCurrentPage(1); }} className="h-9 text-sm" />
          </div>
          {(minPrice || maxPrice || typeFilter || bedsFilter || bathsFilter || cityFilter) && (
            <div className="mt-3 flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={clearFilters} className="text-xs gap-1">
                <Icons.X className="h-3 w-3" /> Clear Filters
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Property Grid */}
      <div className={cn(
        viewMode === "grid"
          ? "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6"
          : "flex flex-col gap-4"
      )}>
        {paginated.map((property) => {
          const isFav = favIds.includes(property.id);
          return viewMode === "grid" ? (
            <Card key={property.id} className="property-card overflow-hidden group cursor-pointer" onClick={() => navigation.navigate(`/property/${property.id}`)}>
              <div className="relative h-44 bg-gradient-to-br from-primary/20 to-accent/40 flex items-center justify-center">
                <Icons.Home className="h-10 w-10 text-primary/30" />
                <Badge className={cn("absolute top-3 left-3 capitalize text-xs", STATUS_COLORS[property.status] || "")}>
                  {property.status}
                </Badge>
                <button
                  onClick={(e) => { e.stopPropagation(); toggleFavorite(property.id); }}
                  className={cn("favorite-btn absolute top-3 right-3 p-1.5 rounded-full bg-white/80 hover:bg-white", isFav && "active")}
                >
                  {isFav ? <Icons.Heart className="h-4 w-4 fill-current" /> : <Icons.Heart className="h-4 w-4" />}
                </button>
              </div>
              <CardContent className="p-4">
                <p className="price-display text-lg font-bold text-primary">{formatPrice(property.price)}</p>
                <h3 className="font-semibold text-sm mt-1 truncate group-hover:text-primary transition-colors">{property.title}</h3>
                <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                  <Icons.MapPin className="h-3 w-3" /> {property.address}, {property.city}, {property.state}
                </p>
                <Separator className="my-3" />
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1"><Icons.BedDouble className="h-3.5 w-3.5" />{property.bedrooms} bd</span>
                  <span className="flex items-center gap-1"><Icons.Bath className="h-3.5 w-3.5" />{property.bathrooms} ba</span>
                  <span className="flex items-center gap-1"><Icons.Maximize2 className="h-3.5 w-3.5" />{property.sqft.toLocaleString()} sqft</span>
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card key={property.id} className="property-card cursor-pointer" onClick={() => navigation.navigate(`/property/${property.id}`)}>
              <CardContent className="p-4 flex gap-4">
                <div className="relative h-28 w-40 shrink-0 rounded-lg bg-gradient-to-br from-primary/20 to-accent/40 flex items-center justify-center">
                  <Icons.Home className="h-8 w-8 text-primary/30" />
                  <Badge className={cn("absolute top-2 left-2 capitalize text-[10px]", STATUS_COLORS[property.status] || "")}>
                    {property.status}
                  </Badge>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="price-display text-lg font-bold text-primary">{formatPrice(property.price)}</p>
                      <h3 className="font-semibold text-sm mt-0.5">{property.title}</h3>
                    </div>
                    <button onClick={(e) => { e.stopPropagation(); toggleFavorite(property.id); }} className={cn("favorite-btn p-1.5", isFav && "active")}>
                      {isFav ? <Icons.Heart className="h-4 w-4 fill-current" /> : <Icons.Heart className="h-4 w-4" />}
                    </button>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                    <Icons.MapPin className="h-3 w-3" /> {property.address}, {property.city}, {property.state} {property.zip}
                  </p>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground mt-2">
                    <span className="flex items-center gap-1"><Icons.BedDouble className="h-3.5 w-3.5" />{property.bedrooms} bd</span>
                    <span className="flex items-center gap-1"><Icons.Bath className="h-3.5 w-3.5" />{property.bathrooms} ba</span>
                    <span className="flex items-center gap-1"><Icons.Maximize2 className="h-3.5 w-3.5" />{property.sqft.toLocaleString()} sqft</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {paginated.length === 0 && (
        <div className="text-center py-16">
          <Icons.SearchX className="h-12 w-12 text-muted-foreground/40 mx-auto mb-3" />
          <h3 className="font-semibold text-lg">No properties found</h3>
          <p className="text-sm text-muted-foreground mt-1">Try adjusting your filters</p>
          <Button variant="outline" size="sm" className="mt-4" onClick={clearFilters}>Clear Filters</Button>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 mt-8">
          <Button variant="outline" size="sm" disabled={currentPage === 1} onClick={() => setCurrentPage(currentPage - 1)}>
            <Icons.ChevronLeft className="h-4 w-4" />
          </Button>
          {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
            <Button key={page} variant={page === currentPage ? "default" : "outline"} size="sm" onClick={() => setCurrentPage(page)} className="w-9">
              {page}
            </Button>
          ))}
          <Button variant="outline" size="sm" disabled={currentPage === totalPages} onClick={() => setCurrentPage(currentPage + 1)}>
            <Icons.ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  );
}

export default PropertyListings;
