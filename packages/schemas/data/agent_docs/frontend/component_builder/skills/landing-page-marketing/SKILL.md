---
name: landing-page-marketing
description: "Marketing/SaaS landing pages — hero with primary CTA, feature grids, testimonials with name+role+metric, pricing teaser, FAQ, conversion-focused footer CTA. Load for marketing-site app types (build_mode=create with a website/marketing intent) and for any component whose role is `hero`, `features`, `testimonials`, `cta-section`, or `landing`. Keywords: landing, marketing, saas, hero, cta, testimonial, feature-grid, conversion, signup, demo-request, value-prop."
metadata:
  kind: domain
---
# Skill: Landing Page & Marketing Composition

For marketing/SaaS landing pages, conversion is the goal. Above-the-fold
content drives ~80 % of clickthrough — the hero must answer **what is
this**, **who is it for**, **why care**, and offer **one** primary CTA
in the first viewport.

This skill covers section-level composition. Header/footer chrome is
covered by [`component-header`](../component-header/SKILL.md) and
[`component-footer`](../component-footer/SKILL.md); pricing tables by
[`pricing-table`](../pricing-table/SKILL.md); multi-step forms by
[`multi-step-wizard`](../multi-step-wizard/SKILL.md).

## Section sequence (top-down)

A high-converting marketing page typically composes:

1. **Hero** — headline + subhead + primary CTA + visual.
2. **Logo strip / social proof** — 4–8 customer logos or "trusted by" line.
3. **Feature grid** — 3–6 benefit cards with icon, title, one-sentence value.
4. **Testimonials** — 1–3 customer quotes with full name, role, company, and a specific metric.
5. **Secondary CTA** — repeats the primary action mid-scroll.
6. **Pricing teaser** or full pricing table (use the `pricing-table` skill).
7. **FAQ** — 4–6 most-asked objection-handling questions.
8. **Footer CTA** — last-chance signup with the same primary action.

Render each section as a separate component when the plan calls for one;
otherwise compose top-to-bottom in a single page component.

## Hero

```tsx
<section className="px-6 py-20 md:py-32 lg:py-40">
  <div className="mx-auto max-w-6xl text-center">
    <h1 className="text-4xl md:text-6xl lg:text-7xl font-bold tracking-tight text-foreground">
      Ship faster with <span className="text-primary">{brandName}</span>
    </h1>
    <p className="mt-6 text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto">
      One clear sentence on the value. Concrete benefit. Plain language.
    </p>
    <div className="mt-10 flex flex-col sm:flex-row gap-4 justify-center">
      <Button size="lg" onClick={() => navigate('/signup')}>Get started — free</Button>
      <Button size="lg" variant="ghost" onClick={() => navigate('/demo')}>
        See a demo <Icons.ArrowRight className="ml-2 h-4 w-4" />
      </Button>
    </div>
    <p className="mt-4 text-sm text-muted-foreground">No credit card required · 14-day trial</p>
  </div>
</section>
```

Rules:
- Headline ≤ 8 words. Specific. Not "Welcome to X" or "Best Y in town".
- Subhead ≤ 18 words. Names the user benefit, not your features.
- One primary CTA (filled). One optional secondary (ghost/outline).
- Friction-reducer line under buttons ("No credit card required").
- Use `<ExepadImage keywords="..." />` for hero imagery — never invent URLs.

## Feature grid

```tsx
<section className="px-6 py-16 md:py-24 bg-muted/30">
  <div className="mx-auto max-w-6xl">
    <h2 className="text-3xl md:text-4xl font-bold text-center">Everything you need to {{verb}}</h2>
    <p className="mt-4 text-lg text-muted-foreground text-center max-w-2xl mx-auto">
      One sentence framing the feature set.
    </p>
    <div className="mt-12 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      {features.map((f) => (
        <div key={f.title} className="p-6 rounded-xl border bg-background hover:shadow-lg transition-shadow">
          <div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
            <Icons.{f.iconName} className="h-6 w-6" />
          </div>
          <h3 className="mt-4 text-xl font-semibold">{f.title}</h3>
          <p className="mt-2 text-muted-foreground">{f.description}</p>
        </div>
      ))}
    </div>
  </div>
</section>
```

Rules:
- 3, 6, or 9 features (multiples that grid cleanly at 1/2/3 cols).
- Icon + title + 1–2 sentence description per card.
- Lucide icons only via `<Icons.X />`. Never invent a custom SVG here.

## Testimonials

```tsx
<figure className="rounded-2xl border bg-background p-8">
  <blockquote className="text-lg leading-relaxed">
    "Increased email revenue by 40 % in 3 months. {brandName} took us a week to set up; the
    ROI was clear by the second campaign."
  </blockquote>
  <figcaption className="mt-6 flex items-center gap-4">
    <ExepadImage keywords="professional headshot woman" className="h-12 w-12 rounded-full object-cover" />
    <div>
      <div className="font-semibold">Jennifer Martinez</div>
      <div className="text-sm text-muted-foreground">VP Marketing, TechCorp</div>
    </div>
  </figcaption>
</figure>
```

Rules — testimonials lift conversion 18–32 % when they include all three:
- **Specific metric** ("40 % more revenue", "saved 12 hours/week").
- **Full name + role + company** — never "Sarah" or "a customer".
- **Photo** — use `<ExepadImage keywords="professional headshot ..." />`. Don't fabricate a placeholder URL.

If you don't have a real testimonial in the seed/content, generate plausible ones tied to the app's domain — never use Lorem Ipsum.

## CTA sections (mid-scroll + footer)

```tsx
<section className="px-6 py-16 bg-primary text-primary-foreground">
  <div className="mx-auto max-w-4xl text-center">
    <h2 className="text-3xl md:text-4xl font-bold">Ready to {{verb}}?</h2>
    <p className="mt-4 text-lg opacity-90">{{One sentence reinforcing benefit.}}</p>
    <Button size="lg" variant="secondary" className="mt-8" onClick={() => navigate('/signup')}>
      Get started — free
    </Button>
  </div>
</section>
```

The mid-scroll CTA repeats the **same** primary action verbatim. Don't introduce a new offer here — it dilutes attention.

## FAQ

Use the SDK `<Accordion>` component for multi-item FAQ. 4–6 questions.

```tsx
<Accordion type="single" collapsible className="mx-auto max-w-3xl">
  {faqs.map((q, i) => (
    <AccordionItem key={i} value={`q-${i}`}>
      <AccordionTrigger>{q.question}</AccordionTrigger>
      <AccordionContent>{q.answer}</AccordionContent>
    </AccordionItem>
  ))}
</Accordion>
```

Pick questions that handle the top objections — pricing, security, switching cost, support. Don't write FAQs about features that already appear above.

## Anti-patterns

- ✗ Hero with a centered purple gradient background and Inter font (the textbook "AI slop" look). Pick a deliberate aesthetic per `frontend-design` guidance — bold minimalism, editorial, or refined maximalism.
- ✗ Multiple competing CTAs above the fold ("Sign up | Try free | Watch demo | Read docs").
- ✗ Stock-photo people staring at laptops in modern offices. Pick imagery that ties to the actual product domain.
- ✗ Testimonials without metrics ("Great product, would recommend!").
- ✗ Feature cards that list inputs/properties instead of benefits ("Configurable workflows" → "Run your team's process without rebuilding it").

## When NOT to use this skill

- CRUD/dashboard apps — load `crud-data-app` instead. Marketing-page composition doesn't apply to authenticated app surfaces.
- Single-component edits inside an existing marketing page — load `component-editing` for surgical changes; this skill is for fresh composition.
