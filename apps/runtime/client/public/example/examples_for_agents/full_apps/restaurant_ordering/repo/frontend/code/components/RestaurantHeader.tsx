import {
  React,
  useArrayState,
  useNavigation,
  useCurrentUser,
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

interface OrderItem {
  id: string;
  name: string;
  price: number;
  quantity: number;
}

const NAV_LINKS = [
  { label: "Home", href: "/" },
  { label: "Menu", href: "/menu" },
  { label: "Order", href: "/order" },
  { label: "Reservations", href: "/reservations" },
  { label: "Reviews", href: "/reviews" },
];

function RestaurantHeader() {
  const navigation = useNavigation();
  const currentUser = useCurrentUser();
  const { items: orderItems } = useArrayState<OrderItem>("orderItems", []);

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

  const items = orderItems ?? [];
  const cartCount = items.reduce((sum: number, item: OrderItem) => sum + item.quantity, 0);

  const currentPath = navigation.currentPath || "/";

  return (
    <div className="flex items-center justify-between gap-4 px-6 py-3 border-b border-border bg-background/80 backdrop-blur-md">
      <button
        onClick={() => navigation.navigate("/")}
        className="flex items-center gap-2 hover:opacity-80 transition-opacity"
      >
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <Icons.UtensilsCrossed className="h-5 w-5" />
        </div>
        <span className="font-extrabold text-xl tracking-tight hidden sm:inline">
          Savora Kitchen
        </span>
      </button>

      <nav className="hidden md:flex items-center gap-1">
        {NAV_LINKS.map((link) => (
          <button
            key={link.href}
            onClick={() => navigation.navigate(link.href)}
            className={cn(
              "px-3 py-2 rounded-md text-sm font-medium transition-colors",
              currentPath === link.href || (link.href !== "/" && currentPath.startsWith(link.href))
                ? "text-primary bg-primary/10"
                : "text-muted-foreground hover:text-foreground hover:bg-muted"
            )}
          >
            {link.label}
          </button>
        ))}
      </nav>

      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          onClick={() => navigation.navigate("/order")}
        >
          <Icons.ShoppingCart className="h-5 w-5" />
          {cartCount > 0 && (
            <Badge className="absolute -top-1 -right-1 flex items-center justify-center rounded-full px-1 py-0 text-[10px] font-bold">
              {cartCount}
            </Badge>
          )}
        </Button>
        <Button
          size="sm"
          onClick={() => navigation.navigate("/reservations")}
          className="hidden sm:inline-flex"
        >
          Reserve a Table
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

export default RestaurantHeader;
