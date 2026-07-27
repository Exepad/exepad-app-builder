import {
  React,
  useModel,
  useAppState,
  useNavigation,
  toast,
  Input,
  Button,
  Badge,
  Card,
  CardContent,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  Separator,
  Icons,
  cn,
} from "@exepad/sdk";

interface Event {
  id: number;
  title: string;
  description: string;
  category: string;
  start_date: string;
  end_date: string;
  venue: string;
  address: string;
  organizer: string;
  price_from: number;
  price_to: number;
  max_capacity: number;
  status: string;
}

const DEMO_EVENTS: Event[] = [
  { id: 1, title: "Neon Nights Music Festival", description: "Three days of incredible live performances", category: "music", start_date: "2026-04-15", end_date: "2026-04-17", venue: "Riverside Amphitheater", address: "500 River Rd, Austin, TX", organizer: "Sonic Collective", price_from: 75, price_to: 350, max_capacity: 5000, status: "published" },
  { id: 2, title: "Future of AI Summit 2026", description: "Explore the cutting edge of artificial intelligence", category: "tech", start_date: "2026-04-22", end_date: "2026-04-23", venue: "Silicon Convention Center", address: "1200 Innovation Blvd, San Jose, CA", organizer: "TechForward Inc.", price_from: 199, price_to: 599, max_capacity: 2000, status: "published" },
  { id: 3, title: "Global Street Food Festival", description: "Taste cuisines from around the world", category: "food", start_date: "2026-05-03", end_date: "2026-05-05", venue: "Waterfront Park", address: "100 Harbor Dr, San Diego, CA", organizer: "Foodie Nation", price_from: 25, price_to: 75, max_capacity: 8000, status: "published" },
  { id: 4, title: "Urban Marathon Challenge", description: "Run through the city's most scenic routes", category: "sports", start_date: "2026-05-10", end_date: "2026-05-10", venue: "City Center Park", address: "1 Main St, Portland, OR", organizer: "RunCity Athletics", price_from: 45, price_to: 120, max_capacity: 10000, status: "published" },
  { id: 5, title: "Jazz Under the Stars", description: "An evening of smooth jazz in the gardens", category: "music", start_date: "2026-04-28", end_date: "2026-04-28", venue: "Botanical Gardens", address: "350 Garden Ave, New Orleans, LA", organizer: "Jazz Heritage Society", price_from: 55, price_to: 150, max_capacity: 1500, status: "published" },
  { id: 6, title: "Startup Pitch Night", description: "Watch 20 startups pitch to top VCs", category: "business", start_date: "2026-05-15", end_date: "2026-05-15", venue: "Innovation Hub", address: "88 Market St, San Francisco, CA", organizer: "Founder's Circle", price_from: 0, price_to: 0, max_capacity: 300, status: "published" },
  { id: 7, title: "Contemporary Art Exhibition", description: "Emerging artists showcase modern works", category: "arts", start_date: "2026-05-20", end_date: "2026-06-20", venue: "Metropolitan Gallery", address: "42 Arts District, New York, NY", organizer: "Art Forward", price_from: 30, price_to: 50, max_capacity: 500, status: "published" },
  { id: 8, title: "Cloud & DevOps Conference", description: "Master cloud-native development practices", category: "tech", start_date: "2026-06-05", end_date: "2026-06-07", venue: "Grand Tech Center", address: "900 Cloud Way, Seattle, WA", organizer: "CloudNative Events", price_from: 299, price_to: 799, max_capacity: 3000, status: "published" },
  { id: 9, title: "Indie Film Festival", description: "Premiering 50 independent films", category: "arts", start_date: "2026-06-12", end_date: "2026-06-15", venue: "Cinema Square", address: "210 Film Row, Los Angeles, CA", organizer: "IndieScreen", price_from: 20, price_to: 85, max_capacity: 2000, status: "published" },
  { id: 10, title: "Craft Beer & BBQ Fest", description: "Local breweries and pitmasters unite", category: "food", start_date: "2026-06-20", end_date: "2026-06-21", venue: "Heritage Fairgrounds", address: "450 County Rd, Nashville, TN", organizer: "Brews & Bites Co.", price_from: 35, price_to: 95, max_capacity: 6000, status: "published" },
  { id: 11, title: "Women in Tech Leadership", description: "Empowering the next generation of leaders", category: "business", start_date: "2026-07-01", end_date: "2026-07-02", venue: "Grand Ballroom Hotel", address: "1500 Executive Blvd, Chicago, IL", organizer: "TechWomen Global", price_from: 149, price_to: 399, max_capacity: 800, status: "published" },
  { id: 12, title: "Electronic Dance Music Night", description: "Top DJs spinning until dawn", category: "music", start_date: "2026-07-10", end_date: "2026-07-10", venue: "Warehouse 23", address: "23 Industrial Ave, Miami, FL", organizer: "BeatDrop Events", price_from: 60, price_to: 200, max_capacity: 4000, status: "published" },
  { id: 13, title: "CrossFit Open Games", description: "Regional qualifying competition", category: "sports", start_date: "2026-07-18", end_date: "2026-07-20", venue: "Olympic Training Center", address: "300 Athlete Way, Denver, CO", organizer: "FitNation", price_from: 30, price_to: 80, max_capacity: 5000, status: "published" },
  { id: 14, title: "Photography Masterclass", description: "Learn from Pulitzer Prize winners", category: "arts", start_date: "2026-07-25", end_date: "2026-07-26", venue: "Studio Loft", address: "55 Creative Lane, Brooklyn, NY", organizer: "LensWork Academy", price_from: 175, price_to: 450, max_capacity: 200, status: "published" },
  { id: 15, title: "Vegan Food & Wellness Expo", description: "Plant-based living for everyone", category: "food", start_date: "2026-08-02", end_date: "2026-08-03", venue: "Green Convention Hall", address: "88 Wellness Dr, Boulder, CO", organizer: "PlantLife Events", price_from: 15, price_to: 55, max_capacity: 4000, status: "published" },
  { id: 16, title: "Blockchain Summit 2026", description: "The future of decentralized technology", category: "tech", start_date: "2026-08-10", end_date: "2026-08-12", venue: "Crypto Center", address: "700 Web3 Blvd, Austin, TX", organizer: "Chain Events", price_from: 249, price_to: 699, max_capacity: 1500, status: "published" },
];

const CATEGORIES = [
  { label: "All", value: "all" },
  { label: "Music", value: "music" },
  { label: "Tech", value: "tech" },
  { label: "Food", value: "food" },
  { label: "Sports", value: "sports" },
  { label: "Arts", value: "arts" },
  { label: "Business", value: "business" },
];

const SORT_OPTIONS = [
  { label: "Date (Soonest)", value: "date_asc" },
  { label: "Date (Latest)", value: "date_desc" },
  { label: "Price (Low to High)", value: "price_asc" },
  { label: "Price (High to Low)", value: "price_desc" },
  { label: "Popularity", value: "popularity" },
];

const CATEGORY_COLORS: Record<string, string> = {
  music: "bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300",
  tech: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
  food: "bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300",
  sports: "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300",
  arts: "bg-pink-100 text-pink-700 dark:bg-pink-900 dark:text-pink-300",
  business: "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300",
};

const ITEMS_PER_PAGE = 6;

function EventsList() {
  const navigation = useNavigation();
  const eventsModel = useModel("events");
  const events = (eventsModel?.data as any[] | null) ?? DEMO_EVENTS;
  const [selectedCategory, setSelectedCategory] = useAppState<string>("selectedCategory", "all");
  const [searchQuery, setSearchQuery] = React.useState("");
  const [sortBy, setSortBy] = React.useState("date_asc");
  const [currentPage, setCurrentPage] = React.useState(1);

  const category = selectedCategory ?? "all";

  const filtered = React.useMemo(() => {
    let result = [...DEMO_EVENTS];

    if (category !== "all") {
      result = result.filter((e) => e.category === category);
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (e) =>
          e.title.toLowerCase().includes(q) ||
          e.venue.toLowerCase().includes(q) ||
          e.organizer.toLowerCase().includes(q)
      );
    }

    switch (sortBy) {
      case "date_asc":
        result.sort((a, b) => a.start_date.localeCompare(b.start_date));
        break;
      case "date_desc":
        result.sort((a, b) => b.start_date.localeCompare(a.start_date));
        break;
      case "price_asc":
        result.sort((a, b) => a.price_from - b.price_from);
        break;
      case "price_desc":
        result.sort((a, b) => b.price_from - a.price_from);
        break;
      case "popularity":
        result.sort((a, b) => b.max_capacity - a.max_capacity);
        break;
    }

    return result;
  }, [category, searchQuery, sortBy]);

  const totalPages = Math.ceil(filtered.length / ITEMS_PER_PAGE);
  const paginated = filtered.slice(
    (currentPage - 1) * ITEMS_PER_PAGE,
    currentPage * ITEMS_PER_PAGE
  );

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr + "T00:00:00");
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-3xl font-bold">Events</h1>
        <p className="text-muted-foreground mt-1">
          {filtered.length} event{filtered.length !== 1 ? "s" : ""} found
        </p>
      </div>

      {/* Filter bar */}
      <Card className="mb-6">
        <CardContent className="p-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="flex-1 relative">
              <Icons.Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search events..."
                className="pl-10"
                value={searchQuery}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                  setSearchQuery(e.target.value);
                  setCurrentPage(1);
                }}
              />
            </div>
            <Select
              value={category}
              onValueChange={(v: string) => {
                setSelectedCategory(v);
                setCurrentPage(1);
              }}
            >
              <SelectTrigger className="w-full sm:w-[160px]">
                <SelectValue placeholder="Category" />
              </SelectTrigger>
              <SelectContent>
                {CATEGORIES.map((cat) => (
                  <SelectItem key={cat.value} value={cat.value}>{cat.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={sortBy} onValueChange={setSortBy}>
              <SelectTrigger className="w-full sm:w-[180px]">
                <SelectValue placeholder="Sort by" />
              </SelectTrigger>
              <SelectContent>
                {SORT_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Events grid */}
      {paginated.length === 0 ? (
        <div className="text-center py-16">
          <Icons.CalendarX className="h-12 w-12 mx-auto text-muted-foreground/30 mb-3" />
          <p className="text-lg font-medium">No events found</p>
          <p className="text-sm text-muted-foreground mt-1">Try adjusting your filters or search query.</p>
          <Button
            variant="outline"
            className="mt-4"
            onClick={() => {
              setSelectedCategory("all");
              setSearchQuery("");
            }}
          >
            Clear Filters
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {paginated.map((event) => (
            <Card
              key={event.id}
              className="event-card overflow-hidden cursor-pointer group"
              onClick={() => navigation.navigate(`/event/${event.id}`)}
            >
              {/* Image placeholder */}
              <div className="relative h-44 bg-gradient-to-br from-primary/20 via-accent to-secondary/60 flex items-center justify-center overflow-hidden">
                <Icons.Image className="h-10 w-10 text-primary/30" />
                {/* Date badge overlay */}
                <div className="absolute top-3 left-3 date-badge bg-background/90 backdrop-blur-sm rounded-lg px-3 py-1.5 shadow-sm">
                  <div className="text-xs font-bold text-primary uppercase">
                    {new Date(event.start_date + "T00:00:00").toLocaleDateString("en-US", { month: "short" })}
                  </div>
                  <div className="text-lg font-bold leading-tight text-center">
                    {new Date(event.start_date + "T00:00:00").getDate()}
                  </div>
                </div>
              </div>

              <CardContent className="p-4 space-y-3">
                <div>
                  <h3 className="font-semibold text-base truncate group-hover:text-primary transition-colors">
                    {event.title}
                  </h3>
                  <p className="text-sm text-muted-foreground mt-1 flex items-center gap-1">
                    <Icons.MapPin className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">{event.venue}</span>
                  </p>
                </div>

                <div className="flex items-center justify-between">
                  <Badge className={cn("text-xs capitalize", CATEGORY_COLORS[event.category] || "")}>
                    {event.category}
                  </Badge>
                  <span className="text-sm font-bold text-primary">
                    {event.price_from === 0
                      ? "Free"
                      : `$${event.price_from} - $${event.price_to}`}
                  </span>
                </div>

                <Button className="w-full" size="sm">
                  <Icons.Ticket className="h-4 w-4 mr-2" />
                  Get Tickets
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 mt-8">
          <Button
            variant="outline"
            size="sm"
            disabled={currentPage === 1}
            onClick={() => setCurrentPage((p) => p - 1)}
          >
            <Icons.ChevronLeft className="h-4 w-4" />
          </Button>
          {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
            <Button
              key={page}
              variant={page === currentPage ? "default" : "outline"}
              size="sm"
              className="w-9"
              onClick={() => setCurrentPage(page)}
            >
              {page}
            </Button>
          ))}
          <Button
            variant="outline"
            size="sm"
            disabled={currentPage === totalPages}
            onClick={() => setCurrentPage((p) => p + 1)}
          >
            <Icons.ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  );
}

export default EventsList;
