import {
  React,
  useNavigation,
  useTheme,
  Button,
  Icons,
  cn,
} from "@exepad/sdk";

const NAV_LINKS = [
  { label: "Features", anchor: "#features" },
  { label: "Pricing", anchor: "#pricing" },
  { label: "Testimonials", anchor: "#testimonials" },
  { label: "FAQ", anchor: "#faq" },
];

function LandingHeader() {
  const navigation = useNavigation();
  const { theme, setTheme } = useTheme();
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const [scrolled, setScrolled] = React.useState(false);
  const isDark = theme === "dark";

  React.useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const scrollTo = (anchor: string) => {
    const id = anchor.replace("#", "");
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: "smooth" });
      setMobileOpen(false);
    }
  };

  return (
    <header
      className={cn(
        "sticky top-0 z-50 w-full transition-all duration-300",
        scrolled
          ? "border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 shadow-sm"
          : "bg-transparent"
      )}
    >
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
        {/* Logo */}
        <div
          className="flex items-center gap-2 cursor-pointer"
          onClick={() => navigation.navigate("/")}
        >
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Icons.Sparkles className="h-4 w-4" />
          </div>
          <span className="text-xl font-bold tracking-tight">LaunchPad AI</span>
        </div>

        {/* Nav Links */}
        <nav className="hidden md:flex items-center gap-1">
          {NAV_LINKS.map((link) => (
            <button
              key={link.anchor}
              onClick={() => scrollTo(link.anchor)}
              className="px-3 py-2 text-sm font-medium rounded-md transition-colors text-muted-foreground hover:text-foreground hover:bg-accent/50"
            >
              {link.label}
            </button>
          ))}
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
            className="hidden sm:flex"
            onClick={() => scrollTo("#hero")}
          >
            Start Free Trial
          </Button>

          {/* Mobile menu toggle */}
          <div className="md:hidden">
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9"
              onClick={() => setMobileOpen(!mobileOpen)}
            >
              {mobileOpen ? (
                <Icons.X className="h-4 w-4" />
              ) : (
                <Icons.Menu className="h-4 w-4" />
              )}
            </Button>
          </div>
        </div>
      </div>

      {/* Mobile Nav */}
      {mobileOpen && (
        <div className="md:hidden border-t border-border bg-background px-4 py-3">
          <div className="flex flex-col gap-1">
            {NAV_LINKS.map((link) => (
              <button
                key={link.anchor}
                onClick={() => scrollTo(link.anchor)}
                className="px-3 py-2 text-sm font-medium rounded-md text-left transition-colors text-muted-foreground hover:text-foreground"
              >
                {link.label}
              </button>
            ))}
            <Button size="sm" className="mt-2" onClick={() => scrollTo("#hero")}>
              Start Free Trial
            </Button>
          </div>
        </div>
      )}
    </header>
  );
}

export default LandingHeader;
