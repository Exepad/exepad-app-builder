# Configuration Reference

The entire Exepad application is defined by a single JSON document conforming to the `WebAppProps` interface. This document is the complete reference for every configuration option.

**Source of truth:** `packages/types/src/`

---

## WebAppProps (Root)

The top-level configuration object.

```typescript
interface WebAppProps extends AppProps {
  uuid: string;                // Unique identifier (UUID v4)
  alias: string;               // Human-readable alias (e.g., "my-app")
  version: string;             // Schema version (e.g., "1.0.0")
  appType: 'WebAppProps';      // App type discriminator
  appSecondaryType: AppSecondaryType; // 'website' | 'form' | 'dataapp' | 'custom'
  name: string;                // Display name
  summary: string;             // Full description
  shortSummary: string;        // One-line description
  lastUpdatedEpoch: number;    // Last updated (epoch seconds)

  repo?: RepoConfig;           // Custom code repository (Tier 2)
  security?: SecurityConfig;   // Per-app authentication & authorization
  secrets?: SecretConfig[];    // Declared API keys/tokens the app expects
  frontend?: FrontendConfig;   // UI configuration
  backend?: BackendConfig;     // Data models and handlers (static or dynamic)
}
```

### Example

```json
{
  "uuid": "550e8400-e29b-41d4-a716-446655440000",
  "alias": "my-bookstore",
  "version": "1.0.0",
  "appType": "WebAppProps",
  "appSecondaryType": "dataapp",
  "name": "My Bookstore",
  "summary": "A library management application",
  "shortSummary": "Library management",
  "lastUpdatedEpoch": 1707580800,
  "frontend": { ... },
  "backend": { ... }
}
```

---

## FrontendConfig

Defines the entire UI layer: layout, theme, pages, navigation regions, and client-side logic.

```typescript
interface FrontendConfig {
  layout: 'boxed' | 'wide' | 'narrow' | 'full-width';
  menuPosition: 'HeaderMenuTop' | 'SidebarMenuLeft';
  theme: ThemeProps;
  languages: LanguageOption[];
  pages: WebPageProps[];
  header: ComponentProps[];     // Components rendered in the header region
  sidebar: ComponentProps[];    // Components rendered in the sidebar region
  footer: ComponentProps[];     // Components rendered in the footer region
  logic?: LogicConfig;          // Client-side state
  transitions?: TransitionConfig; // Page transition animations
  offline?: OfflineConfig;      // PWA/offline support
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `layout` | Yes | Page layout width: `boxed` (max-width container), `wide`, `narrow`, `full-width` |
| `menuPosition` | Yes | Where the main navigation renders: top header or left sidebar |
| `theme` | Yes | Colors, typography, spacing, border radius |
| `languages` | No | Multi-language support options |
| `pages` | Yes | Array of page definitions with components |
| `header` | No | Components for the header region (Navbar, etc.) |
| `sidebar` | No | Components for the sidebar region |
| `footer` | No | Components for the footer region |
| `logic` | No | Client-side state management configuration |

---

## PageProps

Defines a single page/route in the application.

```typescript
interface PageProps {
  uuid: string;                // Unique identifier
  title: string;               // Page title (shown in nav, browser tab)
  path: string;                // URL path (e.g., "/", "/about", "/dashboard")
  description?: string;        // SEO meta description
  access?: AccessLevel;        // Page access control (default: security.defaultAccess or 'public')
  components: ComponentProps[];// Array of components on this page
  showInNav?: boolean;         // Include in navigation menu (default: true)
  icon?: string;               // Icon name for navigation (lucide-react icon)
}
```

### Example

```json
{
  "uuid": "page-001",
  "title": "Dashboard",
  "path": "/dashboard",
  "description": "Main dashboard with analytics",
  "showInNav": true,
  "icon": "LayoutDashboard",
  "access": "authenticated",
  "components": [
    { "uuid": "comp-001", "componentType": "HeadingProps", "text": "Dashboard", "level": 1 },
    { "uuid": "comp-002", "componentType": "GridProps", "columns": 3, "children": [...] }
  ]
}
```

---

## ComponentProps (Base)

Every component in the configuration extends this base interface.

```typescript
interface ComponentProps {
  uuid: string;                // Unique identifier for this component instance
  componentType: string;       // Component type identifier (e.g., "TextProps", "ButtonProps")
  classes?: string;            // Tailwind CSS classes for styling
  showWhen?: string | boolean; // Conditional rendering expression
  lastUpdatedEpoch?: number;   // Last modified timestamp
}
```

The `componentType` field determines which React component is rendered. The runtime maps this string to a component via the component registry. See [Component Catalog](04-component-catalog.md) for the full list of available types.

The `showWhen` field accepts a boolean (`true`/`false`). Code components handle their own conditional rendering in JSX.

---

## ThemeProps

Controls the visual appearance of the application.

```typescript
interface ThemeProps {
  light?: ColorPalette;        // Light mode color palette (HSL values)
  dark?: ColorPalette;         // Dark mode color palette (HSL values)
  charts?: ChartPalette;       // Chart series colors (chart-1 through chart-5)
  fonts?: {
    body?: FontConfig;         // Body text font
    heading?: FontConfig;      // Heading font
  };
  fontSizes?: Record<string, string>; // Typographic scale (xs through 9xl)
  radius?: string;             // Global border-radius in rem (e.g., "0.5")
  spacing?: {
    y?: string;                // Vertical section padding (Tailwind value, e.g., "8")
    x?: string;                // Horizontal content padding (Tailwind value, e.g., "4")
  };
  styles?: StyleVariables;     // Custom CSS properties (shadows, transitions)
  layout?: {
    containerWidth?: string;   // Max content width (e.g., "1280px")
    contentPadding?: string;   // Container padding (e.g., "1rem")
  };
  defaults?: ComponentDefaults; // Global component variant defaults
  metadata?: MetadataProps;    // Site-wide SEO/social metadata
}

interface ColorPalette {
  background?: string;         // Page background (HSL)
  foreground?: string;         // Default text color (HSL)
  primary?: string;            // Primary brand color (HSL)
  'primary-foreground'?: string;
  secondary?: string;          // Secondary brand color (HSL)
  'secondary-foreground'?: string;
  accent?: string;             // Accent/highlight color (HSL)
  'accent-foreground'?: string;
  muted?: string;              // Muted/subtle elements (HSL)
  'muted-foreground'?: string;
  destructive?: string;        // Error/danger color (HSL)
  'destructive-foreground'?: string;
  card?: string;               // Card background (HSL)
  'card-foreground'?: string;
  popover?: string;            // Popover background (HSL)
  'popover-foreground'?: string;
  border?: string;             // Border color (HSL)
  input?: string;              // Input border color (HSL)
  ring?: string;               // Focus ring color (HSL)
}
```

### Example

```json
{
  "light": {
    "background": "0 0% 100%",
    "foreground": "222.2 47.4% 11.2%",
    "primary": "221.2 83.2% 53.3%",
    "primary-foreground": "210 40% 98%",
    "secondary": "210 40% 96%",
    "muted": "210 40% 96%"
  },
  "dark": {
    "background": "222.2 84% 4.9%",
    "foreground": "210 40% 98%",
    "primary": "217.2 91.2% 59.8%"
  },
  "fonts": {
    "body": { "family": "Inter", "variant": "regular" },
    "heading": { "family": "Inter", "variant": "700" }
  },
  "radius": "0.5"
}
```

### MetadataProps

SEO and social sharing metadata, used at both the site level (`frontend.metadata`) and per-page level (`pages[].metadata`).

```typescript
interface MetadataProps {
  title?: string;              // Page/site title
  description?: string;        // Page/site description
  favicon?: string;            // Inline SVG string or URL for the site favicon
  keywords?: string;           // Comma-separated SEO keywords
  openGraph?: {
    title?: string;
    description?: string;
    image?: string;            // Full URL to an OG image
    url?: string;              // Canonical URL
  };
}
```

The AI agent generates `favicon` as an inline SVG string (e.g., `"<svg xmlns='...' viewBox='0 0 32 32'>...</svg>"`).

---

## LogicProps

Defines shared state for code components.

```typescript
interface LogicProps {
  state?: Record<string, unknown>;
}
```

| Field | Description |
|-------|-------------|
| `state` | Initial state values — key-value pairs with optional `$persist` support |

### Example

```json
{
  "logic": {
    "state": {
      "count": 0,
      "items": [],
      "isModalOpen": false,
      "theme": { "$persist": true, "initial": "light" }
    }
  }
}
```

Code components handle all logic (data fetching, derived values, side effects) directly via SDK hooks. See [State Management](05-state-and-actions.md) for details.

---

## BackendConfig

The backend uses a discriminated union on the `mode` field:

```typescript
type BackendConfig = StaticBackend | DynamicBackend;

// For self-contained JSON apps (no server-side infrastructure)
interface StaticBackend {
  mode: 'static';
  data: {
    datasets: Record<string, StaticDataset>; // Auto-injected into frontend state
  };
}

// For full infrastructure apps with their own database
interface DynamicBackend {
  mode: 'dynamic';
  models?: ModelConfig[];      // Database table definitions
  handlers?: HandlerConfig[];  // Custom server-side functions
  sources?: SourceConfig[];    // External data source adapters
  // Future: tasks, pipelines, realtime
}
```

Type guards `isStaticBackend()` and `isDynamicBackend()` are available for runtime checks.

Static datasets are automatically injected into `frontend.logic.state` during initialization — each dataset's records become a state array accessible via `$datasetName`.

---

## ModelConfig

Defines a database table with columns, indexes, access policies, and behavior flags.

```typescript
interface ModelConfig {
  uuid: string;                          // UUID v4 for migration tracking
  name: string;                          // Table name (SQL identifier pattern)
  summary?: string;                      // Description for LLM context
  columns: ColumnConfig[];               // Column definitions
  indexes?: IndexConfig[];               // Database indexes
  crudPolicy?: CrudPolicy;              // Per-operation auth requirements
  migrationPolicy?: MigrationPolicy;    // 'safe' | 'destructive' | 'reset'
  softDelete?: boolean;                  // Use soft delete (deleted_at column)
  ownerScope?: OwnerScope;              // 'user' (default) | 'shared'
}
```

**System columns** are added automatically to every table:
- `id` — INTEGER PRIMARY KEY AUTOINCREMENT
- `owner_id` — TEXT NOT NULL (set from authenticated user)
- `created_at` — TEXT NOT NULL (ISO 8601 timestamp)
- `updated_at` — TEXT NOT NULL (ISO 8601 timestamp)
- `deleted_at` — TEXT (only if `softDelete: true`)

**Owner scoping:**
- `'user'` (default) — All queries filter by `owner_id`. Each user sees only their own data.
- `'shared'` — Reads return all records. Writes still set `owner_id` for audit trails.

### Example

```json
{
  "uuid": "model-books-001",
  "name": "books",
  "summary": "Library book catalog",
  "columns": [
    { "name": "title", "type": "text", "summary": "Book title" },
    { "name": "author_id", "type": "integer", "references": { "model": "authors", "column": "id", "onDelete": "set_null" } },
    { "name": "isbn", "type": "text", "isUnique": true },
    { "name": "price", "type": "real", "defaultValue": 0 },
    { "name": "status", "type": "text", "defaultValue": "available" },
    { "name": "metadata", "type": "json", "isNullable": true }
  ],
  "indexes": [
    { "name": "idx_books_status", "columns": ["status"] },
    { "name": "idx_books_author", "columns": ["author_id"] }
  ],
  "crudPolicy": {
    "create": "authenticated",
    "read": "public",
    "list": "public",
    "update": "authenticated",
    "delete": "admin"
  },
  "softDelete": true,
  "ownerScope": "shared"
}
```

---

## ColumnConfig

Defines a single column in a model.

```typescript
interface ColumnConfig {
  name: string;                // Column name (SQL identifier: [a-zA-Z_][a-zA-Z0-9_]*)
  type: ColumnType;            // 'text' | 'integer' | 'real' | 'blob' | 'json'
  summary?: string;            // Description for LLM context
  isPrimary?: boolean;         // Primary key (only one per model)
  isUnique?: boolean;          // UNIQUE constraint
  isNullable?: boolean;        // Allows NULL values
  defaultValue?: unknown;      // Default value (must match type)
  references?: ForeignKeyRef;  // Foreign key reference
}

type ColumnType = 'text' | 'integer' | 'real' | 'blob' | 'json';
```

---

## ForeignKeyRef

Links a column to another model's column.

```typescript
interface ForeignKeyRef {
  model: string;               // Referenced table name
  column: string;              // Referenced column (typically 'id')
  onDelete?: OnDeleteAction;   // 'cascade' | 'set_null' | 'restrict' | 'no_action'
}
```

---

## IndexConfig

Defines a database index for query optimization.

```typescript
interface IndexConfig {
  name: string;                // Index name (used in CREATE INDEX)
  columns: string[];           // Column names in index order
  unique?: boolean;            // Unique index constraint
}
```

---

## AccessLevel

Controls who can access pages, CRUD operations, and custom handlers.

```typescript
type AccessLevel = 'public' | 'authenticated' | `role:${string}` | 'owner' | 'none';
```

| Level | Description | Valid on |
|-------|-------------|----------|
| `public` | No authentication needed | Pages, CRUD, Handlers |
| `authenticated` | User must be logged in | Pages, CRUD, Handlers |
| `role:X` | User must have role X (directly or via hierarchy) | Pages, CRUD, Handlers |
| `owner` | Only the record owner (enforced by ownerScope) | CRUD only |
| `none` | Permanently blocked — always returns 403 | CRUD only |
| `admin` | **Deprecated** — legacy shorthand for `role:admin` | All (normalized at deploy time) |

**Note:** Write operations (`create`, `update`, `delete`) always require authentication regardless of the declared policy. This is a security guard (H8) that prevents empty `owner_id` on inserts.

---

## CrudPolicy

Controls authentication requirements for each CRUD operation.

```typescript
interface CrudPolicy {
  create?: AccessLevel;          // Default: 'authenticated'
  read?: AccessLevel;            // Default: 'authenticated'
  update?: AccessLevel;          // Default: 'authenticated'
  delete?: AccessLevel;          // Default: 'authenticated'
  list?: AccessLevel;            // Default: 'authenticated'
}
```

---

## HandlerConfig

Defines a custom server-side function.

```typescript
interface HandlerConfig {
  uuid: string;                          // UUID v4
  name: string;                          // Handler name (API route segment)
  summary?: string;                      // Description for LLM context
  authLevel: AccessLevel;                // Required auth level
  inputs: InputConfig[];                 // Input parameters
  outputs: OutputConfig[];               // Response fields
  allowedSources?: string[];             // Allowed data source names
  method: string;                        // Compiled method name in registry
  handlerType?: 'read' | 'write';       // Default: 'write'
}
```

**Handler types:**
- `'read'` — Respects declared `authLevel` (e.g., `'public'` allows unauthenticated access)
- `'write'` (default) — Always requires authentication regardless of `authLevel`

### Example

```json
{
  "uuid": "handler-dashboard-001",
  "name": "getDashboardStats",
  "summary": "Aggregates statistics for the dashboard",
  "authLevel": "authenticated",
  "handlerType": "read",
  "inputs": [
    { "name": "dateRange", "type": "string", "required": false, "summary": "Date filter" }
  ],
  "outputs": [
    { "name": "totalBooks", "type": "number" },
    { "name": "activeLoans", "type": "number" },
    { "name": "recentActivity", "type": "array", "items": "json" }
  ],
  "method": "getDashboardStats"
}
```

---

## InputConfig

Defines an input parameter for a handler.

```typescript
interface InputConfig {
  name: string;                // Parameter name (key in ctx.params)
  type: 'string' | 'number' | 'boolean' | 'json';
  required?: boolean;          // Default: false
  summary?: string;            // Description for LLM context
}
```

---

## OutputConfig

Defines a response field for a handler.

```typescript
interface OutputConfig {
  name: string;                // Field name in response object
  type: 'string' | 'number' | 'boolean' | 'json' | 'array';
  items?: string;              // Item type for arrays (e.g., 'string', 'json')
  summary?: string;            // Description
}
```

---

## RepoConfig

Configuration for custom code (Tier 2 features).

```typescript
interface RepoConfig {
  methods?: Record<string, MethodConfig>;
}

interface MethodConfig {
  source: string;              // Source file path (e.g., "computed/formatCurrency.tsx")
  compiled: string;            // Compiled file path (e.g., "computed/formatCurrency.js")
  type: 'handler' | 'action'; // Method type
}
```

---

## LanguageOption

Multi-language support configuration.

```typescript
interface LanguageOption {
  code: string;                // BCP 47 language code (e.g., "en", "tr", "fr-FR")
  nameEnglish: string;         // English name (e.g., "Turkish")
  nameNative: string;          // Native name (e.g., "Turkce")
  isDefault: boolean;          // Default language
}
```

---

## SecurityConfig

Per-app authentication and authorization. When configured, enables auth actions, `AuthForm`, `AuthGuard`, and `UserMenu` components. Auth pages (login, signup, forgot-password, reset-password) are auto-generated when `authProviders` is set.

```typescript
interface SecurityConfig {
  authProviders?: AuthProviderConfig[];  // Login methods: email, google, exepad
  sessionDuration?: number;              // Session TTL in seconds (default: 604800 = 7 days)
  requireVerification?: boolean;         // Require email verification (default: false)
  allowSignup?: boolean;                 // Allow self-registration (default: true)
  passwordPolicy?: {
    minLength?: number;                  // Minimum password length (default: 8)
    requireUppercase?: boolean;          // Require uppercase letter
    requireNumber?: boolean;             // Require digit
  };
  roles?: string[];                      // App role names (e.g., ['admin', 'editor', 'viewer'])
  roleHierarchy?: Record<string, string[]>; // Role inheritance (e.g., { admin: ['editor'] })
  defaultRole?: string;                  // Role assigned on signup (default: 'user')
  defaultAccess?: AccessLevel;           // Default page/handler access (default: 'public')
  loginPage?: string;                    // Login page route (default: '/login')
  redirectAfterLogin?: string;           // Post-login redirect (default: '/')
  redirectAfterLogout?: string;          // Post-logout redirect (default: '/login')
}

type AuthProviderConfig =
  | { provider: 'email' }
  | { provider: 'google' }
  | { provider: 'exepad' };
```

| Field | Default | Description |
|-------|---------|-------------|
| `authProviders` | `[]` | Which login methods to enable. At least one required for auth. |
| `sessionDuration` | `604800` | Session timeout in seconds (7 days). |
| `requireVerification` | `false` | Require email verification before granting access. |
| `allowSignup` | `true` | Allow new users to self-register. |
| `passwordPolicy` | `{ minLength: 8 }` | Password strength requirements for the email provider. |
| `roles` | `[]` | Custom role names. Roles are assigned to users and checked by `role:X` access levels. |
| `roleHierarchy` | `{}` | Role inheritance map. Example: `{ "admin": ["editor"] }` means admin inherits all editor permissions. Cycles are rejected at deploy time. |
| `defaultRole` | `'user'` | Role assigned to new users on signup. |
| `defaultAccess` | `'public'` | Access level applied to pages and handlers that don't specify an explicit `access` field. |
| `loginPage` | `'/login'` | Route for the login page. |
| `redirectAfterLogin` | `'/'` | Where to redirect after successful login. |
| `redirectAfterLogout` | `'/login'` | Where to redirect after logout. |

### Example

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
    "defaultAccess": "authenticated",
    "passwordPolicy": {
      "minLength": 10,
      "requireUppercase": true,
      "requireNumber": true
    },
    "redirectAfterLogin": "/dashboard"
  }
}
```

---

## Auth Pages

> **Removed (2026-04):** `AuthScaffoldProps`. There is no scaffold expander any more — when `security.authProviders` is configured and no auth pages exist in `frontend.pages`, the agent generates login / signup / forgot-password / reset-password / profile pages as ordinary Code Focus TSX components and wires them to the per-app auth router. There is no separate library of auth-page layout exemplars; the agent designs these pages like any other page.

---

## SecretConfig

Declares the named API keys/tokens an app expects (e.g. `STRIPE_API_KEY`). This
is a declaration surface — it documents the app's requirements for the agent and
for whoever operates the container; it does not itself store a value.

```typescript
interface SecretConfig {
  name: string;                // Secret name (e.g. 'STRIPE_API_KEY')
  summary?: string;            // Description for LLM context
  required?: boolean;          // If true, deployment fails when missing
}
```

Platform secrets are a separate concern: the container generates them on first
run and persists them under `/data/secrets/env.sh` (session secret, deploy
secret, gateway↔backend service token, agent proxy secret), so they survive
restarts and upgrades. See [Deployment](10-deployment.md).

---

## Data Collection (forms, contact, newsletter, surveys)

There is no platform "services" config field. Apps that collect data — contact forms, newsletter sign-ups, surveys, and similar — declare their own backend model (a table via `ModelConfig`) and write to it from a code component with `useModel().create()`. Anything beyond plain CRUD (aggregation, multi-table writes, external calls) goes in a custom handler. See the `crud-data-app` skill for the end-to-end pattern.

---

## Related Documents

- [State Management](05-state-and-actions.md) — State store, SDK hooks, and persistence
- [Component Catalog](04-component-catalog.md) — All component types and their specific props
- [Backend System](06-backend-system.md) — How models and handlers are executed
