import {
  React,
  useAppState,
  useArrayState,
  useNavigation,
  useCurrentUser,
  Input,
  Button,
  Badge,
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

interface CartItem {
  id: string;
  name: string;
  price: number;
  quantity: number;
}

function StoreHeader() {
  const navigation = useNavigation();
  const currentUser = useCurrentUser();
  const [searchQuery, setSearchQuery] = useAppState<string>("searchQuery", "");
  const { items: cartItems } = useArrayState<CartItem>("cartItems", []);

  const items = cartItems ?? [];
  const cartCount = items.reduce((sum: number, item: CartItem) => sum + item.quantity, 0);
  const search = searchQuery ?? "";

  const userName = currentUser?.displayName || currentUser?.email?.split("@")[0] || "Guest";
  const userEmail = currentUser?.email || "guest@shopwave.com";
  const userInitials = userName
    .split(" ")
    .map((n: string) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

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

  const handleSearch = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(e.target.value);
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    navigation.navigate("/");
  };

  return (
    <div className="flex items-center justify-between gap-4 px-6 py-3 border-b border-border bg-background">
      <div className="flex items-center gap-3">
        <button
          onClick={() => navigation.navigate("/")}
          className="flex items-center gap-2 hover:opacity-80 transition-opacity"
        >
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Icons.ShoppingBag className="h-4 w-4" />
          </div>
          <span className="font-bold text-lg hidden md:inline">ShopWave</span>
        </button>
      </div>

      <form onSubmit={handleSearchSubmit} className="flex-1 max-w-md">
        <div className="relative">
          <Icons.Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search products..."
            value={search}
            onChange={handleSearch}
            className="pl-9 pr-4"
          />
        </div>
      </form>

      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          onClick={() => navigation.navigate("/cart")}
        >
          <Icons.ShoppingCart className="h-5 w-5" />
          {cartCount > 0 && (
            <Badge
              className="absolute -top-1 -right-1 cart-badge flex items-center justify-center rounded-full px-1 py-0 text-[10px] font-bold"
            >
              {cartCount}
            </Badge>
          )}
        </Button>

        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="rounded-full">
              <Avatar className="h-8 w-8">
                <AvatarFallback className="text-xs bg-primary/10 text-primary">
                  {userInitials}
                </AvatarFallback>
              </Avatar>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuLabel>
              <div className="flex flex-col">
                <span className="text-sm font-medium">{userName}</span>
                <span className="text-xs text-muted-foreground">
                  {userEmail}
                </span>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => navigation.navigate("/profile")}>
              <Icons.User className="mr-2 h-4 w-4" />
              Profile
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => navigation.navigate("/orders")}>
              <Icons.Package className="mr-2 h-4 w-4" />
              My Orders
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => navigation.navigate("/cart")}>
              <Icons.ShoppingCart className="mr-2 h-4 w-4" />
              Cart ({cartCount})
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => navigation.navigate("/settings")}>
              <Icons.Settings className="mr-2 h-4 w-4" />
              Settings
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleSignOut}>
              <Icons.LogOut className="mr-2 h-4 w-4" />
              Sign Out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

export default StoreHeader;
