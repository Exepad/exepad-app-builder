import {
  React,
  Icons,
} from "@exepad/sdk";

interface Feature {
  icon: keyof typeof Icons;
  title: string;
  description: string;
}

const FEATURES: Feature[] = [
  {
    icon: "Wand2",
    title: "Smart Autocomplete",
    description: "AI predicts your next sentence and suggests completions as you type. Write 3x faster with context-aware suggestions.",
  },
  {
    icon: "SlidersHorizontal",
    title: "Tone Adjustment",
    description: "Switch between professional, casual, persuasive, or friendly tones instantly. Perfect for any audience.",
  },
  {
    icon: "CheckCircle",
    title: "Grammar & Style",
    description: "Advanced grammar checking with style suggestions. Goes beyond basic spell-check to improve clarity and readability.",
  },
  {
    icon: "Search",
    title: "SEO Optimization",
    description: "Built-in SEO analysis scores your content and suggests improvements for better search engine rankings.",
  },
  {
    icon: "Globe",
    title: "Multi-language",
    description: "Write and translate in 30+ languages. Create multilingual content without leaving the editor.",
  },
  {
    icon: "Users",
    title: "Team Collaboration",
    description: "Share documents, leave comments, and collaborate in real-time. Built for teams that write together.",
  },
];

function FeaturesSection() {
  return (
    <section id="features" className="py-20 sm:py-28 bg-background">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        {/* Header */}
        <div className="text-center mb-16">
          <p className="text-sm font-semibold text-primary uppercase tracking-wider mb-2">Features</p>
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight mb-4">
            Everything You Need to Write Better
          </h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            From first draft to final polish, LaunchPad AI gives you superpowers at every stage of the writing process.
          </p>
        </div>

        {/* Feature grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8">
          {FEATURES.map((feature) => {
            const FeatureIcon = Icons[feature.icon] as React.ComponentType<{ className?: string }>;
            return (
              <div
                key={feature.title}
                className="feature-card group rounded-xl border border-border bg-card p-6 hover:border-primary/30"
              >
                <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10 text-primary mb-4 group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
                  {FeatureIcon && <FeatureIcon className="h-6 w-6" />}
                </div>
                <h3 className="text-lg font-semibold mb-2">{feature.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed mb-4">
                  {feature.description}
                </p>
                <button className="text-sm font-medium text-primary hover:underline inline-flex items-center gap-1">
                  Learn more
                  <Icons.ArrowRight className="h-3.5 w-3.5" />
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

export default FeaturesSection;
