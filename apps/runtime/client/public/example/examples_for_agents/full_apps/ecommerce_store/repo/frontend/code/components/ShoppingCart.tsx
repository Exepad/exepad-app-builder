import {
  React,
  useArrayState,
  useAppState,
  useNavigation,
  toast,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  CardFooter,
  Button,
  Badge,
  Input,
  Label,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  Separator,
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  Icons,
  cn,
} from "@exepad/sdk";

interface CartItem {
  id: string;
  name: string;
  price: number;
  quantity: number;
}

const DEMO_CART: CartItem[] = [
  { id: "p1", name: "Wireless Noise-Canceling Headphones", price: 249.99, quantity: 1 },
  { id: "p5", name: "Running Sneakers Pro", price: 129.95, quantity: 2 },
  { id: "p7", name: "Ceramic Pour-Over Coffee Set", price: 64.99, quantity: 1 },
];

function ShoppingCart() {
  const navigation = useNavigation();
  const { items: cartItems, set: setCartItems } = useArrayState<CartItem>("cartItems", DEMO_CART);
  const [promoCode, setPromoCode] = useAppState<string>("promoCode", "");
  const [promoApplied, setPromoApplied] = useAppState<boolean>("promoApplied", false);

  const items = cartItems ?? DEMO_CART;
  const promo = promoCode ?? "";
  const promoActive = promoApplied ?? false;

  const subtotal = items.reduce(
    (sum: number, item: CartItem) => sum + item.price * item.quantity,
    0
  );
  const discount = promoActive ? subtotal * 0.1 : 0;
  const shipping = subtotal > 50 ? 0 : 9.99;
  const tax = (subtotal - discount) * 0.08;
  const total = subtotal - discount + shipping + tax;

  const updateQuantity = (id: string, delta: number) => {
    setCartItems(
      items.map((item: CartItem) => {
        if (item.id === id) {
          const newQty = Math.max(1, item.quantity + delta);
          return { ...item, quantity: newQty };
        }
        return item;
      })
    );
  };

  const removeItem = (id: string) => {
    const item = items.find((i: CartItem) => i.id === id);
    setCartItems(items.filter((i: CartItem) => i.id !== id));
    if (item) toast(`Removed "${item.name}" from cart`);
  };

  const applyPromo = () => {
    if (promo.toLowerCase() === "save10") {
      setPromoApplied(true);
      toast("Promo code applied! 10% discount added.");
    } else {
      toast("Invalid promo code. Try 'SAVE10'.");
    }
  };

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <div className="rounded-full bg-muted p-6 mb-6">
          <Icons.ShoppingCart className="h-12 w-12 text-muted-foreground" />
        </div>
        <h2 className="text-2xl font-bold mb-2">Your cart is empty</h2>
        <p className="text-muted-foreground mb-6 max-w-sm">
          Looks like you haven't added anything to your cart yet. Browse our products to find something you'll love.
        </p>
        <Button onClick={() => navigation.navigate("/")}>
          <Icons.ShoppingBag className="mr-2 h-4 w-4" />
          Continue Shopping
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Shopping Cart</h1>
          <p className="text-sm text-muted-foreground">
            {items.length} item{items.length !== 1 ? "s" : ""} in your cart
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => navigation.navigate("/")}>
          <Icons.ChevronLeft className="mr-1 h-4 w-4" />
          Continue Shopping
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Product</TableHead>
                    <TableHead className="text-center">Price</TableHead>
                    <TableHead className="text-center">Quantity</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead className="w-[40px]" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((item: CartItem) => (
                    <TableRow key={item.id}>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <div className="h-12 w-12 rounded-md bg-muted flex items-center justify-center shrink-0">
                            <Icons.Package className="h-5 w-5 text-muted-foreground" />
                          </div>
                          <span className="font-medium text-sm">{item.name}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-center text-sm price-tag">
                        ${Number(item.price ?? 0).toFixed(2)}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center justify-center gap-1">
                          <Button
                            variant="outline"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => updateQuantity(item.id, -1)}
                          >
                            <Icons.Minus className="h-3 w-3" />
                          </Button>
                          <span className="w-8 text-center text-sm font-medium">
                            {item.quantity}
                          </span>
                          <Button
                            variant="outline"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => updateQuantity(item.id, 1)}
                          >
                            <Icons.Plus className="h-3 w-3" />
                          </Button>
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-medium text-sm price-tag">
                        ${(Number(item.price ?? 0) * Number(item.quantity ?? 0)).toFixed(2)}
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground hover:text-destructive"
                          onClick={() => removeItem(item.id)}
                        >
                          <Icons.X className="h-3.5 w-3.5" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <div className="mt-4">
            <Label className="text-sm mb-2 block">Promo Code</Label>
            <InputGroup className="max-w-sm">
              <InputGroupInput
                placeholder="Enter code (try SAVE10)"
                value={promo}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPromoCode(e.target.value)}
                disabled={promoActive}
              />
              <InputGroupAddon position="right">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={applyPromo}
                  disabled={promoActive || !promo.trim()}
                >
                  {promoActive ? <Icons.Check className="h-4 w-4" /> : "Apply"}
                </Button>
              </InputGroupAddon>
            </InputGroup>
            {promoActive && (
              <p className="text-xs text-green-600 dark:text-green-400 mt-1">
                10% discount applied!
              </p>
            )}
          </div>
        </div>

        <div>
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Order Summary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Subtotal</span>
                <span className="font-medium price-tag">${subtotal.toFixed(2)}</span>
              </div>
              {promoActive && (
                <div className="flex justify-between text-sm text-green-600 dark:text-green-400">
                  <span>Discount (10%)</span>
                  <span>-${discount.toFixed(2)}</span>
                </div>
              )}
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Shipping</span>
                <span className={cn("font-medium", shipping === 0 && "text-green-600 dark:text-green-400")}>
                  {shipping === 0 ? "Free" : `$${shipping.toFixed(2)}`}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Tax (8%)</span>
                <span className="font-medium price-tag">${tax.toFixed(2)}</span>
              </div>
              <Separator />
              <div className="flex justify-between text-base font-bold">
                <span>Total</span>
                <span className="price-tag">${total.toFixed(2)}</span>
              </div>
            </CardContent>
            <CardFooter>
              <Button className="w-full" onClick={() => navigation.navigate("/checkout")}>
                Proceed to Checkout
                <Icons.ChevronRight className="ml-2 h-4 w-4" />
              </Button>
            </CardFooter>
          </Card>

          <div className="mt-4 space-y-2 text-xs text-muted-foreground">
            <div className="flex items-center gap-2">
              <Icons.Shield className="h-3.5 w-3.5" />
              <span>Secure checkout</span>
            </div>
            <div className="flex items-center gap-2">
              <Icons.Truck className="h-3.5 w-3.5" />
              <span>Free shipping on orders over $50</span>
            </div>
            <div className="flex items-center gap-2">
              <Icons.RotateCcw className="h-3.5 w-3.5" />
              <span>30-day return policy</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default ShoppingCart;
