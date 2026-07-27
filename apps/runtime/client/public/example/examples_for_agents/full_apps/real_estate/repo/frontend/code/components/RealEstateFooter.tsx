import {
  React,
  useNavigation,
  Button,
  Input,
  Separator,
  Icons,
  cn,
} from "@exepad/sdk";

const PROPERTY_TYPES = [
  { label: "Houses", slug: "/listings?type=house" },
  { label: "Apartments", slug: "/listings?type=apartment" },
  { label: "Condos", slug: "/listings?type=condo" },
  { label: "Land", slug: "/listings?type=land" },
];

const QUICK_LINKS = [
  { label: "Home", slug: "/" },
  { label: "All Listings", slug: "/listings" },
  { label: "My Favorites", slug: "/favorites" },
  { label: "Find an Agent", slug: "/agents" },
];

const SOCIAL_ICONS: (keyof typeof Icons)[] = [
  "Facebook",
  "Twitter",
  "Instagram",
  "Linkedin",
];

function RealEstateFooter() {
  const navigation = useNavigation();
  const [email, setEmail] = React.useState("");
  const [subscribed, setSubscribed] = React.useState(false);

  const handleSubscribe = () => {
    if (email.trim()) {
      setSubscribed(true);
      setEmail("");
      setTimeout(() => setSubscribed(false), 3000);
    }
  };

  return (
    <footer className="w-full border-t border-border bg-secondary/30">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-12">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8">
          {/* About */}
          <div>
            <div className="flex items-center gap-2 mb-4">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <Icons.Home className="h-4 w-4" />
              </div>
              <span className="text-lg font-bold">
                Nest<span className="text-primary">Finder</span>
              </span>
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Your trusted partner in finding the perfect home. We connect buyers, sellers,
              and agents to make real estate simple and transparent.
            </p>
          </div>

          {/* Property Types */}
          <div>
            <h3 className="font-semibold text-sm mb-4 uppercase tracking-wider">
              Property Types
            </h3>
            <ul className="space-y-2.5">
              {PROPERTY_TYPES.map((item) => (
                <li key={item.label}>
                  <button
                    onClick={() => navigation.navigate(item.slug)}
                    className="text-sm text-muted-foreground hover:text-primary transition-colors"
                  >
                    {item.label}
                  </button>
                </li>
              ))}
            </ul>
          </div>

          {/* Quick Links */}
          <div>
            <h3 className="font-semibold text-sm mb-4 uppercase tracking-wider">
              Quick Links
            </h3>
            <ul className="space-y-2.5">
              {QUICK_LINKS.map((item) => (
                <li key={item.label}>
                  <button
                    onClick={() => navigation.navigate(item.slug)}
                    className="text-sm text-muted-foreground hover:text-primary transition-colors"
                  >
                    {item.label}
                  </button>
                </li>
              ))}
            </ul>
          </div>

          {/* Contact & Newsletter */}
          <div>
            <h3 className="font-semibold text-sm mb-4 uppercase tracking-wider">
              Contact
            </h3>
            <div className="space-y-2.5 text-sm text-muted-foreground mb-5">
              <div className="flex items-center gap-2">
                <Icons.MapPin className="h-4 w-4 shrink-0" />
                <span>123 Market Street, San Francisco, CA</span>
              </div>
              <div className="flex items-center gap-2">
                <Icons.Phone className="h-4 w-4 shrink-0" />
                <span>(415) 555-0199</span>
              </div>
              <div className="flex items-center gap-2">
                <Icons.Mail className="h-4 w-4 shrink-0" />
                <span>hello@nestfinder.com</span>
              </div>
            </div>

            <h4 className="font-medium text-sm mb-2">Newsletter</h4>
            <div className="flex gap-2">
              <Input
                type="email"
                placeholder="Your email"
                value={email}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEmail(e.target.value)}
                className="h-9 text-sm"
              />
              <Button size="sm" onClick={handleSubscribe} className="h-9 px-3 shrink-0">
                {subscribed ? (
                  <Icons.Check className="h-4 w-4" />
                ) : (
                  <Icons.Send className="h-4 w-4" />
                )}
              </Button>
            </div>
            {subscribed && (
              <p className="text-xs text-green-600 mt-1">Subscribed successfully!</p>
            )}
          </div>
        </div>

        <Separator className="my-8" />

        <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="text-xs text-muted-foreground">
            &copy; {new Date().getFullYear()} NestFinder. All rights reserved.
          </p>
          <div className="flex items-center gap-3">
            {SOCIAL_ICONS.map((iconName) => {
              const SocialIcon = Icons[iconName] as React.ComponentType<{ className?: string }>;
              return SocialIcon ? (
                <button
                  key={iconName}
                  className="flex h-8 w-8 items-center justify-center rounded-full bg-muted hover:bg-primary/10 hover:text-primary transition-colors"
                >
                  <SocialIcon className="h-4 w-4" />
                </button>
              ) : null;
            })}
          </div>
        </div>
      </div>
    </footer>
  );
}

export default RealEstateFooter;
