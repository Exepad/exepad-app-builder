import {
  React,
  useModel,
  toast,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  Badge,
  Button,
  Input,
  Label,
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  Icons,
  cn,
} from "@exepad/sdk";

interface Contact {
  id: string;
  name: string;
  email: string;
  company: string;
  phone: string;
  status: string;
  notes: string;
  created_at: string;
}

const DEMO_CONTACTS: Contact[] = [
  { id: "1", name: "Marc Benioff", email: "marc@salesforce.com", company: "Salesforce", phone: "+1 415-555-0101", status: "customer", notes: "Enterprise client since 2023", created_at: "2023-06-15" },
  { id: "2", name: "Patrick Collison", email: "patrick@stripe.com", company: "Stripe", phone: "+1 415-555-0102", status: "customer", notes: "API integration partner", created_at: "2023-08-20" },
  { id: "3", name: "Greg Peters", email: "greg@netflix.com", company: "Netflix", phone: "+1 310-555-0103", status: "prospect", notes: "Interested in cloud migration", created_at: "2024-01-10" },
  { id: "4", name: "Tobi Lutke", email: "tobi@shopify.com", company: "Shopify", phone: "+1 613-555-0104", status: "lead", notes: "Referred by Patrick", created_at: "2024-03-05" },
  { id: "5", name: "Frank Slootman", email: "frank@snowflake.com", company: "Snowflake", phone: "+1 650-555-0105", status: "prospect", notes: "Data analytics suite proposal", created_at: "2024-02-18" },
  { id: "6", name: "Satya Nadella", email: "satya@microsoft.com", company: "Microsoft", phone: "+1 425-555-0106", status: "customer", notes: "Strategic partnership", created_at: "2022-11-30" },
  { id: "7", name: "Andy Jassy", email: "andy@amazon.com", company: "Amazon", phone: "+1 206-555-0107", status: "lead", notes: "Initial outreach via conference", created_at: "2024-04-12" },
  { id: "8", name: "Sundar Pichai", email: "sundar@google.com", company: "Google", phone: "+1 650-555-0108", status: "customer", notes: "Platform integration complete", created_at: "2023-03-22" },
  { id: "9", name: "Jensen Huang", email: "jensen@nvidia.com", company: "NVIDIA", phone: "+1 408-555-0109", status: "prospect", notes: "AI infrastructure discussion", created_at: "2024-05-08" },
  { id: "10", name: "Tim Cook", email: "tim@apple.com", company: "Apple", phone: "+1 408-555-0110", status: "lead", notes: "Exploring developer tools", created_at: "2024-06-01" },
  { id: "11", name: "Dara Khosrowshahi", email: "dara@uber.com", company: "Uber", phone: "+1 415-555-0111", status: "churned", notes: "Contract ended Q4 2024", created_at: "2023-01-15" },
  { id: "12", name: "Brian Chesky", email: "brian@airbnb.com", company: "Airbnb", phone: "+1 415-555-0112", status: "prospect", notes: "Scheduling demo for next week", created_at: "2024-05-25" },
];

const STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  lead: { label: "Lead", className: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300" },
  prospect: { label: "Prospect", className: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300" },
  customer: { label: "Customer", className: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300" },
  churned: { label: "Churned", className: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300" },
};

function ContactsTable() {
  const contactsModel = useModel("contacts");
  const contacts = (contactsModel?.data as any[] | null) ?? DEMO_CONTACTS;
  const [search, setSearch] = React.useState("");
  const [statusFilter, setStatusFilter] = React.useState("all");
  const [showAddDialog, setShowAddDialog] = React.useState(false);

  const filtered = DEMO_CONTACTS.filter((c) => {
    const matchesSearch =
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      c.email.toLowerCase().includes(search.toLowerCase()) ||
      c.company.toLowerCase().includes(search.toLowerCase());
    const matchesStatus = statusFilter === "all" || c.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const handleAction = (action: string, contact: Contact) => {
    toast(`${action}: ${contact.name}`);
  };

  const handleAddContact = () => {
    toast("New contact created successfully!");
    setShowAddDialog(false);
  };

  const statusCounts = DEMO_CONTACTS.reduce((acc, c) => {
    acc[c.status] = (acc[c.status] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  return (
    <div className="p-6 space-y-6">
      {/* Status Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {Object.entries(STATUS_CONFIG).map(([key, config]) => (
          <Card key={key} className="cursor-pointer hover:shadow-sm transition-shadow" onClick={() => setStatusFilter(key === statusFilter ? "all" : key)}>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">{config.label}</span>
                <Badge className={cn("text-xs", config.className)}>{statusCounts[key] || 0}</Badge>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Main Table Card */}
      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <CardTitle className="text-base">
              Contacts
              <Badge variant="secondary" className="ml-2 text-xs">{filtered.length}</Badge>
            </CardTitle>
            <div className="flex items-center gap-2">
              <div className="relative flex-1 sm:w-64">
                <Icons.Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search contacts..."
                  value={search}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearch(e.target.value)}
                  className="pl-9 h-9"
                />
              </div>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-[130px] h-9">
                  <SelectValue placeholder="All Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="lead">Lead</SelectItem>
                  <SelectItem value="prospect">Prospect</SelectItem>
                  <SelectItem value="customer">Customer</SelectItem>
                  <SelectItem value="churned">Churned</SelectItem>
                </SelectContent>
              </Select>
              <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
                <DialogTrigger asChild>
                  <Button size="sm" className="gap-1.5">
                    <Icons.Plus className="h-4 w-4" />
                    Add Contact
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Add New Contact</DialogTitle>
                    <DialogDescription>Fill in the details to create a new contact.</DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4 py-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2"><Label>Full Name</Label><Input placeholder="Jane Smith" /></div>
                      <div className="space-y-2"><Label>Email</Label><Input type="email" placeholder="jane@company.com" /></div>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2"><Label>Company</Label><Input placeholder="Acme Corp" /></div>
                      <div className="space-y-2"><Label>Phone</Label><Input placeholder="+1 555-000-0000" /></div>
                    </div>
                    <div className="space-y-2">
                      <Label>Status</Label>
                      <Select><SelectTrigger><SelectValue placeholder="Select status" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="lead">Lead</SelectItem>
                          <SelectItem value="prospect">Prospect</SelectItem>
                          <SelectItem value="customer">Customer</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setShowAddDialog(false)}>Cancel</Button>
                    <Button onClick={handleAddContact}>Create Contact</Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Company</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead className="w-[60px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((contact) => {
                const statusConf = STATUS_CONFIG[contact.status];
                return (
                  <TableRow key={contact.id}>
                    <TableCell className="font-medium">{contact.name}</TableCell>
                    <TableCell className="text-muted-foreground">{contact.email}</TableCell>
                    <TableCell>{contact.company}</TableCell>
                    <TableCell>
                      <Badge className={cn("text-xs", statusConf?.className)}>
                        {statusConf?.label || contact.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{contact.phone}</TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-7 w-7">
                            <Icons.MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => handleAction("View", contact)}>
                            <Icons.Eye className="mr-2 h-4 w-4" /> View Details
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleAction("Edit", contact)}>
                            <Icons.Pencil className="mr-2 h-4 w-4" /> Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleAction("Call", contact)}>
                            <Icons.Phone className="mr-2 h-4 w-4" /> Call
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem className="text-destructive" onClick={() => handleAction("Delete", contact)}>
                            <Icons.Trash2 className="mr-2 h-4 w-4" /> Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

export default ContactsTable;
