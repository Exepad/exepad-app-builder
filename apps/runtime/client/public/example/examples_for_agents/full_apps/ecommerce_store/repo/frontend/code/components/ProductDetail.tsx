import {
  React,
  useAppState,
  useArrayState,
  useNavigation,
  toast,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Button,
  Badge,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  Label,
  Separator,
  Avatar,
  AvatarFallback,
  Icons,
  cn,
} from "@exepad/sdk";

interface CartItem {
  id: string;
  name: string;
  price: number;
  quantity: number;
}

interface Review {
  id: string;
  reviewer_name: string;
  rating: number;
  comment: string;
  created_at: string;
}

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

const DEMO_PRODUCT: Product = {
  id: "p1",
  name: "Wireless Noise-Canceling Headphones",
  description: "Experience crystal-clear audio with our premium over-ear headphones. Featuring advanced active noise cancellation, 30-hour battery life, and ultra-comfortable memory foam cushions. The 40mm custom drivers deliver rich, detailed sound across all frequencies. Includes carrying case, USB-C charging cable, and 3.5mm audio cable for wired listening.",
  price: 249.99,
  category: "Electronics",
  stock: 45,
  rating: 4.7,
  color: "bg-indigo-500",
};

const DEMO_REVIEWS: Review[] = [
  { id: "r1", reviewer_name: "Sarah Chen", rating: 5, comment: "Absolutely love these headphones! The noise cancellation is incredible, perfect for my daily commute. Battery lasts all week.", created_at: "2026-03-15" },
  { id: "r2", reviewer_name: "Marcus Rivera", rating: 4, comment: "Great sound quality and comfortable fit. Only minor issue is the Bluetooth range could be better. Still highly recommend.", created_at: "2026-03-10" },
  { id: "r3", reviewer_name: "Emily Watson", rating: 5, comment: "Best headphones I've ever owned. The build quality is premium and they fold up nicely for travel. Worth every penny.", created_at: "2026-03-05" },
  { id: "r4", reviewer_name: "James Park", rating: 4, comment: "Solid noise cancellation and battery life. The app could use some improvements but the hardware is top-notch.", created_at: "2026-02-28" },
  { id: "r5", reviewer_name: "Priya Sharma", rating: 5, comment: "Upgraded from a budget pair and the difference is night and day. Crystal clear audio for music and calls.", created_at: "2026-02-20" },
];

const RELATED_PRODUCTS: Product[] = [
  { id: "p2", name: "Mechanical Gaming Keyboard", description: "RGB backlit with Cherry MX Blue switches", price: 159.99, category: "Electronics", stock: 32, rating: 4.5, color: "bg-violet-500" },
  { id: "p3", name: "Ultra-Wide 34\" Monitor", description: "3440x1440 IPS panel with USB-C hub", price: 599.99, category: "Electronics", stock: 12, rating: 4.8, color: "bg-cyan-500" },
  { id: "p8", name: "Smart LED Floor Lamp", description: "WiFi-enabled, 16M colors", price: 119.00, category: "Home", stock: 22, rating: 4.2, color: "bg-yellow-400" },
];

const SIZES = ["Small", "Medium", "Large", "X-Large"];
const COLORS = ["Black", "White", "Navy", "Silver"];

function StarRating({ rating, size = "sm" }: { rating: number; size?: "sm" | "md" }) {
  const iconSize = size === "md" ? "h-5 w-5" : "h-3.5 w-3.5";
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((star) => (
        <Icons.Star
          key={star}
          className={cn(
            iconSize,
            star <= Math.round(rating)
              ? "fill-yellow-400 text-yellow-400"
              : "fill-muted text-muted"
          )}
        />
      ))}
    </div>
  );
}

function ProductDetail() {
  const navigation = useNavigation();
  const { items: cartItems, set: setCartItems } = useArrayState<CartItem>("cartItems", []);
  const [quantity, setQuantity] = React.useState(1);
  const [selectedSize, setSelectedSize] = React.useState("Medium");
  const [selectedColor, setSelectedColor] = React.useState("Black");

  const product = DEMO_PRODUCT;
  const reviews = DEMO_REVIEWS;
  const cart = cartItems ?? [];
  const avgRating = reviews.reduce((sum: number, r: Review) => sum + r.rating, 0) / reviews.length;

  const handleAddToCart = () => {
    const existing = cart.find((item: CartItem) => item.id === product.id);
    if (existing) {
      setCartItems(
        cart.map((item: CartItem) =>
          item.id === product.id
            ? { ...item, quantity: item.quantity + quantity }
            : item
        )
      );
    } else {
      setCartItems([...cart, { id: product.id, name: product.name, price: product.price, quantity }]);
    }
    toast(`Added ${quantity}x "${product.name}" to cart`);
  };

  return (
    <div className="space-y-8">
      <Button
        variant="ghost"
        size="sm"
        onClick={() => navigation.navigate("/")}
        className="mb-2"
      >
        <Icons.ChevronLeft className="mr-1 h-4 w-4" />
        Back to Products
      </Button>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className={cn("rounded-xl h-80 lg:h-[28rem] flex items-center justify-center", product.color)}>
          <Icons.Image className="h-24 w-24 text-white/40" />
        </div>

        <div className="space-y-6">
          <div>
            <Badge variant="secondary" className="mb-2">{product.category}</Badge>
            <h1 className="text-2xl font-bold tracking-tight">{product.name}</h1>
            <div className="flex items-center gap-3 mt-2">
              <StarRating rating={avgRating} size="md" />
              <span className="text-sm text-muted-foreground">
                {avgRating.toFixed(1)} ({reviews.length} reviews)
              </span>
            </div>
          </div>

          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-bold price-tag text-primary">
              ${product.price.toFixed(2)}
            </span>
            <span className="text-sm text-muted-foreground line-through">
              ${(product.price * 1.2).toFixed(2)}
            </span>
            <Badge variant="destructive" className="text-xs">-20%</Badge>
          </div>

          <p className="text-sm text-muted-foreground leading-relaxed">
            {product.description}
          </p>

          <Separator />

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Size</Label>
              <Select value={selectedSize} onValueChange={setSelectedSize}>
                <SelectTrigger>
                  <SelectValue placeholder="Select size" />
                </SelectTrigger>
                <SelectContent>
                  {SIZES.map((size) => (
                    <SelectItem key={size} value={size}>{size}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Color</Label>
              <Select value={selectedColor} onValueChange={setSelectedColor}>
                <SelectTrigger>
                  <SelectValue placeholder="Select color" />
                </SelectTrigger>
                <SelectContent>
                  {COLORS.map((color) => (
                    <SelectItem key={color} value={color}>{color}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <Label className="text-sm">Qty:</Label>
              <div className="flex items-center border border-border rounded-md">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9 rounded-r-none"
                  onClick={() => setQuantity(Math.max(1, quantity - 1))}
                >
                  <Icons.Minus className="h-3 w-3" />
                </Button>
                <span className="w-10 text-center text-sm font-medium">{quantity}</span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9 rounded-l-none"
                  onClick={() => setQuantity(Math.min(product.stock, quantity + 1))}
                >
                  <Icons.Plus className="h-3 w-3" />
                </Button>
              </div>
            </div>
            <Button className="flex-1" onClick={handleAddToCart}>
              <Icons.ShoppingCart className="mr-2 h-4 w-4" />
              Add to Cart
            </Button>
          </div>

          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <div className="flex items-center gap-1">
              <Icons.Truck className="h-3.5 w-3.5" />
              <span>Free shipping over $50</span>
            </div>
            <div className="flex items-center gap-1">
              <Icons.RotateCcw className="h-3.5 w-3.5" />
              <span>30-day returns</span>
            </div>
            <div className="flex items-center gap-1">
              <Icons.Shield className="h-3.5 w-3.5" />
              <span>2-year warranty</span>
            </div>
          </div>
        </div>
      </div>

      <Separator />

      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold">Customer Reviews</h2>
          <Badge variant="outline">{reviews.length} reviews</Badge>
        </div>
        <div className="space-y-4">
          {reviews.map((review: Review) => (
            <Card key={review.id}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-3">
                    <Avatar className="h-8 w-8">
                      <AvatarFallback className="text-xs bg-primary/10 text-primary">
                        {review.reviewer_name.split(" ").map((n: string) => n[0]).join("").toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div>
                      <p className="text-sm font-medium">{review.reviewer_name}</p>
                      <p className="text-xs text-muted-foreground">{review.created_at}</p>
                    </div>
                  </div>
                  <StarRating rating={review.rating} />
                </div>
                <p className="text-sm text-muted-foreground">{review.comment}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      <Separator />

      <div className="space-y-4">
        <h2 className="text-xl font-bold">Related Products</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {RELATED_PRODUCTS.map((rp: Product) => (
            <Card
              key={rp.id}
              className="product-card overflow-hidden cursor-pointer"
              onClick={() => navigation.navigate(`/product/${rp.id}`)}
            >
              <div className={cn("h-28 flex items-center justify-center", rp.color)}>
                <Icons.Image className="h-8 w-8 text-white/50" />
              </div>
              <CardContent className="p-3">
                <h4 className="text-sm font-medium truncate">{rp.name}</h4>
                <p className="text-sm font-bold text-primary price-tag mt-1">
                  ${rp.price.toFixed(2)}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}

export default ProductDetail;
