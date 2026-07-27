import {
  React,
  Charts,
  Checkbox,
  RadioGroup,
  RadioGroupItem,
  Label,
  Separator,
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  useAppState,
  useArrayState,
  cn,
} from "@exepad/sdk";

interface Product {
  id: number;
  name: string;
  price: number;
  rating: number;
  reviews: number;
  category: string;
}

interface QuarterlyData {
  quarter: string;
  revenue: number;
  growth: number;
}

const CATEGORIES = ["Electronics", "Apparel", "Home & Garden", "Sports"];

const PRODUCTS: Product[] = [
  { id: 1, name: "Wireless Earbuds Pro", price: 129, rating: 4.7, reviews: 2340, category: "Electronics" },
  { id: 2, name: "Smart Watch Ultra", price: 349, rating: 4.5, reviews: 1890, category: "Electronics" },
  { id: 3, name: "Bluetooth Speaker", price: 79, rating: 4.2, reviews: 3120, category: "Electronics" },
  { id: 4, name: "Noise-Cancel Headphones", price: 249, rating: 4.8, reviews: 4210, category: "Electronics" },
  { id: 5, name: "USB-C Hub Adapter", price: 45, rating: 4.1, reviews: 1560, category: "Electronics" },
  { id: 6, name: "Performance Running Shoes", price: 159, rating: 4.6, reviews: 2780, category: "Apparel" },
  { id: 7, name: "Merino Wool Jacket", price: 219, rating: 4.4, reviews: 890, category: "Apparel" },
  { id: 8, name: "Stretch Denim Jeans", price: 89, rating: 4.3, reviews: 3450, category: "Apparel" },
  { id: 9, name: "Waterproof Rain Coat", price: 175, rating: 4.0, reviews: 1230, category: "Apparel" },
  { id: 10, name: "Cotton Polo Shirt", price: 55, rating: 3.9, reviews: 2100, category: "Apparel" },
  { id: 11, name: "Robot Vacuum Cleaner", price: 399, rating: 4.6, reviews: 5670, category: "Home & Garden" },
  { id: 12, name: "Air Purifier HEPA", price: 189, rating: 4.3, reviews: 2340, category: "Home & Garden" },
  { id: 13, name: "Smart LED Grow Light", price: 65, rating: 4.1, reviews: 980, category: "Home & Garden" },
  { id: 14, name: "Ergonomic Desk Chair", price: 329, rating: 4.5, reviews: 3210, category: "Home & Garden" },
  { id: 15, name: "Cordless Stick Vacuum", price: 259, rating: 4.2, reviews: 1870, category: "Home & Garden" },
  { id: 16, name: "Yoga Mat Premium", price: 49, rating: 4.7, reviews: 4520, category: "Sports" },
  { id: 17, name: "Resistance Band Set", price: 35, rating: 4.4, reviews: 6780, category: "Sports" },
  { id: 18, name: "Adjustable Dumbbells", price: 299, rating: 4.8, reviews: 2150, category: "Sports" },
  { id: 19, name: "Cycling Helmet Aero", price: 119, rating: 4.3, reviews: 1340, category: "Sports" },
  { id: 20, name: "Fitness Tracker Band", price: 69, rating: 4.0, reviews: 3890, category: "Sports" },
];

const ALL_QUARTERLY: QuarterlyData[] = [
  { quarter: "Q1 2024", revenue: 142000, growth: 8.2 },
  { quarter: "Q2 2024", revenue: 168000, growth: 12.5 },
  { quarter: "Q3 2024", revenue: 155000, growth: 10.1 },
  { quarter: "Q4 2024", revenue: 198000, growth: 18.3 },
  { quarter: "Q1 2025", revenue: 176000, growth: 14.7 },
  { quarter: "Q2 2025", revenue: 210000, growth: 22.1 },
  { quarter: "Q3 2025", revenue: 195000, growth: 16.8 },
  { quarter: "Q4 2025", revenue: 238000, growth: 25.4 },
];

const CATEGORY_COLORS: Record<string, string> = {
  Electronics: "hsl(25, 95%, 53%)",
  Apparel: "hsl(45, 93%, 47%)",
  "Home & Garden": "hsl(15, 75%, 50%)",
  Sports: "hsl(35, 90%, 55%)",
};

function MarketResearch() {
  const { items: selectedCategories, set: setSelectedCategories } = useArrayState<string>(
    "selectedCategories",
    [...CATEGORIES]
  );
  const toggleCategory = (cat: string) => {
    setSelectedCategories(
      (selectedCategories || CATEGORIES).includes(cat)
        ? (selectedCategories || CATEGORIES).filter((c: string) => c !== cat)
        : [...(selectedCategories || CATEGORIES), cat]
    );
  };
  const [timeRange, setTimeRange] = useAppState<string>("timeRange", "all");

  const filteredProducts = PRODUCTS.filter((p) =>
    (selectedCategories || CATEGORIES).includes(p.category)
  );

  const filteredQuarterly = React.useMemo(() => {
    const data = ALL_QUARTERLY;
    if (timeRange === "last4") return data.slice(-4);
    if (timeRange === "last2") return data.slice(-2);
    return data;
  }, [timeRange]);

  const CustomTooltip = ({ active, payload }: any) => {
    if (!active || !payload?.length) return null;
    const data = payload[0].payload;
    return (
      <div className="bg-background border border-border rounded-lg p-3 shadow-lg">
        <p className="font-semibold text-sm">{data.name}</p>
        <p className="text-xs text-muted-foreground">{data.category}</p>
        <Separator className="my-1.5" />
        <p className="text-xs">Price: ${data.price}</p>
        <p className="text-xs">Rating: {data.rating}/5</p>
        <p className="text-xs">Reviews: {data.reviews.toLocaleString()}</p>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Market Research</h2>
        <p className="text-muted-foreground">
          Product positioning analysis and quarterly performance trends
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle className="text-base">Filters</CardTitle>
            <CardDescription>Refine chart data</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-3">
              <Label className="text-sm font-medium">Categories</Label>
              {CATEGORIES.map((cat) => (
                <div key={cat} className="flex items-center space-x-2">
                  <Checkbox
                    id={`cat-${cat}`}
                    checked={(selectedCategories || CATEGORIES).includes(cat)}
                    onCheckedChange={() => toggleCategory(cat)}
                  />
                  <Label
                    htmlFor={`cat-${cat}`}
                    className="text-sm font-normal cursor-pointer"
                  >
                    {cat}
                  </Label>
                </div>
              ))}
            </div>

            <Separator />

            <div className="space-y-3">
              <Label className="text-sm font-medium">Time Range</Label>
              <RadioGroup
                value={timeRange || "all"}
                onValueChange={(val: string) => setTimeRange(val)}
              >
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="all" id="range-all" />
                  <Label htmlFor="range-all" className="text-sm font-normal cursor-pointer">
                    All Quarters (8)
                  </Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="last4" id="range-last4" />
                  <Label htmlFor="range-last4" className="text-sm font-normal cursor-pointer">
                    Last 4 Quarters
                  </Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="last2" id="range-last2" />
                  <Label htmlFor="range-last2" className="text-sm font-normal cursor-pointer">
                    Last 2 Quarters
                  </Label>
                </div>
              </RadioGroup>
            </div>
          </CardContent>
        </Card>

        <div className="lg:col-span-3 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Price vs. Customer Rating</CardTitle>
              <CardDescription>
                Bubble size represents review count. Showing {filteredProducts.length} of {PRODUCTS.length} products.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Charts.ResponsiveContainer width="100%" height={400}>
                <Charts.ScatterChart margin={{ top: 10, right: 30, bottom: 10, left: 10 }}>
                  <Charts.CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <Charts.XAxis
                    type="number"
                    dataKey="price"
                    name="Price"
                    unit="$"
                    domain={[0, 450]}
                    className="text-xs"
                  />
                  <Charts.YAxis
                    type="number"
                    dataKey="rating"
                    name="Rating"
                    domain={[3.5, 5]}
                    className="text-xs"
                  />
                  <Charts.ZAxis
                    type="number"
                    dataKey="reviews"
                    range={[50, 400]}
                    name="Reviews"
                  />
                  <Charts.Tooltip content={<CustomTooltip />} />
                  <Charts.Legend />
                  {CATEGORIES.filter((cat) =>
                    (selectedCategories || CATEGORIES).includes(cat)
                  ).map((cat) => (
                    <Charts.Scatter
                      key={cat}
                      name={cat}
                      data={filteredProducts.filter((p) => p.category === cat)}
                      fill={CATEGORY_COLORS[cat]}
                    />
                  ))}
                </Charts.ScatterChart>
              </Charts.ResponsiveContainer>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Revenue & Growth Trends</CardTitle>
              <CardDescription>
                Bar chart showing quarterly revenue with growth percentage line overlay
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Charts.ResponsiveContainer width="100%" height={350}>
                <Charts.ComposedChart data={filteredQuarterly} margin={{ top: 10, right: 30, bottom: 10, left: 10 }}>
                  <Charts.CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <Charts.XAxis dataKey="quarter" className="text-xs" />
                  <Charts.YAxis
                    yAxisId="revenue"
                    orientation="left"
                    className="text-xs"
                    tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`}
                  />
                  <Charts.YAxis
                    yAxisId="growth"
                    orientation="right"
                    className="text-xs"
                    tickFormatter={(v: number) => `${v}%`}
                  />
                  <Charts.Tooltip
                    formatter={(value: number, name: string) =>
                      name === "revenue"
                        ? [`$${value.toLocaleString()}`, "Revenue"]
                        : [`${value}%`, "Growth"]
                    }
                  />
                  <Charts.Legend />
                  <Charts.Bar
                    yAxisId="revenue"
                    dataKey="revenue"
                    fill="hsl(var(--primary))"
                    radius={[4, 4, 0, 0]}
                    name="revenue"
                  />
                  <Charts.Line
                    yAxisId="growth"
                    type="monotone"
                    dataKey="growth"
                    stroke="hsl(25, 95%, 53%)"
                    strokeWidth={2}
                    dot={{ fill: "hsl(25, 95%, 53%)", r: 4 }}
                    name="growth"
                  />
                </Charts.ComposedChart>
              </Charts.ResponsiveContainer>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

export default MarketResearch;
