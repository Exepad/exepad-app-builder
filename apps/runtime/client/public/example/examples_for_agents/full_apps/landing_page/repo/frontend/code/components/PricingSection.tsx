import {
  React,
  Button,
  Badge,
  Icons,
  cn,
} from "@exepad/sdk";

interface PricingTier {
  name: string;
  monthlyPrice: number;
  yearlyPrice: number;
  description: string;
  features: string[];
  cta: string;
  popular?: boolean;
}

const TIERS: PricingTier[] = [
  {
    name: "Free",
    monthlyPrice: 0,
    yearlyPrice: 0,
    description: "Perfect for trying out LaunchPad AI",
    features: [
      "5,000 words per month",
      "Basic autocomplete",
      "Grammar checking",
      "1 project",
      "Community support",
    ],
    cta: "Get Started Free",
  },
  {
    name: "Pro",
    monthlyPrice: 19,
    yearlyPrice: 15,
    description: "For professionals who write daily",
    features: [
      "100,000 words per month",
      "Advanced autocomplete",
      "Tone adjustment",
      "SEO optimization",
      "30+ languages",
      "Unlimited projects",
      "Priority support",
    ],
    cta: "Start Free Trial",
    popular: true,
  },
  {
    name: "Enterprise",
    monthlyPrice: 49,
    yearlyPrice: 39,
    description: "For teams and organizations",
    features: [
      "Unlimited words",
      "All Pro features",
      "Team collaboration",
      "Custom AI models",
      "API access",
      "SSO & admin controls",
      "Dedicated account manager",
    ],
    cta: "Contact Sales",
  },
];

function PricingSection() {
  const [isYearly, setIsYearly] = React.useState(false);

  return (
    <section id="pricing" className="py-20 sm:py-28 bg-muted/30">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        {/* Header */}
        <div className="text-center mb-12">
          <p className="text-sm font-semibold text-primary uppercase tracking-wider mb-2">Pricing</p>
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight mb-4">
            Simple, Transparent Pricing
          </h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto mb-8">
            Start free and scale as you grow. No hidden fees, no surprises.
          </p>

          {/* Toggle */}
          <div className="flex items-center justify-center gap-3">
            <span className={cn("text-sm font-medium", !isYearly ? "text-foreground" : "text-muted-foreground")}>
              Monthly
            </span>
            <button
              onClick={() => setIsYearly(!isYearly)}
              className={cn(
                "relative inline-flex h-6 w-11 items-center rounded-full transition-colors",
                isYearly ? "bg-primary" : "bg-border"
              )}
            >
              <span
                className={cn(
                  "inline-block h-4 w-4 rounded-full bg-white transition-transform",
                  isYearly ? "translate-x-6" : "translate-x-1"
                )}
              />
            </button>
            <span className={cn("text-sm font-medium", isYearly ? "text-foreground" : "text-muted-foreground")}>
              Yearly
            </span>
            {isYearly && (
              <Badge variant="secondary" className="text-xs bg-green-100 text-green-700 border-green-200">
                Save 20%
              </Badge>
            )}
          </div>
        </div>

        {/* Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-5xl mx-auto">
          {TIERS.map((tier) => {
            const price = isYearly ? tier.yearlyPrice : tier.monthlyPrice;
            return (
              <div
                key={tier.name}
                className={cn(
                  "pricing-card relative rounded-2xl border bg-card p-8 flex flex-col",
                  tier.popular
                    ? "popular border-primary shadow-lg scale-105"
                    : "border-border"
                )}
              >
                {tier.popular && (
                  <Badge className="absolute -top-3 left-1/2 -translate-x-1/2 bg-primary text-primary-foreground">
                    Most Popular
                  </Badge>
                )}
                <div className="mb-6">
                  <h3 className="text-xl font-bold mb-1">{tier.name}</h3>
                  <p className="text-sm text-muted-foreground">{tier.description}</p>
                </div>
                <div className="mb-6">
                  <span className="text-4xl font-extrabold">${price}</span>
                  <span className="text-muted-foreground">/mo</span>
                  {isYearly && tier.monthlyPrice > 0 && (
                    <span className="ml-2 text-sm text-muted-foreground line-through">
                      ${tier.monthlyPrice}
                    </span>
                  )}
                </div>
                <ul className="space-y-3 mb-8 flex-1">
                  {tier.features.map((feature) => (
                    <li key={feature} className="flex items-start gap-2 text-sm">
                      <Icons.Check className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                      <span>{feature}</span>
                    </li>
                  ))}
                </ul>
                <Button
                  className="w-full"
                  variant={tier.popular ? "default" : "outline"}
                  size="lg"
                >
                  {tier.cta}
                </Button>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

export default PricingSection;
