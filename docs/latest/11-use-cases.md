# Use Cases

This document catalogs the types of applications the AI builder agent can generate and the example configurations that ship in the repo.

All example fixtures live under
[`apps/runtime/client/public/example/examples_for_agents/`](../../apps/runtime/client/public/example/examples_for_agents/):

| Directory | What it holds |
|-----------|---------------|
| `full_apps/` | 16 complete app exemplars — `app_config.json` + a `repo/` of Code Focus TSX |
| `backend/` | 8 backend-only config fixtures (models + handlers, no UI) |
| `frontend/blocks_codecomponent/` | 67 single-block Code Focus examples |
| `html_imported/` | 3 imported-design fixtures (`dashboard-1`, `saas-1`, `website-1`) |
| `index/` | Catalog fixture |

---

## Application Categories

The AI builder agent generates applications across these categories based on user prompts:

### Websites & Landing Pages

Marketing sites, business pages, and content sites.

| Type | Example Configs | Key Components |
|------|-----------------|----------------|
| **SaaS Landing Page** | `full_apps/landing_page/` (LaunchPad AI), `html_imported/saas-1/` | Hero, features, pricing table, testimonials, CTA |
| **Business Website** | `full_apps/company_website/` (NovaTech Solutions), `html_imported/website-1/` | Header, sections, services, team, contact |
| **Restaurant Site** | `full_apps/restaurant_ordering/` (Savora Kitchen) | Hero, menu, ordering, reservations |
| **Blog** | — | Code Focus post-list / post-detail pages backed by a user-defined `posts` model (CRUD via `useModel`) |

### Data-Driven Applications

Applications with backend models, CRUD operations, and dynamic data display.

| Type | Example Configs | Key Components |
|------|-----------------|----------------|
| **Admin Dashboard** | `full_apps/analytics_dashboard/` (InsightBoard), `html_imported/dashboard-1/` | Charts, data tables, KPI cards, filters |
| **CRM** | `full_apps/crm_customer/` (PulseCRM) | Contact cards, deal pipeline, task lists |
| **E-commerce** | `full_apps/ecommerce_store/` (ShopWave) | Product grid, cart, multi-step checkout |
| **Project Management** | `full_apps/project_management/` (TaskForge) | Kanban board, task cards, time tracking |
| **LMS** | `full_apps/lms_platform/` (LearnHub) | Course catalog, lesson viewer, progress tracking |
| **Booking System** | `full_apps/event_booking/` (EventSpark) | Calendar view, ticket purchase, booking flow |
| **Listings** | `full_apps/real_estate/` (NestFinder) | Search, detail views with map, saved items |
| **Trackers & Games** | `full_apps/fitness_tracker/`, `full_apps/habit_quest/`, `full_apps/memory_game/`, `full_apps/quiz_master/` | Logging, charts, scoring, leaderboards |

### Backend CRUD Fixtures

Backend-only configs (models + handlers, no UI) that exercise the auto-CRUD system. Also mirrored under `packages/schemas/data/examples/backend/` for schema validation.

| Example | Models | Handlers |
|---------|--------|----------|
| `backend-booking.json` | services, bookings | 2 |
| `backend-crm.json` | contacts, deals, tasks | 2 |
| `backend-dashboard-analytics.json` | sales, products | 3 |
| `backend-ecommerce.json` | products, orders, order_items | 3 |
| `backend-helpdesk.json` | tickets, comments | 2 |
| `backend-internal-tool.json` | users, audit_logs | 2 |
| `backend-inventory.json` | products, stock_movements | 2 |
| `backend-project-management.json` | projects, tasks | 2 |

### Forms & Surveys

Applications for data collection.

| Type | Example Configs | Key Components |
|------|-----------------|----------------|
| **Form Builder / Submissions** | `full_apps/form_builder/` (FormFlow) | Contact, registration, and feedback forms with a submissions view |
| **Survey** | `full_apps/survey_hub/` (PulseCheck) | Survey creation, step-through response flow, analytics |
| **Single-block form examples** | `frontend/blocks_codecomponent/multistep-form-8/`, `zod-validator-30/`, `otp-verification-10/`, `file-upload-gallery-14/` | Multi-step flows, validation, OTP, uploads |

---

## Block Example Library

`frontend/blocks_codecomponent/` holds 67 self-contained Code Focus examples — one block each, as a `block-codecomponent-{name}.json` config plus a `repo/` of TSX. They are the agent's reference material for generating single components. They are also what `pnpm validate:examples:public` walks; that check is currently red because these fixtures still carry the older `repo.components` / `repo.methods` shape (see the [development guide](12-development-guide.md#schemas--examples)).

Representative groupings (directory names are the ground truth):

| Area | Examples |
|------|----------|
| **Tables & data grids** | `crud-table-11`, `inventory-table-23`, `enterprise-data-grid-61`, `headless-data-table-63`, `filter-bar-20` |
| **Charts & metrics** | `stats-dashboard-1`, `line-area-analytics-4`, `pie-radar-overview-5`, `scatter-composed-chart-6`, `realtime-metrics-7`, `scientific-chart-dashboard-35` |
| **Boards & scheduling** | `kanban-board-31`, `dnd-kanban-board-49`, `event-calendar-26`, `full-event-calendar-62`, `workflow-builder-54` |
| **Forms & auth** | `multistep-form-8`, `zod-validator-30`, `otp-verification-10`, `user-profile-auth-13`, `signature-capture-47` |
| **Editors & documents** | `rich-text-notes-41`, `document-composer-42`, `wiki-editor-43`, `resizable-editor-17`, `code-playground-37`, `pdf-document-viewer-56` |
| **Media & canvas** | `canvas-design-tool-44`, `fabric-image-editor-45`, `whiteboard-app-46`, `image-crop-upload-48`, `video-course-player-58`, `audio-waveform-player-57` |
| **Commerce & ops** | `checkout-flow-32`, `store-locator-50`, `delivery-tracker-51`, `barcode-inventory-66`, `qr-code-generator-65` |
| **Shell & navigation** | `sidebar-app-15`, `page-navigator-18`, `breadcrumb-browser-16`, `interactive-tabs-2`, `settings-panel-9`, `notification-hub-19` |

### Full-App Exemplars

`full_apps/` holds 16 complete apps the agent draws from. These are **prompt material** — there is no runtime scaffold expander any more, so each one is just an example the agent can clone and adapt into Code Focus components:

| App | Directory | Description |
|-----|-----------|-------------|
| InsightBoard | `analytics_dashboard/` | Traffic, revenue, retention, and data-exploration views |
| NovaTech Solutions | `company_website/` | Corporate site with services, team profiles, contact |
| PulseCRM | `crm_customer/` | Contacts, deal pipeline, activity tracking |
| ShopWave | `ecommerce_store/` | Catalog, cart, multi-step checkout |
| EventSpark | `event_booking/` | Event browsing, calendar, ticket purchase |
| FitPulse | `fitness_tracker/` | Workout + nutrition logging, progress charts |
| FormFlow | `form_builder/` | Contact / registration / feedback forms + submissions |
| HabitQuest | `habit_quest/` | Gamified habits with XP, levels, badges, streaks |
| LaunchPad AI | `landing_page/` | SaaS landing page — hero, features, pricing, testimonials |
| LearnHub | `lms_platform/` | Course catalog, lesson viewer, progress tracking |
| MindMatch | `memory_game/` | Card matching game with leaderboard and stats |
| TaskForge | `project_management/` | Kanban boards, task tracking, team + time tracking |
| QuizMaster | `quiz_master/` | Categories, timed questions, scoring, leaderboard |
| NestFinder | `real_estate/` | Property search, detail views with map |
| Savora Kitchen | `restaurant_ordering/` | Menu browsing, ordering, table reservations |
| PulseCheck | `survey_hub/` | Survey creation, step-through responses, analytics |

Auth pages are not a separate exemplar category: the agent generates login, signup, forgot-password and reset-password pages as ordinary Code Focus TSX when `security.authProviders` is configured and no explicit auth pages exist.

---

## Authentication Flows

The platform supports declarative authentication via the `security` config. These examples show common patterns.

### Basic Email Auth

Minimal configuration — auto-generates login, signup, forgot-password, and reset-password pages:

```json
{
  "security": {
    "authProviders": [{ "provider": "email" }]
  }
}
```

When no auth pages exist in the config, the agent generates login / signup / forgot-password / reset-password pages as ordinary Code Focus TSX components and wires them to the per-app auth router. `useCurrentUser()` exposes `id`, `email`, `roles`, and `isAuthenticated` to every component.

### Role-Based Access Control

Roles, hierarchy, per-page access, and per-model CRUD policies:

```json
{
  "security": {
    "authProviders": [{ "provider": "email" }],
    "roles": ["admin", "editor", "viewer"],
    "roleHierarchy": {
      "admin": ["editor"],
      "editor": ["viewer"]
    },
    "defaultRole": "viewer",
    "defaultAccess": "authenticated"
  },
  "frontend": {
    "pages": [
      { "slug": "/dashboard", "access": "authenticated", "..." : "..." },
      { "slug": "/admin", "access": "role:admin", "..." : "..." },
      { "slug": "/editor", "access": "role:editor", "..." : "..." }
    ]
  },
  "backend": {
    "models": [
      {
        "name": "posts",
        "crudPolicy": {
          "create": "role:editor",
          "read": "public",
          "update": "role:editor",
          "delete": "role:admin",
          "list": "public"
        }
      }
    ]
  }
}
```

`page.access` is enforced at render time: `ClientPageRenderer` runs `checkPageAccess()` (`client/src/utils/authAccess.ts`) and redirects unauthenticated visitors to the login page or shows a forbidden state. There is no automatic nav-item hiding — navigation is agent-generated TSX, so a component that wants to hide a link checks `useCurrentUser().roles` itself. The role hierarchy means `admin` inherits `editor` and `viewer` permissions without explicit assignment.

### Owner-Scoped Data

Combine `ownerScope: "user"` with CRUD policies for per-user data isolation:

```json
{
  "backend": {
    "models": [
      {
        "name": "notes",
        "ownerScope": "user",
        "crudPolicy": {
          "create": "authenticated",
          "read": "owner",
          "update": "owner",
          "delete": "owner",
          "list": "authenticated"
        }
      }
    ]
  }
}
```

With `ownerScope: "user"`, every record is tagged with the creating user's ID. The `owner` access level in `crudPolicy` restricts read/update/delete to the record's owner. List returns only the current user's records. Admins can access all records in shared-scope models.

---

## Related Documents

- [Component Catalog](04-component-catalog.md) — Full component reference
- [Configuration Reference](07-configuration-reference.md) — WebAppProps schema
- [State & Actions](05-state-and-actions.md) — State management and SDK hooks
