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
  category: string;
  start_date: string;
  venue: string;
  address: string;
  organizer: string;
  price_from: number;
  max_capacity: number;
}

const DEMO_EVENTS: Event[] = [
  { id: 1, title: "Neon Nights Music Festival", category: "music", start_date: "2026-04-15", venue: "Riverside Amphitheater", address: "500 River Rd, Austin, TX", organizer: "Sonic Collective", price_from: 75, max_capacity: 5000 },
  { id: 2, title: "Future of AI Summit 2026", category: "tech", start_date: "2026-04-22", venue: "Silicon Convention Center", address: "1200 Innovation Blvd, San Jose, CA", organizer: "TechForward Inc.", price_from: 199, max_capacity: 2000 },
  { id: 3, title: "Global Street Food Festival", category: "food", start_date: "2026-05-03", venue: "Waterfront Park", address: "100 Harbor Dr, San Diego, CA", organizer: "Foodie Nation", price_from: 25, max_capacity: 8000 },
  { id: 4, title: "Urban Marathon Challenge", category: "sports", start_date: "2026-05-10", venue: "City Center Park", address: "1 Main St, Portland, OR", organizer: "RunCity Athletics", price_from: 45, max_capacity: 10000 },
  { id: 5, title: "Jazz Under the Stars", category: "music", start_date: "2026-04-28", venue: "Botanical Gardens", address: "350 Garden Ave, New Orleans, LA", organizer: "Jazz Heritage Society", price_from: 55, max_capacity: 1500 },
  { id: 6, title: "Startup Pitch Night", category: "business", start_date: "2026-05-15", venue: "Innovation Hub", address: "88 Market St, San Francisco, CA", organizer: "Founder's Circle", price_from: 0, max_capacity: 300 },
  { id: 7, title: "Contemporary Art Exhibition", category: "arts", start_date: "2026-05-20", venue: "Metropolitan Gallery", address: "42 Arts District, New York, NY", organizer: "Art Forward", price_from: 30, max_capacity: 500 },
  { id: 8, title: "Cloud & DevOps Conference", category: "tech", start_date: "2026-06-05", venue: "Grand Tech Center", address: "900 Cloud Way, Seattle, WA", organizer: "CloudNative Events", price_from: 299, max_capacity: 3000 },
];

const CATEGORIES = [
  { label: "Music", slug: "music", icon: "Music" as keyof typeof Icons, color: "bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300" },
  { label: "Tech", slug: "tech", icon: "Cpu" as keyof typeof Icons, color: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300" },
  { label: "Food", slug: "food", icon: "UtensilsCrossed" as keyof typeof Icons, color: "bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300" },
  { label: "Sports", slug: "sports", icon: "Trophy" as keyof typeof Icons, color: "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300" },
  { label: "Arts", slug: "arts", icon: "Palette" as keyof typeof Icons, color: "bg-pink-100 text-pink-700 dark:bg-pink-900 dark:text-pink-300" },
  { label: "Business", slug: "business", icon: "Briefcase" as keyof typeof Icons, color: "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300" },
];

const STATS = [
  { value: "5,000+", label: "Events", icon: "CalendarDays" as keyof typeof Icons },
  { value: "100K+", label: "Tickets Sold", icon: "Ticket" as keyof typeof Icons },
  { value: "500+", label: "Organizers", icon: "Users" as keyof typeof Icons },
];

function EventHome() {
  const navigation = useNavigation();
  const eventsModel = useModel("events");
  const events = (eventsModel?.data as any[] | null) ?? DEMO_EVENTS;
  const [searchQuery, setSearchQuery] = React.useState("");
  const [selectedCat, setSelectedCat] = useAppState<string>("selectedCategory", "all");

  const featured = DEMO_EVENTS.slice(0, 3);
  const upcoming = DEMO_EVENTS.slice(3, 7);

  const handleSearch = () => {
    if (searchQuery.trim()) {
      navigation.navigate("/events");
      toast(`Searching for "${searchQuery}"...`);
    }
  };

  const handleCategoryClick = (slug: string) => {
    setSelectedCat(slug);
    navigation.navigate("/events");
  };

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr + "T00:00:00");
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  };

  return (
    <div className="w-full">
      {/* Hero Section */}
      <section className="relative overflow-hidden bg-gradient-to-br from-primary/5 via-accent/30 to-secondary/50 py-16 sm:py-24">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_50%,hsl(var(--primary)/0.08),transparent_50%)]" />
        <div className="relative max-w-4xl mx-auto text-center px-4 sm:px-6">
          <Badge variant="secondary" className="mb-4 px-3 py-1 text-sm">
            <Icons.Sparkles className="h-3.5 w-3.5 mr-1.5" />
            Discover What's Happening Near You
          </Badge>
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight mb-4">
            Discover <span className="text-primary">Amazing Events</span>
          </h1>
          <p className="text-lg sm:text-xl text-muted-foreground mb-8 max-w-2xl mx-auto">
            Find and book tickets for concerts, conferences, festivals, and more.
            Your next unforgettable experience is just a click away.
          </p>

          {/* Search bar */}
          <div className="flex flex-col sm:flex-row gap-3 max-w-2xl mx-auto">
            <div className="flex-1 relative">
              <Icons.Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search events, venues, organizers..."
                className="pl-10 h-12"
                value={searchQuery}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearchQuery(e.target.value)}
                onKeyDown={(e: React.KeyboardEvent) => e.key === "Enter" && handleSearch()}
              />
            </div>
            <Select value={selectedCat ?? "all"} onValueChange={(v: string) => setSelectedCat(v)}>
              <SelectTrigger className="w-full sm:w-[160px] h-12">
                <SelectValue placeholder="Category" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Categories</SelectItem>
                {CATEGORIES.map((cat) => (
                  <SelectItem key={cat.slug} value={cat.slug}>{cat.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button className="h-12 px-6" onClick={handleSearch}>
              <Icons.Search className="h-4 w-4 mr-2" />
              Find Events
            </Button>
          </div>
        </div>
      </section>

      {/* Featured Events */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 py-12">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-2xl font-bold">Featured Events</h2>
            <p className="text-sm text-muted-foreground mt-1">Handpicked experiences you won't want to miss</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => navigation.navigate("/events")}>
            View All <Icons.ArrowRight className="h-4 w-4 ml-1" />
          </Button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {featured.map((event) => (
            <Card
              key={event.id}
              className="event-card overflow-hidden cursor-pointer group"
              onClick={() => navigation.navigate(`/event/${event.id}`)}
            >
              {/* Image placeholder */}
              <div className="relative h-48 bg-gradient-to-br from-primary/20 via-accent to-secondary flex items-center justify-center">
                <Icons.CalendarDays className="h-12 w-12 text-primary/40" />
                <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
                <div className="absolute bottom-3 left-3 right-3 text-white">
                  <div className="date-badge inline-block bg-primary rounded-md px-2 py-1 text-xs font-semibold mb-2">
                    {formatDate(event.start_date)}
                  </div>
                  <h3 className="text-lg font-bold leading-tight">{event.title}</h3>
                  <p className="text-sm text-white/80 mt-1 flex items-center gap-1">
                    <Icons.MapPin className="h-3 w-3" />
                    {event.venue}
                  </p>
                </div>
              </div>
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <Badge variant="secondary" className="text-xs capitalize">{event.category}</Badge>
                  <span className="text-sm font-semibold text-primary">
                    {event.price_from === 0 ? "Free" : `From $${event.price_from}`}
                  </span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      {/* Category Grid */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 py-12">
        <div className="text-center mb-8">
          <h2 className="text-2xl font-bold">Browse by Category</h2>
          <p className="text-sm text-muted-foreground mt-1">Find events that match your interests</p>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
          {CATEGORIES.map((cat) => {
            const CatIcon = Icons[cat.icon] as React.ComponentType<{ className?: string }>;
            return (
              <Card
                key={cat.slug}
                className="event-card cursor-pointer text-center p-6 hover:border-primary/50"
                onClick={() => handleCategoryClick(cat.slug)}
              >
                <div className={cn("mx-auto h-12 w-12 rounded-xl flex items-center justify-center mb-3", cat.color)}>
                  {CatIcon && <CatIcon className="h-6 w-6" />}
                </div>
                <p className="text-sm font-semibold">{cat.label}</p>
              </Card>
            );
          })}
        </div>
      </section>

      {/* Upcoming Events */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 py-12">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-2xl font-bold">Upcoming Events</h2>
            <p className="text-sm text-muted-foreground mt-1">Don't miss out on these upcoming experiences</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => navigation.navigate("/events")}>
            See More <Icons.ArrowRight className="h-4 w-4 ml-1" />
          </Button>
        </div>
        <div className="space-y-4">
          {upcoming.map((event) => (
            <Card
              key={event.id}
              className="event-card cursor-pointer"
              onClick={() => navigation.navigate(`/event/${event.id}`)}
            >
              <CardContent className="p-4 flex flex-col sm:flex-row items-start sm:items-center gap-4">
                {/* Date badge */}
                <div className="date-badge flex flex-col items-center justify-center rounded-xl bg-primary/10 px-4 py-3 shrink-0">
                  <span className="text-xs font-semibold text-primary uppercase">
                    {new Date(event.start_date + "T00:00:00").toLocaleDateString("en-US", { month: "short" })}
                  </span>
                  <span className="text-2xl font-bold text-primary">
                    {new Date(event.start_date + "T00:00:00").getDate()}
                  </span>
                </div>
                {/* Event info */}
                <div className="flex-1 min-w-0">
                  <h3 className="text-base font-semibold truncate">{event.title}</h3>
                  <div className="flex flex-wrap items-center gap-3 mt-1 text-sm text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Icons.MapPin className="h-3.5 w-3.5" />
                      {event.venue}
                    </span>
                    <span className="flex items-center gap-1">
                      <Icons.Users className="h-3.5 w-3.5" />
                      {event.organizer}
                    </span>
                  </div>
                </div>
                {/* Price + CTA */}
                <div className="flex items-center gap-3 shrink-0">
                  <Badge variant="secondary" className="capitalize text-xs">{event.category}</Badge>
                  <span className="text-sm font-bold text-primary">
                    {event.price_from === 0 ? "Free" : `$${event.price_from}`}
                  </span>
                  <Button size="sm" variant="outline">
                    <Icons.Ticket className="h-4 w-4 mr-1" />
                    Tickets
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      {/* Stats Section */}
      <section className="bg-primary/5 border-y border-border py-12">
        <div className="max-w-4xl mx-auto px-4 sm:px-6">
          <div className="grid grid-cols-3 gap-8 text-center">
            {STATS.map((stat) => {
              const StatIcon = Icons[stat.icon] as React.ComponentType<{ className?: string }>;
              return (
                <div key={stat.label} className="space-y-2">
                  {StatIcon && <StatIcon className="h-6 w-6 mx-auto text-primary" />}
                  <div className="text-3xl font-extrabold">{stat.value}</div>
                  <div className="text-sm text-muted-foreground">{stat.label}</div>
                </div>
              );
            })}
          </div>
        </div>
      </section>
    </div>
  );
}

export default EventHome;
