# App Type Guide: Form

<!-- Schema Version: 3.1.0 | Last Updated: 2026-04-04 -->

You are planning a **FORM** app — a focused application where the primary user journey is completing one or more forms (surveys, multi-step wizards, registrations, applications, quote requests, feedback forms).

All UI is built using **Code Components** (CodeComponentProps).

---

## Architecture

- **Navigation:** `HeaderMenuTop` for simple forms, `SidebarMenuLeft` for multi-step wizards
- **Pages:** 1-3 pages (main form, confirmation/thank-you, optionally a landing page)
- **Footer:** Optional — omit for distraction-free form experiences
- **Backend:** `backend_type: "dynamic"` — data collection REQUIRES a backend model. Plan one model to store submissions and have the form submit via `useModel().create()` (auto-CRUD)

---

## Navigation and Footer Rules

- Set BOTH navigation and footer to null (omit header and footer components) UNLESS the user explicitly requests a header, navbar, or footer
- Form apps should be distraction-free — the form IS the experience
- Only include navigation if the form app has multiple pages that need linking

---

## Built-in Form State Management

Form components handle their own state internally — submission, step navigation, validation, reset. Do NOT plan global state variables for form apps. Leave `app_logic_plan` empty for form-centric apps.

---

## Form Submission

All data-collection forms persist to a backend model via auto-CRUD. Plan one model whose columns match the form fields, then have the form component submit with `useModel().create()`:

```ts
const { create } = useModel("submissions");
await create({ name, email, message });
```

Each form app needs at least one model in `app_backend_plan.models` to receive submissions (set `backend_type: "dynamic"`). Never include system columns (id, owner_id, created_at, updated_at) — those are added automatically.

---

## Content Depth Requirements

| App Category | Min Pages | Required Content |
|-------------|-----------|-----------------|
| Simple contact/feedback | 1 | Form + thank-you state |
| Registration/application | 1-2 | Form page + confirmation page |
| Multi-step wizard | 1-3 | Landing + multi-step form + confirmation |
| Survey/quiz | 1-2 | Form with progress + results/thank-you |

---

## Form Content Richness

When planning form pages, specify ALL fields explicitly in the building plan with their types:

- **Registration/application forms:** Plan 10-18 fields across 3-5 sections. Include personal info, preferences, experience/background, documents, and consent.
- **Surveys/feedback:** Plan 8-15 questions. Include welcome/thank-you messages, mixed question types (rating, select, multi-select, long text, yes/no).
- **Contact forms:** Plan 4-6 fields with proper field types.
- **Field variety:** Forms with 6+ fields MUST use at least 3 different field types — not just text inputs. Use dropdowns, checkboxes, radio groups, date pickers, sliders, file uploads as appropriate.
- **Conditional fields:** Forms with 8+ fields SHOULD include at least 1-2 fields with conditional visibility.

---

## Form Patterns

- **Single-page forms** — all fields visible, submit at bottom, thank-you state on success
- **Multi-step wizards** — progress indicator, back/next navigation, validation per step
- **Conversational forms** — one question at a time, animated transitions
- **Survey forms** — mixed question types, progress bar, conditional branching

---

## Things to Avoid

- **Forgetting the backend model** — every data-collection form needs a model to write to (submitted via `useModel().create()`)
- **Complex global state** — form state should be component-local
- **Marketing-style hero sections** — keep focus on the form
- **Too many pages** — most form apps need 1-2 pages maximum
- **Generic text inputs for everything** — use appropriate field types (dropdowns, checkboxes, date pickers)
- **Missing thank-you/confirmation** — always show feedback after submission
