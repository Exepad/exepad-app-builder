import { createBrowserRouter } from 'react-router';
import { lazy, Suspense, type ComponentType } from 'react';

const HomePage = lazy(() => import('./pages/HomePage'));
const AppLayout = lazy(() => import('./pages/AppLayout'));
const AppPage = lazy(() => import('./pages/AppPage'));
const DemoLayout = lazy(() => import('./pages/DemoLayout'));
const DemoPage = lazy(() => import('./pages/DemoPage'));
const ExampleLayout = lazy(() => import('./pages/ExampleLayout'));
const ExamplePage = lazy(() => import('./pages/ExamplePage'));
const RouterErrorBoundary = lazy(() => import('./pages/RouterErrorBoundary'));
const LoginPage = lazy(() => import('./pages/LoginPage'));
const StudioPage = lazy(() => import('./pages/StudioPage'));
const AppsPage = lazy(() => import('./pages/AppsPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const ProfilePage = lazy(() => import('./pages/ProfilePage'));
const AboutPage = lazy(() => import('./pages/AboutPage'));
const StudioShell = lazy(() => import('./components/studio/StudioShell'));

function LazyFallback() {
  return (
    <div
      className="flex items-center justify-center min-h-screen"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <div className="animate-pulse text-muted-foreground" aria-hidden="true">Loading...</div>
      <span className="sr-only">Loading, please wait…</span>
    </div>
  );
}

function withSuspense(Component: React.LazyExoticComponent<ComponentType<any>>) {
  return (
    <Suspense fallback={<LazyFallback />}>
      <Component />
    </Suspense>
  );
}

/**
 * Detect server-injected appId for subdomain routing.
 * When served via a subdomain (e.g. stratosdigital.exepad.app), the Worker injects
 * data-app-id on the root element so the SPA knows which app to load.
 */
function getServerAppId(): string | null {
  const root = document.getElementById('root');
  return root?.getAttribute('data-app-id') ?? null;
}

const serverAppId = getServerAppId();

export const router = createBrowserRouter([
  // On subdomain: server injected appId, route all paths through AppLayout
  ...(serverAppId ? [{
    path: '/*',
    element: withSuspense(AppLayout),
    errorElement: withSuspense(RouterErrorBoundary),
    children: [
      { path: '*', element: withSuspense(AppPage) },
    ],
  }] : [
    {
      path: '/',
      element: withSuspense(HomePage),
      errorElement: withSuspense(RouterErrorBoundary),
    },
    // Self-host builder UI (the bare runtime origin only — never on subdomains).
    {
      path: '/login',
      element: withSuspense(LoginPage),
      errorElement: withSuspense(RouterErrorBoundary),
    },
    {
      path: '/studio',
      element: withSuspense(StudioPage),
      errorElement: withSuspense(RouterErrorBoundary),
    },
    {
      path: '/studio/:appId',
      element: withSuspense(StudioPage),
      errorElement: withSuspense(RouterErrorBoundary),
    },
    // Sidebar shell wraps the operator dashboard pages. /studio and /login stay
    // full-bleed (handled above / below).
    {
      element: withSuspense(StudioShell),
      errorElement: withSuspense(RouterErrorBoundary),
      children: [
        { path: '/apps', element: withSuspense(AppsPage) },
        { path: '/settings', element: withSuspense(SettingsPage) },
        { path: '/profile', element: withSuspense(ProfilePage) },
        { path: '/help/about', element: withSuspense(AboutPage) },
      ],
    },
  ]),
  {
    path: '/a/:appId/*',
    element: withSuspense(AppLayout),
    errorElement: withSuspense(RouterErrorBoundary),
    children: [
      { path: '*', element: withSuspense(AppPage) },
    ],
  },
  {
    path: '/demo/:appId/*',
    element: withSuspense(DemoLayout),
    errorElement: withSuspense(RouterErrorBoundary),
    children: [
      { path: '*', element: withSuspense(DemoPage) },
    ],
  },
  {
    path: '/example/*',
    element: withSuspense(ExampleLayout),
    errorElement: withSuspense(RouterErrorBoundary),
    children: [
      { path: '*', element: withSuspense(ExamplePage) },
    ],
  },
]);
