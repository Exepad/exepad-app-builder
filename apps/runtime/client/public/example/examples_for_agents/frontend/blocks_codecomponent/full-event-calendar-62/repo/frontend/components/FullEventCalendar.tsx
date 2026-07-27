import {
  React,
  useModel,
  useHandler,
  useAppState,
  toast,
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  Input,
  Textarea,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  Label,
  Card,
  CardContent,
  Button,
  ButtonGroup,
  Badge,
  Icons,
  cn,
} from "@exepad/sdk";
import * as FullCalendarM from "@exepad/ext-fullcalendar";
const FullCalendar: any = (FullCalendarM as any).default ? { ...FullCalendarM, ...(FullCalendarM as any).default } : FullCalendarM;

// Resolve plugins safely — they may be direct named exports or nested inside .default
const resolvePlugin = (name: string): any => {
  return (FullCalendarM as any)[name] || (FullCalendar as any)[name] || ((FullCalendarM as any).default && (FullCalendarM as any).default[name]) || null;
};
const calendarPlugins = [
  resolvePlugin("dayGridPlugin"),
  resolvePlugin("timeGridPlugin"),
  resolvePlugin("interactionPlugin"),
  resolvePlugin("listPlugin"),
].filter(Boolean);

interface CalendarEvent {
  id: string;
  title: string;
  start: string;
  end: string;
  category: "meeting" | "deadline" | "social" | "personal";
  description?: string;
  allDay?: boolean;
}

type CalendarView = "dayGridMonth" | "timeGridWeek" | "timeGridDay" | "listWeek";

const CATEGORY_COLORS: Record<string, { bg: string; border: string; badge: string }> = {
  meeting: { bg: "#3b82f6", border: "#2563eb", badge: "bg-blue-500 text-white" },
  deadline: { bg: "#ef4444", border: "#dc2626", badge: "bg-red-500 text-white" },
  social: { bg: "#22c55e", border: "#16a34a", badge: "bg-green-500 text-white" },
  personal: { bg: "#a855f7", border: "#9333ea", badge: "bg-purple-500 text-white" },
};

const VIEW_OPTIONS: { value: CalendarView; label: string; icon: keyof typeof Icons }[] = [
  { value: "dayGridMonth", label: "Month", icon: "CalendarDays" },
  { value: "timeGridWeek", label: "Week", icon: "Columns3" },
  { value: "timeGridDay", label: "Day", icon: "CalendarClock" },
  { value: "listWeek", label: "List", icon: "List" },
];

function generateDemoEvents(): CalendarEvent[] {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const events: CalendarEvent[] = [];
  const titles = [
    { title: "Team Standup", category: "meeting" as const, duration: 0.5 },
    { title: "Sprint Planning", category: "meeting" as const, duration: 2 },
    { title: "Project Deadline", category: "deadline" as const, duration: 0, allDay: true },
    { title: "Coffee Chat", category: "social" as const, duration: 1 },
    { title: "Design Review", category: "meeting" as const, duration: 1.5 },
    { title: "Gym Session", category: "personal" as const, duration: 1 },
    { title: "Client Call", category: "meeting" as const, duration: 1 },
    { title: "Release Deadline", category: "deadline" as const, duration: 0, allDay: true },
    { title: "Team Lunch", category: "social" as const, duration: 1.5 },
    { title: "Code Review", category: "meeting" as const, duration: 1 },
    { title: "Yoga Class", category: "personal" as const, duration: 1 },
    { title: "Product Demo", category: "meeting" as const, duration: 2 },
    { title: "Hackathon", category: "social" as const, duration: 8, allDay: true },
    { title: "1-on-1", category: "meeting" as const, duration: 0.5 },
    { title: "Reading Time", category: "personal" as const, duration: 1 },
  ];

  titles.forEach((t, i) => {
    const day = ((i * 2 + 3) % 28) + 1;
    const hour = 9 + (i % 8);
    const start = new Date(year, month, day, t.allDay ? 0 : hour);
    const end = new Date(year, month, day, t.allDay ? 23 : hour + t.duration, t.allDay ? 59 : 0);
    events.push({
      id: `evt-${i + 1}`,
      title: t.title,
      start: start.toISOString(),
      end: end.toISOString(),
      category: t.category,
      description: `Details for ${t.title} event.`,
      allDay: t.allDay || false,
    });
  });

  return events;
}

const DEMO_EVENTS = generateDemoEvents();

function FullEventCalendar() {
  const [currentView, setCurrentView] = useAppState<CalendarView>("calendarView", "dayGridMonth");
  const [selectedRange, setSelectedRange] = useAppState<{ start: string; end: string } | null>("selectedRange", null);

  const [events, setEvents] = React.useState<CalendarEvent[]>(DEMO_EVENTS);
  const [createOpen, setCreateOpen] = React.useState(false);
  const [detailOpen, setDetailOpen] = React.useState(false);
  const [selectedEvent, setSelectedEvent] = React.useState<CalendarEvent | null>(null);

  const [newTitle, setNewTitle] = React.useState("");
  const [newCategory, setNewCategory] = React.useState<string>("meeting");
  const [newStartTime, setNewStartTime] = React.useState("09:00");
  const [newDescription, setNewDescription] = React.useState("");
  const [clickedDate, setClickedDate] = React.useState<string>("");

  const calendarRef = React.useRef<any>(null);

  const activeView = currentView ?? "dayGridMonth";

  // Resolve the calendar component - it may be on .default or as a named export
  const CalendarComponent = FullCalendar.default || FullCalendar.FullCalendar;

  const handleDateClick = React.useCallback(
    (info: any) => {
      setClickedDate(info.dateStr);
      setNewTitle("");
      setNewCategory("meeting");
      setNewStartTime("09:00");
      setNewDescription("");
      setCreateOpen(true);
    },
    []
  );

  const handleEventClick = React.useCallback(
    (info: any) => {
      const evt = events.find((e) => e.id === info.event.id);
      if (evt) {
        setSelectedEvent(evt);
        setDetailOpen(true);
      }
    },
    [events]
  );

  const handleEventDrop = React.useCallback(
    (info: any) => {
      setEvents((prev) =>
        prev.map((e) =>
          e.id === info.event.id
            ? { ...e, start: info.event.startStr, end: info.event.endStr }
            : e
        )
      );
      toast.success("Event moved successfully");
    },
    []
  );

  const handleEventResize = React.useCallback(
    (info: any) => {
      setEvents((prev) =>
        prev.map((e) =>
          e.id === info.event.id
            ? { ...e, start: info.event.startStr, end: info.event.endStr }
            : e
        )
      );
      toast.success("Event resized");
    },
    []
  );

  const handleCreateEvent = () => {
    if (!newTitle.trim()) {
      toast.error("Please enter an event title");
      return;
    }
    const dateBase = clickedDate || new Date().toISOString().split("T")[0];
    const [h, m] = newStartTime.split(":").map(Number);
    const start = new Date(`${dateBase}T${newStartTime}:00`);
    const end = new Date(start.getTime() + 60 * 60 * 1000);

    const newEvent: CalendarEvent = {
      id: `evt-${Date.now()}`,
      title: newTitle,
      start: start.toISOString(),
      end: end.toISOString(),
      category: newCategory as CalendarEvent["category"],
      description: newDescription,
    };
    setEvents((prev) => [...prev, newEvent]);
    setCreateOpen(false);
    toast.success(`Created "${newTitle}"`);
  };

  const handleDeleteEvent = () => {
    if (!selectedEvent) return;
    setEvents((prev) => prev.filter((e) => e.id !== selectedEvent.id));
    setDetailOpen(false);
    setSelectedEvent(null);
    toast("Event deleted");
  };

  const calendarEvents = events.map((evt) => ({
    id: evt.id,
    title: evt.title,
    start: evt.start,
    end: evt.end,
    allDay: evt.allDay,
    backgroundColor: CATEGORY_COLORS[evt.category]?.bg || "#3b82f6",
    borderColor: CATEGORY_COLORS[evt.category]?.border || "#2563eb",
    extendedProps: { category: evt.category, description: evt.description },
  }));

  const handleViewChange = (view: CalendarView) => {
    setCurrentView(view);
    const api = calendarRef.current?.getApi?.();
    if (api) {
      api.changeView(view);
    }
  };

  const categoryCount = events.reduce<Record<string, number>>((acc, e) => {
    acc[e.category] = (acc[e.category] || 0) + 1;
    return acc;
  }, {});

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <Card>
        <CardContent className="py-3">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-3">
              <Icons.CalendarDays className="h-5 w-5 text-primary" />
              <span className="font-semibold text-lg">Event Calendar</span>
              <div className="hidden sm:flex gap-1">
                {Object.entries(categoryCount).map(([cat, count]) => (
                  <Badge
                    key={cat}
                    className={cn("text-xs", CATEGORY_COLORS[cat]?.badge)}
                  >
                    {cat}: {count}
                  </Badge>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <ButtonGroup>
                {VIEW_OPTIONS.map((opt) => {
                  const VIcon = Icons[opt.icon] as React.ComponentType<{ className?: string }>;
                  return (
                    <Button
                      key={opt.value}
                      size="sm"
                      variant={activeView === opt.value ? "default" : "outline"}
                      onClick={() => handleViewChange(opt.value)}
                    >
                      {VIcon && <VIcon className="h-4 w-4 mr-1" />}
                      <span className="hidden md:inline">{opt.label}</span>
                    </Button>
                  );
                })}
              </ButtonGroup>
              <Button size="sm" onClick={() => { setClickedDate(""); setNewTitle(""); setNewCategory("meeting"); setNewStartTime("09:00"); setNewDescription(""); setCreateOpen(true); }}>
                <Icons.Plus className="h-4 w-4 mr-1" />
                Add Event
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Calendar */}
      <Card>
        <CardContent className="p-2 sm:p-4">
          <CalendarComponent
            ref={calendarRef}
            plugins={calendarPlugins}
            initialView={activeView}
            headerToolbar={{
              left: "prev,next today",
              center: "title",
              right: "",
            }}
            events={calendarEvents}
            editable={true}
            selectable={true}
            droppable={true}
            eventResizableFromStart={true}
            dateClick={handleDateClick}
            eventClick={handleEventClick}
            eventDrop={handleEventDrop}
            eventResize={handleEventResize}
            height="auto"
            aspectRatio={1.8}
            nowIndicator={true}
          />
        </CardContent>
      </Card>

      {/* Create Event Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Icons.CalendarPlus className="h-5 w-5" />
              Create New Event
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="space-y-2">
              <Label>Event Title</Label>
              <Input
                placeholder="Enter event title..."
                value={newTitle}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewTitle(e.target.value)}
              />
            </div>
            {clickedDate && (
              <div className="space-y-2">
                <Label>Date</Label>
                <Input value={clickedDate} disabled />
              </div>
            )}
            <div className="space-y-2">
              <Label>Start Time</Label>
              <Select value={newStartTime} onValueChange={setNewStartTime}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Array.from({ length: 13 }, (_, i) => {
                    const h = i + 7;
                    const val = `${String(h).padStart(2, "0")}:00`;
                    return (
                      <SelectItem key={val} value={val}>
                        {h > 12 ? `${h - 12}:00 PM` : `${h}:00 ${h === 12 ? "PM" : "AM"}`}
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Category</Label>
              <Select value={newCategory} onValueChange={setNewCategory}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="meeting">Meeting</SelectItem>
                  <SelectItem value="deadline">Deadline</SelectItem>
                  <SelectItem value="social">Social</SelectItem>
                  <SelectItem value="personal">Personal</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Textarea
                placeholder="Optional description..."
                value={newDescription}
                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setNewDescription(e.target.value)}
                rows={3}
              />
            </div>
          </div>
          <DialogFooter className="mt-4">
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreateEvent}>
              <Icons.Check className="h-4 w-4 mr-1" />
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Event Detail Dialog */}
      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="sm:max-w-md">
          {selectedEvent && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  {selectedEvent.title}
                  <Badge className={cn("text-xs", CATEGORY_COLORS[selectedEvent.category]?.badge)}>
                    {selectedEvent.category}
                  </Badge>
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-3 mt-2">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Icons.Clock className="h-4 w-4" />
                  <span>
                    {new Date(selectedEvent.start).toLocaleString()} &mdash;{" "}
                    {new Date(selectedEvent.end).toLocaleString()}
                  </span>
                </div>
                {selectedEvent.description && (
                  <div className="flex items-start gap-2 text-sm">
                    <Icons.FileText className="h-4 w-4 mt-0.5 text-muted-foreground" />
                    <span>{selectedEvent.description}</span>
                  </div>
                )}
              </div>
              <DialogFooter className="mt-4">
                <Button variant="destructive" size="sm" onClick={handleDeleteEvent}>
                  <Icons.Trash2 className="h-4 w-4 mr-1" />
                  Delete
                </Button>
                <Button variant="outline" size="sm" onClick={() => setDetailOpen(false)}>
                  Close
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// Guard: FullCalendar needs at least one plugin (dayGrid, timeGrid, etc.)
// which come from separate @fullcalendar packages. Also check the calendar component exists.
const CalendarComponentCheck = FullCalendar.default || FullCalendar.FullCalendar;
const hasFullCalendarRequirements = !!CalendarComponentCheck && calendarPlugins.length > 0;

function FullEventCalendarGuard() {
  if (!hasFullCalendarRequirements) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-muted-foreground">
          FullCalendar requires plugin packages (dayGrid, timeGrid, interaction) that are only available in the full bundle (production mode).
        </CardContent>
      </Card>
    );
  }
  return <FullEventCalendar />;
}

export default FullEventCalendarGuard;
