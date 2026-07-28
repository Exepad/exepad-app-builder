import {
  React,
  cn,
  Icons,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
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
  useModel,
  toast,
} from "@exepad/sdk";

const { useState } = React;

/* ── Demo Data: 6 goals ── */

const DEMO_GOALS = [
  {
    id: "g1",
    title: "Lose 10 lbs",
    target_value: 10,
    current_value: 6.4,
    unit: "lbs",
    category: "weight",
    deadline: "2026-06-01",
    status: "active",
  },
  {
    id: "g2",
    title: "Run 5K Under 25 min",
    target_value: 25,
    current_value: 24.5,
    unit: "min",
    category: "cardio",
    deadline: "2026-04-15",
    status: "active",
  },
  {
    id: "g3",
    title: "Bench Press 200 lbs",
    target_value: 200,
    current_value: 185,
    unit: "lbs",
    category: "strength",
    deadline: "2026-07-01",
    status: "active",
  },
  {
    id: "g4",
    title: "Hit 150g Protein Daily",
    target_value: 30,
    current_value: 22,
    unit: "days",
    category: "nutrition",
    deadline: "2026-04-30",
    status: "active",
  },
  {
    id: "g5",
    title: "Complete 100 Workouts",
    target_value: 100,
    current_value: 100,
    unit: "sessions",
    category: "cardio",
    deadline: "2026-03-31",
    status: "completed",
  },
  {
    id: "g6",
    title: "Deadlift 350 lbs",
    target_value: 350,
    current_value: 315,
    unit: "lbs",
    category: "strength",
    deadline: "2026-08-01",
    status: "active",
  },
];

const MILESTONES: Record<string, { label: string; date: string; reached: boolean }[]> = {
  g1: [
    { label: "Lost first 2 lbs", date: "Feb 10", reached: true },
    { label: "Halfway (5 lbs)", date: "Mar 5", reached: true },
    { label: "6 lbs lost!", date: "Mar 20", reached: true },
    { label: "Target: 10 lbs", date: "Jun 1", reached: false },
  ],
  g2: [
    { label: "Sub-28 min", date: "Feb 1", reached: true },
    { label: "Sub-26 min", date: "Feb 20", reached: true },
    { label: "Sub-25 min", date: "Mar 15", reached: true },
    { label: "Target: Under 25 min", date: "Apr 15", reached: false },
  ],
  g3: [
    { label: "155 lbs", date: "Jan 15", reached: true },
    { label: "170 lbs", date: "Feb 10", reached: true },
    { label: "185 lbs", date: "Mar 20", reached: true },
    { label: "Target: 200 lbs", date: "Jul 1", reached: false },
  ],
  g5: [
    { label: "25 workouts", date: "Jan 20", reached: true },
    { label: "50 workouts", date: "Feb 15", reached: true },
    { label: "75 workouts", date: "Mar 8", reached: true },
    { label: "100 workouts!", date: "Mar 25", reached: true },
  ],
};

const CATEGORY_COLORS: Record<string, string> = {
  weight: "bg-purple-100 text-purple-700",
  strength: "bg-blue-100 text-blue-700",
  cardio: "bg-red-100 text-red-700",
  nutrition: "bg-green-100 text-green-700",
};

const CATEGORY_RING_COLORS: Record<string, string> = {
  weight: "#9333ea",
  strength: "#3b82f6",
  cardio: "#ef4444",
  nutrition: "#16a34a",
};

/* ── Circular Progress Ring ── */

function ProgressRing({
  percent,
  color,
  size = 80,
}: {
  percent: number;
  color: string;
  size?: number;
}) {
  const strokeWidth = 6;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (percent / 100) * circumference;

  return (
    <svg className="progress-ring" width={size} height={size}>
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="hsl(var(--muted))"
        strokeWidth={strokeWidth}
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
      <text
        x="50%"
        y="50%"
        dominantBaseline="central"
        textAnchor="middle"
        className="text-sm font-bold"
        fill="currentColor"
      >
        {percent}%
      </text>
    </svg>
  );
}

/* ── Component ── */

function GoalsManager({ className }: { className?: string }) {
  const goalsModel = useModel("goals");
  const goals = (goalsModel?.data as any[] | null) ?? DEMO_GOALS;
  const [dialogOpen, setDialogOpen] = useState(false);
  const [expandedGoal, setExpandedGoal] = useState<string | null>(null);

  const allGoals = goals || DEMO_GOALS;
  const activeGoals = allGoals.filter((g: any) => g.status === "active");
  const completedGoals = allGoals.filter((g: any) => g.status === "completed");

  const handleSave = () => {
    toast("Goal created successfully!");
    setDialogOpen(false);
  };

  return (
    <div className={cn("p-6 space-y-6", className)}>
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-2xl font-bold text-foreground tracking-tight">
            Goals
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            {activeGoals.length} active &middot; {completedGoals.length}{" "}
            completed
          </p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button className="bg-primary text-white hover:bg-primary/90 gap-1.5">
              <Icons.Plus className="h-4 w-4" />
              Add Goal
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create New Goal</DialogTitle>
              <DialogDescription>
                Set a new fitness goal to track your progress.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label>Goal Title</Label>
                <Input placeholder="e.g. Lose 10 lbs" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Category</Label>
                  <Select>
                    <SelectTrigger>
                      <SelectValue placeholder="Select category" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="weight">Weight</SelectItem>
                      <SelectItem value="strength">Strength</SelectItem>
                      <SelectItem value="cardio">Cardio</SelectItem>
                      <SelectItem value="nutrition">Nutrition</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Unit</Label>
                  <Input placeholder="e.g. lbs, min, reps" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Target Value</Label>
                  <Input type="number" placeholder="200" />
                </div>
                <div className="space-y-2">
                  <Label>Deadline</Label>
                  <Input type="date" />
                </div>
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
                Create Goal
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Active Goals Grid */}
      <div>
        <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
          <Icons.Zap className="h-4 w-4 text-primary" />
          Active Goals
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {activeGoals.map((goal: any) => {
            const percent = Math.min(
              Math.round((goal.current_value / goal.target_value) * 100),
              100
            );
            const ringColor =
              CATEGORY_RING_COLORS[goal.category] || "#16a34a";
            const daysLeft = Math.max(
              0,
              Math.ceil(
                (new Date(goal.deadline).getTime() - Date.now()) /
                  (1000 * 60 * 60 * 24)
              )
            );
            const milestones = MILESTONES[goal.id] || [];
            const isExpanded = expandedGoal === goal.id;

            return (
              <Card
                key={goal.id}
                className="goal-card cursor-pointer"
                onClick={() =>
                  setExpandedGoal(isExpanded ? null : goal.id)
                }
              >
                <CardContent className="pt-6">
                  <div className="flex items-start gap-4">
                    <ProgressRing percent={percent} color={ringColor} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <Badge
                          className={cn(
                            "text-[10px] px-1.5 py-0 capitalize border-0",
                            CATEGORY_COLORS[goal.category] || "bg-muted"
                          )}
                        >
                          {goal.category}
                        </Badge>
                      </div>
                      <p className="text-sm font-semibold text-foreground truncate">
                        {goal.title}
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {goal.current_value} / {goal.target_value} {goal.unit}
                      </p>
                      <p className="text-[11px] text-muted-foreground mt-1">
                        {daysLeft} days remaining
                      </p>
                    </div>
                  </div>

                  {/* Milestone Timeline */}
                  {isExpanded && milestones.length > 0 && (
                    <div className="mt-4 pt-4 border-t border-border">
                      <p className="text-xs font-semibold text-foreground mb-2">
                        Milestones
                      </p>
                      <div className="space-y-2">
                        {milestones.map((ms, idx) => (
                          <div
                            key={idx}
                            className="flex items-center gap-3"
                          >
                            <div
                              className={cn(
                                "w-2.5 h-2.5 rounded-full shrink-0",
                                ms.reached
                                  ? "bg-primary"
                                  : "bg-muted-foreground/30"
                              )}
                            />
                            <div className="flex-1 flex items-center justify-between">
                              <span
                                className={cn(
                                  "text-xs",
                                  ms.reached
                                    ? "text-foreground"
                                    : "text-muted-foreground"
                                )}
                              >
                                {ms.label}
                              </span>
                              <span className="text-[10px] text-muted-foreground">
                                {ms.date}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>

      {/* Completed Goals */}
      {completedGoals.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
            <Icons.CheckCircle className="h-4 w-4 text-primary" />
            Completed
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {completedGoals.map((goal: any) => {
              const milestones = MILESTONES[goal.id] || [];
              const isExpanded = expandedGoal === goal.id;

              return (
                <Card
                  key={goal.id}
                  className="goal-card cursor-pointer border-primary/20 bg-accent/20"
                  onClick={() =>
                    setExpandedGoal(isExpanded ? null : goal.id)
                  }
                >
                  <CardContent className="pt-6">
                    <div className="flex items-start gap-4">
                      <div className="w-[80px] h-[80px] rounded-full bg-primary/10 flex items-center justify-center">
                        <Icons.Trophy className="h-8 w-8 text-primary" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <Badge className="bg-primary/10 text-primary border-0 text-[10px] px-1.5 py-0">
                            Completed
                          </Badge>
                        </div>
                        <p className="text-sm font-semibold text-foreground truncate">
                          {goal.title}
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {goal.target_value} {goal.unit} achieved!
                        </p>
                      </div>
                    </div>

                    {isExpanded && milestones.length > 0 && (
                      <div className="mt-4 pt-4 border-t border-border">
                        <p className="text-xs font-semibold text-foreground mb-2">
                          Milestones
                        </p>
                        <div className="space-y-2">
                          {milestones.map((ms, idx) => (
                            <div
                              key={idx}
                              className="flex items-center gap-3"
                            >
                              <div className="w-2.5 h-2.5 rounded-full shrink-0 bg-primary" />
                              <div className="flex-1 flex items-center justify-between">
                                <span className="text-xs text-foreground">
                                  {ms.label}
                                </span>
                                <span className="text-[10px] text-muted-foreground">
                                  {ms.date}
                                </span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export default GoalsManager;
