import {
  React,
  useNavigation,
  Button,
  Card,
  CardContent,
  Badge,
  Icons,
  cn,
} from "@exepad/sdk";

interface Service {
  icon: string;
  title: string;
  description: string;
  features: string[];
  color: string;
}

interface PricingTier {
  name: string;
  price: string;
  period: string;
  description: string;
  features: string[];
  highlighted: boolean;
  cta: string;
}

const SERVICES: Service[] = [
  {
    icon: "Brain",
    title: "AI & Machine Learning",
    description: "Custom AI models and ML pipelines that automate decision-making, predict trends, and unlock hidden patterns in your data.",
    features: ["Natural Language Processing", "Predictive Analytics", "Computer Vision", "Recommendation Engines"],
    color: "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300",
  },
  {
    icon: "Cloud",
    title: "Cloud Infrastructure",
    description: "Scalable, resilient cloud architectures on AWS, Azure, and GCP designed for peak performance and cost optimization.",
    features: ["Multi-Cloud Strategy", "Auto-Scaling", "Disaster Recovery", "Cost Optimization"],
    color: "bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300",
  },
  {
    icon: "Shield",
    title: "Cybersecurity",
    description: "Comprehensive security solutions from assessment to implementation, protecting your business against modern cyber threats.",
    features: ["Penetration Testing", "Zero-Trust Architecture", "Compliance Audits", "Incident Response"],
    color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
  },
  {
    icon: "Code2",
    title: "Custom Software",
    description: "Bespoke software solutions built with modern technologies, tailored to your unique business requirements and workflows.",
    features: ["Full-Stack Development", "API Design", "Microservices", "Legacy Modernization"],
    color: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300",
  },
  {
    icon: "BarChart3",
    title: "Data Analytics",
    description: "Transform raw data into actionable insights with advanced analytics platforms, dashboards, and real-time reporting.",
    features: ["Business Intelligence", "Real-Time Dashboards", "Data Warehousing", "ETL Pipelines"],
    color: "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300",
  },
  {
    icon: "GitBranch",
    title: "DevOps & Automation",
    description: "Streamline your development lifecycle with CI/CD pipelines, infrastructure as code, and automated testing frameworks.",
    features: ["CI/CD Pipelines", "Infrastructure as Code", "Container Orchestration", "Monitoring & Alerting"],
    color: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
  },
];

const PRICING: PricingTier[] = [
  {
    name: "Starter",
    price: "$2,999",
    period: "/month",
    description: "Perfect for small teams getting started with digital transformation.",
    features: ["Up to 3 active projects", "Cloud hosting setup", "Monthly security scans", "Email support", "Basic analytics dashboard"],
    highlighted: false,
    cta: "Get Started",
  },
  {
    name: "Professional",
    price: "$7,999",
    period: "/month",
    description: "For growing businesses that need comprehensive technology solutions.",
    features: ["Up to 10 active projects", "Multi-cloud architecture", "Weekly security audits", "24/7 priority support", "Advanced analytics & AI", "Dedicated account manager"],
    highlighted: true,
    cta: "Get Started",
  },
  {
    name: "Enterprise",
    price: "Custom",
    period: "",
    description: "Tailored solutions for large organizations with complex requirements.",
    features: ["Unlimited projects", "Custom infrastructure", "Continuous security monitoring", "24/7 dedicated team", "Full AI/ML platform access", "On-site consulting", "SLA guarantees"],
    highlighted: false,
    cta: "Contact Sales",
  },
];

function ServicesPage() {
  const navigation = useNavigation();

  return (
    <div className="flex flex-col">
      {/* Hero */}
      <section className="py-20 bg-gradient-to-b from-accent/30 to-background">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 text-center">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-primary/20 bg-primary/5 text-primary text-sm font-medium mb-6">
            <Icons.Layers className="h-4 w-4" />
            Our Services
          </div>
          <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight mb-6">
            End-to-End <span className="text-primary">Technology Solutions</span>
          </h1>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            From AI-powered automation to bulletproof cybersecurity, we offer the complete toolkit to accelerate your digital journey.
          </p>
        </div>
      </section>

      {/* Services Grid */}
      <section className="py-20 bg-background">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
            {SERVICES.map((svc) => {
              const Icon = (Icons as any)[svc.icon];
              return (
                <Card key={svc.title} className="group hover:shadow-lg transition-all duration-300 hover:-translate-y-1 border-border/50 flex flex-col">
                  <CardContent className="p-8 flex flex-col flex-1">
                    <div className={cn("inline-flex h-12 w-12 items-center justify-center rounded-xl mb-5", svc.color)}>
                      {Icon && <Icon className="h-6 w-6" />}
                    </div>
                    <h3 className="text-xl font-semibold mb-3">{svc.title}</h3>
                    <p className="text-muted-foreground leading-relaxed mb-5 flex-1">{svc.description}</p>
                    <ul className="space-y-2 mb-6">
                      {svc.features.map((f) => (
                        <li key={f} className="flex items-center gap-2 text-sm">
                          <Icons.Check className="h-4 w-4 text-primary shrink-0" />
                          <span>{f}</span>
                        </li>
                      ))}
                    </ul>
                    <Button variant="outline" className="gap-2 mt-auto" onClick={() => navigation.navigate("/contact")}>
                      Learn More
                      <Icons.ArrowRight className="h-4 w-4" />
                    </Button>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      </section>

      {/* Pricing Section */}
      <section className="py-20 bg-muted/30">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-14">
            <h2 className="text-3xl sm:text-4xl font-bold mb-4">Simple, Transparent Pricing</h2>
            <p className="text-muted-foreground max-w-2xl mx-auto text-lg">
              Choose the plan that fits your needs. All plans include our core technology stack and expert support.
            </p>
          </div>
          <div className="grid md:grid-cols-3 gap-8 max-w-5xl mx-auto">
            {PRICING.map((tier) => (
              <Card
                key={tier.name}
                className={cn(
                  "flex flex-col border-border/50 relative",
                  tier.highlighted && "border-primary shadow-lg scale-[1.02]"
                )}
              >
                {tier.highlighted && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                    <Badge className="bg-primary text-primary-foreground px-3">Most Popular</Badge>
                  </div>
                )}
                <CardContent className="p-8 flex flex-col flex-1">
                  <h3 className="text-xl font-semibold mb-2">{tier.name}</h3>
                  <div className="mb-3">
                    <span className="text-4xl font-extrabold">{tier.price}</span>
                    {tier.period && <span className="text-muted-foreground">{tier.period}</span>}
                  </div>
                  <p className="text-sm text-muted-foreground mb-6">{tier.description}</p>
                  <ul className="space-y-3 mb-8 flex-1">
                    {tier.features.map((f) => (
                      <li key={f} className="flex items-center gap-2 text-sm">
                        <Icons.Check className="h-4 w-4 text-primary shrink-0" />
                        <span>{f}</span>
                      </li>
                    ))}
                  </ul>
                  <Button
                    variant={tier.highlighted ? "default" : "outline"}
                    className="w-full"
                    onClick={() => navigation.navigate("/contact")}
                  >
                    {tier.cta}
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-16 bg-primary text-primary-foreground">
        <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-2xl sm:text-3xl font-bold mb-4">Not Sure Which Plan Is Right?</h2>
          <p className="opacity-90 mb-6 max-w-xl mx-auto">
            Our team will help you find the perfect solution for your business needs. No commitment required.
          </p>
          <Button variant="secondary" size="lg" className="gap-2" onClick={() => navigation.navigate("/contact")}>
            Schedule a Free Consultation
            <Icons.ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </section>
    </div>
  );
}

export default ServicesPage;
