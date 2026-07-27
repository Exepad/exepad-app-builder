import {
  React,
  useModel,
  Icons,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  Badge,
  Button,
  Input,
  cn,
  toast,
} from "@exepad/sdk";

const DEMO_HABITS = [
  { id: "h1", name: "Exercise", description: "30 minutes of physical activity", frequency: "daily", xp_reward: 20, icon: "Dumbbell", is_active: 1, color: "#ef4444" },
  { id: "h2", name: "Read", description: "Read at least 20 pages of a book", frequency: "daily", xp_reward: 15, icon: "BookOpen", is_active: 1, color: "#3b82f6" },
  { id: "h3", name: "Meditate", description: "10 minutes of mindfulness meditation", frequency: "daily", xp_reward: 10, icon: "Brain", is_active: 1, color: "#8b5cf6" },
  { id: "h4", name: "Drink Water", description: "Drink at least 8 glasses of water", frequency: "daily", xp_reward: 10, icon: "Droplets", is_active: 1, color: "#06b6d4" },
  { id: "h5", name: "Journal", description: "Write a journal entry reflecting on the day", frequency: "daily", xp_reward: 15, icon: "PenLine", is_active: 1, color: "#f59e0b" },
  { id: "h6", name: "Learn Language", description: "Complete one language lesson", frequency: "weekly", xp_reward: 50, icon: "Languages", is_active: 1, color: "#10b981" },
];

const PRESET_COLORS = ["#ef4444", "#3b82f6", "#8b5cf6", "#06b6d4", "#f59e0b", "#10b981"];
const XP_OPTIONS = [10, 15, 20, 50];
const ICON_OPTIONS = ["Dumbbell", "BookOpen", "Brain", "Droplets", "PenLine", "Languages", "Heart", "Star", "Music", "Coffee", "Bike", "Moon"];

function HabitManager({ className }: { className?: string }) {
  const habitsResult = useModel("habits");
  const habits = habitsResult?.data ?? DEMO_HABITS;

  const [showForm, setShowForm] = React.useState(false);
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [formData, setFormData] = React.useState({
    name: "",
    description: "",
    frequency: "daily",
    xp_reward: 10,
    icon: "Star",
    color: "#8b5cf6",
  });

  const resetForm = () => {
    setFormData({ name: "", description: "", frequency: "daily", xp_reward: 10, icon: "Star", color: "#8b5cf6" });
    setEditingId(null);
    setShowForm(false);
  };

  const handleSave = () => {
    if (!formData.name.trim()) {
      toast({ title: "Error", description: "Habit name is required" });
      return;
    }
    if (editingId) {
      toast({ title: "Habit Updated", description: `${formData.name} has been updated` });
    } else {
      toast({ title: "Habit Created", description: `${formData.name} added to your quests` });
    }
    resetForm();
  };

  const handleEdit = (habit: any) => {
    setFormData({
      name: habit.name,
      description: habit.description || "",
      frequency: habit.frequency,
      xp_reward: habit.xp_reward,
      icon: habit.icon || "Star",
      color: habit.color || "#8b5cf6",
    });
    setEditingId(habit.id);
    setShowForm(true);
  };

  const handleDelete = (habit: any) => {
    toast({ title: "Habit Removed", description: `${habit.name} has been deleted` });
  };

  const handleToggle = (habit: any) => {
    const status = habit.is_active === 1 ? "paused" : "activated";
    toast({ title: `Habit ${status}`, description: `${habit.name} is now ${status}` });
  };

  return (
    <div className={cn("p-6 space-y-6", className)}>
      {/* Title */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-foreground tracking-tight">My Habits</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Manage your habits and configure XP rewards
          </p>
        </div>
        <Button onClick={() => { resetForm(); setShowForm(true); }} className="gap-2">
          <Icons.Plus className="h-4 w-4" />
          Add New Habit
        </Button>
      </div>

      {/* Add/Edit Form */}
      {showForm && (
        <Card className="border-primary/30">
          <CardHeader>
            <CardTitle className="text-base">
              {editingId ? "Edit Habit" : "New Habit"}
            </CardTitle>
            <CardDescription>
              {editingId ? "Update your habit details" : "Create a new habit to track"}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">Name</label>
                <Input
                  placeholder="e.g. Morning Run"
                  value={formData.name}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    setFormData({ ...formData, name: e.target.value })
                  }
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">Description</label>
                <Input
                  placeholder="Optional description"
                  value={formData.description}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    setFormData({ ...formData, description: e.target.value })
                  }
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* Frequency */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">Frequency</label>
                <div className="flex gap-2">
                  {["daily", "weekly"].map((f) => (
                    <button
                      key={f}
                      onClick={() => setFormData({ ...formData, frequency: f })}
                      className={cn(
                        "px-3 py-1.5 rounded-md text-sm border capitalize",
                        formData.frequency === f
                          ? "bg-primary text-white border-primary"
                          : "bg-white text-foreground border-border hover:bg-muted"
                      )}
                    >
                      {f}
                    </button>
                  ))}
                </div>
              </div>

              {/* XP Reward */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">XP Reward</label>
                <div className="flex gap-2">
                  {XP_OPTIONS.map((xp) => (
                    <button
                      key={xp}
                      onClick={() => setFormData({ ...formData, xp_reward: xp })}
                      className={cn(
                        "px-3 py-1.5 rounded-md text-sm border",
                        formData.xp_reward === xp
                          ? "bg-primary text-white border-primary"
                          : "bg-white text-foreground border-border hover:bg-muted"
                      )}
                    >
                      {xp}
                    </button>
                  ))}
                </div>
              </div>

              {/* Color */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">Color</label>
                <div className="flex gap-2">
                  {PRESET_COLORS.map((color) => (
                    <button
                      key={color}
                      onClick={() => setFormData({ ...formData, color })}
                      className={cn(
                        "w-8 h-8 rounded-full border-2",
                        formData.color === color ? "border-foreground scale-110" : "border-transparent"
                      )}
                      style={{ backgroundColor: color }}
                    />
                  ))}
                </div>
              </div>
            </div>

            {/* Icon Select */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Icon</label>
              <div className="flex flex-wrap gap-2">
                {ICON_OPTIONS.map((iconName) => {
                  const Icon = Icons[iconName as keyof typeof Icons] as React.ComponentType<{ className?: string }>;
                  return (
                    <button
                      key={iconName}
                      onClick={() => setFormData({ ...formData, icon: iconName })}
                      className={cn(
                        "w-10 h-10 rounded-lg border flex items-center justify-center",
                        formData.icon === iconName
                          ? "bg-primary/10 border-primary text-primary"
                          : "bg-white border-border text-muted-foreground hover:bg-muted"
                      )}
                    >
                      {Icon && <Icon className="h-5 w-5" />}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Actions */}
            <div className="flex gap-2 pt-2">
              <Button onClick={handleSave} className="gap-2">
                <Icons.Check className="h-4 w-4" />
                {editingId ? "Update Habit" : "Create Habit"}
              </Button>
              <Button variant="outline" onClick={resetForm}>
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Habits Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {(habits || DEMO_HABITS).map((habit: any) => {
          const Icon = Icons[habit.icon as keyof typeof Icons] as React.ComponentType<{ className?: string }>;
          const isInactive = habit.is_active === 0;
          return (
            <Card key={habit.id} className={cn("habit-card", isInactive && "opacity-60")}>
              <CardContent className="pt-6">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div
                      className="w-10 h-10 rounded-lg flex items-center justify-center"
                      style={{ backgroundColor: `${habit.color || "#8b5cf6"}20` }}
                    >
                      {Icon && <Icon className="h-5 w-5" style={{ color: habit.color || "#8b5cf6" }} />}
                    </div>
                    <div>
                      <h3 className="font-semibold text-foreground text-sm">{habit.name}</h3>
                      <p className="text-xs text-muted-foreground">{habit.description}</p>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 mb-4">
                  <Badge variant="secondary" className="text-[10px] capitalize">
                    {habit.frequency}
                  </Badge>
                  <Badge variant="secondary" className="text-[10px] bg-primary/10 text-primary">
                    +{habit.xp_reward} XP
                  </Badge>
                  {isInactive && (
                    <Badge variant="secondary" className="text-[10px] bg-muted text-muted-foreground">
                      Paused
                    </Badge>
                  )}
                </div>

                <div className="flex items-center gap-1 border-t border-border pt-3">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-xs h-7 px-2"
                    onClick={() => handleEdit(habit)}
                  >
                    <Icons.Pencil className="h-3 w-3 mr-1" />
                    Edit
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-xs h-7 px-2"
                    onClick={() => handleToggle(habit)}
                  >
                    {isInactive ? (
                      <><Icons.Play className="h-3 w-3 mr-1" />Resume</>
                    ) : (
                      <><Icons.Pause className="h-3 w-3 mr-1" />Pause</>
                    )}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-xs h-7 px-2 text-destructive hover:text-destructive ml-auto"
                    onClick={() => handleDelete(habit)}
                  >
                    <Icons.Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

export default HabitManager;
