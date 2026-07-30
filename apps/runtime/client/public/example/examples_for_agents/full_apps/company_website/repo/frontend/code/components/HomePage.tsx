import {
  React,
  useNavigation,
  Button,
  Card,
  CardContent,
  Icons,
  cn,
} from "@exepad/sdk";

interface Feature {
  icon: string;
  title: string;
  description: string;
}

interface Stat {
  value: string;
  label: string;
}

interface Testimonial {
  quote: string;
  name: string;
  role: string;
  company: string;
}

const FEATURES: Feature[] = [
  {
    icon: "Cpu",
    title: "AI Solutions",
    description: "Harness the power of artificial intelligence to automate processes, gain insights, and drive innovation across your organization.",
  },
  {
    icon: "Shield",
    title: "Cybersecurity",
    description: "Protect your digital assets with enterprise-grade security solutions designed to defend against evolving threats.",
  },
  {
    icon: "Zap",
    title: "Cloud Infrastructure",
    description: "Scale effortlessly with cloud-native architectures that deliver reliability, performance, and cost efficiency.",
  },
];

const STATS: Stat[] = [
  { value: "500+", label: "Projects Delivered" },
  { value: "50+", label: "Team Members" },
  { value: "99.9%", label: "Uptime Guarantee" },
  { value: "200+", label: "Global Clients" },
];

const TESTIMONIALS: Testimonial[] = [
  {
    quote: "NovaTech transformed our legacy systems into a modern cloud platform. Their team's expertise and dedication exceeded all our expectations.",
    name: "Sarah Chen",
    role: "CTO",
    company: "Meridian Health",
  },
  {
    quote: "The AI analytics solution they built for us reduced our data processing time by 80%. It's been a game-changer for our business.",
    name: "Marcus Johnson",
    role: "VP of Engineering",
    company: "DataFlow Inc.",
  },
  {
    quote: "Their cybersecurity audit and remediation saved us from a major vulnerability. Professional, thorough, and incredibly responsive.",
    name: "Elena Rodriguez",
    role: "Director of IT",
    company: "Apex Financial",
  },
];

function HomePage() {
  const navigation = useNavigation();

  return (
    <div className="flex flex-col">
      {/* Hero Section */}
      <section className="relative overflow-hidden bg-gradient-to-br from-primary/5 via-background to-accent/30 py-20 sm:py-28 lg:py-36">
        <div className="absolute inset-0 bg-grid-pattern opacity-5" />
        <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 text-center">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-primary/20 bg-primary/5 text-primary text-sm font-medium mb-6">
            <Icons.Sparkles className="h-4 w-4" />
            Innovating Since 2018
          </div>
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight mb-6 leading-tight">
            Transforming Ideas Into
            <br />
            <span className="text-primary">Digital Reality</span>
          </h1>
          <p className="mx-auto max-w-2xl text-lg sm:text-xl text-muted-foreground mb-10 leading-relaxed">
            We build cutting-edge technology solutions that empower businesses to innovate faster, scale smarter, and lead in the digital age.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Button
              size="lg"
              className="gap-2 px-8"
              onClick={() => navigation.navigate("/contact")}
            >
              Get Started
              <Icons.ArrowRight className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="lg"
              className="gap-2 px-8"
              onClick={() => navigation.navigate("/services")}
            >
              Learn More
            </Button>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="py-20 bg-background">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-14">
            <h2 className="text-3xl sm:text-4xl font-bold mb-4">What We Do Best</h2>
            <p className="text-muted-foreground max-w-2xl mx-auto text-lg">
              Our core capabilities span the full technology spectrum, delivering solutions that drive real business results.
            </p>
          </div>
          <div className="grid md:grid-cols-3 gap-8">
            {FEATURES.map((feature) => {
              const Icon = (Icons as any)[feature.icon];
              return (
                <Card
                  key={feature.title}
                  className="group hover:shadow-lg transition-all duration-300 hover:-translate-y-1 border-border/50"
                >
                  <CardContent className="p-8">
                    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary mb-5 group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
                      {Icon && <Icon className="h-6 w-6" />}
                    </div>
                    <h3 className="text-xl font-semibold mb-3">{feature.title}</h3>
                    <p className="text-muted-foreground leading-relaxed">{feature.description}</p>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      </section>

      {/* Stats Section */}
      <section className="py-16 bg-primary text-primary-foreground">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
            {STATS.map((stat) => (
              <div key={stat.label} className="text-center">
                <div className="text-3xl sm:text-4xl font-extrabold mb-1">{stat.value}</div>
                <div className="text-sm sm:text-base opacity-80">{stat.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Testimonials Section */}
      <section className="py-20 bg-muted/30">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-14">
            <h2 className="text-3xl sm:text-4xl font-bold mb-4">What Our Clients Say</h2>
            <p className="text-muted-foreground max-w-2xl mx-auto text-lg">
              Trusted by leading companies across industries to deliver transformative technology solutions.
            </p>
          </div>
          <div className="grid md:grid-cols-3 gap-8">
            {TESTIMONIALS.map((t) => (
              <Card key={t.name} className="border-border/50">
                <CardContent className="p-8">
                  <Icons.Quote className="h-8 w-8 text-primary/20 mb-4" />
                  <p className="text-muted-foreground leading-relaxed mb-6 italic">
                    &ldquo;{t.quote}&rdquo;
                  </p>
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary text-sm font-semibold">
                      {t.name.split(" ").map((n) => n[0]).join("")}
                    </div>
                    <div>
                      <div className="font-semibold text-sm">{t.name}</div>
                      <div className="text-xs text-muted-foreground">{t.role}, {t.company}</div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-20 bg-gradient-to-r from-primary to-primary/80 text-primary-foreground">
        <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-3xl sm:text-4xl font-bold mb-4">Ready to Transform Your Business?</h2>
          <p className="text-lg opacity-90 mb-8 max-w-2xl mx-auto">
            Let&apos;s discuss how NovaTech can help you build the technology foundation for your future growth.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Button
              variant="secondary"
              size="lg"
              className="gap-2 px-8"
              onClick={() => navigation.navigate("/contact")}
            >
              Contact Us
              <Icons.ArrowRight className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="lg"
              className="gap-2 px-8 border-primary-foreground/30 text-primary-foreground hover:bg-primary-foreground/10"
              onClick={() => navigation.navigate("/services")}
            >
              View Services
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}

export default HomePage;
