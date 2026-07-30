import {
  React,
  useArrayState,
  useAppState,
  useNavigation,
  useModel,
  useHandler,
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
  Separator,
  Icons,
  cn,
} from "@exepad/sdk";

interface CartItem {
  id: string;
  name: string;
  price: number;
  quantity: number;
}

const STEP_LABELS = ["Shipping", "Payment", "Review"];

const DEMO_CART: CartItem[] = [
  { id: "p1", name: "Wireless Noise-Canceling Headphones", price: 249.99, quantity: 1 },
  { id: "p5", name: "Running Sneakers Pro", price: 129.95, quantity: 2 },
  { id: "p7", name: "Ceramic Pour-Over Coffee Set", price: 64.99, quantity: 1 },
];

function CheckoutFlow() {
  const navigation = useNavigation();
  const { items: cartItems, set: setCartItems } = useArrayState<CartItem>("cartItems", DEMO_CART);
  const [currentStep, setCurrentStep] = useAppState<number>("checkoutStep", 0);
  const [orderPlaced, setOrderPlaced] = React.useState(false);

  const items = cartItems ?? DEMO_CART;
  const step = currentStep ?? 0;

  const [shipping, setShipping] = React.useState({
    fullName: "",
    email: "",
    address: "",
    city: "",
    state: "",
    zip: "",
  });

  const [payment, setPayment] = React.useState({
    cardNumber: "",
    expiry: "",
    cvv: "",
    nameOnCard: "",
  });

  const orderModel = useModel("orders");
  const createOrder = useHandler("createOrder", {
    onSuccess: () => toast("Order placed successfully!"),
    onError: () => toast("Order placement failed. Please try again."),
  });

  const subtotal = items.reduce(
    (sum: number, item: CartItem) => sum + item.price * item.quantity,
    0
  );
  const shippingCost = subtotal > 50 ? 0 : 9.99;
  const tax = subtotal * 0.08;
  const total = subtotal + shippingCost + tax;

  const handlePlaceOrder = () => {
    if (orderModel?.create) {
      orderModel.create({
        total,
        status: "pending",
        shipping_address: `${shipping.address}, ${shipping.city}, ${shipping.state} ${shipping.zip}`,
        payment_method: "card",
      });
    }
    if (createOrder) {
      createOrder({
        items: items.map((i: CartItem) => ({ product_id: i.id, quantity: i.quantity })),
        shipping_address: `${shipping.address}, ${shipping.city}, ${shipping.state} ${shipping.zip}`,
      });
    }
    setOrderPlaced(true);
    setCartItems([]);
    setCurrentStep(0);
  };

  if (orderPlaced) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <div className="rounded-full bg-green-100 dark:bg-green-900 p-6 mb-6">
          <Icons.CheckCircle2 className="h-12 w-12 text-green-600 dark:text-green-400" />
        </div>
        <h2 className="text-2xl font-bold mb-2">Order Placed Successfully!</h2>
        <p className="text-muted-foreground mb-2 max-w-sm">
          Thank you for your purchase. Your order #SW-{Math.floor(Math.random() * 90000 + 10000)} has been confirmed.
        </p>
        <p className="text-sm text-muted-foreground mb-6">
          You will receive a confirmation email shortly.
        </p>
        <div className="flex gap-3">
          <Button variant="outline" onClick={() => navigation.navigate("/orders")}>
            <Icons.Package className="mr-2 h-4 w-4" />
            View Orders
          </Button>
          <Button onClick={() => { setOrderPlaced(false); navigation.navigate("/"); }}>
            <Icons.ShoppingBag className="mr-2 h-4 w-4" />
            Continue Shopping
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Checkout</h1>
        <p className="text-sm text-muted-foreground">Complete your order in 3 easy steps</p>
      </div>

      {/* Step Indicator */}
      <div className="flex items-center justify-between">
        {STEP_LABELS.map((label, i) => (
          <div key={label} className="flex items-center gap-2">
            <Badge
              variant={i < step ? "default" : i === step ? "outline" : "secondary"}
              className={cn(
                "h-8 w-8 rounded-full flex items-center justify-center p-0",
                i < step && "bg-primary text-primary-foreground"
              )}
            >
              {i < step ? (
                <Icons.Check className="h-4 w-4" />
              ) : (
                <span className="text-xs font-bold">{i + 1}</span>
              )}
            </Badge>
            <span className={cn(
              "text-sm font-medium hidden sm:inline",
              i <= step ? "text-foreground" : "text-muted-foreground"
            )}>
              {label}
            </span>
            {i < STEP_LABELS.length - 1 && (
              <Separator className="w-8 sm:w-16 mx-2" />
            )}
          </div>
        ))}
      </div>

      {/* Step 1: Shipping */}
      {step === 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Shipping Information</CardTitle>
            <CardDescription>Enter your delivery address</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="fullName">Full Name</Label>
                <Input
                  id="fullName"
                  placeholder="John Doe"
                  value={shipping.fullName}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    setShipping({ ...shipping, fullName: e.target.value })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="john@example.com"
                  value={shipping.email}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    setShipping({ ...shipping, email: e.target.value })
                  }
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="address">Street Address</Label>
              <Input
                id="address"
                placeholder="123 Main Street, Apt 4"
                value={shipping.address}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  setShipping({ ...shipping, address: e.target.value })
                }
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="city">City</Label>
                <Input
                  id="city"
                  placeholder="San Francisco"
                  value={shipping.city}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    setShipping({ ...shipping, city: e.target.value })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="state">State</Label>
                <Input
                  id="state"
                  placeholder="CA"
                  value={shipping.state}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    setShipping({ ...shipping, state: e.target.value })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="zip">ZIP Code</Label>
                <Input
                  id="zip"
                  placeholder="94105"
                  value={shipping.zip}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    setShipping({ ...shipping, zip: e.target.value })
                  }
                />
              </div>
            </div>
          </CardContent>
          <CardFooter className="flex justify-between">
            <Button variant="outline" onClick={() => navigation.navigate("/cart")}>
              <Icons.ChevronLeft className="mr-2 h-4 w-4" />
              Back to Cart
            </Button>
            <Button onClick={() => setCurrentStep(1)}>
              Continue to Payment
              <Icons.ChevronRight className="ml-2 h-4 w-4" />
            </Button>
          </CardFooter>
        </Card>
      )}

      {/* Step 2: Payment */}
      {step === 1 && (
        <Card>
          <CardHeader>
            <CardTitle>Payment Information</CardTitle>
            <CardDescription>Enter your payment details securely</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="cardNumber">Card Number</Label>
              <Input
                id="cardNumber"
                placeholder="4242 4242 4242 4242"
                value={payment.cardNumber}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  setPayment({ ...payment, cardNumber: e.target.value })
                }
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="expiry">Expiry Date</Label>
                <Input
                  id="expiry"
                  placeholder="MM/YY"
                  value={payment.expiry}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    setPayment({ ...payment, expiry: e.target.value })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="cvv">CVV</Label>
                <Input
                  id="cvv"
                  placeholder="123"
                  value={payment.cvv}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    setPayment({ ...payment, cvv: e.target.value })
                  }
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="nameOnCard">Name on Card</Label>
              <Input
                id="nameOnCard"
                placeholder="John Doe"
                value={payment.nameOnCard}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  setPayment({ ...payment, nameOnCard: e.target.value })
                }
              />
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground pt-2">
              <Icons.Lock className="h-3.5 w-3.5" />
              <span>Your payment information is encrypted and secure</span>
            </div>
          </CardContent>
          <CardFooter className="flex justify-between">
            <Button variant="outline" onClick={() => setCurrentStep(0)}>
              <Icons.ChevronLeft className="mr-2 h-4 w-4" />
              Back to Shipping
            </Button>
            <Button onClick={() => setCurrentStep(2)}>
              Review Order
              <Icons.ChevronRight className="ml-2 h-4 w-4" />
            </Button>
          </CardFooter>
        </Card>
      )}

      {/* Step 3: Review */}
      {step === 2 && (
        <Card>
          <CardHeader>
            <CardTitle>Review Your Order</CardTitle>
            <CardDescription>Please confirm your order details before placing</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div>
              <h4 className="text-sm font-semibold text-muted-foreground mb-3">Order Items</h4>
              <div className="space-y-2">
                {items.map((item: CartItem) => (
                  <div key={item.id} className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2">
                      <span>{item.name}</span>
                      <Badge variant="secondary" className="text-xs">x{item.quantity}</Badge>
                    </div>
                    <span className="font-medium price-tag">
                      ${(Number(item.price ?? 0) * Number(item.quantity ?? 0)).toFixed(2)}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <Separator />

            <div>
              <h4 className="text-sm font-semibold text-muted-foreground mb-2">Shipping Address</h4>
              <div className="text-sm space-y-1">
                <p className="font-medium">{shipping.fullName || "John Doe"}</p>
                <p className="text-muted-foreground">{shipping.address || "123 Main Street"}</p>
                <p className="text-muted-foreground">
                  {shipping.city || "San Francisco"}, {shipping.state || "CA"} {shipping.zip || "94105"}
                </p>
              </div>
            </div>

            <Separator />

            <div>
              <h4 className="text-sm font-semibold text-muted-foreground mb-2">Payment</h4>
              <div className="flex items-center gap-2 text-sm">
                <Icons.CreditCard className="h-4 w-4 text-muted-foreground" />
                <span>Card ending in {(payment.cardNumber || "4242").slice(-4)}</span>
              </div>
            </div>

            <Separator />

            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Subtotal</span>
                <span className="price-tag">${subtotal.toFixed(2)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Shipping</span>
                <span className={cn(shippingCost === 0 && "text-green-600 dark:text-green-400")}>
                  {shippingCost === 0 ? "Free" : `$${shippingCost.toFixed(2)}`}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Tax (8%)</span>
                <span className="price-tag">${tax.toFixed(2)}</span>
              </div>
              <Separator />
              <div className="flex justify-between text-lg font-bold pt-1">
                <span>Total</span>
                <span className="price-tag">${total.toFixed(2)}</span>
              </div>
            </div>
          </CardContent>
          <CardFooter className="flex justify-between">
            <Button variant="outline" onClick={() => setCurrentStep(1)}>
              <Icons.ChevronLeft className="mr-2 h-4 w-4" />
              Edit Payment
            </Button>
            <Button onClick={handlePlaceOrder}>
              <Icons.CreditCard className="mr-2 h-4 w-4" />
              Place Order - ${total.toFixed(2)}
            </Button>
          </CardFooter>
        </Card>
      )}
    </div>
  );
}

export default CheckoutFlow;
