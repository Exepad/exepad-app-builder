import {
  React,
  useModel,
  useAppState,
  useNavigation,
  Button,
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Icons,
  cn,
} from "@exepad/sdk";

interface CalendarEvent {
  id: number;
  title: string;
  category: string;
  start_date: string;
  venue: string;
  price_from: number;
}

const DEMO_EVENTS: CalendarEvent[] = [
  { id: 1, title: "Neon Nights Music Festival", category: "music", start_date: "2026-04-15", venue: "Riverside Amphitheater", price_from: 75 },
  { id: 2, title: "Future of AI Summit 2026", category: "tech", start_date: "2026-04-22", venue: "Silicon Convention Center", price_from: 199 },
  { id: 3, title: "Global Street Food Festival", category: "food", start_date: "2026-05-03", venue: "Waterfront Park", price_from: 25 },
  { id: 4, title: "Urban Marathon Challenge", category: "sports", start_date: "2026-05-10", venue: "City Center Park", price_from: 45 },
  { id: 5, title: "Jazz Under the Stars", category: "music", start_date: "2026-04-28", venue: "Botanical Gardens", price_from: 55 },
  { id: 6, title: "Startup Pitch Night", category: "business", start_date: "2026-05-15", venue: "Innovation Hub", price_from: 0 },
  { id: 7, title: "Contemporary Art Exhibition", category: "arts", start_date: "2026-05-20", venue: "Metropolitan Gallery", price_from: 30 },
  { id: 8, title: "Cloud & DevOps Conference", category: "tech", start_date: "2026-06-05", venue: "Grand Tech Center", price_from: 299 },
  { id: 9, title: "Indie Film Festival", category: "arts", start_date: "2026-06-12", venue: "Cinema Square", price_from: 20 },
  { id: 10, title: "Craft Beer & BBQ Fest", category: "food", start_date: "2026-06-20", venue: "Heritage Fairgrounds", price_from: 35 },
  { id: 11, title: "Women in Tech Leadership", category: "business", start_date: "2026-07-01", venue: "Grand Ballroom Hotel", price_from: 149 },
  { id: 12, title: "EDM Night", category: "music", start_date: "2026-07-10", venue: "Warehouse 23", price_from: 60 },
  { id: 13, title: "CrossFit Open Games", category: "sports", start_date: "2026-07-18", venue: "Olympic Training Center", price_from: 30 },
  { id: 14, title: "Photography Masterclass", category: "arts", start_date: "2026-04-10", venue: "Studio Loft", price_from: 175 },
  { id: 15, title: "Vegan Food Expo", category: "food", start_date: "2026-04-05", venue: "Green Convention Hall", price_from: 15 },
];

const CATEGORY_DOTS: Record<string, string> = {
  music: "bg-purple-500",
  tech: "bg-blue-500",
  food: "bg-orange-500",
  sports: "bg-green-500",
  arts: "bg-pink-500",
  business: "bg-amber-500",
};

const CATEGORY_COLORS: Record<string, string> = {
  music: "bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300",
  tech: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
  food: "bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300",
  sports: "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300",
  arts: "bg-pink-100 text-pink-700 dark:bg-pink-900 dark:text-pink-300",
  business: "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300",
};

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function EventCalendar() {
  const navigation = useNavigation();
  const eventsModel = useModel("events");
  const events = (eventsModel?.data as any[] | null) ?? DEMO_EVENTS;

  const today = new Date();
  const [viewYear, setViewYear] = React.useState(today.getFullYear());
  const [viewMonth, setViewMonth] = React.useState(today.getMonth());
  const [selectedDay, setSelectedDay] = React.useState<number | null>(null);

  const firstDayOfMonth = new Date(viewYear, viewMonth, 1).getDay();
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const daysInPrevMonth = new Date(viewYear, viewMonth, 0).getDate();

  const monthLabel = new Date(viewYear, viewMonth, 1).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });

  const goToPrevMonth = () => {
    if (viewMonth === 0) {
      setViewMonth(11);
      setViewYear((y) => y - 1);
    } else {
      setViewMonth((m) => m - 1);
    }
    setSelectedDay(null);
  };

  const goToNextMonth = () => {
    if (viewMonth === 11) {
      setViewMonth(0);
      setViewYear((y) => y + 1);
    } else {
      setViewMonth((m) => m + 1);
    }
    setSelectedDay(null);
  };

  const goToToday = () => {
    setViewYear(today.getFullYear());
    setViewMonth(today.getMonth());
    setSelectedDay(today.getDate());
  };

  // Build events map by day
  const eventsByDay = React.useMemo(() => {
    const map: Record<number, CalendarEvent[]> = {};
    DEMO_EVENTS.forEach((ev) => {
      const d = new Date(ev.start_date + "T00:00:00");
      if (d.getFullYear() === viewYear && d.getMonth() === viewMonth) {
        const day = d.getDate();
        if (!map[day]) map[day] = [];
        map[day].push(ev);
      }
    });
    return map;
  }, [viewYear, viewMonth]);

  const selectedDayEvents = selectedDay ? eventsByDay[selectedDay] || [] : [];

  const isToday = (day: number) =>
    viewYear === today.getFullYear() &&
    viewMonth === today.getMonth() &&
    day === today.getDate();

  // Build calendar grid cells
  const calendarCells: Array<{ day: number; isCurrentMonth: boolean }> = [];

  // Previous month trailing days
  for (let i = firstDayOfMonth - 1; i >= 0; i--) {
    calendarCells.push({ day: daysInPrevMonth - i, isCurrentMonth: false });
  }
  // Current month days
  for (let d = 1; d <= daysInMonth; d++) {
    calendarCells.push({ day: d, isCurrentMonth: true });
  }
  // Next month leading days
  const remaining = 42 - calendarCells.length;
  for (let i = 1; i <= remaining; i++) {
    calendarCells.push({ day: i, isCurrentMonth: false });
  }

  const weeks: typeof calendarCells[] = [];
  for (let i = 0; i < calendarCells.length; i += 7) {
    weeks.push(calendarCells.slice(i, i + 7));
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
      <div className="mb-6">
        <h1 className="text-3xl font-bold">Event Calendar</h1>
        <p className="text-muted-foreground mt-1">Browse events by date</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Calendar grid */}
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <Button variant="outline" size="icon" onClick={goToPrevMonth}>
                <Icons.ChevronLeft className="h-4 w-4" />
              </Button>
              <div className="text-center">
                <h2 className="text-lg font-bold">{monthLabel}</h2>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={goToToday}>Today</Button>
                <Button variant="outline" size="icon" onClick={goToNextMonth}>
                  <Icons.ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-3">
            {/* Day headers */}
            <div className="grid grid-cols-7 mb-1">
              {DAY_NAMES.map((name) => (
                <div key={name} className="text-center text-xs font-semibold text-muted-foreground py-2">
                  {name}
                </div>
              ))}
            </div>

            {/* Calendar weeks */}
            <div className="space-y-1">
              {weeks.map((week, wIdx) => (
                <div key={wIdx} className="grid grid-cols-7 gap-1">
                  {week.map((cell, cIdx) => {
                    const dayEvents = cell.isCurrentMonth ? (eventsByDay[cell.day] || []) : [];
                    const isTodayCell = cell.isCurrentMonth && isToday(cell.day);
                    const isSelected = cell.isCurrentMonth && selectedDay === cell.day;

                    return (
                      <button
                        key={cIdx}
                        onClick={() => {
                          if (cell.isCurrentMonth) setSelectedDay(cell.day);
                        }}
                        className={cn(
                          "calendar-day rounded-lg p-1.5 text-left flex flex-col relative",
                          cell.isCurrentMonth
                            ? "hover:bg-accent cursor-pointer"
                            : "text-muted-foreground/30 cursor-default",
                          isTodayCell && "calendar-today",
                          isSelected && "bg-primary/10 ring-1 ring-primary"
                        )}
                      >
                        <span
                          className={cn(
                            "text-xs font-medium",
                            isTodayCell && "text-primary font-bold",
                            isSelected && "text-primary"
                          )}
                        >
                          {cell.day}
                        </span>
                        {dayEvents.length > 0 && (
                          <div className="flex gap-0.5 mt-1 flex-wrap">
                            {dayEvents.slice(0, 3).map((ev, i) => (
                              <span
                                key={i}
                                className={cn(
                                  "h-1.5 w-1.5 rounded-full",
                                  CATEGORY_DOTS[ev.category] || "bg-primary"
                                )}
                              />
                            ))}
                            {dayEvents.length > 3 && (
                              <span className="text-[8px] text-muted-foreground leading-none">
                                +{dayEvents.length - 3}
                              </span>
                            )}
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>

            {/* Legend */}
            <div className="flex flex-wrap items-center gap-3 mt-4 pt-3 border-t border-border">
              {Object.entries(CATEGORY_DOTS).map(([cat, color]) => (
                <div key={cat} className="flex items-center gap-1.5">
                  <span className={cn("h-2 w-2 rounded-full", color)} />
                  <span className="text-xs text-muted-foreground capitalize">{cat}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Side panel */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">
              {selectedDay
                ? new Date(viewYear, viewMonth, selectedDay).toLocaleDateString("en-US", {
                    weekday: "long",
                    month: "long",
                    day: "numeric",
                  })
                : "Select a Day"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {!selectedDay ? (
              <div className="text-center py-8">
                <Icons.CalendarDays className="h-10 w-10 mx-auto text-muted-foreground/30 mb-3" />
                <p className="text-sm text-muted-foreground">
                  Click on a day in the calendar to see events.
                </p>
              </div>
            ) : selectedDayEvents.length === 0 ? (
              <div className="text-center py-8">
                <Icons.CalendarX className="h-10 w-10 mx-auto text-muted-foreground/30 mb-3" />
                <p className="text-sm text-muted-foreground">No events on this day.</p>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-3"
                  onClick={() => navigation.navigate("/events")}
                >
                  Browse All Events
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                {selectedDayEvents.map((ev) => (
                  <div
                    key={ev.id}
                    className="rounded-lg border p-3 cursor-pointer hover:bg-muted/50 transition-colors"
                    onClick={() => navigation.navigate(`/event/${ev.id}`)}
                  >
                    <div className="flex items-start gap-3">
                      <div
                        className={cn(
                          "h-2 w-2 rounded-full mt-1.5 shrink-0",
                          CATEGORY_DOTS[ev.category] || "bg-primary"
                        )}
                      />
                      <div className="flex-1 min-w-0">
                        <h4 className="text-sm font-semibold truncate">{ev.title}</h4>
                        <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
                          <Icons.MapPin className="h-3 w-3" />
                          {ev.venue}
                        </p>
                        <div className="flex items-center justify-between mt-2">
                          <Badge
                            className={cn(
                              "text-xs capitalize",
                              CATEGORY_COLORS[ev.category] || ""
                            )}
                          >
                            {ev.category}
                          </Badge>
                          <span className="text-xs font-semibold text-primary">
                            {ev.price_from === 0 ? "Free" : `$${ev.price_from}`}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default EventCalendar;
