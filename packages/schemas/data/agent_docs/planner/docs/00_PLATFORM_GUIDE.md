# Platform Guide for Planners

<!-- Schema Version: 2.0.0 | Last Updated: 2026-03-30 -->

**This guide is for planner agents.** It covers architectural decisions, built-in capabilities, and when to use them. Component builders have separate documentation with implementation details.

---

## What Exepad Does

Exepad is an **app cloud** that creates full-stack web applications from user prompts. It covers the entire app lifecycle: **create, deploy, and maintain (update)** — a single platform for building and running apps end to end.

Apps are built from two types of code units, both standalone TSX files importing from `@exepad/sdk`:

- **Frontend components** — React UI rendered in Light DOM (`LightDOMContainer`) with CSS scoped via `@layer exepad-app`.
- **Backend handlers** — Server-side TypeScript functions for custom business logic beyond auto-CRUD.

---

## App Types

| Type | Description |
|------|-------------|
| **website** | Marketing sites, landing pages, portfolios, business sites, restaurants, event pages |
| **form** | Surveys, multi-step wizards, registrations, applications, onboarding flows, feedback forms |
| **dataapp** | Dashboards, admin panels, CRM, inventory, project management, analytics, booking systems |
| **custom** | Games, gamified content, interactive tools, hybrid applications combining multiple patterns |

---

## Built-in Platform Capabilities

These features are available out of the box. Do NOT build custom backends for them.

### Core (Always Available)

**Auto-CRUD** — Define `backend.models` and get full create, read, list, update, delete, upsert, batch, and aggregate operations automatically. Includes filtering, search, sorting, pagination (offset & cursor), soft delete, and ownership scoping. No handlers needed for standard data operations.

**Authentication** — Google OAuth 2.0 with session management. User context (id, email, roles) is automatically available in frontend components and backend handlers. Role-based access control built in.

**File Storage** — Upload, download, list, and delete files via R2 cloud storage. Multipart upload support, metadata tracking, configurable size limits.

---

## When to Use What

| Scenario | What it needs |
|----------|---------------|
| Contact form, feedback, survey, newsletter | `backend.models` — define a model and submit via `useModel().create()` |
| Product catalog, inventory, tasks | `backend.models` — plan data models with auto-CRUD |
| Dashboard KPIs, calculated quotes | `backend.models` + `backend.handlers` — plan models and custom logic |
| Complex validation, multi-model logic | `backend.handlers` — plan custom logic |

---

## Planning Checklist

Before creating the app plan, consider:

- **Users:** Who uses this? Public, logged-in users, admins? What roles exist?
- **Core tasks:** What are the 3-5 main things users will do?
- **Data:** What needs collecting? What needs displaying? CRUD or just collection?
- **Backend:** Which `backend.models` are needed (including for form/data collection)? Are custom handlers needed for logic beyond auto-CRUD?
- **Security:** Does the app need authentication? Role-based access?

---

## Common Planning Mistakes

| Mistake | Better Approach |
|---------|-----------------|
| Not planning a model for a contact/feedback form | Define a model and submit via `useModel().create()` — data collection always needs a model |
| Not planning backend for CRUD entities | Define models for entities that need create/edit/delete |
| Planning sidebar nav for marketing site | Use HeaderMenuTop for websites |
| Using HeaderMenuTop for dashboard app | Use SidebarMenuLeft for dataapps |
| Skipping security for user-scoped data | Plan auth when users manage their own data |
