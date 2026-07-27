import {
  React,
  useNavigation,
  useTheme,
  Button,
  Icons,
  cn,
} from "@exepad/sdk";

const NAV_LINKS = [
  { label: "Home", slug: "/" },
  { label: "About", slug: "/about" },
  { label: "Services", slug: "/services" },
  { label: "Contact", slug: "/contact" },
];

function WebsiteHeader() {
  const navigation = useNavigation();
  const { theme, setTheme } = useTheme();
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const currentPath = navigation?.currentPath ?? "/";
  const isDark = theme === "dark";

  return (
    <header className="sticky top-0 z-50 w-full border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        {/* Logo */}
        <div
          className="flex items-center gap-2.5 cursor-pointer"
          onClick={() => navigation.navigate("/")}
        >
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Icons.Zap className="h-5 w-5" />
          </div>
          <span className="text-xl font-bold tracking-tight">
            NovaTech
          </span>
        </div>

        {/* Desktop Nav */}
        <nav className="hidden md:flex items-center gap-1">
          {NAV_LINKS.map((link) => {
            const isActive = currentPath === link.slug;
            return (
              <button
                key={link.slug}
                onClick={() => navigation.navigate(link.slug)}
                className={cn(
                  "px-3 py-2 text-sm font-medium rounded-md transition-colors",
                  isActive
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
                )}
              >
                {link.label}
              </button>
            );
          })}
        </nav>

        {/* Right side */}
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9"
            onClick={() => setTheme(isDark ? "light" : "dark")}
          >
            {isDark ? (
              <Icons.Sun className="h-4 w-4" />
            ) : (
              <Icons.Moon className="h-4 w-4" />
            )}
          </Button>

          <Button
            size="sm"
            className="hidden md:inline-flex"
            onClick={() => navigation.navigate("/contact")}
          >
            Get Started
          </Button>

          {/* Mobile menu button */}
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 md:hidden"
            onClick={() => setMobileOpen(!mobileOpen)}
          >
            {mobileOpen ? (
              <Icons.X className="h-5 w-5" />
            ) : (
              <Icons.Menu className="h-5 w-5" />
            )}
          </Button>
        </div>
      </div>

      {/* Mobile Nav */}
      {mobileOpen && (
        <div className="md:hidden border-t border-border bg-background px-4 py-3">
          <div className="flex flex-col gap-1">
            {NAV_LINKS.map((link) => (
              <button
                key={link.slug}
                onClick={() => {
                  navigation.navigate(link.slug);
                  setMobileOpen(false);
                }}
                className={cn(
                  "px-3 py-2 text-sm font-medium rounded-md text-left transition-colors",
                  currentPath === link.slug
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {link.label}
              </button>
            ))}
            <Button
              size="sm"
              className="mt-2"
              onClick={() => {
                navigation.navigate("/contact");
                setMobileOpen(false);
              }}
            >
              Get Started
            </Button>
          </div>
        </div>
      )}
    </header>
  );
}

export default WebsiteHeader;
