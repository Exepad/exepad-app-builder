# Form App Research: Design Patterns, UX Best Practices & User Expectations

## Implementation Status

This research has informed the following implemented features in the Exepad platform:

| Research Finding | Implementation Status | Component/Feature |
|-----------------|----------------------|-------------------|
| **Multi-step wizard** (86% higher conversion) | Implemented | `FormAction.nextStep` / `FormAction.prevStep`, `StepperProps` |
| **Conversational forms** (40% higher completion) | Implemented | `ConversationalFormProps` component |
| **Conditional field visibility** | Implemented | `visibilityCondition` on all form fields |
| **Two-way state binding** | Implemented | `bindTo` prop on form fields |
| **Autocomplete with async loading** | Implemented | `AutocompleteProps` component |
| **Date range selection** | Implemented | `DateRangePickerProps` component |
| **Quiz/assessment forms** | Implemented | `QuizFormProps` + `QuizQuestionFieldProps` |
| **Form submission to backend** | Implemented | `useModel('<model>').create()` writing to a user-defined backend model |
| **Inline validation** | Implemented | Validation rules (required, minLength, pattern, etc.) |
| **WCAG AA contrast** | Implemented | Auto-contrast pipeline in `useComponentStyles` |

Patterns still in research/aspirational stage: dynamic field generation based on responses, progressive form reveal, answer piping variables.

---

## Context

Research into how form apps (Typeform, Jotform, Google Forms, Tally, Fillout, SurveyMonkey) work, their visual designs, layout structures, user expectations, and best practices — to inform Exepad's form rendering capabilities.

---

## 1. How Major Form Apps Work

### Typeform — Conversational, One-Question-at-a-Time
- Full-screen single question per page with large, readable fonts
- Smooth CSS3 slide transitions between questions (respects `prefers-reduced-motion`)
- Progress is implicit through question sequence
- 23 question types, media library (Unsplash/Pexels), brand kits
- **Impact:** 40% higher completion rate vs traditional forms
- **Limitation:** Most restrictive free tier (10 submissions/month); locked to one-question-per-page

### Jotform — Multi-Field Drag-and-Drop + Card Mode
- Three-column drag-and-drop builder (Basic, Payments, Widgets)
- Two distinct layouts: **classic multi-field** and **card forms** (one-question-at-a-time)
- Card forms support multi-line questions (multiple questions per card)
- Bright colors, cartoonish graphics — functionality over aesthetics
- Most feature-rich free tier (1,000+ submissions)

### Google Forms — Sectioned Linear Forms
- Multi-field single-page scrolling with section headers (page breaks)
- Linear scales for surveys (1-5, 1-10)
- Conditional branching routes respondents to different sections
- Minimalist, functional design; unlimited submissions
- Strong academic and enterprise adoption

### Tally.so — Notion-Like Document Builder
- Type directly on page using Notion-like slash commands
- Document-like flow (natural reading/writing experience)
- Conditional logic, calculator, answer piping
- Forever-free: unlimited forms, unlimited submissions
- Native Notion integration (direct database sync)

### Fillout — Modern AI-Powered Builder
- Compact drag-and-drop with AI form generation from text prompts
- AI adapts form design to match uploaded brand assets
- Clean modern aesthetic, UX-focused builder
- 1,000 responses/month free, unlimited forms

### SurveyMonkey — Enterprise Survey Platform
- 25+ question types (matrices, ranking, NPS)
- "Build with AI" trained in survey science
- Professional distribution and analytics
- 200+ business integrations

---

## 2. Layout Approaches Compared

| Layout | Best For | Completion Rate | Pros | Cons |
|--------|----------|----------------|------|------|
| **One-question-per-page** | Mobile, engagement, short-medium forms | ~40% higher than traditional | Mobile-native, engaging, reduced cognitive load | Feels slow for simple forms |
| **Multi-field single-page** | Simple forms, quick data collection | ~4.53% | See full form, fast for short forms | Overwhelming for long forms |
| **Multi-step wizard** | 6+ field forms, complex flows | ~13.85% (86% higher than single-page) | Balance of engagement + efficiency | More complex to build |
| **Card-based sections** | Medium-long forms | High | Progressive disclosure, clean grouping | Requires navigation design |
| **Accordion/collapsible** | Long forms with logical groups | Moderate | Users see only relevant sections | Can hide important fields |

### Key Statistics
- Multi-step forms: **86% higher conversion** than single-step
- Short forms (1-5 fields): 89% completion average
- 6+ fields: drops to **15% on single-page** vs **71% multi-step**
- Progress indicators boost completion by **43%**
- Reducing fields from 11 to 4: **120% conversion increase**

---

## 3. Form Component Anatomy

### Structure (top to bottom)
1. **Header** — Form title, optional description, breadcrumb/step indicator
2. **Section groups** — Related fields grouped with visual separators (spacing, dividers, cards)
3. **Field** — Label (above) + input + helper text + error message
4. **Action area** — Primary button (Submit/Next) + secondary (Back/Cancel)
5. **Footer** — Legal text, privacy links, security assurances
6. **Completion page** — Thank you message, confirmation details, next steps, CTA

### Progress Indicators
- **Progress bar** — Visual percentage complete
- **Step numbers** — "Step 2 of 5"
- **Stepper component** — Shows current/completed/upcoming steps
- Horizontal steppers for desktop, vertical for mobile

---

## 4. Field Design Best Practices

### Label Placement
- **Above the field (BEST)** — Fastest completion times, best readability, least visual distance
- **Left-aligned** — Slowest completion; only use when you want users to read carefully
- **Inline/floating** — Avoid; labels disappear when typing, accessibility problems
- Single-column forms completed **15.4 seconds faster** than multi-column (Baymard Institute)

### Input Sizing
- Match field width to expected content length (short for zip codes, long for addresses)
- Minimum touch target: **44x44px** (WCAG AA) / **48x48px** (Google recommendation)
- Minimum input height: **34px** (Bootstrap standard)
- Minimum text size on mobile: **16px** (prevents unwanted zoom)
- Standard field widths: 75px, 150px, 250px, 350px, 500px (Atlassian)

### Placeholder Text — Avoid as Labels
7 usability problems identified (Nielsen Norman Group):
1. Strains short-term memory when text disappears
2. Prevents verification before submission
3. Makes error recovery difficult
4. Breaks keyboard navigation
5. Makes populated fields less noticeable
6. Confused with pre-filled data
7. Default gray color fails WCAG contrast guidelines

**Best practice:** Always use persistent, visible labels. Placeholders only for supplementary hints.

### Required vs Optional Fields
- Mark required fields with asterisk (*) or "(required)" text
- When most fields are required, mark optional ones with "(optional)" instead
- When only optional fields were marked, **32% of users had validation errors** (NNG)

### Field States (CSS)
- `:hover` — Background/border color change
- `:focus` — Outline, border, or box-shadow (critical for accessibility)
- `:active` — Press feedback
- `:focus-visible` — Keyboard-only focus styling
- Visible focus states increase completion rates by up to **30%**

---

## 5. Validation & Error Handling

### When to Validate
- **Inline after blur** — Validate when user leaves field (not while typing)
- **On submit** — For required field checks and cross-field validation
- **Debounced server checks** — For uniqueness validation (email, username)
- Delay screen reader announcements by ~500ms

### Error Message Design (Nielsen Norman Group's 10 Guidelines)
1. Inline validation — fix errors immediately without returning to fields
2. Success indicators — show positive feedback for complex fields
3. Adjacent placement — error messages directly next to field (below)
4. Color coding — Red (errors), Orange (warnings), Green (success)
5. Visual markers — Icons + subtle animations
6. Avoid modal dialogs — don't interrupt workflow
7. Wait for completion — don't show errors while typing
8. Don't rely on summary-only — include inline messages
9. Don't use tooltips — errors always visible
10. Escalate — if same error 3+ times, provide extra help

### Error Message Content
- Explicit, human-readable, polite, precise, constructive
- Name the problem clearly and explain how to fix it
- Never blame the user; avoid jargon
- Example: "Please enter a valid email address (e.g., name@example.com)"

---

## 6. Mobile Form Design

### Touch Targets & Sizing
- Minimum: 44x44px (Apple) / 48x48px with 8px spacing (Google)
- Numeric keyboard provides **521% larger hit area** than standard keyboard

### Keyboard Optimization
- `type="email"` — email keyboard
- `type="tel"` — phone keyboard
- `type="number"` — numeric keyboard
- `type="date"` — native date picker

### Mobile Layout Rules
- **Always single-column** on mobile
- Vertical stacking of all elements
- Text minimum 16px (prevents zoom)
- Primary actions in bottom third of screen (thumb-friendly)
- Support browser autofill
- Test on actual devices, not just responsive simulators

### Mobile Performance Gap
- Desktop: 55.5% starter-to-completion
- Mobile: 47.5% starter-to-completion
- 8% performance delta — mobile forms need extra optimization

---

## 7. Conversion Optimization

### What Causes Abandonment
| Factor | Impact |
|--------|--------|
| Form too long/complicated | #1 reason overall |
| Password field | 10.5% abandonment (highest single field) |
| Security concerns | 29% cite this |
| Form length | 27% cite this |
| Phone number field | 5% conversion reduction |
| Street address | 4% conversion reduction |
| Age field | 3% conversion reduction |

### What Increases Completion
| Strategy | Impact |
|----------|--------|
| Multi-step layout | Up to **300%** higher conversion |
| Reducing fields (11→4) | **120%** increase |
| Progress indicators | **43%** increase in completion |
| Real-time feedback | **22%** reduction in abandonment |
| Trust badges | **16%** overall conversion increase |
| Personalized CTAs | **202%** better than generic |
| Conversational format | **40%** higher completion |

---

## 8. Accessibility Requirements (WCAG AA)

### Color Contrast
- Normal text: **4.5:1** ratio minimum
- Large text: **3:1** minimum
- UI components (borders, buttons): **3:1** minimum

### Keyboard Navigation
- All form elements focusable via Tab
- Logical tab order (top-to-bottom)
- No keyboard traps
- Visible focus indicators
- Shift+Tab for reverse navigation

### ARIA & Screen Readers
- `<label for="fieldId">` with matching input `id`
- `aria-describedby` for helper/error text
- `aria-required="true"` for required fields
- Error messages announced properly
- Semantic HTML (`<form>`, `<label>`, `<input>`, `<fieldset>`, `<legend>`)

### Other
- Don't rely on color alone (use icons, text, symbols)
- Support zoom/text enlargement
- Proper heading hierarchy
- Sufficient spacing between clickable elements

---

## 9. Typography & Spacing System

### 8-Point Grid
- All spacing in multiples of 8px
- 4-point baseline grid for fine-tuning typography

### Recommended Spacing
| Element | Spacing |
|---------|---------|
| Between form fields | 16-24px |
| Between sections | 32-48px |
| Label to input | 4-8px |
| Error text below field | 8px |
| Helper text below label | 4-8px |
| Button top margin from last field | 24-32px |
| Icon + text gap | 8-12px |

### Typography
- Body text: 14-16px, line-height 1.5x
- Headings: 1.2-1.3x line-height
- Optimal line length: 40-60 characters
- Sans-serif fonts preferred for web
- 2-3 font families maximum

---

## 10. Design System Patterns (Industry Reference)

### Stripe Checkout
- Single-column vertical flow, no pop-ups, no hard-to-tap dropdowns
- Field ordering: Contact → Shipping → Billing → Payment
- Only ask necessary fields; hide optional behind toggles
- Trust signals: lock icon, security messaging

### Atlassian
- Left-aligned labels above fields
- Standardized field widths (75/150/250/350/500px)
- Primary button left-aligned with form
- Blue highlight on active input focus

### shadcn/ui (our pattern)
- Field component = label + control + description + message
- React Hook Form + Zod validation
- onBlur for text fields, onSubmit for complex rules
- Move focus to first invalid field on submit
- 44px+ touch targets
- Avoid side-by-side small inputs on phones

---

## 11. Completion / Thank You Pages

### Must-Have Elements
- Clear "thank you" / success confirmation
- Recap of what was submitted (order #, name, etc.)
- Clear next steps ("Check your email", "We'll contact you within 2 days")
- Primary CTA for next action
- Never auto-redirect without user action

### Design
- 4-5 lines maximum
- Clean layout with breathing room
- Optional: social sharing, download buttons, related content

---

## 12. Conditional Logic & Branching

### Types
- **Show/Hide** — Reveal/conceal fields based on conditions
- **Branching** — Route to different form paths
- **Skip Logic** — Skip questions/sections based on answers
- **Calculated Fields** — Auto-populate based on responses
- **Personalized Messages** — Change completion messages based on answers

### Benefits
- Only relevant questions shown → higher completion
- Reduced perceived form length
- Better data quality (no unnecessary data collected)
- Personalized experience

---

---
---

# DEEP-DIVE: Multi-Step Wizard Forms

## Stepper Design Patterns

### Horizontal vs Vertical Steppers
- **Horizontal:** Best for desktop, short linear flows (3-5 steps), limited label text
- **Vertical:** Best for mobile, longer forms, steps with nested content, form-heavy content
- **Mobile compact:** Dot indicators for few steps, progress bars for many/dynamic steps

### Linear vs Non-Linear Navigation
- **Linear:** Steps must complete in order; next step disabled until current validates. Best for sequential processes (checkout, applications)
- **Non-Linear:** Users can jump to any step freely. Best for surveys, optional onboarding, multi-section forms where order doesn't matter

### Step States
| State | Visual | Behavior |
|-------|--------|----------|
| **Active/Current** | Primary accent color circle, bold label | User editing this step |
| **Completed** | Green/primary circle with checkmark | Can click to revisit |
| **Upcoming** | Light gray circle with number | Disabled in linear mode |
| **Disabled** | Very light gray, cursor: not-allowed | Cannot access yet |
| **Error** | Red circle with warning icon | Validation failed on step |

### Progress Indicator Types
| Type | Best For |
|------|----------|
| Numbered steps with labels | Most forms — clear step names |
| Progress bar | Many steps or dynamic insertion |
| Dots | 3-5 steps, mobile compact |
| Text-only ("Step 2 of 4") | Minimal UI |
| Breadcrumbs | **Do NOT mix** with progress trackers (causes confusion) |

## Step Validation & Navigation

### Per-Step Validation (Recommended)
- Validate only current step fields when "Next" is clicked
- If fails: show inline errors, prevent navigation, keep user on step
- If passes: store step data, move to next step
- **Never validate all at end** — users discover errors after completing multiple steps (high abandonment)

### Editing Previous Steps
- Users can click Back button or click completed step in stepper
- Previous data preserved; fields repopulate
- Don't re-validate on revisit unless upstream changes invalidate data

### Draft/Autosave
- Save after each step completion or at intervals (30s)
- Store in localStorage (single-device) or server (multi-device)
- Clear on final submission
- **Reduces abandonment by up to 30%**

### Browser Back Button
- Use `history.pushState()` for each step change
- Listen to `window.onpopstate` to restore step state
- Best: URL-based routing synced with component state (`/form?step=2`)

## State Management

### Recommended Pattern: React Hook Form + Zustand
```
User Input → Zod Validation → React Hook Form → Zustand Store → localStorage
```
- RHF handles form state + validation per step
- Zustand manages global state across steps
- Zod provides runtime validation
- localStorage persists for draft/resume

### Alternative: FormProvider + useFormContext
- Wrap entire wizard in FormProvider
- All steps access form via useFormContext hook
- No global state manager needed
- All data available on final submit

### Conditional Steps
- Calculate visible steps based on previous answers
- Update steps array dynamically
- Example: "Do you have a car?" → Yes → show car damage step → No → skip to property step

### URL-Based vs State-Based Steps
- **URL-based** (`/form/step/1`): Browser back works, bookmarkable, more robust
- **State-based:** Simpler, but browser back doesn't work
- **Hybrid (best):** Sync component state with URL via `useSearchParams`

## Animations & Transitions

### Transition Types
- **Slide left/right:** Direction indicates navigation. 300-400ms. Framer Motion `x` property
- **Fade in/out:** Smoother, less disruptive. 300-500ms. Opacity 0↔1
- **Height animation:** Content container animates as step content changes
- **Stagger effects:** Form fields appear sequentially within a step

### Framer Motion Pattern
```jsx
<AnimatePresence mode="wait">
  <motion.div
    key={currentStep}
    initial={{ opacity: 0, x: 100 }}
    animate={{ opacity: 1, x: 0 }}
    exit={{ opacity: 0, x: -100 }}
    transition={{ duration: 0.3 }}
  />
</AnimatePresence>
```

### Reduced Motion
- Detect `prefers-reduced-motion` media query
- Disable/simplify all animations for those users
- Ensure transitions don't break functionality

## Design Specifications

### Sizing
| Element | Size |
|---------|------|
| Stepper height | 48-56px |
| Step circle diameter | 32-40px |
| Connector line width | 2-4px |
| Gap between steps | 8-16px |
| Button height | 40-44px |
| Button min-width | 100px |
| Button padding | 12px 24px |
| Content area padding | 32-48px (desktop), 16-24px (mobile) |
| Form container max-width | 500-600px |

### Button Placement
- Back button to left of Next (not to the right)
- 8px between primary and secondary buttons
- Bottom sticky on mobile (fixed to viewport bottom)
- Only 1 primary action per step

### Typography
| Element | Size | Weight |
|---------|------|--------|
| Step labels | 14-16px | 500 (active), 400 (others) |
| Step content heading | 24-28px | 600-700 |
| Field labels | 14px | 400 |
| Helper text | 12-13px | 400 |
| Error messages | 12-13px | 400 |

## Anti-Patterns to Avoid
- **Too many steps:** Max 4-5 steps. 7+ feels clunky, increases abandonment
- **Too many fields per step:** Max 5 fields per step
- **End-only validation:** Always validate per-step
- **Premature validation:** Don't show errors on focus/keystroke — validate on blur or Next click
- **No progress indicator:** 24% abandon due to unclear completion status
- **No save/draft:** Long forms need pause-and-resume capability
- **Missing back navigation:** Users must be able to review/edit previous steps
- **Mixing breadcrumbs with steppers:** Causes cognitive overload

---
---

# DEEP-DIVE: Conversational Forms (Typeform-Style)

## Core Interaction Pattern

### One-Question-at-a-Time Mechanics
- Full-screen: single question fills viewport, distraction-free focus
- Each question gets maximum screen real estate with large, readable fonts
- Inspired by "War Games" movie — conversational dialogue feel, not formal questionnaire

### Navigation Modes
- **Auto-advance:** After single-select or rating — advances automatically (no Next button needed)
- **Manual Next button:** For text inputs, uploads, date pickers, multi-select
- **Hybrid (best):** Auto-advance for obvious selections, manual for complex inputs

### Keyboard Navigation
| Key | Action |
|-----|--------|
| Enter | Submit text input / advance to next question |
| Tab | Move focus between interactive elements |
| Shift+Tab | Reverse focus navigation |
| Arrow keys | Navigate between options (radio, rating, multi-select) |
| Space | Select focused option |
| Letter shortcuts | Jump to option starting with that letter (optional) |

### Multi-Field Questions
- **Sequential (purest):** Show first+last name on separate screens
- **Combined (practical):** Show related fields together on one screen (first+last name as one "question")
- Best practice: Keep related fields together when they form a logical unit

### Navigation Type
- **Click-based (standard):** Click "Next" or select option to proceed. Previous questions exit view
- **Scroll-based (rare):** Scroll down to see more. Less common in modern conversational forms
- **Touch gestures (mobile):** Swipe up = next, swipe down = previous. Requires visual affordance

## Question Types & UX

### Welcome/Intro Screen
- Large friendly greeting + form title/description
- No input field. Sets tone and manages expectations
- Auto-advance after 2-3s or on click

### Text Inputs
- **Short text:** Single-line, Enter key advances. Character limit indicator if applicable
- **Long text:** Multi-line textarea, separate Next button. No character limit or generous (500+)
- **Email:** Email validation on blur. Mobile shows email keyboard with @ key
- **Phone:** International dialing code selector. Auto-formatting. Number pad on mobile
- **Number:** Numeric input with optional +/- spinners. Range validation

### Selection Types
- **Single select (large button cards — recommended):** Full-width or large cards (60-80px height). 2-5 options. Auto-advance on selection
- **Single select (radio):** Traditional small circles. Space-efficient for 6+ options
- **Multi-select (checkboxes):** Individual selectable items. Vertical layout
- **Multi-select (tags/chips):** Clickable tags, modern feel, great for mobile. Wrap to multiple lines
- **Dropdown:** Space-efficient but **not recommended** for conversational forms (breaks flow)

### Rating Scales
- **NPS (0-10):** Horizontal layout with numbers, large touch targets
- **Stars (1-5):** Click to select, hover effects. Common for satisfaction
- **Emoji/smiley (5-7):** Visual scale sad→happy. Most engaging. Best for simple surveys
- **Likert (1-5 or 1-7):** "Strongly Disagree" → "Strongly Agree". Buttons for each option
- Best practice: Limit to 5 options for conversational forms (faster decisions)

### Special Types
- **Date/time:** Native picker or calendar. Preset options ("Today", "Tomorrow"). Confirm in plain language
- **File upload:** Large drag-and-drop zone. Preview with name/size/thumbnail. Progress bar during upload. One file at a time
- **Payment:** Auto-formatted card input. Card type detection. CVV + expiry separate
- **Ranking/ordering:** Drag items to reorder or use up/down arrows
- **Matrix/grid:** **Break into sequential questions** for conversational forms — one row at a time
- **Statement (no input):** Legal disclaimers, educational slides, progress milestones. Auto-advance or click

### Thank You/Ending Screen
- Confirmation message + optional confetti (with reduced-motion alternative)
- Customizable branding + image
- CTA: "View results", "Download report", "Return home"
- Personalization: "Thanks, {name}! We'll be in touch."
- Optional: time taken ("Completed in 2m 34s")

## Visual Design Specifications

### Typography
| Element | Desktop | Mobile |
|---------|---------|--------|
| Question text | 28-36px, bold | 24-28px, bold |
| Helper/instruction text | 14-16px, 60% opacity | 14-16px |
| Option/label text | 16-18px | 16-18px |
| Error/validation text | 12-14px | 12-14px |

### Spacing
| Element | Spacing |
|---------|---------|
| Question to input field | 20-30px |
| Input to helper text | 10-15px |
| Between options | 12-20px (larger for cards) |
| Below options to Next button | 30-40px |
| Side padding (mobile) | 20-30px |
| Side padding (desktop) | 40-60px |
| Content max-width | 500-600px |

### Option Button Cards
- Height: 60-80px
- Padding: 15-20px
- Border: 2px solid (light gray default, brand color selected)
- Border-radius: 8-12px
- Hover: background lightens or border highlights
- Selected: border/background changes to brand color, checkmark appears
- Transition: 200-300ms

### Screen Layout
- Center content horizontally AND vertically (`display: flex; justify-content: center; align-items: center; min-height: 100vh`)
- Question text: top 20-30% of visible area
- Input/options: middle 40-50%
- Next button: bottom 10-20%
- Progress bar: top 2-5%

### Backgrounds
- **Solid color (recommended):** Clean, professional, accessible
- **Subtle gradient:** Dynamic feel, vertical top-to-bottom
- **Image/video:** Full-screen with text overlay for readability
- Always ensure 4.5:1 contrast ratio for text (WCAG AA)

## Transitions & Animations

### Between Questions
- **Slide up/down:** Current slides out, next slides in. 300-500ms. Sense of progression
- **Fade in/out:** Opacity 0↔1. 300-500ms. Smoother, less jarring
- **Slide + fade combo:** Most polished. Professional feel

### Micro-Interactions
- **Typewriter effect:** Question text appears letter-by-letter (0.05-0.1s per character). Adds personality. Skip on click. Not for serious forms
- **Option stagger reveal:** Options appear one-by-one (100ms delay between each). 200-400ms total
- **Button press:** Scale to 102-105% on click. 100-200ms
- **Selection highlight:** Border/background color change + checkmark scale animation. 200ms
- **Input focus:** Subtle box-shadow glow in brand color. Immediate or 100ms fade
- **Progress bar:** Smooth fill animation matching question transition. 300-500ms

### Reduced Motion (Required)
```css
@media (prefers-reduced-motion: reduce) {
  * { animation: none !important; transition: none !important; }
}
```
- Detect system preference, disable/simplify all motion
- Functionality must work identically without animations

## Logic & Personalization

### Answer Piping
- Store answers as variables: `{ name: "John" }`
- Use in question text: `"Thanks, {{name}}! How can we help?"`
- Replace at render time. Increases engagement, feels like real conversation

### Conditional Branching
- Different questions based on answers: "Do you have a website?" → Yes → "What's the URL?" / No → "Why not?"
- Logic: `if (answers.owns_car) { nextQuestion = "car_model"; }`
- Users only see relevant questions → shorter perceived form → higher completion

### Score Calculation (Quiz-Style)
- Assign point values to answers. Sum as user progresses
- Don't reveal score mid-form. Show result at end with detailed explanation
- Use for: personality quizzes, skills assessments, needs assessments, product recommendations

### Hidden Fields & URL Parameters
- Pre-populate from URL: `?source=google&campaign=email`
- Pre-fill visible fields: `?email=john@example.com`
- Used for tracking and reducing friction

## Technical Implementation

### Question Data Structure
```typescript
type Question = {
  id: string;
  type: "text" | "single-select" | "multi-select" | "rating" | "date" | ...;
  text: string;
  helperText?: string;
  required?: boolean;
  options?: { label: string; value: string }[];
  validation?: ZodSchema;
  next?: string;                            // linear: always go here
  branching?: Record<string, string>;       // conditional: { "Yes": "q3", "No": "q4" }
  piping?: { variable: string; from: string };
};
```

### State Management (Zustand)
```typescript
const useFormStore = create((set) => ({
  responses: {},
  currentQuestion: "q1",
  history: [],                // for back navigation
  setAnswer: (qId, value) => set(state => ({
    responses: { ...state.responses, [qId]: value },
    history: [...state.history, state.currentQuestion]
  })),
  goBack: () => set(state => ({
    currentQuestion: state.history[state.history.length - 1],
    history: state.history.slice(0, -1)
  })),
}));
```

### URL Routing
- **Single URL (simpler):** `/survey` — state-driven, back button doesn't work
- **Per-question URLs (better UX):** `/survey/q1` — browser back works, bookmarkable
- **Recommended:** Single URL for simple forms, per-question for resumable/shareable

### Auto-Focus
```typescript
useEffect(() => {
  const input = document.querySelector('input, textarea, select');
  if (input) input.focus();
}, [currentQuestion]);
```

## When to Use vs NOT Use

### Ideal Use Cases
- Surveys & feedback (CSAT, NPS, post-purchase)
- Lead generation (demo signup, event registration)
- Quizzes & assessments (personality, skills, product recommendation)
- Onboarding & setup (user signup, preference config)

### When NOT to Use
- Complex data entry (50+ fields, insurance/tax forms) — tedious multi-screen
- Data-correction/review — users need to see all fields at once
- Power-user context — experienced data-entry operators need speed over engagement
- Forms requiring field interdependency — can't compare start/end dates across screens

### Comparison
| Factor | Conversational | Traditional |
|--------|---------------|-------------|
| Engagement | High | Low |
| Completion rate | 30-50% higher | Baseline |
| Speed | Slower (multi-screen) | Faster (all visible) |
| Mobile UX | Excellent | Moderate |
| Error correction | Harder (no overview) | Easy (all visible) |
| Best for | Engagement > Speed | Speed > Engagement |
| Form length | 5-20 questions | 20+ fields |

---
---

# DEEP-DIVE: Form Validation Patterns

## Validation Timing Strategies

### On Blur (Recommended Default)
- Validates after user leaves field
- Best for format/length checks
- Doesn't interrupt during typing
- Debounce 500ms for async calls (email availability)

### On Change (Selective Use)
- Validates while user types
- Use only for: password strength meters, character counts, format preview
- RHF mode: `onChange`. Can be overwhelming — use selectively

### On Submit (Full Form)
- Default, most performant approach
- RHF mode: `onSubmit` (default)
- Good for required field checks and cross-field validation

### Hybrid: "Reward-Early, Punish-Late"
- **Blur** for format validation (email format, phone format)
- **Submit** for required fields
- **Change** only for live feedback fields (password strength)
- **Debounced async** for uniqueness checks

### React Hook Form Validation Modes
| Mode | Trigger | Best For |
|------|---------|----------|
| `onSubmit` | Form submit only | Default, best performance |
| `onBlur` | When user leaves field | Good balance |
| `onChange` | Every keystroke | Live feedback (heavy) |
| `onTouched` | After field first touched | Similar to blur |
| `all` | Both change and blur | Maximum feedback |

## Error Display Patterns

### Recommended: Combined Summary + Inline
1. **Error summary at top** — Lists all issues with links to fields
2. **Inline below field** — Specific message directly under invalid field
3. **Field visual change** — Red border + error icon (never color alone)

### Pattern Details
| Pattern | Use When | Avoid When |
|---------|----------|------------|
| Inline below field | Always (primary pattern) | — |
| Error summary at top | Long forms, accessibility | Short forms |
| Field border color | Always combine with text/icon | As sole indicator |
| Shaking animation | Attention-grabbing | Overuse is disruptive |
| Icon indicators (checkmark/X) | Non-color information | As sole indicator |
| Toast/notification | Post-submission, async | During form filling |
| Tooltip/popover | **Avoid** — accessibility issues | — |

## Success/Valid States

### When to Show Success Feedback
- **Green checkmark** — When field passes complex validation (email format, username available)
- **Password strength meter** — Real-time bar (red→orange→green) + requirement checklist
- **Character count** — Live count for text areas with limits
- **Format preview** — Phone number auto-formats as typed: `1234567890` → `(123) 456-7890`
- **Availability status** — "Available" / "Taken" for username/email (debounced async)

## Cross-Field Validation

### Common Patterns
| Pattern | Trigger | Implementation |
|---------|---------|----------------|
| Password confirmation | Blur on confirm field | Zod `.refine()` comparing both |
| Date range (start < end) | Blur on end date | Zod `.refine()` with date comparison |
| Conditional required | When dependency changes | Zod `.refine()` with conditional check |
| Group (at least one filled) | Submit | Zod `.refine()` checking array/object |

### Zod Cross-Field Pattern
```typescript
const schema = z.object({
  password: z.string().min(8),
  confirmPassword: z.string()
}).refine(data => data.password === data.confirmPassword, {
  message: "Passwords don't match",
  path: ["confirmPassword"]
});
```

## Accessibility of Validation

### Required ARIA Attributes
| Attribute | Purpose | When to Set |
|-----------|---------|-------------|
| `aria-invalid="true"` | Marks field as invalid | After validation fails |
| `aria-describedby="error-id"` | Links field to error message | When error message exists |
| `aria-errormessage="error-id"` | Semantic error link | Alternative to describedby |
| `aria-required="true"` | Marks as required | On required fields |

### Live Regions for Dynamic Errors
- `role="status"` / `aria-live="polite"` — Non-urgent validation (waits for screen reader)
- `role="alert"` / `aria-live="assertive"` — Critical errors (interrupts screen reader, use sparingly)

### Focus Management on Error
- Move focus to **first error field** after failed submission
- Ensure Tab order reaches error naturally
- Visible focus indicators: min **3:1** contrast ratio
- Use `:focus-visible` for keyboard-only focus styling

---
---

# DEEP-DIVE: Conditional Logic & Branching

## Types of Conditional Logic

| Type | Description | Example |
|------|-------------|---------|
| **Show/Hide fields** | Fields appear/disappear based on conditions | "If country=USA, show state dropdown" |
| **Show/Hide sections** | Groups of fields toggle together | "If customer=B2B, show Company section" |
| **Enable/Disable** | Field visible but interaction disabled | Grayed out until dependency met |
| **Cascading dropdowns** | Options change based on prior selection | Country → State → City |
| **Dynamic validation** | Validation rules change based on state | "If business=online, email required" |
| **Calculated values** | Fields auto-compute from others | total = quantity * price |
| **Branching/routing** | Different form paths based on answers | Different question sets per role |

## Condition Building Patterns

### Rule Structure
```
IF [field] [operator] [value] THEN [action]
```

### Operators
| Operator | Usage |
|----------|-------|
| Equals / Not equals | Exact match |
| Contains / Not contains | Substring match |
| Greater/Less than | Numeric/date comparison |
| Is empty / Is not empty | Presence check |
| Regex match | Advanced text patterns |

### Logic Combinations
- **AND:** `(country = USA) AND (age >= 18)` — both must be true
- **OR:** `(role = Admin) OR (role = Manager)` — either sufficient
- **Nested:** `((A = X) AND (B = Y)) OR (C = Z)`
- **Default/Else:** Catch-all for uncovered cases

### Multiple Actions Per Condition
Single condition can trigger: show field A + hide field B + set currency to USD + change validation rules

## JSON Schema Representation

### Draft 7+ if/then/else
```json
{
  "if": { "properties": { "country": { "const": "USA" } } },
  "then": { "required": ["state"] },
  "else": { "required": ["province"] }
}
```

### dependentRequired (Draft 2019-09+)
```json
{
  "dependentRequired": {
    "country": ["state"]
  }
}
```

### Custom Condition Schema (for form builders)
```typescript
type Condition = {
  field: string;
  operator: "equals" | "not_equals" | "contains" | "gt" | "lt" | "is_empty" | "is_not_empty";
  value: any;
};

type Rule = {
  conditions: Condition[];
  logic: "AND" | "OR";
  actions: Action[];
};

type Action = {
  type: "show" | "hide" | "enable" | "disable" | "set_value" | "set_required" | "navigate";
  target: string;
  value?: any;
};
```

## Branching Patterns

### Linear with Skip
- Sequential form, skip irrelevant questions
- Single path with branch-outs
- Most common, simplest to implement

### Tree-Based Branching
- Multiple divergence points creating tree structure
- Different paths lead to different question sets
- Can have multiple levels of depth

### Merge Points (Converging)
- Branches come back to common path
- Example: Different product paths → all merge at checkout
- Important for UX: clear when paths reconverge

### Termination Branches
- Some paths end form early
- "If ineligible, show thank-you and end"
- Different completion pages per path

### Loop Patterns
- Repeat section N times ("How many family members?" → ask details for each)
- Conditional: repeat until condition met
- Track state per loop iteration

## Runtime Evaluation

### Dependency Graph
- Track which fields depend on which other fields
- Topological sort determines evaluation order
- Only re-evaluate affected branches when a dependency changes
- Must detect and prevent circular dependencies

### Performance Considerations
- Debounce condition evaluation for rapid changes
- Memoize unchanged conditions
- With 50+ conditions, monitor for performance
- Field-level dependencies more efficient than global `shouldUpdate`

### Re-evaluation Triggers
- Dependent field value changes
- Field first rendered
- Debounce for rapid text input

## Edge Cases

### Hidden Field Data
- **Default:** Clear data when field is hidden (most platforms)
- **Alternative:** Preserve data with explicit flag
- **Calculated fields:** Set to zero/null when hidden
- **Best practice:** Don't rely on hidden field values in downstream actions

### Going Back and Changing Branching Answers
- If user changes answer that triggered Path A → need to "unwind" Path A
- Clear fields from unselected branch
- Validate that current data is consistent with new branch
- Warn user if going back will lose data

### Required Fields That Are Conditionally Hidden
- **Never hide required fields** without removing the requirement
- Results in impossible-to-submit form
- Solution: Make field conditionally required (required only when visible)
- Only validate currently visible fields

### Validation of Conditional Fields
- **Only validate visible fields** — exclude hidden from validation schema
- Use conditional Zod schema: `z.object({...}).refine()`
- Ensure form can't be submitted if required-but-hidden field exists (design error)

---
---

## Summary: Core Principles for Building Forms

1. **Single-column layout** — Always, especially on mobile
2. **Labels above fields** — Never inline-only; persistent and visible
3. **Multi-step for 6+ fields** — With clear progress indicators
4. **Inline validation on blur** — Not while typing; clear, constructive messages
5. **Minimal fields** — Every field reduces completion; only ask what's necessary
6. **Mobile-first** — 48px touch targets, proper input types, single column
7. **Accessible by default** — WCAG AA, keyboard nav, screen reader support, proper ARIA
8. **Progressive disclosure** — Show only relevant fields via conditional logic
9. **Trust signals** — Security messaging, professional design, brand consistency
10. **Clear completion** — Thank you page with next steps, no auto-redirect
