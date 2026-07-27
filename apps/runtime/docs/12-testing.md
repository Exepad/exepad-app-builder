# 12 — Testing

The runtime app uses a two-tier testing strategy: **Vitest 4** for unit, component, and integration tests that run in happy-dom, and **Playwright 1.58** for end-to-end browser tests.

---

## 1. Test Stack

| Layer            | Tool                        | Environment        |
|------------------|-----------------------------|--------------------|
| Unit tests       | Vitest 4 + Testing Library  | happy-dom          |
| Component tests  | Vitest 4 + Testing Library  | happy-dom          |
| Integration tests| Vitest 4 + Testing Library  | happy-dom          |
| E2E tests        | Playwright 1.58             | Real browsers      |
| Coverage         | V8 (via Vitest)             | —                  |

Key dependencies (`package.json`):

```
"@testing-library/jest-dom": "^6.9.1"
"@testing-library/react": "^16.3.0"
"happy-dom": "^20.8.9"
"vitest": "^4.0.18"
"hono": "^4.7.10"
"react-router": "^7.6.1"
"zustand": "^5.0.8"
```

---

## 2. Vitest Configuration

**File:** `vitest.config.ts`

```ts
// vitest.config.ts
export default defineConfig({
  plugins: [react()],
  test: {
    reporters: ['default', 'json'],
    outputFile: { json: path.resolve(__dirname, 'test-results.json') },
    pool: 'forks',
    testTimeout: 15000,
    teardownTimeout: 5000,
    globals: true,
    environment: 'happy-dom',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.{ts,tsx}'],
    exclude: [
      '**/node_modules/**',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/', 'tests/', 'e2e/',
        '**/*.test.ts', '**/*.test.tsx',
        '**/*.spec.ts', '**/*.spec.tsx',
      ],
    },
  },
  resolve: {
    alias: {
      // Match client tsconfig paths — all point to ./client/src/
      '@/runtime':     path.resolve(__dirname, './client/src/app_runtime/runtime'),
      '@/interfaces':  path.resolve(__dirname, './client/src/app_runtime/interfaces'),
      '@/types':       path.resolve(__dirname, './client/src/app_runtime/interfaces'),
      '@/app_runtime': path.resolve(__dirname, './client/src/app_runtime'),
      '@':             path.resolve(__dirname, './client/src'),
      '@tests':        path.resolve(__dirname, './tests'),
      // Worker dependencies for admin/deploy route tests
      'hono':               path.resolve(__dirname, './worker/node_modules/hono'),
      '@exepad/deploy-utils': path.resolve(__dirname, './worker/node_modules/@exepad/deploy-utils'),
    },
  },
});
```

Notable settings:

- **pool: 'forks'** — Tests run in forked worker processes for isolation and stability.
- **globals: true** — `describe`, `it`, `expect`, `vi`, `beforeEach`, `afterEach` are available globally without importing from `vitest`.
- **environment: happy-dom** — Tests run in happy-dom (faster and more compatible than jsdom).
- **Path aliases** — Mirror the client `tsconfig.json` paths, pointing to `./client/src/` so imports like `@/stores/appStore` resolve correctly.
- **Worker aliases** — `hono` and `@exepad/deploy-utils` are aliased to the worker's `node_modules` so admin and deploy route tests can import them.
- **No exclusions** — All admin, deploy, and lib tests have been migrated to the Hono worker pattern and run as part of the full suite.
- **Coverage exclusions** — Test files and test infrastructure are excluded from coverage reports.

---

## 3. Test Setup

**File:** `tests/setup.ts`

The setup file runs before every test suite. It configures the following mocks:

### 3.1 DOM API Mocks

```ts
// tests/setup.ts:11-20
globalThis.requestAnimationFrame = vi.fn((callback) => {
  return setTimeout(() => callback(Date.now()), 0);
});
globalThis.cancelAnimationFrame = vi.fn((id) => { clearTimeout(id); });
Element.prototype.scrollIntoView = vi.fn();
```

- **requestAnimationFrame / cancelAnimationFrame** — happy-dom does not implement these; they are stubbed with `setTimeout`.
- **scrollIntoView** — Required by Radix UI Select and other components that programmatically scroll.

### 3.2 React Router Mock

```ts
// tests/setup.ts:22-34
const mockNavigate = vi.fn();

vi.mock('react-router', async () => {
  const actual = await vi.importActual('react-router');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useParams: () => ({}),
    useSearchParams: () => [new URLSearchParams(), vi.fn()],
    useLocation: () => ({ pathname: '/', search: '', hash: '', state: null, key: 'default' }),
  };
});
```

The mock preserves all real `react-router` exports (e.g., `Link`, `MemoryRouter`) while overriding navigation hooks. `mockNavigate` is exported (`tests/setup.ts:84`) so individual tests can assert on navigation calls.

### 3.3 Environment Variables

```ts
// tests/setup.ts:37-45
(globalThis as any).import = {
  meta: {
    env: {
      MODE: 'test',
      VITE_BACKEND_URL: 'http://localhost:8000',
      VITE_WS_URL: 'ws://localhost:8000',
    },
  },
};
```

Vite's `import.meta.env` is mocked with `VITE_*` prefixed variables (replacing the old `NEXT_PUBLIC_*` convention).

### 3.4 WebSocket Mock

```ts
// tests/setup.ts:48-74
globalThis.WebSocket = class MockWebSocket {
  readyState = 1; // OPEN
  // ... onopen, onclose, onmessage, onerror handlers
  send(data: string) { /* no-op */ }
  close() { this.readyState = 3; /* CLOSED */ }
};
```

The mock WebSocket auto-fires `onopen` asynchronously and transitions to CLOSED on `close()`.

### 3.5 Console Suppression

```ts
// tests/setup.ts:76-81
globalThis.console = {
  ...console,
  error: vi.fn(),
  warn: vi.fn(),
};
```

`console.error` and `console.warn` are mocked to keep test output clean. Comment these out when debugging test failures.

### 3.6 jest-dom Matchers

```ts
// tests/setup.ts:8
import '@testing-library/jest-dom';
```

Adds DOM matchers like `toBeInTheDocument()`, `toHaveTextContent()`, `toBeVisible()`, etc. This is still `@testing-library/jest-dom` — it works with Vitest's `expect` via the `globals: true` configuration.

---

## 4. Test Structure

### Directory Layout

```
tests/
  setup.ts                          Global setup (mocks)
  mocks/
    mockConfigs.ts                  Shared mock WebAppProps configs
  utils/
    renderWithProviders.tsx         Custom render with all context providers
    testUtils.ts                   Helper functions (mockFetch, mockLocalStorage, etc.)
  unit/
    stores/                        Zustand store tests
    services/                      Service class tests
    hooks/                         Custom hook tests
    lib/                           Client library/utility tests
      security/                    SecurityRuleSet + urlGuard
    utils/                         Utility function tests
    components/                    Isolated component tests
    client/                        Client widgets + URL validation
    config/                        Config normalization/validation tests
    core/                          Core infrastructure tests (PreviewPage)
    deploy/                        Deploy pipeline tests
    registry/                      Component registry tests
    worker/                        Worker unit tests
      lib/                         Worker libs (meta-db, origin, security-headers, …)
      routes/                      Route handlers (gateway, deprovision, diagnostic)
    server/                        Node server surface (auth, publish, network, …)
    admin/                         Hono worker admin route tests
      database/                    Database admin CRUD (tables, rows, schema)
      users/                       User management admin routes
      export/                      Export bundle builders
      source/                      Generated-source route
      lib/                         Shared admin utilities (password, SQL builders)
  components/                      Standalone component test (CodeComponentPlaceholder)
  hooks/                           Hook tests (legacy location)
  integration/
    AppConfigContext.test.tsx       Config context integration
    DynamicRenderer.test.tsx        Full renderer integration
    contexts/                      Context provider integration tests
      AppContext.test.tsx
      ConfigUpdateContext.test.tsx
      EditModeContext.test.tsx
      TransitionContext.test.tsx
      context-edges.test.tsx
```

### Test File Counts

121 test files in total. By directory:

| Directory                  | Files | What They Test                              |
|----------------------------|-------|---------------------------------------------|
| `tests/unit/server/`       | 22    | Node server surface — auth setup, publish lifecycle/isolation, network, domains, quick-access, in-process dispatch, materialize-build, TLS cert |
| `tests/unit/worker/`       | 20    | Worker libs (meta-db, origin, security-headers, custom-domains, sql-whitelist, …) + routes (gateway dispatch, deprovision, diagnostic) + friendly-slug rewrite |
| `tests/unit/admin/`        | 17    | Admin routes — database (4), users (4), export (4), lib (2), settings, source, read-only provisioning |
| `tests/unit/lib/`          | 11    | Client libs — jwt-helper, platformAuth, logger, published-url, color contrast, single-app, on-demand TLS, security/ (2) |
| `tests/unit/components/`   | 7     | DynamicRenderer, DynamicTheme, DefaultLoginPage, HeadTagsRenderer, LogoutHandler, PlatformAuthControl, CodeComponentContrastBoundary |
| `tests/unit/services/`     | 6     | AdminApi, ConfigService, ErrorReportingService, PersistenceService, StudioStream, WebSocketManager |
| `tests/unit/utils/`        | 5     | LifecycleManager, componentComparison, authAccess, fontUtils, layoutPatterns |
| `tests/unit/deploy/`       | 5     | deploy-endpoint, deploy-internal-publish, image-capture, r2-helpers, runtime-security |
| `tests/unit/client/`       | 5     | ExepadImage, SettingsImagesPanel, domain-input, urlValidator, useBrokenImageFallback |
| `tests/unit/hooks/`        | 4     | data-fetch-hooks, useCurrentPage, useLifecycle, useRuntimeStore |
| `tests/unit/config/`       | 4     | access-resolver, normalizer, security-validator, unifiedConfig |
| `tests/unit/stores/`       | 2     | appStore, appStateStore                     |
| `tests/unit/core/`         | 1     | PreviewPage                                 |
| `tests/unit/registry/`     | 1     | Component registry                          |
| `tests/components/`        | 1     | CodeComponentPlaceholder                    |
| `tests/hooks/`             | 3     | useLifecycle, useMobile, use-toast (legacy location) |
| `tests/integration/`       | 7     | AppConfigContext, DynamicRenderer, contexts/ (5) |

---

## 5. Test Commands

Scripts defined in `package.json`:

| Command                   | Script                                    | Description                           |
|---------------------------|-------------------------------------------|---------------------------------------|
| `pnpm test`               | `vitest run`                              | Run all Vitest tests once             |
| `pnpm check`              | `tsc --noEmit` (client + worker)          | TypeScript type checking              |

Additional Vitest CLI options can be passed directly:

```bash
pnpm test tests/unit               # Unit tests only
pnpm test tests/integration        # Integration tests only
pnpm test -- --coverage            # Run with V8 coverage report
pnpm vitest                        # Watch mode (re-runs on file change)
pnpm vitest --ui                   # Vitest UI dashboard in browser
```

---

## 6. Playwright Configuration

**File:** `playwright.config.ts`

```ts
// playwright.config.ts:7-75
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,        // Fail CI if test.only left in
  retries: process.env.CI ? 2 : 0,     // Retry twice on CI
  workers: process.env.CI ? 1 : undefined,  // Sequential on CI

  reporter: [
    ['html', { open: 'never' }],
    ['list'],
  ],

  use: {
    baseURL: 'http://localhost:3001',
    trace: 'on-first-retry',           // Collect trace on retry
    screenshot: 'only-on-failure',
  },

  projects: [
    { name: 'chromium',       use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox',        use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit',         use: { ...devices['Desktop Safari'] } },
    { name: 'Mobile Chrome',  use: { ...devices['Pixel 5'] } },
    { name: 'Mobile Safari',  use: { ...devices['iPhone 12'] } },
  ],

  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:3001',
    reuseExistingServer: !process.env.CI,
    timeout: 120 * 1000,               // 2 min startup timeout
  },
});
```

Key details:

- **5 browser targets** (`playwright.config.ts:41-65`): Chromium, Firefox, WebKit, Pixel 5 (mobile Chrome), iPhone 12 (mobile Safari).
- **Auto-starts dev server** (`playwright.config.ts:69-74`): Runs `pnpm dev` before tests. On local dev, reuses an existing server if one is already running.
- **Base URL** (`playwright.config.ts:31`): `http://localhost:3001` — all `page.goto('/')` calls resolve against this.
- **CI behavior**: Sequential workers, 2 retries, `test.only` forbidden, fresh dev server per run.
- **Trace collection** (`playwright.config.ts:34`): Full trace recorded on first retry for debugging flaky tests.
- **Screenshots** (`playwright.config.ts:37`): Captured automatically on test failure.

---

## 7. E2E Test Structure

**Directory:** `e2e/`

| File                          | Description                                    |
|-------------------------------|------------------------------------------------|
| `app-rendering.spec.ts`      | Verifies demo apps render: header, sections, footer, images, responsive layout |
| `form-interactions.spec.ts`  | Tests form field interactions: input, validation, submission |
| `phase2-backend.spec.ts`     | Backend CRUD integration: API calls, data display, error handling |
| `preview-mode.spec.ts`       | Preview mode: WebSocket connection, config updates, edit mode |
| `state-management.spec.ts`   | State interactions: button clicks, rapid clicks, navigation, page errors |

All E2E tests use the `*.spec.ts` naming convention (vs `*.test.ts` for Vitest). They navigate to demo app routes (e.g., `/demo/beauty-center`) and assert on rendered DOM structure and interactive behavior.

---

## 8. Testing Patterns

### 8.1 Testing a Zustand Store

Source reference: `tests/unit/stores/appStore.test.ts`

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useAppStore } from '@/stores/appStore';

beforeEach(() => {
  // Reset store to initial state before each test
  useAppStore.setState({
    appConfig: null,
    selectedComponentId: null,
    isEditMode: false,
    contentUpdates: new Map(),
    processingComponentIds: new Set(),
    wsConnectionStatus: 'disconnected',
  });
});

describe('AppStore', () => {
  it('should set app config', () => {
    useAppStore.getState().setAppConfig(mockAppConfig);
    expect(useAppStore.getState().appConfig).toEqual(mockAppConfig);
  });

  it('should toggle edit mode', () => {
    useAppStore.getState().toggleEditMode();
    expect(useAppStore.getState().isEditMode).toBe(true);
  });
});
```

Pattern: Call `useAppStore.setState()` in `beforeEach` to reset, then invoke actions via `useAppStore.getState().actionName()` and assert on `useAppStore.getState().property`.

### 8.2 Testing a Custom Hook

Source reference: `tests/unit/hooks/useAppStateHooks.test.ts`

```ts
import { renderHook, act, waitFor } from '@testing-library/react';
import { useAppState } from '@/hooks/useAppStateHooks';
import { useAppStateStore } from '@/stores/appStateStore';

// Mock the backing store
vi.mock('@/stores/appStateStore', async () => {
  const actual = await vi.importActual('zustand');
  const createStore = (actual as any).create;
  const createMockStore = () => createStore((set, get) => ({
    _state: {},
    get: vi.fn((key) => get()._state[key]),
    set: vi.fn((key, value) => {
      set((state) => ({ _state: { ...state._state, [key]: value } }));
    }),
    // ... other store methods
  }));
  return { useAppStateStore: createMockStore() };
});

describe('useAppState', () => {
  it('should return state value', () => {
    useAppStateStore.setState({ _state: { count: 42 } });
    const { result } = renderHook(() => useAppState('count'));
    expect(result.current).toBe(42);
  });
});
```

Pattern: Use `renderHook` from Testing Library. Mock the backing Zustand store with `vi.mock` and `vi.importActual('zustand')` to create a real store with mock methods.

### 8.3 Testing a Component

Source reference: `tests/utils/renderWithProviders.tsx`

```ts
import { renderWithProviders, screen } from '@tests/utils/renderWithProviders';
import { Button } from '@/app_runtime/runtime/components/custom/common/core/Button';

// Mock React Router (already mocked globally in setup.ts, but can override per-test)
vi.mock('react-router', async () => {
  const actual = await vi.importActual('react-router');
  return {
    ...actual,
    useNavigate: () => vi.fn(),
    useLocation: () => ({ pathname: '/', search: '', hash: '', state: null, key: 'default' }),
  };
});

describe('Button', () => {
  it('renders with text', () => {
    renderWithProviders(<Button uuid="btn-1" componentType="ButtonProps" text="Click me" />);
    expect(screen.getByText('Click me')).toBeInTheDocument();
  });

  it('handles click events', () => {
    const onClick = vi.fn();
    renderWithProviders(<Button uuid="btn-1" componentType="ButtonProps" text="Click" onClick={onClick} />);
    fireEvent.click(screen.getByText('Click'));
    expect(onClick).toHaveBeenCalled();
  });
});
```

The `renderWithProviders` function (`tests/utils/renderWithProviders.tsx:76-86`) wraps components in all required context providers: `AppConfigProvider`, `TransitionProvider`, and `EditModeProvider`. A `renderWithPreviewProviders` variant (`tests/utils/renderWithProviders.tsx:91-105`) sets `mode: 'preview'` for testing preview-specific behavior.

### 8.4 Testing a Hono Route

Source reference: `tests/unit/admin/database/tables.test.ts`

Admin and deploy route tests import Hono sub-routers from the worker source, mount them in a test-local Hono app, and use `app.request()` to simulate HTTP requests without a running server:

```ts
import { vi, describe, it, expect, beforeEach } from 'vitest';

// Mock dependencies at module level (before imports)
const mockAuthenticateAdmin = vi.fn();
const mockExecuteD1DDL = vi.fn();

vi.mock('../../../../worker/src/lib/admin-auth', () => ({
  authenticateAdmin: (...args: unknown[]) => mockAuthenticateAdmin(...args),
}));

vi.mock('@exepad/deploy-utils', () => ({
  executeD1DDL: (...args: unknown[]) => mockExecuteD1DDL(...args),
}));

// Import Hono router AFTER mocks are set up
import { Hono } from 'hono';
import { database } from '../../../../worker/src/routes/admin/database';

// Mount the sub-router to match production layout
const app = new Hono();
app.route('/:appId/database', database);

describe('GET /tables', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticateAdmin.mockResolvedValue({
      appId: 'test-app',
      config: { accountId: 'acc', apiToken: 'tok' },
      dbId: 'db-123',
    });
  });

  it('returns user tables', async () => {
    mockExecuteD1DDL.mockResolvedValueOnce({
      results: [{ name: 'products' }, { name: 'orders' }],
    });

    const res = await app.request('/test-app/database/tables', {
      method: 'GET',
      headers: { Authorization: 'Bearer test-token' },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tables).toHaveLength(2);
  });
});
```

Pattern: Use `vi.mock()` to stub external dependencies (auth, database), import the Hono sub-router, mount it with `app.route()`, then call `app.request(path, init)` to test HTTP handling. The `hono` and `@exepad/deploy-utils` aliases in `vitest.config.ts` ensure these imports resolve correctly from the worker's `node_modules`.

### 8.5 Writing an E2E Test

Source reference: `e2e/app-rendering.spec.ts`

```ts
import { test, expect } from '@playwright/test';

test.describe('Demo App Rendering', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/demo/beauty-center', { waitUntil: 'networkidle' });
  });

  test('should render header navigation', async ({ page }) => {
    const nav = page.locator('nav, header');
    const navCount = await nav.count();

    if (navCount > 0) {
      await expect(nav.first()).toBeVisible();
      const navLinks = nav.first().locator('a, button');
      const linkCount = await navLinks.count();
      expect(linkCount).toBeGreaterThan(0);
    }
  });

  test('should respond to button clicks without errors', async ({ page }) => {
    const buttons = page.locator('button:not([disabled])');
    if (await buttons.count() > 0) {
      let hasError = false;
      page.on('pageerror', () => { hasError = true; });
      await buttons.first().click();
      await page.waitForTimeout(500);
      expect(hasError).toBe(false);
    }
  });
});
```

Pattern: Navigate to a demo app route, wait for network idle, then assert on DOM structure and interaction behavior. Use `page.on('pageerror', ...)` to detect unhandled runtime errors.

---

## 9. Test Utilities

### 9.1 renderWithProviders

**File:** `tests/utils/renderWithProviders.tsx`

Wraps a component in the full provider tree required by the runtime:

```
AppConfigProvider → TransitionProvider → EditModeProvider → {children}
```

Accepts `providerOptions` to customize `appConfig`, `basePath`, `appId`, `mode`, and `routeType`.

### 9.2 testUtils

**File:** `tests/utils/testUtils.ts`

Shared helpers available to all tests:

| Function                    | Purpose                                                |
|-----------------------------|--------------------------------------------------------|
| `createMockFetchResponse()` | Creates a mock `Response` object                       |
| `mockFetch()`               | Replaces `global.fetch` with sequenced mock responses  |
| `resetAllMocks()`           | Clears and restores all `vi` mocks                     |
| `createMockEvent()`         | Creates a mock DOM Event                               |
| `createMockMouseEvent()`    | Creates a mock MouseEvent                              |
| `createMockKeyboardEvent()` | Creates a mock KeyboardEvent                           |
| `mockLocalStorage()`        | In-memory localStorage mock                            |
| `mockIntersectionObserver()`| Mock IntersectionObserver                              |
| `mockResizeObserver()`      | Mock ResizeObserver                                    |
| `mockMatchMedia()`          | Mock window.matchMedia                                 |
| `suppressConsole()`         | Suppress console.log/warn/error during test lifecycle  |
| `generateTestUuid()`        | Random test UUID generator                             |
| `createDeferred()`          | Promise with externally accessible resolve/reject      |

### 9.3 mockConfigs

**File:** `tests/mocks/mockConfigs.ts`

Shared mock `WebAppProps` configurations used across component and integration tests. Provides a realistic app config structure with pages, components, state, and theming for consistent test fixtures.
