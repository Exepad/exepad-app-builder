import {
  React,
  useNavigation,
  toast,
  Input,
  Button,
  Separator,
  Icons,
  cn,
} from "@exepad/sdk";

const ABOUT_TEXT =
  "EventSpark connects people with unforgettable experiences. Discover concerts, conferences, food festivals, and more in your area. Join our community of event-goers and organizers.";

const CATEGORIES = [
  { label: "Music & Concerts", slug: "/events?cat=music" },
  { label: "Tech & Innovation", slug: "/events?cat=tech" },
  { label: "Food & Drink", slug: "/events?cat=food" },
  { label: "Sports & Fitness", slug: "/events?cat=sports" },
  { label: "Arts & Culture", slug: "/events?cat=arts" },
  { label: "Business & Networking", slug: "/events?cat=business" },
];

const SUPPORT_LINKS = [
  { label: "Help Center", slug: "#" },
  { label: "Contact Us", slug: "#" },
  { label: "Organizer Guide", slug: "#" },
  { label: "Terms of Service", slug: "#" },
  { label: "Privacy Policy", slug: "#" },
];

const SOCIAL_ICONS: Array<{ icon: keyof typeof Icons; label: string }> = [
  { icon: "Twitter", label: "Twitter" },
  { icon: "Facebook", label: "Facebook" },
  { icon: "Instagram", label: "Instagram" },
  { icon: "Linkedin", label: "LinkedIn" },
  { icon: "Youtube", label: "YouTube" },
];

function EventFooter() {
  const navigation = useNavigation();
  const [email, setEmail] = React.useState("");

  const handleSubscribe = () => {
    if (!email.trim() || !email.includes("@")) {
      toast("Please enter a valid email address.");
      return;
    }
    toast("Thanks for subscribing! You'll receive event updates soon.");
    setEmail("");
  };

  const handleNav = (slug: string) => {
    if (slug.startsWith("#")) return;
    navigation.navigate(slug);
  };

  return (
    <footer className="w-full bg-muted/50 border-t border-border">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-12">
        {/* Main grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8">
          {/* About */}
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <Icons.Sparkles className="h-4 w-4" />
              </div>
              <span className="text-lg font-bold">EventSpark</span>
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed">
              {ABOUT_TEXT}
            </p>
          </div>

          {/* Categories */}
          <div className="space-y-4">
            <h4 className="text-sm font-semibold uppercase tracking-wider">Categories</h4>
            <ul className="space-y-2">
              {CATEGORIES.map((cat) => (
                <li key={cat.label}>
                  <button
                    onClick={() => handleNav(cat.slug)}
                    className="text-sm text-muted-foreground hover:text-primary transition-colors"
                  >
                    {cat.label}
                  </button>
                </li>
              ))}
            </ul>
          </div>

          {/* Support */}
          <div className="space-y-4">
            <h4 className="text-sm font-semibold uppercase tracking-wider">Support</h4>
            <ul className="space-y-2">
              {SUPPORT_LINKS.map((link) => (
                <li key={link.label}>
                  <button
                    onClick={() => handleNav(link.slug)}
                    className="text-sm text-muted-foreground hover:text-primary transition-colors"
                  >
                    {link.label}
                  </button>
                </li>
              ))}
            </ul>
          </div>

          {/* Connect + Newsletter */}
          <div className="space-y-4">
            <h4 className="text-sm font-semibold uppercase tracking-wider">Connect</h4>
            <p className="text-sm text-muted-foreground">
              Stay updated with the latest events and exclusive offers.
            </p>
            <div className="flex gap-2">
              <Input
                placeholder="your@email.com"
                value={email}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEmail(e.target.value)}
                className="text-sm"
              />
              <Button size="sm" onClick={handleSubscribe}>
                <Icons.Send className="h-4 w-4" />
              </Button>
            </div>
            <div className="flex items-center gap-3 pt-2">
              {SOCIAL_ICONS.map((social) => {
                const SocialIcon = Icons[social.icon] as React.ComponentType<{ className?: string }>;
                return (
                  <button
                    key={social.label}
                    className="p-2 rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
                    title={social.label}
                  >
                    {SocialIcon && <SocialIcon className="h-4 w-4" />}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <Separator className="my-8" />

        {/* Bottom bar */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-muted-foreground">
          <p>&copy; {new Date().getFullYear()} EventSpark. All rights reserved.</p>
          <div className="flex items-center gap-4">
            <button className="hover:text-primary transition-colors">Terms</button>
            <button className="hover:text-primary transition-colors">Privacy</button>
            <button className="hover:text-primary transition-colors">Cookies</button>
          </div>
        </div>
      </div>
    </footer>
  );
}

export default EventFooter;
