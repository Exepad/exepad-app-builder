# Component Planning — DataApp Rules

## Navigation

Choose navigation based on the app's complexity:

- **`SidebarMenuLeft`** — best for apps with many pages or sections (admin panels, CRM, project management, multi-entity dashboards). Most dataapps use this.
- **`HeaderMenuTop`** — suitable for simpler dataapps with fewer pages (single-entity trackers, personal tools, analytics viewers).

## Page Structure

Plan pages around the core workflows. Common page types:

- **Dashboard** — overview with KPI cards, summary charts, recent activity. Usually the landing page.
- **Entity list** — one page per major entity (e.g., Contacts, Products, Orders). Data table with search, filters, and row actions.
- **Detail view** — single-entity detail with related data, history, or nested entities.
- **Create/Edit form** — standalone page or modal for entity creation and editing.
- **Calendar/Schedule** — date-based views for bookings, events, tasks, appointments.
- **Analytics/Reports** — charts, trends, and aggregation views with date range filters.
- **Settings/Profile** — app configuration, user preferences, account management.
- **Kanban/Board** — column-based workflow views for status-driven entities (tasks, deals, tickets). **MUST be drag-and-drop.** A kanban without drag between columns is broken. When planning a page as Kanban/Board, name the component with "Kanban", "Board", or "Pipeline" in it (e.g. `PipelineContent`, `TaskBoardContent`) so the ComponentBuilder loads the `kanban-board` skill which teaches the HTML5 DnD pattern.

Keep the page count focused — 3-8 pages covers most dataapps. Each page should have a clear purpose.

## Common DataApp Patterns

### Admin Panels / Back-Office Tools
- Entity management pages with CRUD tables and modals
- Role-based access (admin vs viewer)
- Activity logs, audit trails

### CRM / Contact Management
- Contact and deal entity pages with search and filters
- Pipeline/kanban view for deals
- Dashboard with sales KPIs and conversion charts
- Activity feed and interaction history

### Project / Task Management
- Task list with status filters and assignee grouping
- Kanban board for workflow stages
- Project overview with progress metrics
- Team member views

### Inventory / Catalog Management
- Product table with category filters and stock status
- Create/edit forms with image fields
- Low-stock alerts on dashboard
- Category and supplier management

### Analytics Dashboards
- KPI cards with trend indicators
- Multiple chart types (bar, line, area, pie) with date range selectors
- Data tables for drill-down
- Export or download actions

### Booking / Scheduling Apps
- Calendar or time-slot views
- Booking form with availability checks
- Upcoming/past bookings list
- Customer and service management

### Personal Trackers (Fitness, Finance, Habits)
- Daily/weekly entry forms
- Progress charts and streak counters
- Goal setting and tracking
- History views with date filtering

## Component Planning per Page

For each page, the building plan should describe:

- **Layout** — what sections the page has (e.g., KPI row at top, chart below, table at bottom)
- **Data source** — which model or handler feeds each section
- **Key interactions** — what the user can do (filter, sort, create, edit, delete, export)

### Dashboard Pages
- Plan KPI cards with specific metrics and their data sources
- Plan charts with the chart type and what data they visualize
- Plan recent activity or quick-action sections if relevant

### Entity Table Pages
- Plan which columns to show in the table
- Plan filters and search fields
- Plan row actions (view, edit, delete)
- Plan create/edit modals with their form fields and submit behavior

### CRUD Modals
For every entity page with create/edit actions, include in the building plan:
- The **modal trigger** (button, row action)
- The **form fields** inside the modal
- The **submit behavior** (which model or handler to call)
- Modal state (open/close, selected item) is managed inside the component — do NOT add these to `app_logic_plan`.

### Settings / Profile Pages

Settings pages often contain forms that save user preferences or profile data. These are **not** data-collection forms (contact, feedback) — they are CRUD operations on user data.

**Rules:**
- If the page has a "save" or "update" button that writes user data → the data needs a backend model (e.g., `user_settings`, `user_profile`) or a handler (e.g., `updateUserProfile`)
- If the page only displays read-only info or toggles that affect frontend state (via `useAppState`) → no backend model needed
- **Never plan a form with a save button that has no backend** — if there's no model to save to, either add one to `app_backend_plan` or remove the save button from the building plan

**Decision rule:**
- User preferences stored in `useAppState` (date range, theme, compact mode) → no backend needed, state persists via `$persist`
- User profile data (name, email, avatar) → needs a model or handler
- Integration keys, webhook URLs → needs a model or handler
- Export/download buttons → can use a handler or client-side logic

## Connecting Components to Backend

After structuring the frontend, describe how each component gets its data:

1. **Name the handler or model** — reference the exact name from `app_backend_plan`.
2. **Name the output fields** — list which fields the component displays, matching the handler's `outputs` or model's columns.
3. **Describe the rendering** — how each field should appear (currency, count, percentage, chart axis, table column, badge, etc.).

**Good building plan examples:**
- "KPI row: call `getDashboardStats`, show `totalRevenue` as currency, `activeUsers` as count, `conversionRate` as percentage."
- "Revenue chart: call `getMonthlyRevenue`, bar chart with `month` on X-axis and `revenue` on Y-axis."
- "Products table: list from `products` model, columns: `name`, `price`, `category`, `status`. Search by name, filter by category."
- "Bookings calendar: list from `bookings` model filtered by date range, display as calendar grid with booking title and time."

**Bad examples (too vague):**
- "Show dashboard metrics" — which metrics? from which handler?
- "Display a revenue chart" — what fields? what chart type?

Without explicit field names, the builder may guess wrong and create data binding mismatches.

## Seed Data

DataApps look empty without sample data. When planning models in `app_backend_plan`, include `seed_hint` so the app has meaningful content on first load:
- **Time-series data:** spread records across realistic time ranges — not all at the same timestamp.
- **Categorical data:** include variety to make charts and filters useful (multiple statuses, categories).
- **Realistic volumes:** 10-50 records per model is usually enough for a good demo.
