import {
  React,
  useAppState,
  useNavigation,
  useCurrentUser,
  toast,
  Input,
  Button,
  Badge,
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  Label,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  Avatar,
  AvatarFallback,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
  Icons,
  cn,
} from "@exepad/sdk";

function CrmHeader() {
  const navigation = useNavigation();
  const currentUser = useCurrentUser();
  const [searchQuery, setSearchQuery] = React.useState("");
  const [showContactDialog, setShowContactDialog] = React.useState(false);
  const [showDealDialog, setShowDealDialog] = React.useState(false);
  const [notifCount] = React.useState(3);

  const userName = currentUser?.displayName || currentUser?.email?.split("@")[0] || "User";
  const userEmail = currentUser?.email || "user@app.com";
  const userInitials = userName.split(" ").map((n: string) => n[0]).join("").toUpperCase().slice(0, 2);

  const handleSignOut = async () => {
    try {
      const basePath = navigation.basePath || "";
      const segments = basePath.split("/").filter(Boolean);
      const platform = (window as any).ExepadPlatform;
      const apiAppId = platform?.getAppId?.() || segments[segments.length - 1] || "app";
      await fetch(`/api/${apiAppId}/rpc`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ method: "auth_signout", params: {} }),
      });
      window.dispatchEvent(new CustomEvent("exepad:auth:changed"));
      navigation.navigate("/login");
    } catch {
      navigation.navigate("/login");
    }
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      toast(`Searching for "${searchQuery}"...`);
    }
  };

  const handleAddContact = () => {
    toast("Contact created successfully!");
    setShowContactDialog(false);
  };

  const handleAddDeal = () => {
    toast("Deal created successfully!");
    setShowDealDialog(false);
  };

  return (
    <div className="flex items-center justify-between w-full h-14 px-6 border-b border-border bg-background">
      {/* Search */}
      <form onSubmit={handleSearch} className="flex items-center gap-2 flex-1 max-w-md">
        <div className="relative flex-1">
          <Icons.Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search contacts, deals, companies..."
            value={searchQuery}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearchQuery(e.target.value)}
            className="pl-9 h-9"
          />
        </div>
      </form>

      {/* Actions */}
      <div className="flex items-center gap-2">
        {/* Add Contact */}
        <Dialog open={showContactDialog} onOpenChange={setShowContactDialog}>
          <DialogTrigger asChild>
            <Button variant="outline" size="sm" className="gap-1.5">
              <Icons.UserPlus className="h-4 w-4" />
              <span className="hidden sm:inline">Contact</span>
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add New Contact</DialogTitle>
              <DialogDescription>Create a new contact in your CRM.</DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>Full Name</Label>
                <Input placeholder="John Doe" />
              </div>
              <div className="space-y-2">
                <Label>Email</Label>
                <Input type="email" placeholder="john@company.com" />
              </div>
              <div className="space-y-2">
                <Label>Company</Label>
                <Input placeholder="Acme Corp" />
              </div>
              <div className="space-y-2">
                <Label>Status</Label>
                <Select>
                  <SelectTrigger>
                    <SelectValue placeholder="Select status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="lead">Lead</SelectItem>
                    <SelectItem value="prospect">Prospect</SelectItem>
                    <SelectItem value="customer">Customer</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowContactDialog(false)}>Cancel</Button>
              <Button onClick={handleAddContact}>Create Contact</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Add Deal */}
        <Dialog open={showDealDialog} onOpenChange={setShowDealDialog}>
          <DialogTrigger asChild>
            <Button variant="outline" size="sm" className="gap-1.5">
              <Icons.Plus className="h-4 w-4" />
              <span className="hidden sm:inline">Deal</span>
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add New Deal</DialogTitle>
              <DialogDescription>Create a new deal in your pipeline.</DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>Deal Name</Label>
                <Input placeholder="Enterprise License Q1" />
              </div>
              <div className="space-y-2">
                <Label>Company</Label>
                <Input placeholder="Acme Corp" />
              </div>
              <div className="space-y-2">
                <Label>Value ($)</Label>
                <Input type="number" placeholder="50000" />
              </div>
              <div className="space-y-2">
                <Label>Stage</Label>
                <Select>
                  <SelectTrigger>
                    <SelectValue placeholder="Select stage" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="qualification">Qualification</SelectItem>
                    <SelectItem value="proposal">Proposal</SelectItem>
                    <SelectItem value="negotiation">Negotiation</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowDealDialog(false)}>Cancel</Button>
              <Button onClick={handleAddDeal}>Create Deal</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Notifications */}
        <Button variant="ghost" size="icon" className="relative h-9 w-9">
          <Icons.Bell className="h-4 w-4" />
          {notifCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-destructive text-[10px] font-bold text-destructive-foreground">
              {notifCount}
            </span>
          )}
        </Button>

        {/* User Menu */}
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <button className="rounded-full focus:outline-hidden focus:ring-2 focus:ring-primary">
              <Avatar className="h-8 w-8">
                <AvatarFallback className="text-xs bg-primary/10 text-primary">{userInitials}</AvatarFallback>
              </Avatar>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuLabel>
              <div className="flex flex-col">
                <span className="text-sm font-medium">{userName}</span>
                <span className="text-xs text-muted-foreground">{userEmail}</span>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => navigation.navigate("/profile")}>
              <Icons.User className="mr-2 h-4 w-4" />Profile
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => navigation.navigate("/settings")}>
              <Icons.Settings className="mr-2 h-4 w-4" />Settings
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleSignOut}>
              <Icons.LogOut className="mr-2 h-4 w-4" />Sign Out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

export default CrmHeader;
