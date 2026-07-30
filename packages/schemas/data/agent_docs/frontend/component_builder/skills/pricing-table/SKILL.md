---
name: pricing-table
description: "SaaS pricing tables — 3-tier responsive layout with monthly/yearly toggle, \"most popular\" highlight, feature checkmark lists, primary CTA per tier. Load for components with role `pricing` or `plans`, or whenever a marketing/website plan calls for a pricing comparison. Keywords: pricing, plans, tiers, subscription, monthly, yearly, compare, billing-cycle, popular, recommended."
metadata:
  kind: domain
---
# Skill: Pricing Table

Standard SaaS pricing layout: three plans, "most popular" middle tier
highlighted, monthly/yearly toggle that updates each tier's price.

## Canonical structure

```tsx
const [yearly, setYearly] = useState(false);

const plans = [
  { name: 'Starter',    monthly: 0,   yearly: 0,   features: [...], cta: 'Start free',   featured: false },
  { name: 'Pro',        monthly: 29,  yearly: 23,  features: [...], cta: 'Start trial',  featured: true  },
  { name: 'Enterprise', monthly: 99,  yearly: 79,  features: [...], cta: 'Contact us',   featured: false },
];

return (
  <section className="px-6 py-16 md:py-24">
    <div className="mx-auto max-w-6xl">
      <div className="text-center">
        <h2 className="text-3xl md:text-4xl font-bold">Simple, transparent pricing</h2>
        <p className="mt-4 text-muted-foreground">Pick the plan that fits your team.</p>

        {/* billing toggle */}
        <div className="mt-8 inline-flex items-center gap-3 p-1 rounded-full bg-muted">
          <button
            className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${!yearly ? 'bg-background shadow' : ''}`}
            onClick={() => setYearly(false)}
          >Monthly</button>
          <button
            className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${yearly ? 'bg-background shadow' : ''}`}
            onClick={() => setYearly(true)}
          >Yearly <span className="ml-1 text-xs text-primary">(save 20 %)</span></button>
        </div>
      </div>

      <div className="mt-12 grid grid-cols-1 md:grid-cols-3 gap-6 md:gap-4 lg:gap-6">
        {plans.map((p) => (
          <div
            key={p.name}
            className={`relative p-6 md:p-8 rounded-2xl border bg-background ${
              p.featured ? 'border-primary ring-2 ring-primary/20 md:scale-105' : ''
            }`}
          >
            {p.featured && (
              <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-primary text-primary-foreground text-xs font-medium">
                Most popular
              </div>
            )}
            <h3 className="text-xl font-semibold">{p.name}</h3>
            <div className="mt-4 flex items-baseline gap-1">
              <span className="text-4xl md:text-5xl font-bold">
                ${yearly ? p.yearly : p.monthly}
              </span>
              <span className="text-muted-foreground">/mo</span>
            </div>
            {yearly && p.yearly < p.monthly && (
              <p className="mt-1 text-sm text-muted-foreground">
                billed annually (${p.yearly * 12}/yr)
              </p>
            )}
            <Button
              className="mt-6 w-full"
              variant={p.featured ? 'default' : 'outline'}
              onClick={() => navigate(p.name === 'Enterprise' ? '/contact' : '/signup')}
            >
              {p.cta}
            </Button>
            <ul className="mt-6 space-y-3 text-sm">
              {p.features.map((f) => (
                <li key={f} className="flex items-start gap-2">
                  <Icons.Check className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                  <span>{f}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  </section>
);
```

## Rules

- **3 tiers is the sweet spot.** 2 forces a binary choice; 4+ paralyzes — only use them if the plan explicitly demands it.
- **Middle tier is "most popular".** This is the price-anchoring sweet spot. Highlight via `border-primary` + `ring-primary/20` + a label badge above the card. On `md+` add `scale-105` to lift it visually.
- **Yearly toggle saves ~20 %.** That's the conventional discount; don't invent unrealistic discounts. The toggle changes the displayed price, not the feature list.
- **Same number of features per tier when possible.** Use `grayscale opacity-50` on features the tier doesn't include if you absolutely need to show them — usually it's cleaner to list only what's included.
- **CTA verbs differ per tier.** Free → "Start free", paid → "Start trial", enterprise → "Contact sales". Same colour scheme: featured tier gets `variant="default"`; others `variant="outline"`.
- **Every tier CTA MUST be wired.** The button is the page's whole purpose. Give it an `onClick` that `navigate`s to `/signup` (free/paid tiers) or `/contact` (enterprise) — see the canonical block above. There is NO billing/checkout integration, so the CTA routes to a signup/login/contact page; never ship a bare `<Button>{cta}</Button>` with no handler (a dead button on the one page meant to convert users).
- **Currency symbol stays small relative to the number.** `$29` reads better than `$ 29 USD/month`. Stick to the user's locale; the platform doesn't multi-currency by default.

## Anti-patterns

- ✗ Yearly toggle that changes feature lists too — confuses users; only the price should change.
- ✗ "Most popular" applied to the cheapest or most expensive tier — anchoring is broken.
- ✗ Pricing inside a vertical stack on desktop — horizontal comparison is the whole point of a pricing table.
- ✗ Slashed-out "was $X" prices unless the discount is real and time-bound. Inventing fake discounts erodes trust.
- ✗ Using a Card-component framework with rounded-3xl + dramatic shadow on every plan + pastel gradients. Looks identical to every other AI-built SaaS page.
- ✗ A bare `<Button>{tier.cta}</Button>` with no `onClick`/`navigate` — a dead CTA on the conversion page. Wire every tier button to `/signup` or `/contact`.

## Compatibility

Use SDK `<Button>` and `<Icons.Check />`. The toggle pattern uses inline state; no SDK toggle component is required (using one over-engineers a 3-line `useState`).
