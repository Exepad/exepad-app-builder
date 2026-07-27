import {
  React,
  useAppState,
  useArrayState,
  useNavigation,
  useCurrentUser,
  useHandler,
  Avatar,
  AvatarFallback,
  Badge,
  Separator,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  Icons,
  cn,
} from "@exepad/sdk";

interface CartItem {
  id: string;
  name: string;
  price: number;
  quantity: number;
}

interface NavItem {
  label: string;
  icon: keyof typeof Icons;
  slug: string;
  showBadge?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { label: "Products", icon: "ShoppingBag", slug: "/" },
  { label: "Cart", icon: "ShoppingCart", slug: "/cart", showBadge: true },
  { label: "Checkout", icon: "CreditCard", slug: "/checkout" },
  { label: "Orders", icon: "Package", slug: "/orders" },
];

const CATEGORIES = [
  { label: "Electronics", slug: "electronics", icon: "Cpu" as keyof typeof Icons },
  { label: "Clothing", slug: "clothing", icon: "Shirt" as keyof typeof Icons },
  { label: "Home", slug: "home", icon: "Home" as keyof typeof Icons },
  { label: "Sports", slug: "sports", icon: "Dumbbell" as keyof typeof Icons },
  { label: "Books", slug: "books", icon: "BookOpen" as keyof typeof Icons },
];

function StoreSidebar() {
  const navigation = useNavigation();
  const currentUser = useCurrentUser();
  const signout = useHandler("auth_signout", { autoFetch: false });
  const { items: cartItems } = useArrayState<CartItem>("cartItems", []);
  const [selectedCategory, setSelectedCategory] = useAppState<string>("selectedCategory", "all");

  const items = cartItems ?? [];
  const cartCount = items.reduce((sum: number, item: CartItem) => sum + item.quantity, 0);
  const currentPath = navigation?.currentPath ?? "/";

  const userName = currentUser?.displayName || currentUser?.email || "Guest";
  const userInitials = userName
    .split(" ")
    .map((n: string) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  const handleNavClick = (slug: string) => {
    navigation.navigate(slug);
  };

  const handleCategoryClick = (slug: string) => {
    setSelectedCategory(slug);
    navigation.navigate("/");
  };

  return (
    <aside className="h-full w-64 shrink-0 flex flex-col bg-background border-r border-border">
      {/* Header */}
      <div className="border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Icons.ShoppingBag className="h-4 w-4" />
          </div>
          <div>
            <span className="font-bold text-sm">ShopWave</span>
            <p className="text-[10px] text-muted-foreground leading-none">Online Store</p>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <div className="flex-1 overflow-y-auto py-2">
        <div className="px-3 mb-1">
          <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Store</span>
        </div>
        <nav className="space-y-0.5 px-2">
          {NAV_ITEMS.map((item) => {
            const Icon = Icons[item.icon] as React.ComponentType<{ className?: string }>;
            const isActive = currentPath === item.slug;
            return (
              <button
                key={item.slug}
                onClick={() => handleNavClick(item.slug)}
                className={cn(
                  "flex items-center justify-between w-full rounded-md px-2.5 py-2 text-sm transition-colors",
                  isActive
                    ? "bg-primary/10 text-primary font-medium"
                    : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                )}
              >
                <div className="flex items-center gap-2">
                  {Icon && <Icon className="h-4 w-4" />}
                  <span>{item.label}</span>
                </div>
                {item.showBadge && cartCount > 0 && (
                  <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-5 min-w-[20px] justify-center">
                    {cartCount}
                  </Badge>
                )}
              </button>
            );
          })}
        </nav>

        <Separator className="my-3" />

        {/* Categories */}
        <div className="px-3 mb-1">
          <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Categories</span>
        </div>
        <nav className="space-y-0.5 px-2">
          <button
            onClick={() => handleCategoryClick("all")}
            className={cn(
              "flex items-center gap-2 w-full rounded-md px-2.5 py-2 text-sm transition-colors",
              (selectedCategory ?? "all") === "all"
                ? "bg-primary/10 text-primary font-medium"
                : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            )}
          >
            <Icons.LayoutGrid className="h-4 w-4" />
            <span>All Categories</span>
          </button>
          {CATEGORIES.map((cat) => {
            const CatIcon = Icons[cat.icon] as React.ComponentType<{ className?: string }>;
            return (
              <button
                key={cat.slug}
                onClick={() => handleCategoryClick(cat.slug)}
                className={cn(
                  "flex items-center gap-2 w-full rounded-md px-2.5 py-2 text-sm transition-colors",
                  (selectedCategory ?? "all") === cat.slug
                    ? "bg-primary/10 text-primary font-medium"
                    : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                )}
              >
                {CatIcon && <CatIcon className="h-4 w-4" />}
                <span>{cat.label}</span>
              </button>
            );
          })}
        </nav>
      </div>

      {/* Footer */}
      <div className="border-t border-border p-3">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex items-center gap-2 w-full px-2 py-1.5 rounded-md hover:bg-accent transition-colors">
              <Avatar className="h-8 w-8">
                <AvatarFallback className="text-xs bg-primary/10 text-primary">
                  {userInitials}
                </AvatarFallback>
              </Avatar>
              <div className="flex flex-col text-left text-xs leading-tight">
                <span className="font-semibold truncate">{userName}</span>
                <span className="text-muted-foreground truncate">
                  {currentUser?.email || "guest@shopwave.com"}
                </span>
              </div>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="start" className="w-56">
            <DropdownMenuLabel>
              <div className="flex flex-col">
                <span className="text-sm">{userName}</span>
                <span className="text-xs text-muted-foreground">{currentUser?.email || "guest@shopwave.com"}</span>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            {currentUser.isAuthenticated ? (
              <>
                <DropdownMenuItem onClick={() => navigation.navigate("/profile")}>
                  <Icons.User className="mr-2 h-4 w-4" />Profile
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => navigation.navigate("/settings")}>
                  <Icons.Settings className="mr-2 h-4 w-4" />Settings
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={async () => { await signout.execute({}); navigation.navigate("/"); }}>
                  <Icons.LogOut className="mr-2 h-4 w-4" />Sign Out
                </DropdownMenuItem>
              </>
            ) : (
              <DropdownMenuItem onClick={() => navigation.navigate("/login")}>
                <Icons.LogIn className="mr-2 h-4 w-4" />Sign In
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </aside>
  );
}

export default StoreSidebar;
