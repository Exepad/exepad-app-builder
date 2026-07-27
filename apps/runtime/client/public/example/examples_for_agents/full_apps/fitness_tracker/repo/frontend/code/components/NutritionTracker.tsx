import {
  React,
  Charts,
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
  Progress,
  useModel,
  toast,
} from "@exepad/sdk";

const { useState } = React;

/* ── Demo Data: 14 meals for today ── */

const DEMO_MEALS = [
  { id: "m1", date: "2026-03-27", meal_type: "breakfast", name: "Oatmeal with Blueberries", calories: 310, protein: 11, carbs: 52, fat: 7 },
  { id: "m2", date: "2026-03-27", meal_type: "breakfast", name: "Scrambled Eggs (2)", calories: 180, protein: 14, carbs: 2, fat: 12 },
  { id: "m3", date: "2026-03-27", meal_type: "breakfast", name: "Orange Juice", calories: 110, protein: 2, carbs: 26, fat: 0 },
  { id: "m4", date: "2026-03-27", meal_type: "lunch", name: "Grilled Chicken Breast", calories: 280, protein: 42, carbs: 0, fat: 12 },
  { id: "m5", date: "2026-03-27", meal_type: "lunch", name: "Quinoa Salad", calories: 220, protein: 8, carbs: 34, fat: 6 },
  { id: "m6", date: "2026-03-27", meal_type: "lunch", name: "Whole Wheat Roll", calories: 130, protein: 4, carbs: 24, fat: 2 },
  { id: "m7", date: "2026-03-27", meal_type: "snack", name: "Protein Bar", calories: 200, protein: 20, carbs: 22, fat: 8 },
  { id: "m8", date: "2026-03-27", meal_type: "snack", name: "Apple + Peanut Butter", calories: 190, protein: 5, carbs: 28, fat: 8 },
  { id: "m9", date: "2026-03-27", meal_type: "dinner", name: "Salmon Fillet", calories: 350, protein: 34, carbs: 0, fat: 22 },
  { id: "m10", date: "2026-03-27", meal_type: "dinner", name: "Steamed Broccoli", calories: 55, protein: 4, carbs: 10, fat: 0.5 },
  { id: "m11", date: "2026-03-27", meal_type: "dinner", name: "Sweet Potato", calories: 180, protein: 4, carbs: 41, fat: 0.3 },
  { id: "m12", date: "2026-03-27", meal_type: "dinner", name: "Mixed Green Salad", calories: 45, protein: 2, carbs: 8, fat: 1 },
  { id: "m13", date: "2026-03-27", meal_type: "snack", name: "Greek Yogurt", calories: 130, protein: 15, carbs: 12, fat: 4 },
  { id: "m14", date: "2026-03-27", meal_type: "snack", name: "Trail Mix (1/4 cup)", calories: 160, protein: 5, carbs: 14, fat: 10 },
];

const CALORIE_GOAL = 2200;
const MACRO_GOALS = { protein: 150, carbs: 250, fat: 75 };

const MEAL_SECTIONS = [
  { type: "breakfast", label: "Breakfast", icon: "Sunrise", color: "text-amber-600" },
  { type: "lunch", label: "Lunch", icon: "Sun", color: "text-green-600" },
  { type: "dinner", label: "Dinner", icon: "Sunset", color: "text-blue-600" },
  { type: "snack", label: "Snacks", icon: "Cookie", color: "text-purple-600" },
];

/* ── Component ── */

function NutritionTracker({ className }: { className?: string }) {
  const mealsModel = useModel("meals");
  const meals = (mealsModel?.data as any[] | null) ?? DEMO_MEALS;
  const [dialogOpen, setDialogOpen] = useState(false);

  const allMeals = meals || DEMO_MEALS;
  const totalCal = allMeals.reduce((s: number, m: any) => s + m.calories, 0);
  const totalProtein = allMeals.reduce((s: number, m: any) => s + m.protein, 0);
  const totalCarbs = allMeals.reduce((s: number, m: any) => s + m.carbs, 0);
  const totalFat = allMeals.reduce((s: number, m: any) => s + m.fat, 0);

  const calPercent = Math.min(Math.round((totalCal / CALORIE_GOAL) * 100), 100);
  const proteinPct = Math.min(Math.round((totalProtein / MACRO_GOALS.protein) * 100), 100);
  const carbsPct = Math.min(Math.round((totalCarbs / MACRO_GOALS.carbs) * 100), 100);
  const fatPct = Math.min(Math.round((totalFat / MACRO_GOALS.fat) * 100), 100);

  const pieData = [
    { name: "Protein", value: Math.round(totalProtein * 4), fill: "#16a34a" },
    { name: "Carbs", value: Math.round(totalCarbs * 4), fill: "#3b82f6" },
    { name: "Fat", value: Math.round(totalFat * 9), fill: "#f59e0b" },
  ];

  const handleSave = () => {
    toast("Meal logged successfully!");
    setDialogOpen(false);
  };

  return (
    <div className={cn("p-6 space-y-6", className)}>
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-2xl font-bold text-foreground tracking-tight">
            Nutrition Tracker
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Today's intake — {allMeals.length} items logged
          </p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button className="bg-primary text-white hover:bg-primary/90 gap-1.5">
              <Icons.Plus className="h-4 w-4" />
              Add Meal
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Log Meal</DialogTitle>
              <DialogDescription>
                Add a food item to your daily nutrition log.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Meal Type</Label>
                  <Select>
                    <SelectTrigger>
                      <SelectValue placeholder="Select meal" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="breakfast">Breakfast</SelectItem>
                      <SelectItem value="lunch">Lunch</SelectItem>
                      <SelectItem value="dinner">Dinner</SelectItem>
                      <SelectItem value="snack">Snack</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Food Name</Label>
                  <Input placeholder="e.g. Grilled Chicken" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Calories</Label>
                  <Input type="number" placeholder="350" />
                </div>
                <div className="space-y-2">
                  <Label>Protein (g)</Label>
                  <Input type="number" placeholder="30" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Carbs (g)</Label>
                  <Input type="number" placeholder="40" />
                </div>
                <div className="space-y-2">
                  <Label>Fat (g)</Label>
                  <Input type="number" placeholder="12" />
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
                Log Meal
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Summary Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Calories Summary */}
        <Card>
          <CardContent className="pt-6">
            <div className="text-center mb-4">
              <p className="text-sm text-muted-foreground">Daily Calories</p>
              <div className="flex items-baseline justify-center gap-1 mt-1">
                <span className="text-3xl font-bold text-foreground">
                  {totalCal.toLocaleString()}
                </span>
                <span className="text-sm text-muted-foreground">
                  / {CALORIE_GOAL.toLocaleString()}
                </span>
              </div>
            </div>
            <Progress value={calPercent} className="h-3" />
            <p className="text-xs text-muted-foreground text-center mt-2">
              {CALORIE_GOAL - totalCal > 0
                ? `${CALORIE_GOAL - totalCal} cal remaining`
                : "Goal reached!"}
            </p>
          </CardContent>
        </Card>

        {/* Macros Progress */}
        <Card>
          <CardContent className="pt-6 space-y-4">
            <p className="text-sm font-medium text-foreground text-center">
              Macro Breakdown
            </p>
            {/* Protein */}
            <div>
              <div className="flex justify-between text-xs mb-1">
                <span className="font-medium text-green-600">Protein</span>
                <span className="text-muted-foreground">
                  {Math.round(totalProtein)}g / {MACRO_GOALS.protein}g
                </span>
              </div>
              <div className="macro-bar w-full bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-green-500 rounded-full"
                  style={{ width: `${proteinPct}%` }}
                />
              </div>
            </div>
            {/* Carbs */}
            <div>
              <div className="flex justify-between text-xs mb-1">
                <span className="font-medium text-blue-600">Carbs</span>
                <span className="text-muted-foreground">
                  {Math.round(totalCarbs)}g / {MACRO_GOALS.carbs}g
                </span>
              </div>
              <div className="macro-bar w-full bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-blue-500 rounded-full"
                  style={{ width: `${carbsPct}%` }}
                />
              </div>
            </div>
            {/* Fat */}
            <div>
              <div className="flex justify-between text-xs mb-1">
                <span className="font-medium text-amber-600">Fat</span>
                <span className="text-muted-foreground">
                  {Math.round(totalFat)}g / {MACRO_GOALS.fat}g
                </span>
              </div>
              <div className="macro-bar w-full bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-amber-500 rounded-full"
                  style={{ width: `${fatPct}%` }}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Macros Pie Chart */}
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm font-medium text-foreground text-center mb-2">
              Calorie Sources
            </p>
            <Charts.ResponsiveContainer width="100%" height={180}>
              <Charts.PieChart>
                <Charts.Pie
                  data={pieData}
                  cx="50%"
                  cy="50%"
                  innerRadius={45}
                  outerRadius={70}
                  paddingAngle={3}
                  dataKey="value"
                >
                  {pieData.map((entry, idx) => (
                    <Charts.Cell key={idx} fill={entry.fill} />
                  ))}
                </Charts.Pie>
                <Charts.Tooltip
                  formatter={(value: number) => `${value} cal`}
                />
                <Charts.Legend
                  verticalAlign="bottom"
                  height={30}
                  iconSize={8}
                />
              </Charts.PieChart>
            </Charts.ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Meal Sections */}
      <div className="space-y-4">
        {MEAL_SECTIONS.map((section) => {
          const Icon = Icons[section.icon as keyof typeof Icons] as React.ComponentType<{
            className?: string;
          }>;
          const sectionMeals = allMeals.filter(
            (m: any) => m.meal_type === section.type
          );
          const sectionCal = sectionMeals.reduce(
            (s: number, m: any) => s + m.calories,
            0
          );

          if (sectionMeals.length === 0) return null;

          return (
            <Card key={section.type}>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {Icon && (
                      <Icon className={cn("h-4 w-4", section.color)} />
                    )}
                    <CardTitle className="text-sm">{section.label}</CardTitle>
                    <Badge
                      variant="secondary"
                      className="text-[10px] px-1.5 py-0"
                    >
                      {sectionMeals.length} items
                    </Badge>
                  </div>
                  <span className="text-sm font-semibold text-foreground">
                    {sectionCal} cal
                  </span>
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="divide-y divide-border">
                  {sectionMeals.map((meal: any) => (
                    <div
                      key={meal.id}
                      className="meal-row flex items-center justify-between py-2.5 px-2 rounded-md"
                    >
                      <span className="text-sm text-foreground">
                        {meal.name}
                      </span>
                      <div className="flex items-center gap-4 text-xs text-muted-foreground">
                        <span>{meal.calories} cal</span>
                        <span className="text-green-600">
                          P:{Math.round(meal.protein)}g
                        </span>
                        <span className="text-blue-600">
                          C:{Math.round(meal.carbs)}g
                        </span>
                        <span className="text-amber-600">
                          F:{Math.round(meal.fat)}g
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

export default NutritionTracker;
