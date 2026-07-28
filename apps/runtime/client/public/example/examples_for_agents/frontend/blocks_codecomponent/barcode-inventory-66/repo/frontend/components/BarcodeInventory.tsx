import {
  React,
  useAppState,
  toast,
  Button,
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  Input,
  Label,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  Badge,
  Icons,
  cn,
} from "@exepad/sdk";
import * as JsBarcode from "@exepad/ext-barcode";

interface InventoryItem {
  id: string;
  name: string;
  sku: string;
  price: number;
  quantity: number;
  format: string;
}

const DEMO_ITEMS: InventoryItem[] = [
  { id: "1", name: "Wireless Mouse", sku: "WM-100234", price: 29.99, quantity: 150, format: "CODE128" },
  { id: "2", name: "USB-C Hub", sku: "UH-200567", price: 49.99, quantity: 85, format: "CODE128" },
  { id: "3", name: "Mechanical Keyboard", sku: "MK-300891", price: 89.99, quantity: 62, format: "CODE128" },
  { id: "4", name: "Monitor Stand", sku: "MS-400123", price: 34.99, quantity: 200, format: "CODE128" },
  { id: "5", name: "Webcam HD", sku: "WC-500456", price: 59.99, quantity: 45, format: "CODE128" },
  { id: "6", name: "Desk Lamp LED", sku: "DL-600789", price: 24.99, quantity: 310, format: "CODE128" },
];

interface FormState {
  name: string;
  sku: string;
  price: string;
  quantity: string;
  format: string;
}

function BarcodeCanvas({ value, format }: { value: string; format: string }) {
  const svgRef = React.useRef<SVGSVGElement>(null);

  React.useEffect(() => {
    if (svgRef.current) {
      try {
        JsBarcode.default(svgRef.current, value, {
          format: format,
          width: 1.5,
          height: 40,
          displayValue: true,
          fontSize: 12,
          margin: 5,
        });
      } catch {
        // Invalid barcode value for format
      }
    }
  }, [value, format]);

  return <svg ref={svgRef} />;
}

function BarcodeInventory() {
  const [items, setItems] = useAppState<InventoryItem[]>("inventoryItems", DEMO_ITEMS);
  const [globalFormat, setGlobalFormat] = useAppState<string>("barcodeFormat", "CODE128");
  const [showForm, setShowForm] = React.useState(false);
  const [form, setForm] = React.useState<FormState>({
    name: "",
    sku: "",
    price: "",
    quantity: "",
    format: "CODE128",
  });

  const inventory = items ?? DEMO_ITEMS;
  const fmt = globalFormat ?? "CODE128";

  const handleAdd = () => {
    if (!form.name || !form.sku) {
      toast.error("Name and SKU are required");
      return;
    }
    const newItem: InventoryItem = {
      id: Date.now().toString(),
      name: form.name,
      sku: form.sku,
      price: parseFloat(form.price) || 0,
      quantity: parseInt(form.quantity, 10) || 0,
      format: form.format,
    };
    setItems([...inventory, newItem]);
    setForm({ name: "", sku: "", price: "", quantity: "", format: "CODE128" });
    setShowForm(false);
    toast.success(`Added "${form.name}" to inventory`);
  };

  const handleRemove = (id: string) => {
    setItems(inventory.filter((i) => i.id !== id));
    toast.success("Item removed");
  };

  const handlePrint = () => {
    window.print();
    toast.success("Print dialog opened");
  };

  const totalValue = inventory.reduce((sum, i) => sum + i.price * i.quantity, 0);

  return (
    <div className="space-y-4">
      {/* Header */}
      <Card>
        <CardContent className="py-3">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-3">
              <Icons.BarChart3 className="h-5 w-5 text-primary" />
              <span className="font-semibold text-lg">Inventory</span>
              <Badge variant="secondary">{inventory.length} items</Badge>
              <Badge variant="outline">${totalValue.toFixed(2)} total</Badge>
            </div>
            <div className="flex items-center gap-2">
              <Select value={fmt} onValueChange={(v: string) => setGlobalFormat(v)}>
                <SelectTrigger className="w-[130px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="CODE128">CODE128</SelectItem>
                  <SelectItem value="EAN13">EAN13</SelectItem>
                  <SelectItem value="UPC">UPC</SelectItem>
                  <SelectItem value="CODE39">CODE39</SelectItem>
                </SelectContent>
              </Select>
              <Button size="sm" variant="outline" onClick={handlePrint}>
                <Icons.Printer className="h-4 w-4 mr-1" />
                Print
              </Button>
              <Button size="sm" onClick={() => setShowForm(!showForm)}>
                <Icons.Plus className="h-4 w-4 mr-1" />
                Add Item
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Add Form */}
      {showForm && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Add New Item</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              <div>
                <Label>Name</Label>
                <Input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="Product name"
                />
              </div>
              <div>
                <Label>SKU</Label>
                <Input
                  value={form.sku}
                  onChange={(e) => setForm({ ...form, sku: e.target.value })}
                  placeholder="SKU-123456"
                />
              </div>
              <div>
                <Label>Price</Label>
                <Input
                  type="number"
                  value={form.price}
                  onChange={(e) => setForm({ ...form, price: e.target.value })}
                  placeholder="0.00"
                />
              </div>
              <div>
                <Label>Quantity</Label>
                <Input
                  type="number"
                  value={form.quantity}
                  onChange={(e) => setForm({ ...form, quantity: e.target.value })}
                  placeholder="0"
                />
              </div>
              <div className="flex items-end">
                <Button onClick={handleAdd} className="w-full">
                  Add
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Inventory Table */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="text-left p-3 font-medium">Product</th>
                  <th className="text-left p-3 font-medium">SKU</th>
                  <th className="text-right p-3 font-medium">Price</th>
                  <th className="text-right p-3 font-medium">Qty</th>
                  <th className="text-center p-3 font-medium">Barcode</th>
                  <th className="text-center p-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {inventory.map((item) => (
                  <tr key={item.id} className="border-b last:border-0">
                    <td className="p-3 font-medium">{item.name}</td>
                    <td className="p-3">
                      <Badge variant="outline" className="font-mono text-xs">
                        {item.sku}
                      </Badge>
                    </td>
                    <td className="p-3 text-right">${item.price.toFixed(2)}</td>
                    <td className="p-3 text-right">{item.quantity}</td>
                    <td className="p-3 text-center">
                      <BarcodeCanvas value={item.sku} format={item.format || fmt} />
                    </td>
                    <td className="p-3 text-center">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleRemove(item.id)}
                      >
                        <Icons.Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default BarcodeInventory;
