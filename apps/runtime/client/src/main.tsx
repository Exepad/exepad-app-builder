import { StrictMode, lazy, Suspense, useState, useEffect, type ReactNode } from 'react';
import { createRoot, hydrateRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router';
import { router } from './router';
// Toaster is lazy so `sonner` (~33KB) stays out of the entry chunk, AND mounted
// only after the main thread goes idle (below) so its chunk never loads during
// the LCP window. It renders nothing until a toast fires, and sonner queues
// toasts in its own store, so a late mount never drops an early toast.
const Toaster = lazy(() => import('./components/ui/sonner').then((m) => ({ default: m.Toaster })));

/**
 * Render children only after the first idle period, so deferred chunks (the
 * Toaster's `sonner`) don't compete with the initial render for bandwidth/CPU
 * during the FCP/LCP window under mobile throttling.
 */
function MountAfterIdle({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const ric =
      (window as typeof window & { requestIdleCallback?: (cb: () => void) => number })
        .requestIdleCallback ?? ((cb: () => void) => window.setTimeout(cb, 200));
    const cic =
      (window as typeof window & { cancelIdleCallback?: (id: number) => void })
        .cancelIdleCallback ?? window.clearTimeout;
    const id = ric(() => setReady(true));
    return () => cic(id);
  }, []);
  return ready ? <>{children}</> : null;
}
// Self-hosted chrome fonts. Imported as JS modules (not via CSS @import) so Vite
// bundles + hashes their woff2 assets — see styles/studio-theme.css for why.
import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import '@fontsource-variable/inter';
import './globals.css';

const rootEl = document.getElementById('root')!;
const tree = (
  <StrictMode>
    <RouterProvider router={router} />
    {/* Chrome toaster: the rendered-app toaster lives under @layer exepad-app,
        so platform pages need their own. The theme is read passively, so this
        single global mount never fights DefaultThemeApplier on app routes.
        Lazy + idle-mounted + Suspense(null): invisible until a toast, deferred
        past the LCP window, so it costs nothing on initial load. */}
    <MountAfterIdle>
      <Suspense fallback={null}>
        <Toaster />
      </Suspense>
    </MountAfterIdle>
  </StrictMode>
);

// Stage 1: when the worker served deploy-time-prerendered markup into #root
// (`data-exepad-prerendered="1"` + real children), adopt it with hydrateRoot
// so the first paint is the streamed HTML and React attaches over it — no
// re-render flash. Otherwise (the default today, empty #root), mount fresh
// with createRoot. The marker is only set when the prerender feature flag is
// on AND an artifact exists, so this path is inert until Stage 1 is enabled.
//
// Before hydrating we reproduce the two pieces of synchronous state the server
// render depended on, both of which the client normally only establishes inside
// a post-mount effect (useRuntimeStore) — i.e. AFTER the first render, which
// would mismatch the server markup and trigger React #418:
//   1. the component registry (so CodeComponent resolves component→URL on its
//      first render), and
//   2. the first-fold module cache (so CodeComponent renders real content, not a
//      skeleton, on its first render).
// Both are derived from data already in the HTML (`__exepad_config` +
// `__exepad_prerender`), so this adds no network round-trip to the hydrate path.
function readJsonScript<T>(id: string): T | null {
  const el = document.getElementById(id);
  if (!el?.textContent) return null;
  try {
    return JSON.parse(el.textContent) as T;
  } catch {
    return null;
  }
}

async function hydratePrerendered() {
  try {
    const pp = readJsonScript<{ basePath: string; modules: string[] }>('__exepad_prerender');
    const cfg = readJsonScript<{ repo?: unknown }>('__exepad_config');
    if (pp && cfg) {
      const [
        { initializeComponentRegistry },
        { primeCodeComponentModule },
        { preloadComponents, getRegisteredComponentTypes },
      ] = await Promise.all([
        import('./lib/componentRegistry'),
        import('./app_runtime/runtime/components/custom/code/CodeComponent'),
        import('./registry'),
      ]);
      // Reproduce — synchronously, before hydrate — the three things the server
      // render depended on, all of which the client normally only establishes in
      // post-mount effects (so its first render would otherwise mismatch):
      //   1. the repo registry (CodeComponent resolves component→URL),
      //   2. the runtime registry (DynamicRenderer's getComponentSync returns
      //      CodeComponent itself — without this its first render is an empty
      //      slot vs the server's content → #418), and
      //   3. the first-fold module cache (CodeComponent renders real content).
      // Seed the SDK navigation fallback's base path synchronously BEFORE the
      // first render. useNavigation reads `window.__EXEPAD_BASE_PATH__` during
      // render to derive currentSlug; ExposePlatformGlobal normally sets it, but
      // it renders after the header/content, so the first render would otherwise
      // compute the wrong slug → active-nav markup mismatch → #418. The server
      // render seeds the same value, so both first renders agree.
      (window as unknown as { __EXEPAD_BASE_PATH__?: string }).__EXEPAD_BASE_PATH__ = pp.basePath;
      initializeComponentRegistry(cfg.repo as never, pp.basePath);
      await Promise.all([
        preloadComponents(getRegisteredComponentTypes()),
        ...(pp.modules || []).map(async (url) => {
          try {
            // @ts-ignore — external runtime URL, resolved via the page importmap
            const mod = await import(/* @vite-ignore */ url);
            primeCodeComponentModule(url, mod.default || mod.Component || mod);
          } catch {
            // A failed prime just leaves that slot to the normal lazy load —
            // the worst case is a single mismatched boundary, not a broken page.
          }
        }),
      ]);
    }
  } catch {
    // Non-fatal — hydrate regardless. Any unmatched boundary client-renders.
  }
  hydrateRoot(rootEl, tree);
}

if (rootEl.getAttribute('data-exepad-prerendered') === '1' && rootEl.firstElementChild) {
  void hydratePrerendered();
} else {
  createRoot(rootEl).render(tree);
}
