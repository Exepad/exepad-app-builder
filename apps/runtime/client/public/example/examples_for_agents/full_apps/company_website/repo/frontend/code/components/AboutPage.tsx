import {
  React,
  useNavigation,
  Button,
  Card,
  CardContent,
  Icons,
  cn,
} from "@exepad/sdk";

interface TeamMember {
  name: string;
  role: string;
  bio: string;
  initials: string;
}

interface Value {
  icon: string;
  title: string;
  description: string;
}

interface Milestone {
  year: string;
  title: string;
  description: string;
}

const TEAM: TeamMember[] = [
  { name: "Alex Rivera", role: "CEO & Founder", bio: "Former Google engineer with 15+ years in enterprise tech. Passionate about building technology that matters.", initials: "AR" },
  { name: "Dr. Maya Patel", role: "CTO", bio: "PhD in Computer Science from MIT. Leading our AI and machine learning initiatives with deep research expertise.", initials: "MP" },
  { name: "James Okonkwo", role: "VP of Engineering", bio: "Scaled engineering teams at three unicorn startups. Expert in distributed systems and cloud architecture.", initials: "JO" },
  { name: "Sarah Kim", role: "Head of Design", bio: "Award-winning UX designer. Previously led design at Figma and Stripe. Advocates for human-centered design.", initials: "SK" },
  { name: "David Chen", role: "Head of Security", bio: "Former NSA cybersecurity analyst. CISSP certified with expertise in zero-trust architecture.", initials: "DC" },
  { name: "Lisa Thompson", role: "VP of Sales", bio: "15 years in enterprise SaaS sales. Built and led sales teams generating $100M+ in annual revenue.", initials: "LT" },
];

const VALUES: Value[] = [
  { icon: "Lightbulb", title: "Innovation First", description: "We embrace new technologies and methodologies to deliver solutions that keep our clients ahead of the curve." },
  { icon: "Users", title: "Client Partnership", description: "We don't just build software — we build lasting partnerships, investing in our clients' long-term success." },
  { icon: "Shield", title: "Trust & Security", description: "Security and transparency are foundational to everything we do. Our clients' data and trust are sacred." },
  { icon: "Target", title: "Excellence", description: "We hold ourselves to the highest standards, delivering quality that exceeds expectations on every project." },
];

const MILESTONES: Milestone[] = [
  { year: "2018", title: "Founded", description: "NovaTech Solutions was founded in San Francisco with a mission to democratize enterprise technology." },
  { year: "2020", title: "Series A", description: "Raised $12M Series A funding. Expanded to 25 team members and opened our first dedicated office." },
  { year: "2022", title: "Global Expansion", description: "Expanded operations to London and Singapore. Crossed 100+ enterprise clients milestone." },
  { year: "2024", title: "Industry Leader", description: "Named Top 10 Tech Innovator by TechCrunch. Launched our AI-powered cloud platform to 200+ clients." },
];

function AboutPage() {
  const navigation = useNavigation();

  return (
    <div className="flex flex-col">
      {/* Mission Section */}
      <section className="py-20 bg-gradient-to-b from-accent/30 to-background">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="max-w-3xl mx-auto text-center">
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-primary/20 bg-primary/5 text-primary text-sm font-medium mb-6">
              <Icons.Building2 className="h-4 w-4" />
              About NovaTech
            </div>
            <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight mb-6">
              Building the Future of <span className="text-primary">Technology</span>
            </h1>
            <p className="text-lg text-muted-foreground leading-relaxed">
              Since 2018, NovaTech Solutions has been at the forefront of digital transformation. We combine deep technical expertise with strategic thinking to help businesses of all sizes leverage technology for growth, efficiency, and competitive advantage.
            </p>
          </div>
        </div>
      </section>

      {/* Team Section */}
      <section className="py-20 bg-background">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-14">
            <h2 className="text-3xl sm:text-4xl font-bold mb-4">Meet Our Leadership</h2>
            <p className="text-muted-foreground max-w-2xl mx-auto text-lg">
              A diverse team of industry veterans and innovators driving NovaTech's mission forward.
            </p>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-8">
            {TEAM.map((member) => (
              <Card key={member.name} className="group hover:shadow-lg transition-all duration-300 border-border/50">
                <CardContent className="p-8 text-center">
                  <div className="flex h-20 w-20 items-center justify-center rounded-full bg-primary/10 text-primary text-2xl font-bold mx-auto mb-4 group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
                    {member.initials}
                  </div>
                  <h3 className="text-lg font-semibold mb-1">{member.name}</h3>
                  <p className="text-sm text-primary font-medium mb-3">{member.role}</p>
                  <p className="text-sm text-muted-foreground leading-relaxed">{member.bio}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Values Section */}
      <section className="py-20 bg-muted/30">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-14">
            <h2 className="text-3xl sm:text-4xl font-bold mb-4">Our Core Values</h2>
            <p className="text-muted-foreground max-w-2xl mx-auto text-lg">
              The principles that guide every decision we make and every solution we build.
            </p>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-8">
            {VALUES.map((value) => {
              const Icon = (Icons as any)[value.icon];
              return (
                <Card key={value.title} className="text-center border-border/50 hover:shadow-md transition-shadow">
                  <CardContent className="p-8">
                    <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-primary/10 text-primary mx-auto mb-5">
                      {Icon && <Icon className="h-7 w-7" />}
                    </div>
                    <h3 className="text-lg font-semibold mb-2">{value.title}</h3>
                    <p className="text-sm text-muted-foreground leading-relaxed">{value.description}</p>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      </section>

      {/* Timeline Section */}
      <section className="py-20 bg-background">
        <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-14">
            <h2 className="text-3xl sm:text-4xl font-bold mb-4">Our Journey</h2>
            <p className="text-muted-foreground max-w-2xl mx-auto text-lg">
              Key milestones that have shaped NovaTech into the company it is today.
            </p>
          </div>
          <div className="relative">
            <div className="absolute left-8 top-0 bottom-0 w-px bg-border hidden sm:block" />
            <div className="space-y-10">
              {MILESTONES.map((m, i) => (
                <div key={m.year} className="flex gap-6 sm:gap-10">
                  <div className="relative shrink-0">
                    <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary text-primary-foreground font-bold text-sm z-10 relative">
                      {m.year}
                    </div>
                  </div>
                  <div className="pt-3">
                    <h3 className="text-xl font-semibold mb-2">{m.title}</h3>
                    <p className="text-muted-foreground leading-relaxed">{m.description}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-16 bg-accent/30">
        <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-2xl sm:text-3xl font-bold mb-4">Want to Join Our Team?</h2>
          <p className="text-muted-foreground mb-6">
            We&apos;re always looking for talented people who share our passion for technology and innovation.
          </p>
          <Button size="lg" className="gap-2" onClick={() => navigation.navigate("/contact")}>
            View Open Positions
            <Icons.ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </section>
    </div>
  );
}

export default AboutPage;
