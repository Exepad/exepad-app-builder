import {
  React,
  useModel,
  useHandler,
  useNavigation,
  useAppState,
  toast,
  Button,
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Separator,
  Icons,
  cn,
} from "@exepad/sdk";

interface EventData {
  id: number;
  title: string;
  description: string;
  category: string;
  start_date: string;
  end_date: string;
  venue: string;
  address: string;
  organizer: string;
  max_capacity: number;
  status: string;
}

interface TicketTier {
  id: number;
  name: string;
  price: number;
  quantity: number;
  available: number;
  description: string;
}

interface Speaker {
  id: number;
  name: string;
  title: string;
  bio: string;
  initials: string;
}

interface ScheduleItem {
  time: string;
  title: string;
  description: string;
}

const DEMO_EVENT: EventData = {
  id: 1,
  title: "Future of AI Summit 2026",
  description: "Join over 2,000 technology leaders, researchers, and entrepreneurs for the most anticipated AI conference of the year. The Future of AI Summit brings together the brightest minds in artificial intelligence to explore breakthroughs in machine learning, natural language processing, computer vision, and robotics.\n\nThis two-day event features 40+ sessions, hands-on workshops, live product demos, and unparalleled networking opportunities. Whether you're building AI products, investing in AI companies, or researching the next frontier of intelligence, this summit is designed to inspire and connect.\n\nHighlights include keynotes from Nobel laureates, a startup showcase featuring 50 AI-first companies, and an exclusive hackathon with $100K in prizes. Don't miss the evening reception at the rooftop lounge with panoramic city views.",
  category: "tech",
  start_date: "2026-04-22",
  end_date: "2026-04-23",
  venue: "Silicon Convention Center",
  address: "1200 Innovation Blvd, San Jose, CA 95112",
  organizer: "TechForward Inc.",
  max_capacity: 2000,
  status: "published",
};

const DEMO_TIERS: TicketTier[] = [
  { id: 1, name: "General Admission", price: 199, quantity: 1200, available: 847, description: "Access to all main stage sessions and expo hall" },
  { id: 2, name: "VIP Pass", price: 449, quantity: 500, available: 213, description: "Priority seating, VIP lounge access, lunch included, and meet & greet with speakers" },
  { id: 3, name: "Premium All-Access", price: 799, quantity: 300, available: 64, description: "Everything in VIP plus workshop access, hackathon entry, recording access, and exclusive swag bag" },
];

const DEMO_SPEAKERS: Speaker[] = [
  { id: 1, name: "Dr. Elena Vasquez", title: "Head of AI Research, DeepMind", bio: "Leading researcher in reinforcement learning and neural architecture search with over 200 publications.", initials: "EV" },
  { id: 2, name: "Marcus Chen", title: "CTO, NeuralPath Labs", bio: "Serial entrepreneur who built three AI unicorns. Pioneer in real-time computer vision systems.", initials: "MC" },
  { id: 3, name: "Prof. Aisha Okonkwo", title: "Director, MIT AI Ethics Lab", bio: "Award-winning researcher focused on responsible AI development and algorithmic fairness.", initials: "AO" },
];

const DEMO_SCHEDULE: ScheduleItem[] = [
  { time: "08:00 AM", title: "Registration & Breakfast", description: "Check in and enjoy complimentary breakfast in the expo hall" },
  { time: "09:00 AM", title: "Opening Keynote: The Next Decade of AI", description: "Dr. Elena Vasquez sets the stage for two days of innovation" },
  { time: "10:30 AM", title: "Panel: Building Responsible AI Products", description: "Industry leaders discuss ethics, bias, and transparency" },
  { time: "12:00 PM", title: "Networking Lunch", description: "Curated lunch with table topics and startup demos" },
  { time: "01:30 PM", title: "Workshop: Hands-on with Large Language Models", description: "Build, fine-tune, and deploy your own LLM application" },
  { time: "03:00 PM", title: "Startup Showcase & Pitch Competition", description: "50 AI startups demo their products to judges and investors" },
  { time: "05:00 PM", title: "Closing Keynote & Awards Ceremony", description: "Hackathon winners announced, key takeaways, and closing remarks" },
  { time: "06:30 PM", title: "Rooftop Reception", description: "Evening networking event with drinks and panoramic city views" },
];

function EventDetail() {
  const navigation = useNavigation();
  const eventModel = useModel("events");
  const purchaseTicket = useHandler("purchaseTicket", {
    onSuccess: () => toast("Ticket purchased successfully!"),
    onError: () => toast("Purchase failed. Please try again."),
  });

  const event = DEMO_EVENT;

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr + "T00:00:00");
    return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  };

  const handleBuyTicket = (tier: TicketTier) => {
    if (purchaseTicket) {
      purchaseTicket({ event_id: event.id, tier_id: tier.id, quantity: 1 });
    } else {
      toast(`Added 1x ${tier.name} ($${tier.price}) to cart!`);
    }
  };

  const availabilityStatus = (tier: TicketTier) => {
    const pct = tier.available / tier.quantity;
    if (pct <= 0) return { label: "Sold Out", color: "text-destructive", variant: "destructive" as const };
    if (pct <= 0.1) return { label: "Almost Gone", color: "text-orange-600", variant: "secondary" as const };
    if (pct <= 0.3) return { label: "Selling Fast", color: "text-amber-600", variant: "secondary" as const };
    return { label: `${tier.available} left`, color: "text-green-600", variant: "secondary" as const };
  };

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
      {/* Back button */}
      <Button variant="ghost" size="sm" className="mb-4 -ml-2" onClick={() => navigation.navigate("/events")}>
        <Icons.ArrowLeft className="h-4 w-4 mr-1" />
        Back to Events
      </Button>

      {/* Banner */}
      <div className="relative rounded-2xl overflow-hidden mb-8">
        <div className="h-64 sm:h-80 bg-gradient-to-br from-primary/30 via-accent to-secondary/60 flex items-center justify-center">
          <Icons.CalendarDays className="h-16 w-16 text-primary/30" />
        </div>
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
        <div className="absolute bottom-6 left-6 right-6 text-white">
          <Badge className="mb-2 capitalize bg-primary text-primary-foreground">{event.category}</Badge>
          <h1 className="text-3xl sm:text-4xl font-bold mb-2">{event.title}</h1>
          <p className="text-white/80">by {event.organizer}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Main content */}
        <div className="lg:col-span-2 space-y-8">
          {/* Event info bar */}
          <Card>
            <CardContent className="p-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                    <Icons.CalendarDays className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Date</p>
                    <p className="text-sm font-medium">{formatDate(event.start_date)}</p>
                    {event.start_date !== event.end_date && (
                      <p className="text-xs text-muted-foreground">to {formatDate(event.end_date)}</p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                    <Icons.MapPin className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Venue</p>
                    <p className="text-sm font-medium">{event.venue}</p>
                    <p className="text-xs text-muted-foreground">{event.address}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                    <Icons.Users className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Capacity</p>
                    <p className="text-sm font-medium">{event.max_capacity.toLocaleString()} attendees</p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Description */}
          <div>
            <h2 className="text-xl font-bold mb-3">About This Event</h2>
            <div className="text-sm text-muted-foreground leading-relaxed whitespace-pre-line">
              {event.description}
            </div>
          </div>

          {/* Schedule */}
          <div>
            <h2 className="text-xl font-bold mb-4">Event Schedule</h2>
            <div className="space-y-3">
              {DEMO_SCHEDULE.map((item, idx) => (
                <div key={idx} className="flex gap-4 items-start">
                  <div className="shrink-0 w-20 text-right">
                    <span className="text-sm font-semibold text-primary">{item.time}</span>
                  </div>
                  <div className="flex flex-col items-center shrink-0">
                    <div className="h-3 w-3 rounded-full bg-primary border-2 border-background ring-2 ring-primary/20" />
                    {idx < DEMO_SCHEDULE.length - 1 && <div className="w-px h-full min-h-[40px] bg-border" />}
                  </div>
                  <div className="pb-4">
                    <p className="text-sm font-semibold">{item.title}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{item.description}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Speakers */}
          <div>
            <h2 className="text-xl font-bold mb-4">Speakers</h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {DEMO_SPEAKERS.map((speaker) => (
                <Card key={speaker.id} className="text-center p-6">
                  <div className="mx-auto h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center mb-3">
                    <span className="text-lg font-bold text-primary">{speaker.initials}</span>
                  </div>
                  <h3 className="font-semibold text-sm">{speaker.name}</h3>
                  <p className="text-xs text-primary mt-0.5">{speaker.title}</p>
                  <p className="text-xs text-muted-foreground mt-2 line-clamp-3">{speaker.bio}</p>
                </Card>
              ))}
            </div>
          </div>
        </div>

        {/* Sidebar - Tickets */}
        <div className="space-y-4">
          <Card className="sticky top-24">
            <CardHeader>
              <CardTitle className="text-lg">Get Tickets</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {DEMO_TIERS.map((tier) => {
                const status = availabilityStatus(tier);
                const isSoldOut = tier.available <= 0;
                return (
                  <div key={tier.id} className="rounded-lg border p-4 space-y-3">
                    <div className="flex items-start justify-between">
                      <div>
                        <h4 className="font-semibold text-sm">{tier.name}</h4>
                        <p className="text-xs text-muted-foreground mt-0.5">{tier.description}</p>
                      </div>
                      <span className="text-lg font-bold text-primary shrink-0 ml-3">
                        ${tier.price}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <Badge variant={status.variant} className={cn("text-xs", status.color)}>
                        {status.label}
                      </Badge>
                      <Button
                        size="sm"
                        disabled={isSoldOut}
                        onClick={() => handleBuyTicket(tier)}
                      >
                        {isSoldOut ? "Sold Out" : "Buy Now"}
                      </Button>
                    </div>
                  </div>
                );
              })}

              <Separator />

              <div className="text-center">
                <p className="text-xs text-muted-foreground">
                  <Icons.Shield className="h-3 w-3 inline mr-1" />
                  Secure checkout. Instant confirmation.
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Venue card */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Venue Information</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="h-32 rounded-lg bg-muted flex items-center justify-center">
                <Icons.Map className="h-8 w-8 text-muted-foreground/30" />
              </div>
              <h4 className="font-semibold text-sm">{event.venue}</h4>
              <p className="text-xs text-muted-foreground flex items-start gap-1">
                <Icons.MapPin className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                {event.address}
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

export default EventDetail;
