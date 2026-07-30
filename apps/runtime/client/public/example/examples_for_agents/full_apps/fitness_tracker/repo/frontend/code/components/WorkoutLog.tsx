import {
  React,
  cn,
  Icons,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Badge,
  Button,
  Input,
  Label,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
  useModel,
  toast,
} from "@exepad/sdk";

const { useState } = React;

/* ── Demo Data: 16 workouts over 2 weeks ── */

const DEMO_WORKOUTS = [
  { id: "w1", type: "cardio", name: "Morning Run", duration_min: 35, calories_burned: 420, date: "2026-03-27", notes: "5K at 7:00/mi pace" },
  { id: "w2", type: "strength", name: "Upper Body Push", duration_min: 55, calories_burned: 380, date: "2026-03-27", notes: "Bench + OHP focus" },
  { id: "w3", type: "cardio", name: "Hill Cycling", duration_min: 45, calories_burned: 520, date: "2026-03-26", notes: "Mountain route" },
  { id: "w4", type: "flexibility", name: "Vinyasa Yoga", duration_min: 40, calories_burned: 180, date: "2026-03-26", notes: null },
  { id: "w5", type: "strength", name: "Leg Day", duration_min: 50, calories_burned: 450, date: "2026-03-25", notes: "Squats 225x5, Deadlifts 275x3" },
  { id: "w6", type: "cardio", name: "Swimming Laps", duration_min: 30, calories_burned: 350, date: "2026-03-25", notes: "Freestyle 1500m" },
  { id: "w7", type: "sports", name: "Basketball", duration_min: 60, calories_burned: 580, date: "2026-03-24", notes: "Pickup game at gym" },
  { id: "w8", type: "strength", name: "Back & Biceps", duration_min: 48, calories_burned: 340, date: "2026-03-24", notes: "Pull-ups, rows, curls" },
  { id: "w9", type: "cardio", name: "Treadmill HIIT", duration_min: 25, calories_burned: 380, date: "2026-03-23", notes: "30s sprint / 60s walk x 10" },
  { id: "w10", type: "flexibility", name: "Pilates", duration_min: 45, calories_burned: 210, date: "2026-03-22", notes: "Core focus session" },
  { id: "w11", type: "strength", name: "Chest & Triceps", duration_min: 52, calories_burned: 360, date: "2026-03-21", notes: null },
  { id: "w12", type: "cardio", name: "Outdoor Run", duration_min: 40, calories_burned: 480, date: "2026-03-20", notes: "7K easy pace" },
  { id: "w13", type: "sports", name: "Tennis Match", duration_min: 75, calories_burned: 620, date: "2026-03-19", notes: "Won 6-4, 7-5" },
  { id: "w14", type: "strength", name: "Full Body", duration_min: 60, calories_burned: 420, date: "2026-03-18", notes: "Compound movements" },
  { id: "w15", type: "cardio", name: "Rowing Machine", duration_min: 20, calories_burned: 260, date: "2026-03-17", notes: "5K row" },
  { id: "w16", type: "flexibility", name: "Stretch & Recovery", duration_min: 30, calories_burned: 120, date: "2026-03-16", notes: "Foam rolling + stretches" },
];

const TYPE_COLORS: Record<string, string> = {
  cardio: "bg-red-100 text-red-700",
  strength: "bg-blue-100 text-blue-700",
  flexibility: "bg-purple-100 text-purple-700",
  sports: "bg-amber-100 text-amber-700",
};

const TYPE_ICONS: Record<string, string> = {
  cardio: "Heart",
  strength: "Dumbbell",
  flexibility: "Stretching",
  sports: "Trophy",
};

/* ── Component ── */

function WorkoutLog({ className }: { className?: string }) {
  const workoutsModel = useModel("workouts");
  const workouts = (workoutsModel?.data as any[] | null) ?? DEMO_WORKOUTS;
  const [activeFilter, setActiveFilter] = useState("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [exercises, setExercises] = useState([
    { name: "", sets: "", reps: "", weight: "" },
  ]);

  const allWorkouts = workouts || DEMO_WORKOUTS;
  const filtered =
    activeFilter === "all"
      ? allWorkouts
      : allWorkouts.filter((w: any) => w.type === activeFilter);

  const totalCalories = allWorkouts.reduce(
    (s: number, w: any) => s + w.calories_burned,
    0
  );
  const totalDuration = allWorkouts.reduce(
    (s: number, w: any) => s + w.duration_min,
    0
  );

  const addExerciseRow = () => {
    setExercises([...exercises, { name: "", sets: "", reps: "", weight: "" }]);
  };

  const removeExerciseRow = (idx: number) => {
    if (exercises.length > 1) {
      setExercises(exercises.filter((_, i) => i !== idx));
    }
  };

  const handleSave = () => {
    toast("Workout saved successfully!");
    setDialogOpen(false);
    setExercises([{ name: "", sets: "", reps: "", weight: "" }]);
  };

  return (
    <div className={cn("p-6 space-y-6", className)}>
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-2xl font-bold text-foreground tracking-tight">
            Workout Log
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            {allWorkouts.length} workouts &middot; {totalCalories.toLocaleString()} cal
            burned &middot; {Math.round(totalDuration / 60)}h total
          </p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button className="bg-primary text-white hover:bg-primary/90 gap-1.5">
              <Icons.Plus className="h-4 w-4" />
              Add Workout
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Log New Workout</DialogTitle>
              <DialogDescription>
                Add your workout details and exercises below.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Workout Type</Label>
                  <Select>
                    <SelectTrigger>
                      <SelectValue placeholder="Select type" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="cardio">Cardio</SelectItem>
                      <SelectItem value="strength">Strength</SelectItem>
                      <SelectItem value="flexibility">Flexibility</SelectItem>
                      <SelectItem value="sports">Sports</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Workout Name</Label>
                  <Input placeholder="e.g. Morning Run" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Duration (min)</Label>
                  <Input type="number" placeholder="45" />
                </div>
                <div className="space-y-2">
                  <Label>Calories Burned</Label>
                  <Input type="number" placeholder="350" />
                </div>
              </div>

              {/* Exercises */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-semibold">Exercises</Label>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={addExerciseRow}
                    className="text-primary text-xs gap-1"
                  >
                    <Icons.Plus className="h-3.5 w-3.5" />
                    Add Exercise
                  </Button>
                </div>
                {exercises.map((ex, idx) => (
                  <div
                    key={idx}
                    className="grid grid-cols-[1fr_60px_60px_70px_28px] gap-2 items-end"
                  >
                    <Input placeholder="Exercise name" className="text-sm" />
                    <Input placeholder="Sets" type="number" className="text-sm" />
                    <Input placeholder="Reps" type="number" className="text-sm" />
                    <Input placeholder="Wt (lb)" type="number" className="text-sm" />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => removeExerciseRow(idx)}
                      className="p-0 h-9 w-7 text-muted-foreground hover:text-destructive"
                    >
                      <Icons.X className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDialogOpen(false)}>
                Cancel
              </Button>
              <Button
                className="bg-primary text-white hover:bg-primary/90"
                onClick={handleSave}
              >
                Save Workout
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Filter Tabs */}
      <Tabs
        defaultValue="all"
        value={activeFilter}
        onValueChange={setActiveFilter}
      >
        <TabsList>
          <TabsTrigger value="all">
            All ({allWorkouts.length})
          </TabsTrigger>
          <TabsTrigger value="cardio">Cardio</TabsTrigger>
          <TabsTrigger value="strength">Strength</TabsTrigger>
          <TabsTrigger value="flexibility">Flexibility</TabsTrigger>
          <TabsTrigger value="sports">Sports</TabsTrigger>
        </TabsList>
      </Tabs>

      {/* Workout List */}
      <div className="space-y-3">
        {filtered.map((w: any) => (
          <Card key={w.id} className="workout-card hover:bg-muted/20">
            <CardContent className="py-4 px-5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <Badge
                    className={cn(
                      "text-xs px-2.5 py-1 capitalize border-0 font-medium",
                      TYPE_COLORS[w.type] || "bg-muted"
                    )}
                  >
                    {w.type}
                  </Badge>
                  <div>
                    <p className="text-sm font-semibold text-foreground">
                      {w.name}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {new Date(w.date).toLocaleDateString("en-US", {
                        weekday: "short",
                        month: "short",
                        day: "numeric",
                      })}
                      {w.notes && (
                        <span className="ml-2 text-muted-foreground/60">
                          — {w.notes}
                        </span>
                      )}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-6">
                  <div className="text-right">
                    <div className="flex items-center gap-1 text-sm font-medium text-foreground">
                      <Icons.Clock className="h-3.5 w-3.5 text-muted-foreground" />
                      {w.duration_min} min
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="flex items-center gap-1 text-sm font-medium text-foreground">
                      <Icons.Flame className="h-3.5 w-3.5 text-orange-500" />
                      {w.calories_burned} cal
                    </div>
                  </div>
                  <Button variant="ghost" size="sm" className="text-muted-foreground">
                    <Icons.MoreHorizontal className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {filtered.length === 0 && (
        <div className="text-center py-12 text-muted-foreground">
          <Icons.Dumbbell className="h-12 w-12 mx-auto mb-3 opacity-30" />
          <p className="text-sm">No workouts found for this filter.</p>
        </div>
      )}
    </div>
  );
}

export default WorkoutLog;
