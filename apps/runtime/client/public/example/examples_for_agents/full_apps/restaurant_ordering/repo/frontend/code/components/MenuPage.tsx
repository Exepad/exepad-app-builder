import {
  React,
  useModel,
  useAppState,
  useArrayState,
  toast,
  Card,
  CardContent,
  CardFooter,
  Button,
  Badge,
  Input,
  Tabs,
  TabsList,
  TabsTrigger,
  Icons,
  cn,
} from "@exepad/sdk";

const { useMemo } = React;

interface MenuItem {
  id: string;
  name: string;
  description: string;
  price: number;
  category: string;
  spice_level: string | null;
  is_available: number;
}

interface OrderItem {
  id: string;
  name: string;
  price: number;
  quantity: number;
}

const DEMO_MENU_ITEMS: MenuItem[] = [
  { id: "a1", name: "Bruschetta al Pomodoro", description: "Grilled ciabatta topped with vine-ripened tomatoes, fresh basil, garlic, and extra virgin olive oil.", price: 11.0, category: "appetizers", spice_level: null, is_available: 1 },
  { id: "a2", name: "Crispy Calamari Fritti", description: "Lightly dusted squid rings fried golden, served with spicy marinara and lemon aioli.", price: 14.0, category: "appetizers", spice_level: "mild", is_available: 1 },
  { id: "a3", name: "Burrata Caprese", description: "Creamy burrata cheese with heirloom tomatoes, wild arugula, aged balsamic reduction, and basil oil.", price: 16.0, category: "appetizers", spice_level: null, is_available: 1 },
  { id: "a4", name: "Spicy Nduja Flatbread", description: "Crispy flatbread with spreadable Calabrian nduja sausage, mozzarella, honey, and fresh chili.", price: 13.0, category: "appetizers", spice_level: "hot", is_available: 1 },
  { id: "m1", name: "Osso Buco alla Milanese", description: "Braised veal shank in white wine, tomatoes, and gremolata, served with saffron risotto.", price: 36.0, category: "mains", spice_level: null, is_available: 1 },
  { id: "m2", name: "Chicken Parmigiana", description: "Herb-crusted chicken breast with San Marzano tomato sauce, melted mozzarella, and fresh basil.", price: 24.0, category: "mains", spice_level: null, is_available: 1 },
  { id: "m3", name: "Lamb Chops Scottadito", description: "Char-grilled lamb chops marinated in rosemary, garlic, and olive oil with roasted potatoes.", price: 38.0, category: "mains", spice_level: "mild", is_available: 1 },
  { id: "m4", name: "Eggplant Parmigiana", description: "Layers of fried eggplant, tomato sauce, mozzarella, and Parmigiano. A vegetarian classic.", price: 20.0, category: "mains", spice_level: null, is_available: 1 },
  { id: "p1", name: "Truffle Mushroom Risotto", description: "Arborio rice slow-cooked with porcini mushrooms, finished with black truffle oil and aged Parmigiano.", price: 24.0, category: "pasta", spice_level: null, is_available: 1 },
  { id: "p2", name: "Cacio e Pepe", description: "Tonnarelli pasta with Pecorino Romano and cracked black pepper. Simple perfection.", price: 18.0, category: "pasta", spice_level: "mild", is_available: 1 },
  { id: "p3", name: "Lobster Ravioli", description: "Handmade ravioli filled with Maine lobster in a saffron cream sauce with cherry tomatoes.", price: 28.0, category: "pasta", spice_level: null, is_available: 1 },
  { id: "p4", name: "Pappardelle Bolognese", description: "Wide ribbon pasta with slow-simmered beef and pork ragu, San Marzano tomatoes, and Parmigiano.", price: 22.0, category: "pasta", spice_level: null, is_available: 1 },
  { id: "p5", name: "Arrabbiata Penne", description: "Penne in a fiery tomato sauce with garlic, red chili flakes, and fresh parsley.", price: 17.0, category: "pasta", spice_level: "hot", is_available: 1 },
  { id: "s1", name: "Grilled Mediterranean Branzino", description: "Whole sea bass grilled with lemon, capers, and fresh herbs on roasted vegetables.", price: 32.0, category: "seafood", spice_level: null, is_available: 1 },
  { id: "s2", name: "Shrimp Scampi Linguine", description: "Jumbo shrimp sauteed in garlic butter, white wine, and cherry tomatoes over linguine.", price: 26.0, category: "seafood", spice_level: "mild", is_available: 1 },
  { id: "s3", name: "Pan-Seared Salmon", description: "Atlantic salmon with crispy skin, lemon dill sauce, asparagus, and fingerling potatoes.", price: 28.0, category: "seafood", spice_level: null, is_available: 1 },
  { id: "s4", name: "Spicy Cioppino", description: "San Francisco-style seafood stew with clams, mussels, shrimp, and fish in spicy tomato broth.", price: 30.0, category: "seafood", spice_level: "extra_hot", is_available: 1 },
  { id: "d1", name: "Tiramisu Classico", description: "Layers of espresso-soaked ladyfingers, mascarpone cream, and cocoa. Our signature recipe since 2011.", price: 12.0, category: "desserts", spice_level: null, is_available: 1 },
  { id: "d2", name: "Panna Cotta al Limone", description: "Silky vanilla panna cotta with lemon curd, fresh berries, and a pistachio crumble.", price: 11.0, category: "desserts", spice_level: null, is_available: 1 },
  { id: "d3", name: "Chocolate Lava Cake", description: "Warm dark chocolate fondant with a molten center, vanilla gelato, and raspberry coulis.", price: 14.0, category: "desserts", spice_level: null, is_available: 1 },
  { id: "dr1", name: "Aperol Spritz", description: "Classic Italian aperitivo with Aperol, Prosecco, and a splash of soda. Refreshing and bubbly.", price: 14.0, category: "drinks", spice_level: null, is_available: 1 },
  { id: "dr2", name: "Negroni", description: "Equal parts gin, Campari, and sweet vermouth, stirred over ice with an orange peel.", price: 15.0, category: "drinks", spice_level: null, is_available: 1 },
  { id: "dr3", name: "Espresso Martini", description: "Vodka, freshly pulled espresso, coffee liqueur, and a hint of vanilla. Shaken cold.", price: 16.0, category: "drinks", spice_level: null, is_available: 1 },
  { id: "dr4", name: "Limonata Fresca", description: "House-made sparkling lemonade with fresh mint and a touch of elderflower syrup.", price: 7.0, category: "drinks", spice_level: null, is_available: 1 },
];

const CATEGORIES = ["All", "Appetizers", "Mains", "Pasta", "Seafood", "Desserts", "Drinks"];

const WARM_BG: Record<string, string> = {
  appetizers: "bg-orange-200",
  mains: "bg-red-200",
  pasta: "bg-amber-100",
  seafood: "bg-sky-200",
  desserts: "bg-pink-200",
  drinks: "bg-lime-200",
};

const SPICE_DOTS: Record<string, number> = { mild: 1, medium: 2, hot: 3, extra_hot: 4 };

function SpiceIndicator({ level }: { level: string }) {
  const dots = SPICE_DOTS[level] ?? 0;
  if (dots === 0) return null;
  return (
    <div className="flex items-center gap-1" title={level.replace("_", " ")}>
      {Array.from({ length: dots }).map((_, i) => (
        <span key={i} className="w-2 h-2 rounded-full bg-red-500 inline-block" />
      ))}
    </div>
  );
}

function MenuPage() {
  const menuItemsModel = useModel("menu_items");
  const menuItems = (menuItemsModel?.data as any[] | null) ?? DEMO_MENU_ITEMS;
  const [selectedCategory, setSelectedCategory] = useAppState<string>("selectedCategory", "all");
  const { items: orderItems, set: setOrderItems } = useArrayState<OrderItem>("orderItems", []);
  const [searchQuery, setSearchQuery] = React.useState("");

  const category = selectedCategory ?? "all";
  const cart = orderItems ?? [];

  const filteredItems = useMemo(() => {
    let items = DEMO_MENU_ITEMS;
    if (category !== "all") {
      items = items.filter((item) => item.category === category);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      items = items.filter(
        (item) =>
          item.name.toLowerCase().includes(q) ||
          item.description.toLowerCase().includes(q)
      );
    }
    return items;
  }, [category, searchQuery]);

  const addToOrder = (item: MenuItem) => {
    const idx = cart.findIndex((o: OrderItem) => o.id === item.id);
    if (idx >= 0) {
      const updated = [...cart];
      updated[idx] = { ...updated[idx], quantity: updated[idx].quantity + 1 };
      setOrderItems(updated);
    } else {
      setOrderItems([...cart, { id: item.id, name: item.name, price: item.price, quantity: 1 }]);
    }
    toast(`Added "${item.name}" to your order`);
  };

  const handleCategoryChange = (value: string) => {
    setSelectedCategory(value.toLowerCase());
  };

  return (
    <div className="max-w-7xl mx-auto px-6 py-12 space-y-8">
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight">Our Menu</h1>
        <p className="text-muted-foreground mt-1">Fresh ingredients, bold flavors, crafted with love.</p>
      </div>

      <div className="relative max-w-md">
        <Icons.Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search dishes..."
          value={searchQuery}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearchQuery(e.target.value)}
          className="pl-9"
        />
      </div>

      <Tabs
        value={category === "all" ? "All" : CATEGORIES.find((c) => c.toLowerCase() === category) || "All"}
        onValueChange={handleCategoryChange}
      >
        <TabsList className="flex-wrap h-auto gap-1">
          {CATEGORIES.map((cat) => (
            <TabsTrigger key={cat} value={cat} className="text-xs">
              {cat}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {filteredItems.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <Icons.SearchX className="h-12 w-12 text-muted-foreground mb-4" />
          <h3 className="text-lg font-semibold">No dishes found</h3>
          <p className="text-sm text-muted-foreground mt-1">Try adjusting your search or category filter</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredItems.map((item) => (
            <Card key={item.id} className="overflow-hidden flex flex-col">
              <div className={cn("h-40 flex items-center justify-center relative", WARM_BG[item.category] || "bg-orange-200")}>
                <Icons.ChefHat className="h-12 w-12 text-foreground/10" />
                {item.spice_level && (
                  <div className="absolute top-3 right-3">
                    <SpiceIndicator level={item.spice_level} />
                  </div>
                )}
              </div>
              <CardContent className="flex-1 p-5 space-y-2">
                <div className="flex justify-between items-start gap-2">
                  <h3 className="text-sm font-bold leading-tight">{item.name}</h3>
                  <span className="text-primary font-bold text-base shrink-0">
                    ${item.price.toFixed(2)}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2">
                  {item.description}
                </p>
              </CardContent>
              <CardFooter className="p-5 pt-0">
                <Button className="w-full" size="sm" onClick={() => addToOrder(item)}>
                  <Icons.Plus className="mr-2 h-4 w-4" />
                  Add to Order
                </Button>
              </CardFooter>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

export default MenuPage;
