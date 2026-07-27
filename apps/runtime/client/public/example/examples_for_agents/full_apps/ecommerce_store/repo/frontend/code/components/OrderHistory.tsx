import {
  React,
  useModel,
  useNavigation,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  Button,
  Badge,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  Separator,
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
  Icons,
  cn,
} from "@exepad/sdk";

interface OrderItem {
  id: string;
  name: string;
  quantity: number;
  price: number;
}

interface Order {
  id: string;
  date: string;
  items: OrderItem[];
  total: number;
  status: "pending" | "processing" | "shipped" | "delivered" | "cancelled";
  shippingAddress: string;
}

const DEMO_ORDERS: Order[] = [
  {
    id: "SW-48291",
    date: "2026-03-25",
    items: [
      { id: "p1", name: "Wireless Noise-Canceling Headphones", quantity: 1, price: 249.99 },
      { id: "p7", name: "Ceramic Pour-Over Coffee Set", quantity: 1, price: 64.99 },
    ],
    total: 340.37,
    status: "delivered",
    shippingAddress: "123 Main St, San Francisco, CA 94105",
  },
  {
    id: "SW-48356",
    date: "2026-03-22",
    items: [
      { id: "p5", name: "Running Sneakers Pro", quantity: 2, price: 129.95 },
    ],
    total: 280.69,
    status: "shipped",
    shippingAddress: "456 Oak Ave, Portland, OR 97201",
  },
  {
    id: "SW-48410",
    date: "2026-03-20",
    items: [
      { id: "p3", name: "Ultra-Wide 34\" Monitor", quantity: 1, price: 599.99 },
      { id: "p2", name: "Mechanical Gaming Keyboard", quantity: 1, price: 159.99 },
      { id: "p10", name: "Yoga Mat Premium", quantity: 1, price: 49.99 },
    ],
    total: 874.77,
    status: "processing",
    shippingAddress: "789 Pine Rd, Austin, TX 78701",
  },
  {
    id: "SW-48502",
    date: "2026-03-18",
    items: [
      { id: "p4", name: "Classic Leather Jacket", quantity: 1, price: 289.00 },
    ],
    total: 312.12,
    status: "pending",
    shippingAddress: "321 Elm Blvd, Denver, CO 80202",
  },
  {
    id: "SW-48123",
    date: "2026-03-10",
    items: [
      { id: "p11", name: "The Art of Clean Code", quantity: 1, price: 34.99 },
      { id: "p12", name: "Design Systems Handbook", quantity: 1, price: 42.00 },
    ],
    total: 83.14,
    status: "cancelled",
    shippingAddress: "654 Birch Ln, Seattle, WA 98101",
  },
];

const STATUS_CONFIG: Record<string, { variant: string; icon: keyof typeof Icons; label: string }> = {
  pending: { variant: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300", icon: "Clock", label: "Pending" },
  processing: { variant: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300", icon: "Loader2", label: "Processing" },
  shipped: { variant: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-300", icon: "Truck", label: "Shipped" },
  delivered: { variant: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300", icon: "CheckCircle2", label: "Delivered" },
  cancelled: { variant: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300", icon: "XCircle", label: "Cancelled" },
};

function OrderRow({ order }: { order: Order }) {
  const [isOpen, setIsOpen] = React.useState(false);
  const statusConfig = STATUS_CONFIG[order.status] || STATUS_CONFIG.pending;
  const StatusIcon = Icons[statusConfig.icon] as React.ComponentType<{ className?: string }>;

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger asChild>
        <TableRow className="cursor-pointer hover:bg-muted/50">
          <TableCell className="font-medium text-sm">{order.id}</TableCell>
          <TableCell className="text-sm text-muted-foreground">{order.date}</TableCell>
          <TableCell className="text-center text-sm">
            {order.items.reduce((sum: number, item: OrderItem) => sum + item.quantity, 0)}
          </TableCell>
          <TableCell className="text-right text-sm font-medium price-tag">
            ${order.total.toFixed(2)}
          </TableCell>
          <TableCell>
            <Badge className={cn("text-xs gap-1", statusConfig.variant)}>
              {StatusIcon && <StatusIcon className="h-3 w-3" />}
              {statusConfig.label}
            </Badge>
          </TableCell>
          <TableCell className="w-[40px]">
            <Icons.ChevronDown
              className={cn(
                "h-4 w-4 text-muted-foreground transition-transform",
                isOpen && "rotate-180"
              )}
            />
          </TableCell>
        </TableRow>
      </CollapsibleTrigger>
      <CollapsibleContent asChild>
        <tr>
          <td colSpan={6} className="p-0">
            <div className="bg-muted/30 px-6 py-4 space-y-3">
              <div className="flex items-start justify-between">
                <div>
                  <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                    Order Items
                  </h4>
                  <div className="space-y-1.5">
                    {order.items.map((item: OrderItem) => (
                      <div key={item.id} className="flex items-center justify-between text-sm gap-8">
                        <div className="flex items-center gap-2">
                          <Icons.Package className="h-3.5 w-3.5 text-muted-foreground" />
                          <span>{item.name}</span>
                          <Badge variant="secondary" className="text-[10px]">x{item.quantity}</Badge>
                        </div>
                        <span className="font-medium price-tag">
                          ${(item.price * item.quantity).toFixed(2)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="text-right">
                  <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                    Shipping
                  </h4>
                  <p className="text-xs text-muted-foreground max-w-[200px]">
                    {order.shippingAddress}
                  </p>
                </div>
              </div>
            </div>
          </td>
        </tr>
      </CollapsibleContent>
    </Collapsible>
  );
}

function OrderHistory() {
  const navigation = useNavigation();
  const ordersModel = useModel("orders");
  const orders = (ordersModel?.data as Order[] | null) ?? DEMO_ORDERS;

  const orderCounts = {
    total: orders.length,
    active: orders.filter((o: Order) => ["pending", "processing", "shipped"].includes(o.status)).length,
    delivered: orders.filter((o: Order) => o.status === "delivered").length,
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Order History</h1>
          <p className="text-sm text-muted-foreground">
            Track and manage your past orders
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => navigation.navigate("/")}>
          <Icons.ShoppingBag className="mr-2 h-4 w-4" />
          Shop More
        </Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="rounded-full bg-primary/10 p-2">
              <Icons.Package className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-2xl font-bold">{orderCounts.total}</p>
              <p className="text-xs text-muted-foreground">Total Orders</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="rounded-full bg-blue-500/10 p-2">
              <Icons.Truck className="h-5 w-5 text-blue-500" />
            </div>
            <div>
              <p className="text-2xl font-bold">{orderCounts.active}</p>
              <p className="text-xs text-muted-foreground">Active Orders</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="rounded-full bg-green-500/10 p-2">
              <Icons.CheckCircle2 className="h-5 w-5 text-green-500" />
            </div>
            <div>
              <p className="text-2xl font-bold">{orderCounts.delivered}</p>
              <p className="text-xs text-muted-foreground">Delivered</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Your Orders</CardTitle>
          <CardDescription>Click on any order to view details</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Order #</TableHead>
                <TableHead>Date</TableHead>
                <TableHead className="text-center">Items</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-[40px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {orders.map((order: Order) => (
                <OrderRow key={order.id} order={order} />
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {orders.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <Icons.Package className="h-12 w-12 text-muted-foreground mb-4" />
          <h3 className="text-lg font-semibold">No orders yet</h3>
          <p className="text-sm text-muted-foreground mt-1 mb-4">
            Start shopping to see your order history here
          </p>
          <Button onClick={() => navigation.navigate("/")}>
            Browse Products
          </Button>
        </div>
      )}
    </div>
  );
}

export default OrderHistory;
