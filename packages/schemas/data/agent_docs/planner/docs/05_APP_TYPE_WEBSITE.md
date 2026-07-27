# App Type Guide: Website

<!-- Schema Version: 2.0.0 | Last Updated: 2026-03-30 -->

You are planning a **WEBSITE** — a public-facing web presence optimized for content presentation and conversion (marketing sites, landing pages, portfolios, agency sites, restaurants, SaaS marketing).

Components are TSX files using Light DOM rendering (`LightDOMContainer`) with Tailwind CSS classes scoped via prefix. All imports from `@exepad/sdk`.

---

## Architecture

- **Pages:** Multi-page with logical sections (Hero, Features, Pricing, CTA, About, Contact, etc.)
- **Navigation:** `HeaderMenuTop` — top header with logo and nav links, responsive hamburger on mobile
- **Footer:** Multi-column footer with links, social, and legal info
- **Rendering mode:** `react_jsx` for all components (header, footer, content)
- **Required page:** Homepage (`/`). Privacy Policy (`/privacy-policy`) and Terms of Service (`/terms`) are added for standard multi-page sites, but OMITTED when the user requests a minimal or single-page scope.
- **Common additional pages:** About, Services, Pricing, Contact, FAQ, Features, Testimonials (only when scope is unspecified — see Respect User Scope below)

---

## Content Depth Requirements (CRITICAL)

Match the page count to the USER'S REQUEST first. Whatever pages DO exist must be rich, substantive, and professionally complete — thin or skeletal pages are unacceptable, but extra unrequested pages are equally wrong.

### Respect User Scope (REQUIRED — overrides the standard set below)
- If the user names specific pages, or asks for "one page", a "single-page"/"landing page", or a "simple" site, emit EXACTLY that set. Do NOT add pages they did not ask for (no auto Privacy/Terms/FAQ/Gallery/Testimonials).
- A one-page request → exactly ONE content page (Homepage `/`) plus header/footer; put the requested sections on that single page.
- Only when the user is vague about scope should you fall back to the standard multi-page set below.

### Standard Page Set (use ONLY when the user did not specify scope)
- **At least 6 content pages** (excluding Privacy Policy and Terms of Service)
- **Typical core:** Homepage + About + Services/Products + Contact
- **Add 2-3 more** domain-appropriate pages: Testimonials, Team, FAQ, Pricing, Portfolio, Case Studies, Careers, Gallery, Partners
- Privacy Policy and Terms of Service are added on top of the content pages — but NOT for a user-requested minimal/single-page scope

### Minimum Sections Per Page

| Page Type | Minimum Sections | Examples |
|-----------|-----------------|----------|
| **Homepage** | **5-7 sections** | Hero, Stats/Social Proof, Features, Testimonials, How-It-Works, FAQ, CTA |
| **About** | **3-4 sections** | Mission/Story, Team, Values/Culture, CTA |
| **Services / Products** | **3-4 sections** | Overview, Service Grid, Process, CTA |
| **Pricing** | **3 sections** | Overview, Pricing Tiers, FAQ or Comparison, CTA |
| **Contact** | **2-3 sections** | Contact Info, Form, FAQ or Map |
| **FAQ** | **2 sections** | Intro, Accordion Groups |
| **Testimonials** | **2-3 sections** | Intro, Testimonial Grid/Carousel, CTA |
| **Team / People** | **2-3 sections** | Intro, Team Grid, CTA |
| **Privacy Policy** | 1 section | Legal text (OK to be minimal) |
| **Terms of Service** | 1 section | Legal text (OK to be minimal) |

**Rules:**
- NEVER create a content page with only 1 section (except Privacy/Terms)
- Every content page SHOULD end with a CTA or next-step section
- Homepage is the MOST important — must make a strong first impression

---

## Homepage Composition

The homepage should have 5-7 sections that create a compelling first impression. Choose and combine section types creatively — do NOT follow a fixed template. Every homepage should feel unique.

**Section types to draw from** (pick, combine, reorder — none are mandatory):
- **Hero / Opening** — Could be a bold headline, an interactive demo, a video, a fullscreen image, an animated illustration, or a product screenshot. NOT always "large headline + dual CTA."
- **Social Proof** — Stats, client logos, trust badges, case study snippets, press mentions
- **Features / Services** — Cards, split layouts, icon grids, comparison tables, interactive demos
- **Testimonials / Reviews** — Quotes, video testimonials, star ratings, case studies
- **How It Works** — Steps, timeline, animated walkthrough, interactive diagram
- **CTA / Conversion** — Newsletter signup, free trial, pricing preview, contact form
- **FAQ** — Collapsible questions, search-enabled, categorized
- **Gallery / Portfolio** — Image grids, project showcases, before/after comparisons
- **Pricing Preview** — Compact tier comparison, "starting at" pricing

Be creative with layout — NOT every homepage needs Hero → Features → Testimonials → CTA. A portfolio might open with a gallery. A SaaS app might lead with an interactive demo. A consultancy might open with a case study.

---

## Inner Page Guidelines

(Applies when the site has multiple pages. For a user-requested single-page site, put these section concepts on the one homepage instead of creating extra pages.)

Each inner page should have 2-4 meaningful sections. The content and layout should match the page's purpose — there is no fixed template. Be creative with section composition and layout.

**Minimum section counts by page type:**
- About: 3 sections
- Services/Products: 3 sections
- Pricing: 2 sections
- Contact: 2 sections

Design each page to feel intentional and unique. An About page doesn't always need a team grid. A Services page doesn't always need a process timeline. A Contact page could be a single elegant form with no surrounding content.

---

## Design Best Practices

### Visual Hierarchy
- Each page should have exactly one `<h1>` (page title in hero)
- Use `<h2>` for section headings, `<h3>` for card titles and subsections

### Spacing & Rhythm
- Vary vertical padding between sections — monotonous spacing looks flat
- Minimum gap between cards: `gap-4` or `gap-6`

### Text on Dark Backgrounds
- When using dark section backgrounds, ensure all text uses light `on-*` color tokens
- NEVER use mid-gray text on dark backgrounds — fails contrast requirements

### CTA Design
- Use action verbs: "Start Free Trial", "Get Your Quote", "View Our Work"
- Avoid generic: "Click Here", "Submit", "Learn More"

### Image Usage
- Icons.* (lucide-react) are better for feature cards than placeholder images
- Background images need overlay for text readability
- All images need descriptive alt text

---

## Form Handling

**Route all data-collection form submissions to a backend model via `useModel().create()`.**

Each form type below needs a model in `app_backend_plan.models` whose columns match the form fields (set `backend_needed: true`):

| Form Type | Backend Config? |
|-----------|-----------------|
| Contact form | Yes — model + `useModel().create()` |
| Newsletter signup | Yes — model + `useModel().create()` |
| Feedback / survey | Yes — model + `useModel().create()` |
| Event registration | Yes — model + `useModel().create()` |
| Job application | Yes — model + `useModel().create()` |

Also plan backend models/handlers for any CRUD entities (product catalog, user profiles).

---

## Backend Rule

- **Default:** `backend_needed: false` for pure content/marketing sites with no data collection
- **Set `true`** when the site has any data-collection form (contact, newsletter, registration, etc.), CRUD entities, or custom business logic — each data-collection form needs a model to receive submissions

---

## Website Archetype Guidance

Different website categories have different content needs. Use these as **starting points for page planning**, NOT fixed templates — reorder, combine, and invent sections freely.

- **B2B / Consulting** — Focus on trust and expertise. Pages: services, case studies, team, contact
- **SaaS / Product** — Focus on features and conversion. Pages: features, pricing, how-it-works, FAQ
- **Portfolio / Creative** — Focus on showcasing work. Pages: portfolio/gallery, about, process, contact
- **Local Business** — Focus on atmosphere and accessibility. Pages: menu/services, gallery, reviews, location
- **E-commerce / Landing** — Focus on product benefits and social proof. Pages: products, comparison, FAQ

---

## Things to Avoid

- **Sidebar navigation** — use HeaderMenuTop for websites
- **Complex state management** — websites are mostly static content
- **Thin pages with only 1 section** — aim for 2+ sections per page
- **Dashboard components (charts, data tables, KPIs)** — not appropriate for marketing sites
