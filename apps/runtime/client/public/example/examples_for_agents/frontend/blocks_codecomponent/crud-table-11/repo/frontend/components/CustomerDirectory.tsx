import {
  React,
  useModel,
  toast,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  TableCaption,
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationPrevious,
  PaginationNext,
  PaginationEllipsis,
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogAction,
  AlertDialogCancel,
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  Input,
  Button,
  Badge,
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  Icons,
  cn,
} from "@exepad/sdk";

interface Customer {
  id: string;
  name: string;
  email: string;
  company: string;
  status: "active" | "inactive" | "pending";
  joinedDate: string;
}

const DEMO_CUSTOMERS: Customer[] = [
  { id: "1", name: "Alice Johnson", email: "alice@acmecorp.com", company: "Acme Corp", status: "active", joinedDate: "2024-01-15" },
  { id: "2", name: "Bob Williams", email: "bob@techstart.io", company: "TechStart", status: "active", joinedDate: "2024-02-20" },
  { id: "3", name: "Carol Martinez", email: "carol@globalinc.com", company: "Global Inc", status: "pending", joinedDate: "2024-03-10" },
  { id: "4", name: "David Chen", email: "david@innovate.co", company: "Innovate Co", status: "active", joinedDate: "2024-04-05" },
  { id: "5", name: "Eva Petrova", email: "eva@dataflow.dev", company: "DataFlow", status: "inactive", joinedDate: "2023-11-22" },
  { id: "6", name: "Frank Osei", email: "frank@cloudpeak.io", company: "CloudPeak", status: "active", joinedDate: "2024-05-12" },
  { id: "7", name: "Grace Kim", email: "grace@nextera.com", company: "NextEra", status: "active", joinedDate: "2024-06-01" },
  { id: "8", name: "Henry Muller", email: "henry@brightside.co", company: "Brightside", status: "pending", joinedDate: "2024-06-18" },
  { id: "9", name: "Irene Tanaka", email: "irene@softlabs.jp", company: "SoftLabs", status: "inactive", joinedDate: "2023-09-30" },
  { id: "10", name: "James O'Brien", email: "james@webcraft.io", company: "WebCraft", status: "active", joinedDate: "2024-07-02" },
  { id: "11", name: "Karen Singh", email: "karen@bluevault.in", company: "BlueVault", status: "active", joinedDate: "2024-07-15" },
  { id: "12", name: "Leo Fernandez", email: "leo@pixelworks.es", company: "PixelWorks", status: "pending", joinedDate: "2024-08-01" },
];

type SortField = "name" | "email" | "company" | "status" | "joinedDate";
type SortDirection = "asc" | "desc";

const STATUS_VARIANT: Record<Customer["status"], "default" | "secondary" | "outline"> = {
  active: "default",
  inactive: "secondary",
  pending: "outline",
};

const PAGE_SIZE = 5;

function CustomerDirectory() {
  // In a real app you'd use useModel:
  // const { data: customers, loading } = useModel("customers");
  // Here we use local state for the demo.
  const [customers, setCustomers] = React.useState<Customer[]>(DEMO_CUSTOMERS);
  const [sortField, setSortField] = React.useState<SortField>("name");
  const [sortDir, setSortDir] = React.useState<SortDirection>("asc");
  const [currentPage, setCurrentPage] = React.useState(1);
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [editingCustomer, setEditingCustomer] = React.useState<Customer | null>(null);

  // Form state
  const [formName, setFormName] = React.useState("");
  const [formEmail, setFormEmail] = React.useState("");
  const [formCompany, setFormCompany] = React.useState("");

  // Sorting
  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDir("asc");
    }
    setCurrentPage(1);
  };

  const sorted = React.useMemo(() => {
    return [...customers].sort((a, b) => {
      const aVal = a[sortField];
      const bVal = b[sortField];
      const cmp = aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [customers, sortField, sortDir]);

  // Pagination
  const totalPages = Math.ceil(sorted.length / PAGE_SIZE);
  const paginated = sorted.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return <Icons.ArrowUpDown className="ml-1 h-3 w-3 opacity-40" />;
    return sortDir === "asc" ? (
      <Icons.ArrowUp className="ml-1 h-3 w-3" />
    ) : (
      <Icons.ArrowDown className="ml-1 h-3 w-3" />
    );
  };

  // CRUD operations
  const openAdd = () => {
    setEditingCustomer(null);
    setFormName("");
    setFormEmail("");
    setFormCompany("");
    setDialogOpen(true);
  };

  const openEdit = (customer: Customer) => {
    setEditingCustomer(customer);
    setFormName(customer.name);
    setFormEmail(customer.email);
    setFormCompany(customer.company);
    setDialogOpen(true);
  };

  const handleSave = () => {
    if (!formName.trim() || !formEmail.trim()) {
      toast("Name and email are required.");
      return;
    }

    if (editingCustomer) {
      setCustomers((prev) =>
        prev.map((c) =>
          c.id === editingCustomer.id
            ? { ...c, name: formName.trim(), email: formEmail.trim(), company: formCompany.trim() }
            : c
        )
      );
      toast("Customer updated successfully.");
    } else {
      const newCustomer: Customer = {
        id: String(Date.now()),
        name: formName.trim(),
        email: formEmail.trim(),
        company: formCompany.trim() || "Unassigned",
        status: "pending",
        joinedDate: new Date().toISOString().split("T")[0],
      };
      setCustomers((prev) => [...prev, newCustomer]);
      toast("Customer added successfully.");
    }
    setDialogOpen(false);
  };

  const handleDelete = (id: string) => {
    setCustomers((prev) => prev.filter((c) => c.id !== id));
    toast("Customer deleted.");
    if (paginated.length === 1 && currentPage > 1) {
      setCurrentPage(currentPage - 1);
    }
  };

  const renderPaginationLinks = () => {
    const items = [];
    for (let i = 1; i <= totalPages; i++) {
      if (i === 1 || i === totalPages || (i >= currentPage - 1 && i <= currentPage + 1)) {
        items.push(
          <PaginationItem key={i}>
            <PaginationLink
              isActive={i === currentPage}
              onClick={() => setCurrentPage(i)}
            >
              {i}
            </PaginationLink>
          </PaginationItem>
        );
      } else if (i === currentPage - 2 || i === currentPage + 2) {
        items.push(
          <PaginationItem key={`ellipsis-${i}`}>
            <PaginationEllipsis />
          </PaginationItem>
        );
      }
    }
    return items;
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Icons.Users className="h-5 w-5" />
                Customer Directory
              </CardTitle>
              <p className="text-sm text-muted-foreground mt-1">
                {customers.length} customers total
              </p>
            </div>
            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
              <DialogTrigger asChild>
                <Button onClick={openAdd}>
                  <Icons.Plus className="mr-2 h-4 w-4" />
                  Add Customer
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>
                    {editingCustomer ? "Edit Customer" : "Add New Customer"}
                  </DialogTitle>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Name *</label>
                    <Input
                      value={formName}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFormName(e.target.value)}
                      placeholder="Full name"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Email *</label>
                    <Input
                      value={formEmail}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFormEmail(e.target.value)}
                      placeholder="email@example.com"
                      type="email"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Company</label>
                    <Input
                      value={formCompany}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFormCompany(e.target.value)}
                      placeholder="Company name"
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setDialogOpen(false)}>
                    Cancel
                  </Button>
                  <Button onClick={handleSave}>
                    {editingCustomer ? "Save Changes" : "Add Customer"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border">
            <Table>
              <TableCaption>A list of all customers in your directory.</TableCaption>
              <TableHeader>
                <TableRow>
                  <TableHead
                    className="cursor-pointer select-none"
                    onClick={() => handleSort("name")}
                  >
                    <span className="flex items-center">
                      Name
                      <SortIcon field="name" />
                    </span>
                  </TableHead>
                  <TableHead
                    className="cursor-pointer select-none"
                    onClick={() => handleSort("email")}
                  >
                    <span className="flex items-center">
                      Email
                      <SortIcon field="email" />
                    </span>
                  </TableHead>
                  <TableHead
                    className="cursor-pointer select-none hidden md:table-cell"
                    onClick={() => handleSort("company")}
                  >
                    <span className="flex items-center">
                      Company
                      <SortIcon field="company" />
                    </span>
                  </TableHead>
                  <TableHead
                    className="cursor-pointer select-none"
                    onClick={() => handleSort("status")}
                  >
                    <span className="flex items-center">
                      Status
                      <SortIcon field="status" />
                    </span>
                  </TableHead>
                  <TableHead
                    className="cursor-pointer select-none hidden lg:table-cell"
                    onClick={() => handleSort("joinedDate")}
                  >
                    <span className="flex items-center">
                      Joined
                      <SortIcon field="joinedDate" />
                    </span>
                  </TableHead>
                  <TableHead className="w-12">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paginated.map((customer) => (
                  <TableRow key={customer.id}>
                    <TableCell className="font-medium">{customer.name}</TableCell>
                    <TableCell className="text-muted-foreground">{customer.email}</TableCell>
                    <TableCell className="hidden md:table-cell">{customer.company}</TableCell>
                    <TableCell>
                      <Badge variant={STATUS_VARIANT[customer.status]} className="capitalize">
                        {customer.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="hidden lg:table-cell text-muted-foreground">
                      {customer.joinedDate}
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="sm">
                            <Icons.MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            onClick={() => toast(`Viewing ${customer.name}'s profile`)}
                          >
                            <Icons.Eye className="mr-2 h-4 w-4" />
                            View
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => openEdit(customer)}>
                            <Icons.Pencil className="mr-2 h-4 w-4" />
                            Edit
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <DropdownMenuItem
                                onSelect={(e: Event) => e.preventDefault()}
                                className="text-destructive focus:text-destructive"
                              >
                                <Icons.Trash2 className="mr-2 h-4 w-4" />
                                Delete
                              </DropdownMenuItem>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Delete Customer</AlertDialogTitle>
                                <AlertDialogDescription>
                                  Are you sure you want to delete {customer.name}? This action
                                  cannot be undone.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction
                                  onClick={() => handleDelete(customer.id)}
                                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                >
                                  Delete
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="mt-4 flex justify-center">
              <Pagination>
                <PaginationContent>
                  <PaginationItem>
                    <PaginationPrevious
                      onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
                      className={cn(currentPage === 1 && "pointer-events-none opacity-50")}
                    />
                  </PaginationItem>
                  {renderPaginationLinks()}
                  <PaginationItem>
                    <PaginationNext
                      onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
                      className={cn(currentPage === totalPages && "pointer-events-none opacity-50")}
                    />
                  </PaginationItem>
                </PaginationContent>
              </Pagination>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default CustomerDirectory;
