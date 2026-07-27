import {
  React,
  useNavigation,
  useModel,
  useAppState,
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

const DEMO_FEATURED: Property[] = [
  {
    id: "1",
    title: "Modern Craftsman in Capitol Hill",
    price: 875000,
    property_type: "house",
    bedrooms: 4,
    bathrooms: 3,
    sqft: 2850,
    address: "1247 Pine Street",
    city: "Seattle",
    state: "WA",
    status: "active",
  },
  {
    id: "2",
    title: "Luxury Penthouse with Bay Views",
    price: 1250000,
    property_type: "condo",
    bedrooms: 3,
    bathrooms: 2,
    sqft: 2100,
    address: "580 Battery Street #PH4",
    city: "San Francisco",
    state: "CA",
    status: "active",
  },
  {
    id: "3",
    title: "Charming Bungalow near Pearl District",
    price: 525000,
    property_type: "house",
    bedrooms: 3,
    bathrooms: 2,
    sqft: 1650,
    address: "923 NW Lovejoy Street",
    city: "Portland",
    state: "OR",
    status: "active",
  },
];

const STATS = [
  { value: "10,000+", label: "Properties", icon: "Building2" as keyof typeof Icons },
  { value: "500+", label: "Agents", icon: "Users" as keyof typeof Icons },
  { value: "98%", label: "Satisfaction", icon: "ThumbsUp" as keyof typeof Icons },
];

const STEPS = [
  { step: 1, title: "Search", description: "Browse thousands of listings with powerful filters and map view", icon: "Search" as keyof typeof Icons },
  { step: 2, title: "Tour", description: "Schedule visits with top-rated agents who know your neighborhood", icon: "CalendarDays" as keyof typeof Icons },
  { step: 3, title: "Close", description: "Get expert guidance through offers, inspections, and closing day", icon: "KeyRound" as keyof typeof Icons },
];

function formatPrice(price: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(price);
}

function RealEstateHome() {
  const navigation = useNavigation();
  const { data: properties } = useModel<Property>("properties", { limit: 3 });
  const [searchFilters, setSearchFilters] = useAppState<Record<string, string>>("searchFilters", {});

  const [location, setLocation] = React.useState("");
  const [propertyType, setPropertyType] = React.useState("");
  const [priceRange, setPriceRange] = React.useState("");
  const [bedrooms, setBedrooms] = React.useState("");

  const featured = properties && properties.length > 0 ? properties : DEMO_FEATURED;

  const handleSearch = () => {
    const filters: Record<string, string> = {};
    if (location) filters.city = location;
    if (propertyType) filters.type = propertyType;
    if (priceRange) filters.price = priceRange;
    if (bedrooms) filters.bedrooms = bedrooms;
    setSearchFilters(filters);
    navigation.navigate("/listings");
  };

  return (
    <div className="w-full">
      {/* Hero Section */}
      <section className="relative bg-gradient-to-br from-primary/5 via-background to-accent/30 py-16 sm:py-24 lg:py-32">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 text-center">
          <Badge variant="secondary" className="mb-4 px-3 py-1">
            <Icons.Sparkles className="mr-1.5 h-3 w-3" />
            #1 Real Estate Platform
          </Badge>
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight mb-4">
            Find Your <span className="text-primary">Dream Home</span>
          </h1>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto mb-10">
            Discover the perfect property from our curated collection of homes, apartments,
            and condos across the most desirable neighborhoods.
          </p>

          {/* Search Form */}
          <div className="hero-search mx-auto max-w-4xl rounded-xl border border-border p-4 sm:p-6 shadow-lg">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block text-left">Location</label>
                <Input
                  placeholder="City or ZIP"
                  value={location}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setLocation(e.target.value)}
                  className="h-10"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block text-left">Property Type</label>
                <Select value={propertyType} onValueChange={setPropertyType}>
                  <SelectTrigger className="h-10">
                    <SelectValue placeholder="Any Type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="house">House</SelectItem>
                    <SelectItem value="apartment">Apartment</SelectItem>
                    <SelectItem value="condo">Condo</SelectItem>
                    <SelectItem value="land">Land</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block text-left">Price Range</label>
                <Select value={priceRange} onValueChange={setPriceRange}>
                  <SelectTrigger className="h-10">
                    <SelectValue placeholder="Any Price" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="0-300000">Under $300K</SelectItem>
                    <SelectItem value="300000-500000">$300K - $500K</SelectItem>
                    <SelectItem value="500000-750000">$500K - $750K</SelectItem>
                    <SelectItem value="750000-1000000">$750K - $1M</SelectItem>
                    <SelectItem value="1000000-99999999">$1M+</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block text-left">Bedrooms</label>
                <Select value={bedrooms} onValueChange={setBedrooms}>
                  <SelectTrigger className="h-10">
                    <SelectValue placeholder="Any" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">1+</SelectItem>
                    <SelectItem value="2">2+</SelectItem>
                    <SelectItem value="3">3+</SelectItem>
                    <SelectItem value="4">4+</SelectItem>
                    <SelectItem value="5">5+</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <Button onClick={handleSearch} className="w-full sm:w-auto px-8 h-11 gap-2">
              <Icons.Search className="h-4 w-4" />
              Search Properties
            </Button>
          </div>
        </div>
      </section>

      {/* Stats */}
      <section className="py-12 border-b border-border">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-8 text-center">
            {STATS.map((stat) => {
              const Icon = Icons[stat.icon] as React.ComponentType<{ className?: string }>;
              return (
                <div key={stat.label} className="flex flex-col items-center gap-2">
                  {Icon && (
                    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary mb-1">
                      <Icon className="h-6 w-6" />
                    </div>
                  )}
                  <span className="text-3xl font-bold">{stat.value}</span>
                  <span className="text-sm text-muted-foreground">{stat.label}</span>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Featured Properties */}
      <section className="py-16">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between mb-8">
            <div>
              <h2 className="text-2xl sm:text-3xl font-bold">Featured Properties</h2>
              <p className="text-muted-foreground mt-1">Handpicked listings you'll love</p>
            </div>
            <Button variant="outline" onClick={() => navigation.navigate("/listings")} className="gap-1.5">
              View All
              <Icons.ArrowRight className="h-4 w-4" />
            </Button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {featured.map((property) => (
              <Card
                key={property.id}
                className="property-card overflow-hidden cursor-pointer group"
                onClick={() => navigation.navigate(`/property/${property.id}`)}
              >
                <div className="relative h-48 bg-gradient-to-br from-primary/20 to-accent/40 flex items-center justify-center">
                  <Icons.Home className="h-12 w-12 text-primary/40" />
                  <Badge className="absolute top-3 left-3 capitalize">{property.property_type}</Badge>
                </div>
                <CardContent className="p-4">
                  <p className="price-display text-xl font-bold text-primary mb-1">
                    {formatPrice(property.price)}
                  </p>
                  <h3 className="font-semibold text-sm mb-1 group-hover:text-primary transition-colors">
                    {property.title}
                  </h3>
                  <p className="text-xs text-muted-foreground mb-3 flex items-center gap-1">
                    <Icons.MapPin className="h-3 w-3" />
                    {property.city}, {property.state}
                  </p>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Icons.BedDouble className="h-3.5 w-3.5" />
                      {property.bedrooms} bd
                    </span>
                    <span className="flex items-center gap-1">
                      <Icons.Bath className="h-3.5 w-3.5" />
                      {property.bathrooms} ba
                    </span>
                    <span className="flex items-center gap-1">
                      <Icons.Maximize2 className="h-3.5 w-3.5" />
                      {property.sqft.toLocaleString()} sqft
                    </span>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="py-16 bg-secondary/30">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-2xl sm:text-3xl font-bold mb-2">How It Works</h2>
          <p className="text-muted-foreground mb-12">Three simple steps to your new home</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-8">
            {STEPS.map((step) => {
              const Icon = Icons[step.icon] as React.ComponentType<{ className?: string }>;
              return (
                <div key={step.step} className="flex flex-col items-center">
                  <div className="relative mb-4">
                    <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-lg">
                      {Icon && <Icon className="h-7 w-7" />}
                    </div>
                    <span className="absolute -top-2 -right-2 flex h-6 w-6 items-center justify-center rounded-full bg-background border-2 border-primary text-primary text-xs font-bold">
                      {step.step}
                    </span>
                  </div>
                  <h3 className="text-lg font-semibold mb-2">{step.title}</h3>
                  <p className="text-sm text-muted-foreground max-w-xs">{step.description}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-16">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="rounded-2xl bg-primary p-8 sm:p-12 text-center text-primary-foreground">
            <h2 className="text-2xl sm:text-3xl font-bold mb-3">Ready to Find Your Home?</h2>
            <p className="text-primary-foreground/80 max-w-lg mx-auto mb-6">
              Join thousands of happy homeowners who found their perfect property through NestFinder.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
              <Button
                variant="secondary"
                size="lg"
                onClick={() => navigation.navigate("/listings")}
                className="gap-2"
              >
                <Icons.Search className="h-4 w-4" />
                Browse Listings
              </Button>
              <Button
                variant="outline"
                size="lg"
                onClick={() => navigation.navigate("/agents")}
                className="gap-2 border-primary-foreground/30 text-primary-foreground hover:bg-primary-foreground/10"
              >
                <Icons.Users className="h-4 w-4" />
                Find an Agent
              </Button>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

export default RealEstateHome;
