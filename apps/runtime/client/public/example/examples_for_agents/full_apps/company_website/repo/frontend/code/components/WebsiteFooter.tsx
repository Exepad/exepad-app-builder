import {
  React,
  useNavigation,
  Button,
  Input,
  Separator,
  Icons,
  toast,
} from "@exepad/sdk";

const QUICK_LINKS = [
  { label: "Home", slug: "/" },
  { label: "About Us", slug: "/about" },
  { label: "Services", slug: "/services" },
  { label: "Contact", slug: "/contact" },
  { label: "Careers", slug: "/contact" },
];

const SERVICES_LINKS = [
  "AI & Machine Learning",
  "Cloud Infrastructure",
  "Cybersecurity",
  "Custom Software",
  "Data Analytics",
  "DevOps & Automation",
];

const SOCIAL_ICONS = [
  { icon: "Twitter", label: "Twitter" },
  { icon: "Linkedin", label: "LinkedIn" },
  { icon: "Github", label: "GitHub" },
  { icon: "Youtube", label: "YouTube" },
];

function WebsiteFooter() {
  const navigation = useNavigation();
  const [email, setEmail] = React.useState("");

  const handleSubscribe = (e: React.FormEvent) => {
    e.preventDefault();
    if (email.trim()) {
      toast.success("Thanks for subscribing!");
      setEmail("");
    }
  };

  return (
    <footer className="border-t border-border bg-muted/30">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-12">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-10">
          {/* Company Info */}
          <div>
            <div className="flex items-center gap-2.5 mb-4">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <Icons.Zap className="h-4 w-4" />
              </div>
              <span className="text-lg font-bold">NovaTech</span>
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed mb-4">
              Transforming businesses through innovative technology solutions. We build the digital infrastructure that powers tomorrow's enterprises.
            </p>
            <div className="flex gap-3">
              {SOCIAL_ICONS.map((s) => {
                const Icon = (Icons as any)[s.icon];
                return (
                  <button
                    key={s.label}
                    className="flex h-9 w-9 items-center justify-center rounded-full border border-border text-muted-foreground hover:text-foreground hover:border-foreground transition-colors"
                    title={s.label}
                  >
                    {Icon && <Icon className="h-4 w-4" />}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Quick Links */}
          <div>
            <h3 className="text-sm font-semibold uppercase tracking-wider mb-4">Quick Links</h3>
            <ul className="space-y-2">
              {QUICK_LINKS.map((link) => (
                <li key={link.label}>
                  <button
                    onClick={() => navigation.navigate(link.slug)}
                    className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {link.label}
                  </button>
                </li>
              ))}
            </ul>
          </div>

          {/* Services */}
          <div>
            <h3 className="text-sm font-semibold uppercase tracking-wider mb-4">Services</h3>
            <ul className="space-y-2">
              {SERVICES_LINKS.map((svc) => (
                <li key={svc}>
                  <button
                    onClick={() => navigation.navigate("/services")}
                    className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {svc}
                  </button>
                </li>
              ))}
            </ul>
          </div>

          {/* Contact & Newsletter */}
          <div>
            <h3 className="text-sm font-semibold uppercase tracking-wider mb-4">Contact</h3>
            <ul className="space-y-3 text-sm text-muted-foreground mb-6">
              <li className="flex items-center gap-2">
                <Icons.Mail className="h-4 w-4 text-primary" />
                hello@novatech.com
              </li>
              <li className="flex items-center gap-2">
                <Icons.Phone className="h-4 w-4 text-primary" />
                +1 (555) 234-5678
              </li>
              <li className="flex items-start gap-2">
                <Icons.MapPin className="h-4 w-4 text-primary mt-0.5" />
                <span>100 Innovation Drive<br />San Francisco, CA 94105</span>
              </li>
            </ul>
            <h4 className="text-sm font-semibold mb-2">Newsletter</h4>
            <form onSubmit={handleSubscribe} className="flex gap-2">
              <Input
                type="email"
                placeholder="your@email.com"
                value={email}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEmail(e.target.value)}
                className="h-9 text-sm flex-1"
              />
              <Button type="submit" size="sm" className="h-9 px-4">
                Subscribe
              </Button>
            </form>
          </div>
        </div>

        <Separator className="my-8" />

        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-muted-foreground">
          <p>&copy; {new Date().getFullYear()} NovaTech Solutions. All rights reserved.</p>
          <div className="flex gap-4">
            <button className="hover:text-foreground transition-colors">Privacy Policy</button>
            <button className="hover:text-foreground transition-colors">Terms of Service</button>
            <button className="hover:text-foreground transition-colors">Cookie Policy</button>
          </div>
        </div>
      </div>
    </footer>
  );
}

export default WebsiteFooter;
