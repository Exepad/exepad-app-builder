import {
  React,
  useAppState,
  useArrayState,
  toast,
  format,
  Calendar,
  Popover,
  PopoverTrigger,
  PopoverContent,
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  Input,
  Button,
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  Label,
  Icons,
  cn,
} from "@exepad/sdk";

interface CalendarEvent {
  id: string;
  title: string;
  date: string;
  time: string;
  category: "Meeting" | "Deadline" | "Social" | "Task";
  description: string;
}

const CATEGORY_COLORS: Record<CalendarEvent["category"], string> = {
  Meeting: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300",
  Deadline: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300",
  Social: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300",
  Task: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300",
};

const CATEGORY_DOTS: Record<CalendarEvent["category"], string> = {
  Meeting: "bg-blue-500",
  Deadline: "bg-red-500",
  Social: "bg-green-500",
  Task: "bg-yellow-500",
};

const TIME_OPTIONS = [
  "08:00 AM", "08:30 AM", "09:00 AM", "09:30 AM", "10:00 AM", "10:30 AM",
  "11:00 AM", "11:30 AM", "12:00 PM", "12:30 PM", "01:00 PM", "01:30 PM",
  "02:00 PM", "02:30 PM", "03:00 PM", "03:30 PM", "04:00 PM", "04:30 PM",
  "05:00 PM", "05:30 PM", "06:00 PM", "06:30 PM", "07:00 PM", "07:30 PM",
];

const today = new Date();
const year = today.getFullYear();
const month = today.getMonth();

function dateStr(day: number): string {
  return format(new Date(year, month, day), "yyyy-MM-dd");
}

const INITIAL_EVENTS: CalendarEvent[] = [
  { id: "1", title: "Sprint Planning", date: dateStr(2), time: "09:00 AM", category: "Meeting", description: "Bi-weekly sprint planning session with the engineering team to review backlog and assign stories." },
  { id: "2", title: "Design Review", date: dateStr(5), time: "02:00 PM", category: "Meeting", description: "Review the updated wireframes for the onboarding flow with the design and product teams." },
  { id: "3", title: "Q1 Report Due", date: dateStr(7), time: "05:00 PM", category: "Deadline", description: "Submit the Q1 performance report to management with key metrics and revenue analysis." },
  { id: "4", title: "Team Lunch", date: dateStr(9), time: "12:00 PM", category: "Social", description: "Monthly team lunch at the new Italian restaurant downtown. RSVP required by Friday." },
  { id: "5", title: "Code Freeze", date: dateStr(12), time: "06:00 PM", category: "Deadline", description: "Feature freeze for v2.4 release. No new feature merges after this point, only bugfixes." },
  { id: "6", title: "1:1 with Manager", date: dateStr(14), time: "10:00 AM", category: "Meeting", description: "Weekly one-on-one meeting to discuss career growth, blockers, and project updates." },
  { id: "7", title: "Update Dependencies", date: dateStr(16), time: "09:00 AM", category: "Task", description: "Run dependency audit and update all packages to latest stable versions. Run full test suite." },
  { id: "8", title: "Company Happy Hour", date: dateStr(18), time: "05:00 PM", category: "Social", description: "End-of-month celebration at the rooftop bar. Drinks and appetizers provided by the company." },
  { id: "9", title: "Security Audit", date: dateStr(20), time: "10:00 AM", category: "Task", description: "Complete the quarterly security review. Check for CVEs, update SBOM, and review access permissions." },
  { id: "10", title: "Client Demo", date: dateStr(22), time: "03:00 PM", category: "Meeting", description: "Demo the new dashboard features to the enterprise client. Prepare slide deck and staging environment." },
  { id: "11", title: "API Docs Deadline", date: dateStr(25), time: "05:00 PM", category: "Deadline", description: "Finalize and publish the v2.4 API documentation. All new endpoints must have examples and schemas." },
  { id: "12", title: "Write Unit Tests", date: dateStr(28), time: "09:00 AM", category: "Task", description: "Increase test coverage for the payments module to 90%. Focus on edge cases and error handling." },
];

function EventCalendar() {
  const [selectedDate, setSelectedDate] = useAppState<string>(
    "selectedDate",
    format(today, "yyyy-MM-dd")
  );
  const { items: events, push: append, remove } = useArrayState<CalendarEvent>(
    "calendarEvents",
    INITIAL_EVENTS
  );
  const [dialogOpen, setDialogOpen] = useAppState<boolean>("dialogOpen", false);
  const [newTitle, setNewTitle] = React.useState("");
  const [newTime, setNewTime] = React.useState("09:00 AM");
  const [newCategory, setNewCategory] = React.useState<CalendarEvent["category"]>("Meeting");

  const allEvents = events || INITIAL_EVENTS;
  const selected = selectedDate || format(today, "yyyy-MM-dd");

  const eventsForDate = allEvents.filter(
    (ev: CalendarEvent) => ev.date === selected
  );

  const datesWithEvents = new Set(allEvents.map((ev: CalendarEvent) => ev.date));

  const handleAddEvent = () => {
    if (!newTitle.trim()) {
      toast("Please enter a title for the event.");
      return;
    }
    const newEvent: CalendarEvent = {
      id: String(Date.now()),
      title: newTitle.trim(),
      date: selected,
      time: newTime,
      category: newCategory,
      description: "",
    };
    append(newEvent);
    setNewTitle("");
    setNewTime("09:00 AM");
    setNewCategory("Meeting");
    setDialogOpen(false);
    toast("Event added successfully!");
  };

  const handleDeleteEvent = (id: string) => {
    const idx = allEvents.findIndex((ev: CalendarEvent) => ev.id === id);
    if (idx !== -1) {
      remove(idx);
      toast("Event deleted.");
    }
  };

  const handleDateSelect = (date: Date | undefined) => {
    if (date) {
      setSelectedDate(format(date, "yyyy-MM-dd"));
    }
  };

  const selectedDateObj = new Date(selected + "T00:00:00");
  const formattedSelected = format(selectedDateObj, "EEEE, MMMM d, yyyy");

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <Card className="lg:col-span-1">
        <CardHeader>
          <CardTitle className="text-lg">Calendar</CardTitle>
          <CardDescription>Select a date to view events</CardDescription>
        </CardHeader>
        <CardContent className="flex justify-center">
          <Calendar
            mode="single"
            selected={selectedDateObj}
            onSelect={handleDateSelect}
            className="rounded-md border"
            components={{
              DayButton: ({ day, ...props }: any) => {
                const dateKey = format(day.date, "yyyy-MM-dd");
                const hasEvents = datesWithEvents.has(dateKey);
                return (
                  <button {...props}>
                    <span>{day.date.getDate()}</span>
                    {hasEvents && (
                      <span className="absolute bottom-1 left-1/2 -translate-x-1/2 flex gap-0.5">
                        {allEvents
                          .filter((ev: CalendarEvent) => ev.date === dateKey)
                          .slice(0, 3)
                          .map((ev: CalendarEvent, i: number) => (
                            <span
                              key={i}
                              className={cn(
                                "h-1 w-1 rounded-full",
                                CATEGORY_DOTS[ev.category]
                              )}
                            />
                          ))}
                      </span>
                    )}
                  </button>
                );
              },
            }}
          />
        </CardContent>
      </Card>

      <Card className="lg:col-span-2">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-lg">Events</CardTitle>
              <CardDescription>{formattedSelected}</CardDescription>
            </div>
            <Dialog
              open={dialogOpen ?? false}
              onOpenChange={(v: boolean) => setDialogOpen(v)}
            >
              <DialogTrigger asChild>
                <Button size="sm">
                  <Icons.Plus className="mr-2 h-4 w-4" />
                  Add Event
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>
                    New Event on {format(selectedDateObj, "MMM d, yyyy")}
                  </DialogTitle>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label htmlFor="event-title">Title</Label>
                    <Input
                      id="event-title"
                      placeholder="Event title"
                      value={newTitle}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                        setNewTitle(e.target.value)
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Time</Label>
                    <Select value={newTime} onValueChange={setNewTime}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select time" />
                      </SelectTrigger>
                      <SelectContent>
                        {TIME_OPTIONS.map((t) => (
                          <SelectItem key={t} value={t}>
                            {t}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Category</Label>
                    <Select
                      value={newCategory}
                      onValueChange={(v: string) =>
                        setNewCategory(v as CalendarEvent["category"])
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select category" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Meeting">Meeting</SelectItem>
                        <SelectItem value="Deadline">Deadline</SelectItem>
                        <SelectItem value="Social">Social</SelectItem>
                        <SelectItem value="Task">Task</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <DialogFooter>
                  <Button
                    variant="outline"
                    onClick={() => setDialogOpen(false)}
                  >
                    Cancel
                  </Button>
                  <Button onClick={handleAddEvent}>Add Event</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </CardHeader>
        <CardContent>
          {eventsForDate.length === 0 ? (
            <div className="text-center py-12">
              <Icons.CalendarDays className="h-12 w-12 mx-auto text-muted-foreground/30 mb-3" />
              <p className="text-muted-foreground">
                No events scheduled for this day.
              </p>
              <Button
                variant="link"
                className="mt-2"
                onClick={() => setDialogOpen(true)}
              >
                Add an event
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              {eventsForDate.map((event: CalendarEvent) => (
                <Popover key={event.id}>
                  <PopoverTrigger asChild>
                    <div className="flex items-center gap-3 p-3 rounded-lg border hover:bg-muted/50 cursor-pointer transition-colors">
                      <div
                        className={cn(
                          "h-10 w-1 rounded-full shrink-0",
                          CATEGORY_DOTS[event.category]
                        )}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm truncate">
                            {event.title}
                          </span>
                          <Badge
                            className={cn(
                              "text-xs shrink-0",
                              CATEGORY_COLORS[event.category]
                            )}
                          >
                            {event.category}
                          </Badge>
                        </div>
                        <div className="flex items-center gap-1 mt-0.5 text-xs text-muted-foreground">
                          <Icons.Clock className="h-3 w-3" />
                          {event.time}
                        </div>
                      </div>
                      <Icons.ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                    </div>
                  </PopoverTrigger>
                  <PopoverContent className="w-80" align="end">
                    <div className="space-y-3">
                      <div className="flex items-start justify-between">
                        <div>
                          <h4 className="font-semibold">{event.title}</h4>
                          <div className="flex items-center gap-2 mt-1">
                            <Badge
                              className={cn(
                                "text-xs",
                                CATEGORY_COLORS[event.category]
                              )}
                            >
                              {event.category}
                            </Badge>
                            <span className="text-xs text-muted-foreground flex items-center gap-1">
                              <Icons.Clock className="h-3 w-3" />
                              {event.time}
                            </span>
                          </div>
                        </div>
                      </div>
                      {event.description && (
                        <p className="text-sm text-muted-foreground">
                          {event.description}
                        </p>
                      )}
                      <div className="flex justify-end">
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => handleDeleteEvent(event.id)}
                        >
                          <Icons.Trash2 className="mr-1 h-3 w-3" />
                          Delete
                        </Button>
                      </div>
                    </div>
                  </PopoverContent>
                </Popover>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default EventCalendar;
