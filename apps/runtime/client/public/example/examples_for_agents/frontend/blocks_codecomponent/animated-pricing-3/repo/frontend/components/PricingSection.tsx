import {
  React,
  Motion,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  CardFooter,
  Button,
  Badge,
  Switch,
  Label,
  Icons,
  cn,
} from "@exepad/sdk";

interface Plan {
  name: string;
  monthlyPrice: number;
  yearlyPrice: number;
  description: string;
  features: string[];
  popular?: boolean;
}

const PLANS: Plan[] = [
  {
    name: "Starter",
    monthlyPrice: 9,
    yearlyPrice: 90,
    description: "Perfect for side projects and small teams.",
    features: ["5 projects", "1 GB storage", "Community support", "Basic analytics"],
  },
  {
    name: "Pro",
    monthlyPrice: 29,
    yearlyPrice: 290,
    description: "For growing teams that need more power.",
    features: [
      "Unlimited projects",
      "50 GB storage",
      "Priority support",
      "Advanced analytics",
      "Custom domains",
      "Team collaboration",
    ],
    popular: true,
  },
  {
    name: "Enterprise",
    monthlyPrice: 99,
    yearlyPrice: 990,
    description: "For large organizations with custom needs.",
    features: [
      "Everything in Pro",
      "Unlimited storage",
      "24/7 dedicated support",
      "SSO & SAML",
      "Audit logs",
      "Custom integrations",
      "SLA guarantee",
    ],
  },
];

function PricingSection() {
  const [isYearly, setIsYearly] = React.useState(false);

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-center gap-3">
        <Label htmlFor="billing-toggle" className="text-sm">
          Monthly
        </Label>
        <Switch
          id="billing-toggle"
          checked={isYearly}
          onCheckedChange={setIsYearly}
        />
        <Label htmlFor="billing-toggle" className="text-sm">
          Yearly
          <Badge variant="secondary" className="ml-2 text-xs">
            Save 17%
          </Badge>
        </Label>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {PLANS.map((plan, index) => {
          const price = isYearly ? plan.yearlyPrice : plan.monthlyPrice;
          const period = isYearly ? "/year" : "/month";

          return (
            <Motion.div
              key={plan.name}
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: index * 0.1 }}
            >
              <Card
                className={cn(
                  "relative flex flex-col h-full",
                  plan.popular && "border-primary shadow-lg"
                )}
              >
                {plan.popular && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                    <Badge>Most Popular</Badge>
                  </div>
                )}
                <CardHeader className="text-center pt-8">
                  <CardTitle className="text-xl">{plan.name}</CardTitle>
                  <CardDescription>{plan.description}</CardDescription>
                  <div className="mt-4">
                    <span className="text-4xl font-bold">${price}</span>
                    <span className="text-muted-foreground">{period}</span>
                  </div>
                </CardHeader>
                <CardContent className="flex-1">
                  <ul className="space-y-3">
                    {plan.features.map((feature) => (
                      <li key={feature} className="flex items-center gap-2 text-sm">
                        <Icons.Check className="h-4 w-4 text-primary shrink-0" />
                        {feature}
                      </li>
                    ))}
                  </ul>
                </CardContent>
                <CardFooter>
                  <Button
                    className="w-full"
                    variant={plan.popular ? "default" : "outline"}
                  >
                    Get Started
                  </Button>
                </CardFooter>
              </Card>
            </Motion.div>
          );
        })}
      </div>
    </div>
  );
}

export default PricingSection;
