import {
  React,
  useNavigation,
  Separator,
  Icons,
} from "@exepad/sdk";

const PRODUCT_LINKS = [
  { label: "Features", anchor: "#features" },
  { label: "Pricing", anchor: "#pricing" },
  { label: "FAQ", anchor: "#faq" },
  { label: "Changelog", anchor: "#" },
  { label: "API Docs", anchor: "#" },
];

const COMPANY_LINKS = [
  { label: "About Us", anchor: "#" },
  { label: "Blog", anchor: "#" },
  { label: "Careers", anchor: "#" },
  { label: "Press Kit", anchor: "#" },
  { label: "Contact", anchor: "#" },
];

const LEGAL_LINKS = [
  { label: "Privacy Policy", anchor: "#" },
  { label: "Terms of Service", anchor: "#" },
  { label: "Cookie Policy", anchor: "#" },
];

const SOCIAL_LINKS = [
  { icon: "Twitter" as keyof typeof Icons, label: "Twitter" },
  { icon: "Github" as keyof typeof Icons, label: "GitHub" },
  { icon: "Linkedin" as keyof typeof Icons, label: "LinkedIn" },
];

function LandingFooter() {
  const navigation = useNavigation();

  const scrollTo = (anchor: string) => {
    if (anchor === "#") return;
    const id = anchor.replace("#", "");
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <footer className="border-t border-border bg-muted/30">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 py-12">
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-10">
          {/* Brand */}
          <div>
            <div className="flex items-center gap-2 mb-4">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <Icons.Sparkles className="h-3.5 w-3.5" />
              </div>
              <span className="text-lg font-bold">LaunchPad AI</span>
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed mb-4">
              AI-powered writing assistant that helps you create better content faster. Trusted by 50,000+ writers worldwide.
            </p>
            <div className="flex gap-3">
              {SOCIAL_LINKS.map((social) => {
                const SocialIcon = Icons[social.icon] as React.ComponentType<{ className?: string }>;
                return (
                  <button
                    key={social.label}
                    className="flex h-9 w-9 items-center justify-center rounded-full border border-border text-muted-foreground hover:text-foreground hover:border-foreground transition-colors"
                    title={social.label}
                  >
                    {SocialIcon && <SocialIcon className="h-4 w-4" />}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Product */}
          <div>
            <h3 className="text-sm font-semibold uppercase tracking-wider mb-4">Product</h3>
            <ul className="space-y-2">
              {PRODUCT_LINKS.map((link) => (
                <li key={link.label}>
                  <button
                    onClick={() => scrollTo(link.anchor)}
                    className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {link.label}
                  </button>
                </li>
              ))}
            </ul>
          </div>

          {/* Company */}
          <div>
            <h3 className="text-sm font-semibold uppercase tracking-wider mb-4">Company</h3>
            <ul className="space-y-2">
              {COMPANY_LINKS.map((link) => (
                <li key={link.label}>
                  <button
                    onClick={() => scrollTo(link.anchor)}
                    className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {link.label}
                  </button>
                </li>
              ))}
            </ul>
          </div>

          {/* Legal */}
          <div>
            <h3 className="text-sm font-semibold uppercase tracking-wider mb-4">Legal</h3>
            <ul className="space-y-2">
              {LEGAL_LINKS.map((link) => (
                <li key={link.label}>
                  <button
                    onClick={() => scrollTo(link.anchor)}
                    className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {link.label}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <Separator className="my-8" />

        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-muted-foreground">
          <p>&copy; {new Date().getFullYear()} LaunchPad AI. All rights reserved.</p>
          <p>Made with love for writers everywhere.</p>
        </div>
      </div>
    </footer>
  );
}

export default LandingFooter;
