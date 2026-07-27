import {
  React,
  useModel,
  useNavigation,
  toast,
  Button,
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Separator,
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
  Icons,
  cn,
} from "@exepad/sdk";

interface Ticket {
  id: number;
  event_title: string;
  event_date: string;
  venue: string;
  tier_name: string;
  ticket_code: string;
  status: "active" | "used" | "cancelled" | "refunded";
  purchased_at: string;
  is_past: boolean;
}

const DEMO_TICKETS: Ticket[] = [
  {
    id: 1,
    event_title: "Future of AI Summit 2026",
    event_date: "2026-04-22",
    venue: "Silicon Convention Center",
    tier_name: "VIP Pass",
    ticket_code: "EVT-2026-A7K2",
    status: "active",
    purchased_at: "2026-03-15T10:30:00Z",
    is_past: false,
  },
  {
    id: 2,
    event_title: "Neon Nights Music Festival",
    event_date: "2026-04-15",
    venue: "Riverside Amphitheater",
    tier_name: "General Admission",
    ticket_code: "EVT-2026-M3P9",
    status: "active",
    purchased_at: "2026-03-10T14:20:00Z",
    is_past: false,
  },
  {
    id: 3,
    event_title: "Global Street Food Festival",
    event_date: "2026-05-03",
    venue: "Waterfront Park",
    tier_name: "Premium All-Access",
    ticket_code: "EVT-2026-F5R1",
    status: "active",
    purchased_at: "2026-03-20T09:15:00Z",
    is_past: false,
  },
  {
    id: 4,
    event_title: "Jazz Under the Stars",
    event_date: "2025-11-28",
    venue: "Botanical Gardens",
    tier_name: "General Admission",
    ticket_code: "EVT-2025-J8W4",
    status: "used",
    purchased_at: "2025-11-01T16:45:00Z",
    is_past: true,
  },
  {
    id: 5,
    event_title: "Cloud & DevOps Conference",
    event_date: "2025-10-15",
    venue: "Grand Tech Center",
    tier_name: "VIP Pass",
    ticket_code: "EVT-2025-C2D6",
    status: "used",
    purchased_at: "2025-09-20T11:00:00Z",
    is_past: true,
  },
  {
    id: 6,
    event_title: "Indie Film Festival",
    event_date: "2025-09-05",
    venue: "Cinema Square",
    tier_name: "General Admission",
    ticket_code: "EVT-2025-I1N3",
    status: "cancelled",
    purchased_at: "2025-08-15T08:30:00Z",
    is_past: true,
  },
];

const STATUS_CONFIG: Record<string, { label: string; variant: "default" | "secondary" | "outline" | "destructive"; color: string }> = {
  active: { label: "Active", variant: "default", color: "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300" },
  used: { label: "Used", variant: "secondary", color: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300" },
  cancelled: { label: "Cancelled", variant: "destructive", color: "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300" },
  refunded: { label: "Refunded", variant: "outline", color: "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300" },
};

function QrPlaceholder() {
  // Simple grid pattern as a QR code visual placeholder
  const cells = [];
  for (let r = 0; r < 7; r++) {
    for (let c = 0; c < 7; c++) {
      const isFilled =
        // Corner squares
        (r < 3 && c < 3) ||
        (r < 3 && c > 3) ||
        (r > 3 && c < 3) ||
        // Some inner pattern
        ((r + c) % 3 === 0);
      cells.push(
        <div
          key={`${r}-${c}`}
          className={cn(
            "rounded-sm",
            isFilled ? "bg-foreground" : "bg-transparent"
          )}
        />
      );
    }
  }
  return (
    <div className="w-24 h-24 p-2 bg-white rounded-lg border-2 border-border">
      <div className="grid grid-cols-7 grid-rows-7 gap-0.5 w-full h-full">
        {cells}
      </div>
    </div>
  );
}

function TicketCard({ ticket }: { ticket: Ticket }) {
  const navigation = useNavigation();
  const status = STATUS_CONFIG[ticket.status] || STATUS_CONFIG.active;

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr + "T00:00:00");
    return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
  };

  const handleDownload = () => {
    toast("Preparing PDF download... (demo mode)");
  };

  return (
    <Card className="event-card overflow-hidden">
      <CardContent className="p-0">
        <div className="flex flex-col sm:flex-row">
          {/* Left section - ticket info */}
          <div className="flex-1 p-5 space-y-3">
            <div className="flex items-start justify-between">
              <div>
                <h3
                  className="font-semibold text-base cursor-pointer hover:text-primary transition-colors"
                  onClick={() => navigation.navigate(`/event/${ticket.id}`)}
                >
                  {ticket.event_title}
                </h3>
                <div className="flex flex-wrap items-center gap-3 mt-1.5 text-sm text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <Icons.CalendarDays className="h-3.5 w-3.5" />
                    {formatDate(ticket.event_date)}
                  </span>
                  <span className="flex items-center gap-1">
                    <Icons.MapPin className="h-3.5 w-3.5" />
                    {ticket.venue}
                  </span>
                </div>
              </div>
              <Badge className={cn("text-xs shrink-0", status.color)}>
                {status.label}
              </Badge>
            </div>

            <Separator />

            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground">Tier</p>
                <p className="text-sm font-medium">{ticket.tier_name}</p>
              </div>
              <div className="text-right">
                <p className="text-xs text-muted-foreground">Ticket Code</p>
                <p className="ticket-code text-sm font-bold text-primary">{ticket.ticket_code}</p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={handleDownload}>
                <Icons.Download className="h-3.5 w-3.5 mr-1.5" />
                Download PDF
              </Button>
              {ticket.status === "active" && (
                <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive">
                  <Icons.X className="h-3.5 w-3.5 mr-1.5" />
                  Cancel
                </Button>
              )}
            </div>
          </div>

          {/* Right section - QR placeholder */}
          <div className="sm:border-l border-t sm:border-t-0 border-border border-dashed p-5 flex flex-col items-center justify-center bg-muted/30 sm:w-40">
            <QrPlaceholder />
            <p className="text-[10px] text-muted-foreground mt-2 text-center">
              Scan at entry
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function MyTickets() {
  const ticketsModel = useModel("tickets");
  const tickets = (ticketsModel?.data as any[] | null) ?? DEMO_TICKETS;
  const navigation = useNavigation();

  const upcomingTickets = DEMO_TICKETS.filter((t) => !t.is_past);
  const pastTickets = DEMO_TICKETS.filter((t) => t.is_past);

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold">My Tickets</h1>
          <p className="text-muted-foreground mt-1">
            {DEMO_TICKETS.length} ticket{DEMO_TICKETS.length !== 1 ? "s" : ""} total
          </p>
        </div>
        <Button onClick={() => navigation.navigate("/events")}>
          <Icons.Plus className="h-4 w-4 mr-2" />
          Browse Events
        </Button>
      </div>

      <Tabs defaultValue="upcoming">
        <TabsList className="mb-6">
          <TabsTrigger value="upcoming">
            Upcoming
            {upcomingTickets.length > 0 && (
              <Badge variant="secondary" className="ml-2 h-5 px-1.5 text-xs">
                {upcomingTickets.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="past">
            Past
            {pastTickets.length > 0 && (
              <Badge variant="secondary" className="ml-2 h-5 px-1.5 text-xs">
                {pastTickets.length}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="upcoming">
          {upcomingTickets.length === 0 ? (
            <div className="text-center py-16">
              <Icons.Ticket className="h-12 w-12 mx-auto text-muted-foreground/30 mb-3" />
              <p className="text-lg font-medium">No upcoming tickets</p>
              <p className="text-sm text-muted-foreground mt-1">
                Browse events to find your next experience.
              </p>
              <Button className="mt-4" onClick={() => navigation.navigate("/events")}>
                Explore Events
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              {upcomingTickets.map((ticket) => (
                <TicketCard key={ticket.id} ticket={ticket} />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="past">
          {pastTickets.length === 0 ? (
            <div className="text-center py-16">
              <Icons.Clock className="h-12 w-12 mx-auto text-muted-foreground/30 mb-3" />
              <p className="text-lg font-medium">No past tickets</p>
              <p className="text-sm text-muted-foreground mt-1">
                Your attended event tickets will appear here.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {pastTickets.map((ticket) => (
                <TicketCard key={ticket.id} ticket={ticket} />
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default MyTickets;
