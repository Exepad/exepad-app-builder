import {
  React,
  useArrayState,
  useAppState,
  _,
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
  Checkbox,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  Badge,
  Button,
  Input,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Icons,
  cn,
} from "@exepad/sdk";

interface InventoryItem {
  id: string;
  name: string;
  sku: string;
  category: string;
  quantity: number;
  price: number;
  status: "In Stock" | "Low Stock" | "Out of Stock";
}

const INITIAL_INVENTORY: InventoryItem[] = [
  { id: "1", name: "Wireless Mouse", sku: "WM-1001", category: "Electronics", quantity: 245, price: 29.99, status: "In Stock" },
  { id: "2", name: "Mechanical Keyboard", sku: "MK-2002", category: "Electronics", quantity: 12, price: 89.99, status: "Low Stock" },
  { id: "3", name: "USB-C Hub", sku: "UH-3003", category: "Accessories", quantity: 0, price: 49.99, status: "Out of Stock" },
  { id: "4", name: "Monitor Stand", sku: "MS-4004", category: "Furniture", quantity: 78, price: 39.99, status: "In Stock" },
  { id: "5", name: "Webcam HD", sku: "WC-5005", category: "Electronics", quantity: 5, price: 59.99, status: "Low Stock" },
  { id: "6", name: "Desk Lamp", sku: "DL-6006", category: "Furniture", quantity: 192, price: 24.99, status: "In Stock" },
  { id: "7", name: "Headset Pro", sku: "HP-7007", category: "Electronics", quantity: 0, price: 129.99, status: "Out of Stock" },
  { id: "8", name: "Mouse Pad XL", sku: "MP-8008", category: "Accessories", quantity: 340, price: 14.99, status: "In Stock" },
  { id: "9", name: "Cable Organizer", sku: "CO-9009", category: "Accessories", quantity: 8, price: 12.99, status: "Low Stock" },
  { id: "10", name: "Laptop Stand", sku: "LS-1010", category: "Furniture", quantity: 56, price: 44.99, status: "In Stock" },
  { id: "11", name: "Wireless Charger", sku: "WC-1111", category: "Electronics", quantity: 167, price: 34.99, status: "In Stock" },
  { id: "12", name: "Ergonomic Chair", sku: "EC-1212", category: "Furniture", quantity: 3, price: 299.99, status: "Low Stock" },
  { id: "13", name: "Bluetooth Speaker", sku: "BS-1313", category: "Electronics", quantity: 0, price: 79.99, status: "Out of Stock" },
  { id: "14", name: "Desk Shelf", sku: "DS-1414", category: "Furniture", quantity: 91, price: 54.99, status: "In Stock" },
  { id: "15", name: "Screen Cleaner Kit", sku: "SC-1515", category: "Accessories", quantity: 420, price: 9.99, status: "In Stock" },
];

const STATUS_COLORS: Record<InventoryItem["status"], string> = {
  "In Stock": "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300",
  "Low Stock": "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300",
  "Out of Stock": "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300",
};

type SortField = "name" | "sku" | "category" | "quantity" | "price" | "status";
type SortOrder = "asc" | "desc";

function InventoryTable() {
  const { items } = useArrayState<InventoryItem>("inventoryItems", INITIAL_INVENTORY);
  const [selectedIds, setSelectedIds] = useAppState<string[]>("selectedIds", []);
  const [searchQuery, setSearchQuery] = useAppState<string>("searchQuery", "");
  const [sortField, setSortField] = useAppState<SortField>("sortField", "name");
  const [sortOrder, setSortOrder] = useAppState<SortOrder>("sortOrder", "asc");

  const safeItems = items || INITIAL_INVENTORY;
  const safeSelected = selectedIds || [];
  const query = searchQuery || "";
  const field = sortField || "name";
  const order = sortOrder || "asc";

  const filteredItems = _.filter(safeItems, (item: InventoryItem) => {
    if (!query) return true;
    const q = query.toLowerCase();
    return (
      item.name.toLowerCase().includes(q) ||
      item.sku.toLowerCase().includes(q) ||
      item.category.toLowerCase().includes(q) ||
      item.status.toLowerCase().includes(q)
    );
  });

  const sortedItems = _.orderBy(filteredItems, [field], [order]);

  const handleSort = (col: SortField) => {
    if (field === col) {
      setSortOrder(order === "asc" ? "desc" : "asc");
    } else {
      setSortField(col);
      setSortOrder("asc");
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds(
      safeSelected.includes(id)
        ? safeSelected.filter((s: string) => s !== id)
        : [...safeSelected, id]
    );
  };

  const toggleSelectAll = () => {
    const allIds = sortedItems.map((item: InventoryItem) => item.id);
    const allSelected = allIds.every((id: string) => safeSelected.includes(id));
    setSelectedIds(allSelected ? [] : allIds);
  };

  const allSelected =
    sortedItems.length > 0 &&
    sortedItems.every((item: InventoryItem) => safeSelected.includes(item.id));

  const totalValue = _.sumBy(sortedItems, (item: InventoryItem) => item.quantity * item.price);
  const totalQuantity = _.sumBy(sortedItems, (item: InventoryItem) => item.quantity);

  const SortIcon = ({ col }: { col: SortField }) => {
    if (field !== col) return <Icons.ArrowUpDown className="ml-1 h-3 w-3 opacity-50" />;
    return order === "asc" ? (
      <Icons.ArrowUp className="ml-1 h-3 w-3" />
    ) : (
      <Icons.ArrowDown className="ml-1 h-3 w-3" />
    );
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <CardTitle className="text-xl">Inventory Management</CardTitle>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Icons.Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search items..."
                value={query}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  setSearchQuery(e.target.value)
                }
                className="pl-9 w-[250px]"
              />
            </div>
            {safeSelected.length > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm">
                    <Icons.MoreHorizontal className="mr-2 h-4 w-4" />
                    Actions ({safeSelected.length})
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem>
                    <Icons.Download className="mr-2 h-4 w-4" />
                    Export Selected
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem>
                    <Icons.RefreshCw className="mr-2 h-4 w-4" />
                    Update Status
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem className="text-destructive">
                    <Icons.Trash2 className="mr-2 h-4 w-4" />
                    Delete Selected
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <Table>
          <TableCaption>
            Showing {sortedItems.length} of {safeItems.length} inventory items
          </TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[40px]">
                <Checkbox
                  checked={allSelected}
                  onCheckedChange={toggleSelectAll}
                />
              </TableHead>
              <TableHead>
                <button
                  onClick={() => handleSort("name")}
                  className="flex items-center font-medium hover:text-foreground transition-colors"
                >
                  Product <SortIcon col="name" />
                </button>
              </TableHead>
              <TableHead>
                <button
                  onClick={() => handleSort("sku")}
                  className="flex items-center font-medium hover:text-foreground transition-colors"
                >
                  SKU <SortIcon col="sku" />
                </button>
              </TableHead>
              <TableHead>
                <button
                  onClick={() => handleSort("category")}
                  className="flex items-center font-medium hover:text-foreground transition-colors"
                >
                  Category <SortIcon col="category" />
                </button>
              </TableHead>
              <TableHead className="text-right">
                <button
                  onClick={() => handleSort("quantity")}
                  className="flex items-center font-medium ml-auto hover:text-foreground transition-colors"
                >
                  Qty <SortIcon col="quantity" />
                </button>
              </TableHead>
              <TableHead className="text-right">
                <button
                  onClick={() => handleSort("price")}
                  className="flex items-center font-medium ml-auto hover:text-foreground transition-colors"
                >
                  Price <SortIcon col="price" />
                </button>
              </TableHead>
              <TableHead>
                <button
                  onClick={() => handleSort("status")}
                  className="flex items-center font-medium hover:text-foreground transition-colors"
                >
                  Status <SortIcon col="status" />
                </button>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sortedItems.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                  No items match your search.
                </TableCell>
              </TableRow>
            ) : (
              sortedItems.map((item: InventoryItem) => (
                <TableRow
                  key={item.id}
                  className={cn(
                    safeSelected.includes(item.id) && "bg-muted/50"
                  )}
                >
                  <TableCell>
                    <Checkbox
                      checked={safeSelected.includes(item.id)}
                      onCheckedChange={() => toggleSelect(item.id)}
                    />
                  </TableCell>
                  <TableCell className="font-medium">{item.name}</TableCell>
                  <TableCell className="text-muted-foreground font-mono text-sm">
                    {item.sku}
                  </TableCell>
                  <TableCell>{item.category}</TableCell>
                  <TableCell className="text-right">{item.quantity}</TableCell>
                  <TableCell className="text-right">
                    ${item.price.toFixed(2)}
                  </TableCell>
                  <TableCell>
                    <Badge className={cn("text-xs", STATUS_COLORS[item.status])}>
                      {item.status}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell colSpan={4} className="font-semibold">
                Totals
              </TableCell>
              <TableCell className="text-right font-semibold">
                {totalQuantity.toLocaleString()}
              </TableCell>
              <TableCell className="text-right font-semibold">
                ${totalValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </TableCell>
              <TableCell />
            </TableRow>
          </TableFooter>
        </Table>
      </CardContent>
    </Card>
  );
}

export default InventoryTable;
