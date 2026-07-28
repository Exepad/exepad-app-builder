---
name: animation-motion
description: "Animation patterns — SDK Motion / FadeIn / SlideUp / Reveal / AnimatePresence, spring/duration configs, scroll-triggered reveals, hover micro-interactions, page transitions, stagger choreography. Load when a component plan asks for motion, transitions, scroll effects, or polish beyond static layout. Skip for back-office/dataapp components where static is preferred. Keywords: animation, motion, transition, framer-motion, fade, slide, reveal, scroll-reveal, stagger, spring, hover, parallax, page-transition."
metadata:
  kind: domain
---
# Skill: Animation & Motion

Motion adds delight to marketing pages and onboarding; over-applied to
dataapps it gets in the user's way. Use the SDK's motion primitives
sparingly — one well-orchestrated reveal beats fifty fidgety ones.

## SDK motion primitives

```tsx
import {
  Motion,           // direct framer-motion equivalent: <Motion.div animate={...} />
  FadeIn,           // wraps children with mount-time fade
  SlideUp,          // mount-time fade + 20px slide up
  Reveal,           // scroll-triggered fade + slide
  AnimatePresence,  // exit animations on unmount
} from "@exepad/sdk";
```

| Primitive | Use for |
|-----------|---------|
| `<FadeIn delay={0.1}>` | Single element appears on mount |
| `<SlideUp delay={0.1}>` | Hero text / CTA appears |
| `<Reveal>` | Section reveals as user scrolls into view |
| `<Motion.div animate={...}>` | Custom animation — direct framer access |
| `<AnimatePresence>` | Exit transitions (modal close, tab switch) |

Default to the named helpers (`FadeIn`, `SlideUp`, `Reveal`) — they
encode the right defaults (duration 300 ms, ease-out, 20-px translation)
and stay consistent across the app.

## Pattern 1 — staggered hero entrance

```tsx
<section className="px-6 py-20 text-center">
  <SlideUp delay={0.0}>
    <h1 className="text-5xl md:text-7xl font-bold">{headline}</h1>
  </SlideUp>
  <SlideUp delay={0.1}>
    <p className="mt-6 text-lg text-muted-foreground">{subhead}</p>
  </SlideUp>
  <SlideUp delay={0.2}>
    <div className="mt-10">
      <Button size="lg">{cta}</Button>
    </div>
  </SlideUp>
</section>
```

Rules:
- **0.1 s stagger between siblings.** Tighter feels rushed; wider feels
  laggy.
- **Cap at 4–5 staggered elements.** Beyond that the user has waited
  too long to interact.
- **Stagger only on first paint.** Subsequent renders should be
  instant — `<SlideUp>` only animates on mount.

## Pattern 2 — scroll-triggered reveal

```tsx
<Reveal>
  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
    {features.map((f) => (
      <FeatureCard key={f.id} {...f} />
    ))}
  </div>
</Reveal>
```

For staggered children inside a single `<Reveal>`:

```tsx
<Reveal stagger={0.08}>
  {features.map((f) => <FeatureCard key={f.id} {...f} />)}
</Reveal>
```

`Reveal` uses an IntersectionObserver internally — fires once when the
element first enters the viewport (default threshold 0.2). Doesn't
re-fire on scroll back up.

## Pattern 3 — hover micro-interactions (CSS only)

For card hover, button press feedback, link underline animation —
**CSS transitions, not framer-motion**:

```tsx
<div className="rounded-xl border bg-background p-6 transition-all hover:shadow-lg hover:-translate-y-0.5">
  ...
</div>

<a className="relative after:absolute after:left-0 after:bottom-0 after:h-px after:w-full after:origin-left after:scale-x-0 after:bg-primary after:transition-transform hover:after:scale-x-100">
  Link
</a>
```

Tailwind utilities cover 90 % of micro-interactions:
- `transition-colors` for colour changes
- `transition-transform hover:scale-105` for slight lift
- `transition-shadow hover:shadow-lg` for elevation
- `transition-opacity` for fade in/out

## Pattern 4 — exit animations

For modals, tabs, dynamic lists — wrap with `<AnimatePresence>`:

```tsx
<AnimatePresence mode="wait">
  {open && (
    <Motion.div
      key="overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
    >
      {children}
    </Motion.div>
  )}
</AnimatePresence>
```

The Radix `<Dialog>`, `<Sheet>`, `<Popover>` already include exit
animations — don't re-wrap.

## Performance rules

- **Animate transform / opacity only** at high frequency. `top`,
  `left`, `width`, `height` trigger layout — drops frames on
  list-heavy pages.
- **Cap concurrent animations.** Don't animate 100 list items
  simultaneously — stagger entry, then commit them static.
- **Respect `prefers-reduced-motion`.** All SDK motion primitives
  honour this automatically (animation degrades to instant when the
  user opts out at OS level).

For custom CSS animations:

```css
@media (prefers-reduced-motion: reduce) {
  * { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; }
}
```

## Spring vs duration

| Option | Use for |
|--------|---------|
| `transition={{ duration: 0.2, ease: 'easeOut' }}` | UI fades, opacity, simple translates |
| `transition={{ type: 'spring', stiffness: 300, damping: 30 }}` | Drag-and-drop, draggable elements that need overshoot |

Default to duration-based ease-out for content. Spring physics belongs
on objects that simulate real movement (game pieces, drag previews,
pull-to-refresh).

## Pattern 5 — "where motion adds value vs. AI slop"

**Where motion EARNS its keep:**
- Hero entrance on landing pages (sets brand tone).
- Modal open/close (signals state change; helps a11y by drawing attention).
- Drag-and-drop feedback (essential for reorderable lists).
- Empty-state illustrations (subtle bounce on the icon adds warmth).
- Loading-state skeletons (`animate-pulse`).

**Where it's noise (skip):**
- Every card on hover bouncing 8 px and adding a glow. Pick one or
  none.
- Animated counters that count up from 0 to 1247 over 2 seconds.
  Distracting.
- Gradient backgrounds that animate continuously. Battery drain, no
  user value.
- "Slide-in from off-screen" on every dataapp form. Static is faster.
- Confetti on every save. Pick a moment that matters.

## Anti-patterns

- ✗ `setInterval` for animation. Use `requestAnimationFrame` or, better,
  framer-motion / CSS transitions.
- ✗ Animating `box-shadow` on every frame. Triggers paint; use
  `transform` and a pre-rendered shadow layer if needed.
- ✗ Animating `width: 0 → 300px` for slide-in panels. Animate
  `transform: translateX(-100%) → 0` instead.
- ✗ Long entry animations (>500 ms). Above 300 ms users feel
  artificial delay.
- ✗ Bouncy spring physics on every UI element. Springs are great for
  one or two highlight elements; ubiquitously they make the app feel
  jelly.
- ✗ Forgetting `<AnimatePresence>` on conditional render. Element snaps
  out without exit animation.

## Compatibility

`@exepad/sdk` re-exports `motion` (as `Motion`), plus the
opinionated `FadeIn`, `SlideUp`, `Reveal`, `AnimatePresence` helpers.
Don't import from `framer-motion` directly — the SDK wraps for
`prefers-reduced-motion` and bundle stability.
