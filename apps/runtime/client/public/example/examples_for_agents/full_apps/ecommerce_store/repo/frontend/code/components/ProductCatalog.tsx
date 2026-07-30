import {
  React,
  useAppState,
  useArrayState,
  useModel,
  useNavigation,
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

interface Product {
  id: string;
  name: string;
  description: string;
  price: number;
  category: string;
  stock: number;
  rating: number;
  color: string;
}

interface CartItem {
  id: string;
  name: string;
  price: number;
  quantity: number;
}

const DEMO_PRODUCTS: Product[] = [
  { id: "p1", name: "Wireless Noise-Canceling Headphones", description: "Premium over-ear headphones with ANC and 30hr battery", price: 249.99, category: "Electronics", stock: 45, rating: 4.7, color: "bg-indigo-500" },
  { id: "p2", name: "Mechanical Gaming Keyboard", description: "RGB backlit with Cherry MX Blue switches", price: 159.99, category: "Electronics", stock: 32, rating: 4.5, color: "bg-violet-500" },
  { id: "p3", name: "Ultra-Wide 34\" Monitor", description: "3440x1440 IPS panel with USB-C hub", price: 599.99, category: "Electronics", stock: 12, rating: 4.8, color: "bg-cyan-500" },
  { id: "p4", name: "Classic Leather Jacket", description: "Genuine lambskin leather, slim fit design", price: 289.00, category: "Clothing", stock: 18, rating: 4.6, color: "bg-amber-700" },
  { id: "p5", name: "Running Sneakers Pro", description: "Lightweight mesh with responsive cushioning", price: 129.95, category: "Clothing", stock: 64, rating: 4.4, color: "bg-rose-500" },
  { id: "p6", name: "Merino Wool Sweater", description: "Extra-fine merino, crew neck, machine washable", price: 89.00, category: "Clothing", stock: 40, rating: 4.3, color: "bg-emerald-600" },
  { id: "p7", name: "Ceramic Pour-Over Coffee Set", description: "Handcrafted dripper with double-wall carafe", price: 64.99, category: "Home", stock: 28, rating: 4.9, color: "bg-orange-400" },
  { id: "p8", name: "Smart LED Floor Lamp", description: "WiFi-enabled, 16M colors, voice control compatible", price: 119.00, category: "Home", stock: 22, rating: 4.2, color: "bg-yellow-400" },
  { id: "p9", name: "Carbon Fiber Tennis Racket", description: "Professional-grade 98 sq in head, 305g unstrung", price: 219.00, category: "Sports", stock: 15, rating: 4.5, color: "bg-lime-500" },
  { id: "p10", name: "Yoga Mat Premium", description: "6mm eco-friendly TPE, non-slip both sides", price: 49.99, category: "Sports", stock: 55, rating: 4.6, color: "bg-teal-500" },
  { id: "p11", name: "The Art of Clean Code", description: "Practical guide to writing maintainable software", price: 34.99, category: "Books", stock: 100, rating: 4.8, color: "bg-blue-600" },
  { id: "p12", name: "Design Systems Handbook", description: "Building scalable UI component libraries", price: 42.00, category: "Books", stock: 78, rating: 4.4, color: "bg-purple-600" },
];

const CATEGORIES = ["All", "Electronics", "Clothing", "Home", "Sports", "Books"];

function StarRating({ rating }: { rating: number }) {
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((star) => (
        <Icons.Star
          key={star}
          className={cn(
            "h-3.5 w-3.5",
            star <= Math.round(rating)
              ? "fill-yellow-400 text-yellow-400"
              : "fill-muted text-muted"
          )}
        />
      ))}
      <span className="ml-1 text-xs text-muted-foreground">{rating.toFixed(1)}</span>
    </div>
  );
}

function ProductCatalog() {
  const navigation = useNavigation();
  const [searchQuery, setSearchQuery] = useAppState<string>("searchQuery", "");
  const [selectedCategory, setSelectedCategory] = useAppState<string>("selectedCategory", "all");
  const { items: cartItems, set: setCartItems } = useArrayState<CartItem>("cartItems", []);

  const productsModel = useModel("products");
  const products = (productsModel?.data as Product[] | null) ?? DEMO_PRODUCTS;
  const search = searchQuery ?? "";
  const category = selectedCategory ?? "all";
  const cart = cartItems ?? [];

  const filtered = products.filter((product: Product) => {
    const matchesSearch = product.name.toLowerCase().includes(search.toLowerCase()) ||
      product.description.toLowerCase().includes(search.toLowerCase());
    const matchesCategory = category === "all" || product.category.toLowerCase() === category.toLowerCase();
    return matchesSearch && matchesCategory;
  });

  const handleAddToCart = (product: Product) => {
    const existing = cart.find((item: CartItem) => item.id === product.id);
    if (existing) {
      setCartItems(
        cart.map((item: CartItem) =>
          item.id === product.id
            ? { ...item, quantity: item.quantity + 1 }
            : item
        )
      );
    } else {
      setCartItems([...cart, { id: product.id, name: product.name, price: product.price, quantity: 1 }]);
    }
    toast(`Added "${product.name}" to cart`);
  };

  const handleCategoryChange = (value: string) => {
    setSelectedCategory(value.toLowerCase());
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Products</h1>
          <p className="text-sm text-muted-foreground">
            Browse our collection of {filtered.length} product{filtered.length !== 1 ? "s" : ""}
          </p>
        </div>
        <div className="relative w-full sm:w-64">
          <Icons.Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search products..."
            value={search}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
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

      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <Icons.SearchX className="h-12 w-12 text-muted-foreground mb-4" />
          <h3 className="text-lg font-semibold">No products found</h3>
          <p className="text-sm text-muted-foreground mt-1">
            Try adjusting your search or category filter
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((product: Product) => (
            <Card key={product.id} className="product-card overflow-hidden flex flex-col">
              <div
                className={cn(
                  "h-40 flex items-center justify-center cursor-pointer",
                  product.color
                )}
                onClick={() => navigation.navigate(`/product/${product.id}`)}
              >
                <Icons.Image className="h-12 w-12 text-white/60" />
              </div>
              <CardContent className="flex-1 p-4 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <h3
                    className="text-sm font-semibold leading-tight cursor-pointer hover:text-primary transition-colors"
                    onClick={() => navigation.navigate(`/product/${product.id}`)}
                  >
                    {product.name}
                  </h3>
                  <Badge variant="secondary" className="text-[10px] shrink-0">
                    {product.category}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground line-clamp-2">
                  {product.description}
                </p>
                <StarRating rating={product.rating} />
                <div className="flex items-center justify-between pt-1">
                  <span className="text-lg font-bold price-tag text-primary">
                    ${product.price.toFixed(2)}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {product.stock > 0 ? `${product.stock} in stock` : "Out of stock"}
                  </span>
                </div>
              </CardContent>
              <CardFooter className="p-4 pt-0">
                <Button
                  className="w-full"
                  size="sm"
                  onClick={() => handleAddToCart(product)}
                  disabled={product.stock === 0}
                >
                  <Icons.ShoppingCart className="mr-2 h-4 w-4" />
                  Add to Cart
                </Button>
              </CardFooter>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

export default ProductCatalog;
