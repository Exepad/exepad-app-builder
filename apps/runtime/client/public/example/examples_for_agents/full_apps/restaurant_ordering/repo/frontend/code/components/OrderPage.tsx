import {
  React,
  useModel,
  useArrayState,
  useNavigation,
  toast,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardFooter,
  Button,
  Input,
  Textarea,
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
  Separator,
  Icons,
  cn,
} from "@exepad/sdk";

const { useState } = React;

interface OrderItem {
  id: string;
  name: string;
  price: number;
  quantity: number;
}

const DEMO_ORDERS = [
  { id: "ord-1", items_json: "[]", total: 0, status: "pending", order_type: "delivery", special_instructions: null, created_at: "2026-03-27T12:00:00Z" },
];

function OrderPage() {
  const navigation = useNavigation();
  const ordersModel = useModel("orders");
  const orders = (ordersModel?.data as any[] | null) ?? DEMO_ORDERS;
  const { items: orderItems, set: setOrderItems } = useArrayState<OrderItem>("orderItems", []);
  const [orderType, setOrderType] = useState("delivery");
  const [specialInstructions, setSpecialInstructions] = useState("");
  const [address, setAddress] = useState({ street: "", apt: "", city: "", zip: "" });
  const [isPlaced, setIsPlaced] = useState(false);

  const items = orderItems ?? [];

  const updateQuantity = (id: string, delta: number) => {
    const updated = items
      .map((item: OrderItem) => (item.id === id ? { ...item, quantity: item.quantity + delta } : item))
      .filter((item: OrderItem) => item.quantity > 0);
    setOrderItems(updated);
  };

  const removeItem = (id: string) => {
    setOrderItems(items.filter((item: OrderItem) => item.id !== id));
  };

  const subtotal = items.reduce((sum: number, item: OrderItem) => sum + item.price * item.quantity, 0);
  const deliveryFee = orderType === "delivery" ? 5.99 : 0;
  const tax = subtotal * 0.08;
  const total = subtotal + deliveryFee + tax;

  const handlePlaceOrder = () => {
    if (items.length === 0) return;
    setIsPlaced(true);
    setOrderItems([]);
    toast(`Order placed! Your ${orderType} order total: $${total.toFixed(2)}`);
  };

  if (isPlaced) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center px-6">
        <Card className="max-w-md w-full text-center p-8">
          <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-6">
            <Icons.Check className="h-8 w-8 text-green-600" />
          </div>
          <h2 className="text-2xl font-extrabold mb-3">Order Confirmed!</h2>
          <p className="text-muted-foreground mb-1">Your order has been received and is being prepared.</p>
          <p className="text-sm text-muted-foreground mb-8">
            Estimated time: {orderType === "delivery" ? "35-45 minutes" : "20-25 minutes"}
          </p>
          <div className="flex gap-3 justify-center">
            <Button onClick={() => { setIsPlaced(false); navigation.navigate("/menu"); }}>
              Order More
            </Button>
            <Button variant="outline" onClick={() => { setIsPlaced(false); navigation.navigate("/"); }}>
              Back Home
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center px-6">
        <Card className="max-w-md w-full text-center p-8">
          <Icons.ShoppingCart className="h-16 w-16 mx-auto text-muted-foreground/40 mb-6" />
          <h2 className="text-2xl font-extrabold mb-3">Your cart is empty</h2>
          <p className="text-muted-foreground mb-8">
            Browse our menu and add some delicious dishes to get started.
          </p>
          <Button onClick={() => navigation.navigate("/menu")}>Browse Menu</Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-6 py-12">
      <h1 className="text-3xl font-extrabold tracking-tight mb-8">Your Order</h1>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-6">
          {/* Order Type Toggle */}
          <Tabs value={orderType} onValueChange={setOrderType}>
            <TabsList>
              <TabsTrigger value="delivery">
                <Icons.Truck className="mr-2 h-4 w-4" /> Delivery
              </TabsTrigger>
              <TabsTrigger value="pickup">
                <Icons.Store className="mr-2 h-4 w-4" /> Pickup
              </TabsTrigger>
            </TabsList>
          </Tabs>

          {/* Items List */}
          <div className="space-y-3">
            {items.map((item: OrderItem) => (
              <Card key={item.id} className="p-4">
                <div className="flex items-center gap-4">
                  <div className="w-14 h-14 rounded-lg bg-orange-100 flex items-center justify-center shrink-0">
                    <Icons.ChefHat className="h-7 w-7 text-primary/30" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-sm font-bold truncate">{item.name}</h3>
                    <p className="text-sm text-muted-foreground">${item.price.toFixed(2)} each</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-8 w-8 rounded-full"
                      onClick={() => updateQuantity(item.id, -1)}
                    >
                      <Icons.Minus className="h-3 w-3" />
                    </Button>
                    <span className="w-8 text-center text-sm font-semibold">{item.quantity}</span>
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-8 w-8 rounded-full"
                      onClick={() => updateQuantity(item.id, 1)}
                    >
                      <Icons.Plus className="h-3 w-3" />
                    </Button>
                  </div>
                  <span className="text-sm font-bold w-16 text-right">
                    ${(item.price * item.quantity).toFixed(2)}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground hover:text-destructive"
                    onClick={() => removeItem(item.id)}
                  >
                    <Icons.Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </Card>
            ))}
          </div>

          {/* Special Instructions */}
          <div className="space-y-2">
            <label className="text-sm font-semibold">Special Instructions</label>
            <Textarea
              value={specialInstructions}
              onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setSpecialInstructions(e.target.value)}
              placeholder="Allergies, preferences, or any special requests..."
              rows={3}
            />
          </div>

          {/* Delivery Address */}
          {orderType === "delivery" && (
            <Card>
              <CardHeader className="pb-4">
                <CardTitle className="text-sm">Delivery Address</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <Input
                  placeholder="Street address"
                  value={address.street}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setAddress({ ...address, street: e.target.value })}
                />
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <Input
                    placeholder="Apt / Suite"
                    value={address.apt}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setAddress({ ...address, apt: e.target.value })}
                  />
                  <Input
                    placeholder="City"
                    value={address.city}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setAddress({ ...address, city: e.target.value })}
                  />
                  <Input
                    placeholder="ZIP Code"
                    value={address.zip}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setAddress({ ...address, zip: e.target.value })}
                  />
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Order Summary */}
        <div>
          <Card className="sticky top-28">
            <CardHeader>
              <CardTitle>Order Summary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex justify-between text-muted-foreground">
                <span>Subtotal ({items.reduce((s: number, i: OrderItem) => s + i.quantity, 0)} items)</span>
                <span>${subtotal.toFixed(2)}</span>
              </div>
              {orderType === "delivery" && (
                <div className="flex justify-between text-muted-foreground">
                  <span>Delivery Fee</span>
                  <span>${deliveryFee.toFixed(2)}</span>
                </div>
              )}
              <div className="flex justify-between text-muted-foreground">
                <span>Tax (8%)</span>
                <span>${tax.toFixed(2)}</span>
              </div>
              <Separator />
              <div className="flex justify-between font-bold text-base">
                <span>Total</span>
                <span>${total.toFixed(2)}</span>
              </div>
            </CardContent>
            <CardFooter className="flex-col gap-2">
              <Button className="w-full" size="lg" onClick={handlePlaceOrder}>
                Place Order
              </Button>
              <p className="text-xs text-muted-foreground text-center">
                {orderType === "delivery" ? "Estimated delivery: 35-45 min" : "Estimated pickup: 20-25 min"}
              </p>
            </CardFooter>
          </Card>
        </div>
      </div>
    </div>
  );
}

export default OrderPage;
