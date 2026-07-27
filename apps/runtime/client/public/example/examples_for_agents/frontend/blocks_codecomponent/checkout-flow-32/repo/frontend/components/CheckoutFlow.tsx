import {
  React,
  useArrayState,
  useModel,
  useHandler,
  useNavigation,
  useAppState,
  toast,
  useForm,
  Controller,
  z,
  Input,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  Checkbox,
  Label,
  Button,
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  Separator,
  Badge,
  Icons,
  cn,
} from "@exepad/sdk";

interface CartItem {
  id: string;
  name: string;
  price: number;
  quantity: number;
  image: string;
}

interface ShippingData {
  fullName: string;
  address: string;
  city: string;
  zip: string;
  country: string;
}

const INITIAL_CART: CartItem[] = [
  { id: "p1", name: "Wireless Noise-Canceling Headphones", price: 249.99, quantity: 1, image: "WH" },
  { id: "p2", name: "Mechanical Keyboard (Cherry MX)", price: 159.99, quantity: 1, image: "MK" },
  { id: "p3", name: "Ultra-Wide 34\" Monitor", price: 599.99, quantity: 1, image: "UM" },
  { id: "p4", name: "Ergonomic Mouse Pad XL", price: 29.99, quantity: 2, image: "MP" },
];

const COUNTRIES = [
  "United States",
  "Canada",
  "United Kingdom",
  "Germany",
  "France",
  "Australia",
  "Japan",
  "Netherlands",
  "Sweden",
  "Switzerland",
];

const shippingSchema = z.object({
  fullName: z.string().min(2, "Name must be at least 2 characters"),
  address: z.string().min(5, "Address must be at least 5 characters"),
  city: z.string().min(2, "City is required"),
  zip: z.string().min(3, "ZIP/Postal code is required"),
  country: z.string().min(1, "Please select a country"),
});

type ShippingFormData = z.infer<typeof shippingSchema>;

const STEP_LABELS = ["Cart Summary", "Shipping Info", "Confirmation"];

function CheckoutFlow() {
  const { items: cartItems, set: setCartItems } = useArrayState<CartItem>("checkoutCart", INITIAL_CART);
  const [currentStep, setCurrentStep] = useAppState<number>("checkoutStep", 0);
  const [promoCode, setPromoCode] = useAppState<string>("promoCode", "");
  const [promoApplied, setPromoApplied] = useAppState<boolean>("promoApplied", false);
  const [shippingInfo, setShippingInfo] = React.useState<ShippingData>({
    fullName: "",
    address: "",
    city: "",
    zip: "",
    country: "",
  });

  const navigation = useNavigation();
  const items = cartItems ?? INITIAL_CART;
  const step = currentStep ?? 0;
  const promo = promoCode ?? "";
  const promoActive = promoApplied ?? false;

  const subtotal = React.useMemo(
    () => items.reduce((sum: number, item: CartItem) => sum + item.price * item.quantity, 0),
    [cartItems]
  );

  const discount = React.useMemo(
    () => (promoActive ? subtotal * 0.1 : 0),
    [subtotal, promoApplied]
  );

  const tax = React.useMemo(
    () => (subtotal - discount) * 0.1,
    [subtotal, discount]
  );

  const total = React.useMemo(
    () => subtotal - discount + tax,
    [subtotal, discount, tax]
  );

  const orderModel = useModel("order");

  const handlePayment = useHandler("processPayment", {
    onSuccess: () => {
      toast("Order placed successfully! Redirecting...");
      setTimeout(() => navigation.navigate("/"), 2000);
    },
    onError: () => {
      toast("Payment processing failed. Please try again.");
    },
  });

  const shippingForm = useForm<ShippingFormData>({
    schema: shippingSchema,
    defaultValues: shippingInfo,
  });

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

  const handleShippingSubmit = (data: ShippingFormData) => {
    setShippingInfo(data);
    setCurrentStep(2);
  };

  const handlePlaceOrder = () => {
    const orderData = {
      items: items,
      shipping: shippingInfo,
      subtotal,
      discount,
      tax,
      total,
    };

    if (orderModel?.create) {
      orderModel.create(orderData);
    }

    if (handlePayment) {
      handlePayment(orderData);
    } else {
      toast("Order placed successfully!");
    }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Step Indicator */}
      <div className="flex items-center justify-between">
        {STEP_LABELS.map((label, i) => (
          <div
            key={label}
            className={cn(
              "flex items-center gap-2",
              i <= step ? "text-primary" : "text-muted-foreground"
            )}
          >
            <Badge
              variant={i < step ? "default" : i === step ? "outline" : "secondary"}
              className={cn(
                "h-7 w-7 rounded-full flex items-center justify-center p-0",
                i < step && "bg-primary text-primary-foreground"
              )}
            >
              {i < step ? (
                <Icons.Check className="h-3.5 w-3.5" />
              ) : (
                <span className="text-xs">{i + 1}</span>
              )}
            </Badge>
            <span className="text-sm font-medium hidden sm:inline">{label}</span>
            {i < STEP_LABELS.length - 1 && (
              <Separator className="w-8 sm:w-16 mx-2" />
            )}
          </div>
        ))}
      </div>

      {/* Step 1: Cart Summary */}
      {step === 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Shopping Cart</CardTitle>
            <CardDescription>
              {items.length} item{items.length !== 1 ? "s" : ""} in your cart
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead>
                  <TableHead className="text-center">Qty</TableHead>
                  <TableHead className="text-right">Price</TableHead>
                  <TableHead className="text-right">Subtotal</TableHead>
                  <TableHead className="w-[40px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item: CartItem) => (
                  <TableRow key={item.id}>
                    <TableCell className="font-medium">{item.name}</TableCell>
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
                    <TableCell className="text-right">
                      ${Number(item.price ?? 0).toFixed(2)}
                    </TableCell>
                    <TableCell className="text-right font-medium">
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

            <Separator />

            <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-end justify-between">
              <div className="space-y-2 w-full sm:w-auto">
                <Label className="text-sm">Promo Code</Label>
                <InputGroup className="w-full sm:w-[280px]">
                  <InputGroupInput
                    placeholder="Enter code (try SAVE10)"
                    value={promo}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                      setPromoCode(e.target.value)
                    }
                    disabled={promoActive}
                  />
                  <InputGroupAddon position="right">
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={applyPromo}
                      disabled={promoActive || !promo.trim()}
                    >
                      {promoActive ? (
                        <Icons.Check className="h-4 w-4" />
                      ) : (
                        "Apply"
                      )}
                    </Button>
                  </InputGroupAddon>
                </InputGroup>
                {promoActive && (
                  <p className="text-xs text-green-600 dark:text-green-400">
                    10% discount applied!
                  </p>
                )}
              </div>

              <div className="space-y-1 text-sm text-right w-full sm:w-auto">
                <div className="flex justify-between sm:gap-8">
                  <span className="text-muted-foreground">Subtotal:</span>
                  <span className="font-medium">${Number(subtotal ?? 0).toFixed(2)}</span>
                </div>
                {promoActive && (
                  <div className="flex justify-between sm:gap-8 text-green-600 dark:text-green-400">
                    <span>Discount (10%):</span>
                    <span>-${Number(discount ?? 0).toFixed(2)}</span>
                  </div>
                )}
                <div className="flex justify-between sm:gap-8">
                  <span className="text-muted-foreground">Tax (10%):</span>
                  <span>${Number(tax ?? 0).toFixed(2)}</span>
                </div>
                <Separator />
                <div className="flex justify-between sm:gap-8 text-base font-bold">
                  <span>Total:</span>
                  <span>${Number(total ?? 0).toFixed(2)}</span>
                </div>
              </div>
            </div>
          </CardContent>
          <CardFooter className="flex justify-end">
            <Button onClick={() => setCurrentStep(1)} disabled={items.length === 0}>
              Continue to Shipping
              <Icons.ChevronRight className="ml-2 h-4 w-4" />
            </Button>
          </CardFooter>
        </Card>
      )}

      {/* Step 2: Shipping Info */}
      {step === 1 && (
        <Card>
          <CardHeader>
            <CardTitle>Shipping Information</CardTitle>
            <CardDescription>
              Enter your delivery address details.
            </CardDescription>
          </CardHeader>
          <form onSubmit={shippingForm.handleSubmit(handleShippingSubmit)}>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="fullName">Full Name</Label>
                <Input
                  id="fullName"
                  placeholder="John Doe"
                  {...shippingForm.register("fullName")}
                />
                {shippingForm.formState.errors.fullName && (
                  <p className="text-xs text-destructive">
                    {shippingForm.formState.errors.fullName.message}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="address">Street Address</Label>
                <Input
                  id="address"
                  placeholder="123 Main Street, Apt 4"
                  {...shippingForm.register("address")}
                />
                {shippingForm.formState.errors.address && (
                  <p className="text-xs text-destructive">
                    {shippingForm.formState.errors.address.message}
                  </p>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="city">City</Label>
                  <Input
                    id="city"
                    placeholder="San Francisco"
                    {...shippingForm.register("city")}
                  />
                  {shippingForm.formState.errors.city && (
                    <p className="text-xs text-destructive">
                      {shippingForm.formState.errors.city.message}
                    </p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="zip">ZIP / Postal Code</Label>
                  <Input
                    id="zip"
                    placeholder="94105"
                    {...shippingForm.register("zip")}
                  />
                  {shippingForm.formState.errors.zip && (
                    <p className="text-xs text-destructive">
                      {shippingForm.formState.errors.zip.message}
                    </p>
                  )}
                </div>
              </div>

              <div className="space-y-2">
                <Label>Country</Label>
                <Controller
                  control={shippingForm.control}
                  name="country"
                  render={({ field }) => (
                    <Select
                      value={field.value}
                      onValueChange={field.onChange}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select a country" />
                      </SelectTrigger>
                      <SelectContent>
                        {COUNTRIES.map((c) => (
                          <SelectItem key={c} value={c}>
                            {c}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
                {shippingForm.formState.errors.country && (
                  <p className="text-xs text-destructive">
                    {shippingForm.formState.errors.country.message}
                  </p>
                )}
              </div>
            </CardContent>
            <CardFooter className="flex justify-between">
              <Button
                type="button"
                variant="outline"
                onClick={() => setCurrentStep(0)}
              >
                <Icons.ChevronLeft className="mr-2 h-4 w-4" />
                Back to Cart
              </Button>
              <Button type="submit">
                Review Order
                <Icons.ChevronRight className="ml-2 h-4 w-4" />
              </Button>
            </CardFooter>
          </form>
        </Card>
      )}

      {/* Step 3: Confirmation */}
      {step === 2 && (
        <Card>
          <CardHeader>
            <CardTitle>Order Confirmation</CardTitle>
            <CardDescription>
              Review your order before placing it.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div>
              <h4 className="text-sm font-semibold text-muted-foreground mb-3">
                Order Items
              </h4>
              <div className="space-y-2">
                {items.map((item: CartItem) => (
                  <div
                    key={item.id}
                    className="flex items-center justify-between text-sm"
                  >
                    <div className="flex items-center gap-2">
                      <span>{item.name}</span>
                      <Badge variant="secondary" className="text-xs">
                        x{item.quantity}
                      </Badge>
                    </div>
                    <span className="font-medium">
                      ${(Number(item.price ?? 0) * Number(item.quantity ?? 0)).toFixed(2)}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <Separator />

            <div>
              <h4 className="text-sm font-semibold text-muted-foreground mb-3">
                Shipping Address
              </h4>
              <div className="text-sm space-y-1">
                <p className="font-medium">{shippingInfo.fullName}</p>
                <p className="text-muted-foreground">{shippingInfo.address}</p>
                <p className="text-muted-foreground">
                  {shippingInfo.city}, {shippingInfo.zip}
                </p>
                <p className="text-muted-foreground">{shippingInfo.country}</p>
              </div>
            </div>

            <Separator />

            <div className="space-y-1 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Subtotal:</span>
                <span>${Number(subtotal ?? 0).toFixed(2)}</span>
              </div>
              {promoActive && (
                <div className="flex justify-between text-green-600 dark:text-green-400">
                  <span>Discount (10%):</span>
                  <span>-${Number(discount ?? 0).toFixed(2)}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-muted-foreground">Tax (10%):</span>
                <span>${Number(tax ?? 0).toFixed(2)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Shipping:</span>
                <span className="text-green-600 dark:text-green-400">Free</span>
              </div>
              <Separator />
              <div className="flex justify-between text-lg font-bold pt-1">
                <span>Total:</span>
                <span>${Number(total ?? 0).toFixed(2)}</span>
              </div>
            </div>
          </CardContent>
          <CardFooter className="flex justify-between">
            <Button variant="outline" onClick={() => setCurrentStep(1)}>
              <Icons.ChevronLeft className="mr-2 h-4 w-4" />
              Edit Shipping
            </Button>
            <Button onClick={handlePlaceOrder}>
              <Icons.CreditCard className="mr-2 h-4 w-4" />
              Place Order
            </Button>
          </CardFooter>
        </Card>
      )}
    </div>
  );
}

export default CheckoutFlow;
