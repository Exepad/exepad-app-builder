import {
  React,
  Icons,
} from "@exepad/sdk";

interface Testimonial {
  quote: string;
  name: string;
  role: string;
  company: string;
  rating: number;
  initials: string;
}

const TESTIMONIALS: Testimonial[] = [
  {
    quote: "LaunchPad AI cut my blog writing time in half. The tone adjustment feature is a game-changer — I can switch from casual to professional in one click.",
    name: "Sarah Chen",
    role: "Content Marketing Manager",
    company: "TechFlow Inc.",
    rating: 5,
    initials: "SC",
  },
  {
    quote: "We rolled this out to our entire content team. The collaboration features and consistent quality have transformed our workflow. Best investment we've made.",
    name: "Marcus Rodriguez",
    role: "VP of Marketing",
    company: "GrowthLab",
    rating: 5,
    initials: "MR",
  },
  {
    quote: "As a non-native English speaker, the multi-language support is incredible. I write in my language and get perfectly translated, natural-sounding content.",
    name: "Yuki Tanaka",
    role: "Freelance Copywriter",
    company: "Self-employed",
    rating: 5,
    initials: "YT",
  },
];

function TestimonialsSection() {
  return (
    <section id="testimonials" className="py-20 sm:py-28 bg-background">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        {/* Header */}
        <div className="text-center mb-16">
          <p className="text-sm font-semibold text-primary uppercase tracking-wider mb-2">Testimonials</p>
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight mb-4">
            Loved by Writers Everywhere
          </h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            See what our users are saying about how LaunchPad AI has transformed their writing workflow.
          </p>
        </div>

        {/* Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {TESTIMONIALS.map((t) => (
            <div
              key={t.name}
              className="testimonial-card rounded-xl border border-border bg-card p-6 flex flex-col"
            >
              {/* Stars */}
              <div className="flex gap-1 mb-4">
                {Array.from({ length: t.rating }).map((_, i) => (
                  <Icons.Star
                    key={i}
                    className="h-4 w-4 fill-yellow-400 text-yellow-400"
                  />
                ))}
              </div>

              {/* Quote */}
              <blockquote className="text-sm leading-relaxed text-foreground mb-6 flex-1">
                &ldquo;{t.quote}&rdquo;
              </blockquote>

              {/* Author */}
              <div className="flex items-center gap-3 pt-4 border-t border-border">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary text-sm font-semibold">
                  {t.initials}
                </div>
                <div>
                  <div className="text-sm font-semibold">{t.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {t.role}, {t.company}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export default TestimonialsSection;
