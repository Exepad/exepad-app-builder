import {
  React,
  useNavigation,
  useModel,
  useHandler,
  useAppState,
  useArrayState,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Textarea,
  Badge,
  Separator,
  Avatar,
  AvatarFallback,
  Icons,
  toast,
  cn,
} from "@exepad/sdk";

interface Property {
  id: string;
  title: string;
  description: string;
  price: number;
  property_type: string;
  bedrooms: number;
  bathrooms: number;
  sqft: number;
  address: string;
  city: string;
  state: string;
  zip: string;
  latitude: number | null;
  longitude: number | null;
  status: string;
}

interface Feature {
  feature_name: string;
  feature_value: string | null;
}

const DEMO_PROPERTY: Property = {
  id: "1",
  title: "Modern Craftsman in Capitol Hill",
  description: "This stunning 4-bedroom Craftsman home blends classic architectural details with modern upgrades throughout. The open-concept main floor features hardwood floors, a chef's kitchen with quartz countertops and stainless steel appliances, and a spacious living room with a gas fireplace. The primary suite offers a walk-in closet and a spa-inspired bathroom with heated floors. The finished basement includes a bonus room perfect for a home office or media room. Enjoy the private backyard with a covered patio, mature landscaping, and a detached two-car garage. Located steps from restaurants, shops, and parks in one of Seattle's most vibrant neighborhoods.",
  price: 875000,
  property_type: "house",
  bedrooms: 4,
  bathrooms: 3,
  sqft: 2850,
  address: "1247 Pine Street",
  city: "Seattle",
  state: "WA",
  zip: "98122",
  latitude: 47.6155,
  longitude: -122.3209,
  status: "active",
};

const DEMO_FEATURES: Feature[] = [
  { feature_name: "Central AC", feature_value: "Yes" },
  { feature_name: "Hardwood Floors", feature_value: "Throughout main level" },
  { feature_name: "Pool", feature_value: null },
  { feature_name: "Garage", feature_value: "2-car detached" },
  { feature_name: "Fireplace", feature_value: "Gas, living room" },
  { feature_name: "Heated Floors", feature_value: "Primary bathroom" },
  { feature_name: "Lot Size", feature_value: "0.18 acres" },
  { feature_name: "Year Built", feature_value: "2018" },
  { feature_name: "Roof", feature_value: "Composition shingle" },
  { feature_name: "Foundation", feature_value: "Concrete perimeter" },
  { feature_name: "Laundry", feature_value: "In-unit, main floor" },
  { feature_name: "Parking", feature_value: "Garage + driveway" },
];

const DEMO_SIMILAR: Property[] = [
  { id: "5", title: "Waterfront Estate on Lake Washington", description: "", price: 2450000, property_type: "house", bedrooms: 5, bathrooms: 4, sqft: 4200, address: "8901 Lake Shore Blvd", city: "Seattle", state: "WA", zip: "98118", latitude: null, longitude: null, status: "pending" },
  { id: "8", title: "Sleek Condo in South Lake Union", description: "", price: 620000, property_type: "condo", bedrooms: 2, bathrooms: 2, sqft: 1200, address: "345 Fairview Ave N #801", city: "Seattle", state: "WA", zip: "98109", latitude: null, longitude: null, status: "active" },
  { id: "6", title: "Cozy Studio near Pioneer Square", description: "", price: 275000, property_type: "apartment", bedrooms: 1, bathrooms: 1, sqft: 550, address: "201 1st Ave S #412", city: "Seattle", state: "WA", zip: "98104", latitude: null, longitude: null, status: "active" },
];

const DEMO_AGENT = {
  name: "Sarah Mitchell",
  email: "sarah.mitchell@nestfinder.com",
  phone: "(206) 555-0142",
  license_number: "RE-29841",
};

function formatPrice(price: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(price);
}

function PropertyDetail() {
  const navigation = useNavigation();
  const { data: properties } = useModel<Property>("properties", { limit: 1 });
  const { data: features } = useModel<Feature>("property_features", { limit: 20 });
  const { execute: submitInquiry } = useHandler("submitInquiry");
  const { items: favoriteIds, push: addFavorite, remove: removeFavoriteItem } = useArrayState<string>("favoriteIds", []);

  const property = properties && properties.length > 0 ? properties[0] : DEMO_PROPERTY;
  const featureList = features && features.length > 0 ? features : DEMO_FEATURES;
  const agent = DEMO_AGENT;
  const similar = DEMO_SIMILAR;
  const favIds = favoriteIds ?? [];
  const isFav = favIds.includes(property.id);

  const [contactName, setContactName] = React.useState("");
  const [contactEmail, setContactEmail] = React.useState("");
  const [contactPhone, setContactPhone] = React.useState("");
  const [contactMessage, setContactMessage] = React.useState("");
  const [sending, setSending] = React.useState(false);
  const [selectedImage, setSelectedImage] = React.useState(0);

  const toggleFavorite = () => {
    const idx = favIds.indexOf(property.id);
    if (idx >= 0) {
      removeFavoriteItem(idx);
    } else {
      addFavorite(property.id);
    }
  };

  const handleSendInquiry = async () => {
    if (!contactName || !contactEmail || !contactMessage) {
      toast.error("Please fill in name, email, and message");
      return;
    }
    setSending(true);
    try {
      await submitInquiry({ property_id: Number(property.id), message: contactMessage, phone: contactPhone });
      toast.success("Inquiry sent successfully!");
      setContactName(""); setContactEmail(""); setContactPhone(""); setContactMessage("");
    } catch {
      toast.error("Failed to send inquiry. Please try again.");
    } finally {
      setSending(false);
    }
  };

  const STATUS_COLORS: Record<string, string> = {
    active: "bg-green-100 text-green-800",
    pending: "bg-yellow-100 text-yellow-800",
    sold: "bg-red-100 text-red-800",
  };

  const imagePlaceholders = [0, 1, 2, 3, 4];

  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8">
      {/* Back button */}
      <button onClick={() => navigation.navigate("/listings")} className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-6 transition-colors">
        <Icons.ArrowLeft className="h-4 w-4" /> Back to listings
      </button>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Main Content */}
        <div className="lg:col-span-2 space-y-6">
          {/* Image Gallery */}
          <div className="space-y-3">
            <div className="relative h-64 sm:h-80 lg:h-96 rounded-xl bg-gradient-to-br from-primary/20 to-accent/40 flex items-center justify-center overflow-hidden">
              <Icons.Home className="h-16 w-16 text-primary/30" />
              <Badge className={cn("absolute top-4 left-4 capitalize", STATUS_COLORS[property.status] || "")}>{property.status}</Badge>
              <button onClick={toggleFavorite} className={cn("favorite-btn absolute top-4 right-4 p-2 rounded-full bg-white/80 hover:bg-white shadow-sm", isFav && "active")}>
                {isFav ? <Icons.Heart className="h-5 w-5 fill-current" /> : <Icons.Heart className="h-5 w-5" />}
              </button>
            </div>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {imagePlaceholders.map((i) => (
                <button key={i} onClick={() => setSelectedImage(i)} className={cn("shrink-0 h-16 w-20 rounded-lg bg-gradient-to-br from-primary/10 to-accent/20 flex items-center justify-center border-2 transition-colors", selectedImage === i ? "border-primary" : "border-transparent hover:border-border")}>
                  <Icons.Image className="h-4 w-4 text-primary/30" />
                </button>
              ))}
            </div>
          </div>

          {/* Title & Price */}
          <div>
            <div className="flex items-start justify-between gap-4">
              <div>
                <h1 className="text-2xl sm:text-3xl font-bold">{property.title}</h1>
                <p className="text-muted-foreground mt-1 flex items-center gap-1.5">
                  <Icons.MapPin className="h-4 w-4" /> {property.address}, {property.city}, {property.state} {property.zip}
                </p>
              </div>
              <p className="price-display text-2xl sm:text-3xl font-bold text-primary whitespace-nowrap">{formatPrice(property.price)}</p>
            </div>
          </div>

          {/* Details Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
            {[
              { label: "Bedrooms", value: property.bedrooms, icon: "BedDouble" as keyof typeof Icons },
              { label: "Bathrooms", value: property.bathrooms, icon: "Bath" as keyof typeof Icons },
              { label: "Sq Ft", value: property.sqft.toLocaleString(), icon: "Maximize2" as keyof typeof Icons },
              { label: "Year Built", value: "2018", icon: "Calendar" as keyof typeof Icons },
              { label: "Lot Size", value: "0.18 ac", icon: "Trees" as keyof typeof Icons },
              { label: "Type", value: property.property_type, icon: "Building2" as keyof typeof Icons },
            ].map((detail) => {
              const Icon = Icons[detail.icon] as React.ComponentType<{ className?: string }>;
              return (
                <div key={detail.label} className="rounded-lg border border-border p-3 text-center">
                  {Icon && <Icon className="h-5 w-5 mx-auto text-primary mb-1" />}
                  <p className="text-sm font-semibold">{detail.value}</p>
                  <p className="text-[10px] text-muted-foreground uppercase">{detail.label}</p>
                </div>
              );
            })}
          </div>

          {/* Description */}
          <div>
            <h2 className="text-lg font-semibold mb-3">Description</h2>
            <p className="text-sm text-muted-foreground leading-relaxed">{property.description}</p>
          </div>

          {/* Features */}
          <div>
            <h2 className="text-lg font-semibold mb-3">Amenities & Features</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {featureList.map((f, i) => (
                <div key={i} className="flex items-center gap-2 text-sm py-1.5">
                  <Icons.CheckCircle2 className="h-4 w-4 text-primary shrink-0" />
                  <span className="font-medium">{f.feature_name}</span>
                  {f.feature_value && <span className="text-muted-foreground">- {f.feature_value}</span>}
                </div>
              ))}
            </div>
          </div>

          {/* Map Placeholder */}
          <div>
            <h2 className="text-lg font-semibold mb-3">Location</h2>
            <div className="h-64 rounded-xl border border-border bg-muted flex items-center justify-center">
              <div className="text-center text-muted-foreground">
                <Icons.Map className="h-10 w-10 mx-auto mb-2 opacity-40" />
                <p className="text-sm font-medium">Map</p>
                <p className="text-xs">{property.city}, {property.state} {property.zip}</p>
                {property.latitude && property.longitude && (
                  <p className="text-[10px] mt-1">{property.latitude.toFixed(4)}, {property.longitude.toFixed(4)}</p>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Agent Card */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Listing Agent</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center gap-3">
                <Avatar className="h-12 w-12">
                  <AvatarFallback className="bg-primary/10 text-primary font-semibold">
                    {agent.name.split(" ").map((n) => n[0]).join("")}
                  </AvatarFallback>
                </Avatar>
                <div>
                  <p className="font-semibold text-sm">{agent.name}</p>
                  <p className="text-xs text-muted-foreground">License #{agent.license_number}</p>
                </div>
              </div>
              <div className="space-y-1.5 text-sm text-muted-foreground">
                <div className="flex items-center gap-2"><Icons.Phone className="h-3.5 w-3.5" />{agent.phone}</div>
                <div className="flex items-center gap-2"><Icons.Mail className="h-3.5 w-3.5" />{agent.email}</div>
              </div>
              <Button variant="outline" className="w-full gap-1.5" size="sm">
                <Icons.Phone className="h-3.5 w-3.5" /> Call Agent
              </Button>
            </CardContent>
          </Card>

          {/* Contact Form */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Send Inquiry</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Input placeholder="Your Name" value={contactName} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setContactName(e.target.value)} className="h-9 text-sm" />
              <Input placeholder="Email Address" type="email" value={contactEmail} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setContactEmail(e.target.value)} className="h-9 text-sm" />
              <Input placeholder="Phone (optional)" value={contactPhone} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setContactPhone(e.target.value)} className="h-9 text-sm" />
              <Textarea placeholder="I'm interested in this property..." value={contactMessage} onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setContactMessage(e.target.value)} className="text-sm min-h-[80px]" />
              <Button className="w-full gap-1.5" onClick={handleSendInquiry} disabled={sending}>
                {sending ? <Icons.Loader2 className="h-4 w-4 animate-spin" /> : <Icons.Send className="h-4 w-4" />}
                Send Inquiry
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Similar Properties */}
      <Separator className="my-10" />
      <div>
        <h2 className="text-xl font-bold mb-6">Similar Properties</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {similar.map((p) => (
            <Card key={p.id} className="property-card overflow-hidden cursor-pointer group" onClick={() => navigation.navigate(`/property/${p.id}`)}>
              <div className="relative h-36 bg-gradient-to-br from-primary/20 to-accent/40 flex items-center justify-center">
                <Icons.Home className="h-8 w-8 text-primary/30" />
              </div>
              <CardContent className="p-4">
                <p className="price-display text-lg font-bold text-primary">{formatPrice(p.price)}</p>
                <h3 className="font-semibold text-sm mt-1 truncate group-hover:text-primary transition-colors">{p.title}</h3>
                <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                  <Icons.MapPin className="h-3 w-3" /> {p.city}, {p.state}
                </p>
                <div className="flex items-center gap-3 text-xs text-muted-foreground mt-2">
                  <span className="flex items-center gap-1"><Icons.BedDouble className="h-3.5 w-3.5" />{p.bedrooms} bd</span>
                  <span className="flex items-center gap-1"><Icons.Bath className="h-3.5 w-3.5" />{p.bathrooms} ba</span>
                  <span className="flex items-center gap-1"><Icons.Maximize2 className="h-3.5 w-3.5" />{p.sqft.toLocaleString()} sqft</span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}

export default PropertyDetail;
