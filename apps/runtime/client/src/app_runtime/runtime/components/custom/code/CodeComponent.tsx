// src/app_runtime/runtime/components/custom/code/CodeComponent.tsx

import * as React from 'react';
import { Suspense, useState, useEffect, useRef, useCallback, useMemo, ComponentType } from 'react';
import { cn } from '@/lib/utils';
import { logger } from '@/lib/logger';
import { getEditorOrigin } from '@/lib/editor-origin';
import { componentRegistry } from '@/lib/componentRegistry';
import { loadExtensionsIntoImportMap } from '@/lib/extensionLoader';
import { CodeComponentProps } from '@/app_runtime/interfaces/code_components/code_component';
// Inline skeleton replacement (shadcn/ui primitives removed)
const Skeleton: React.FC<{ className?: string }> = ({ className }) => (
  <div className={cn("animate-pulse rounded-md bg-muted", className)} />
);
import { isAllowedUrl, RemoteUrlValidationError } from './urlValidator';
import { LinkInterceptor } from './LinkInterceptor';
import { CodeComponentContrastBoundary } from './CodeComponentContrastBoundary';
import { useEditMode } from '@/context/EditModeContext';

// ============================================================================
// Types
// ============================================================================

interface ModuleCacheEntry {
  module: ComponentType<any> | null;
  promise: Promise<ComponentType<any>> | null;
  error: Error | null;
  loadedAt: number;
}

interface CodeModuleCache {
  [url: string]: ModuleCacheEntry;
}

interface LoadingState {
  status: 'idle' | 'loading' | 'success' | 'error';
  error?: Error;
}

interface UseCodeComponentResult {
  Component: ComponentType<any> | null;
  loading: boolean;
  error: Error | null;
  retry: () => void;
}

// ============================================================================
// Module Cache (Singleton)
// ============================================================================

const moduleCache: CodeModuleCache = {};
const CACHE_TTL_MS = 1000 * 60 * 30; // 30 minutes

/**
 * Clear a specific URL from the cache
 */
function clearCacheEntry(url: string): void {
  delete moduleCache[url];
}

/**
 * Clear all entries from the cache
 */
export function clearCodeComponentCache(): void {
  Object.keys(moduleCache).forEach(key => delete moduleCache[key]);
}

/**
 * Drop the `?hash=` (or any) cache-buster query so a primed module matches the
 * URL `CodeComponent` resolves regardless of whether a hash was appended.
 * `CodeComponent` only appends `?hash=` when it can parse the resolved URL as
 * absolute; priming + lookup both normalize through here so the two always meet.
 */
function stripCacheBust(url: string): string {
  const i = url.indexOf('?');
  return i === -1 ? url : url.slice(0, i);
}

/**
 * Synchronously read an already-loaded module for `url` from the cache, trying
 * the exact key first then the cache-bust-stripped key. Returns null when no
 * resolved module is cached (still loading, errored, or never requested).
 */
function getCachedModule(url: string): ComponentType<any> | null {
  if (!url) return null;
  const direct = moduleCache[url];
  if (direct?.module) return direct.module;
  const bare = stripCacheBust(url);
  if (bare !== url) {
    const stripped = moduleCache[bare];
    if (stripped?.module) return stripped.module;
  }
  return null;
}

/**
 * Prime the module cache with an already-resolved component so the NEXT render
 * of a `CodeComponent` pointed at `url` resolves it SYNCHRONOUSLY — no skeleton,
 * no effect round-trip. Two callers:
 *  - Stage-1 SSR: the server render harness primes first-fold components so the
 *    streamed HTML carries real content (+ proper Suspense markers) instead of
 *    skeletons.
 *  - Client hydration: `main.tsx` imports the modulepreloaded first-fold chunks
 *    and primes them BEFORE `hydrateRoot`, so the client's first render produces
 *    the SAME tree the server streamed → clean hydrate, no React #418.
 *
 * Stored under both the given URL and its cache-bust-stripped form so the lookup
 * in `useCodeComponent` (and `importRemoteModule`'s own exact-key check) hit
 * regardless of the `?hash=` suffix.
 */
export function primeCodeComponentModule(url: string, component: ComponentType<any>): void {
  if (!url || !validateReactComponent(component)) return;
  const entry: ModuleCacheEntry = {
    module: component,
    promise: null,
    error: null,
    loadedAt: Date.now(),
  };
  moduleCache[url] = entry;
  const bare = stripCacheBust(url);
  if (bare !== url) moduleCache[bare] = entry;
}

// ============================================================================
// Remote Module Loader
// ============================================================================

/**
 * Dynamically imports a remote ES module from a URL.
 * Includes caching, validation, and error handling.
 */
async function importRemoteModule(url: string): Promise<ComponentType<any>> {
  // Validate URL first
  const validation = isAllowedUrl(url);
  if (!validation.allowed) {
    throw new RemoteUrlValidationError(
      `Code component URL blocked: ${validation.reason}`,
      url,
      validation.reason || 'Unknown validation error'
    );
  }

  // Use the resolved URL (handles relative paths)
  const resolvedUrl = validation.parsedUrl?.href || url;

  // Check cache using original URL as key for consistency
  const cached = moduleCache[url];
  if (cached) {
    const isExpired = Date.now() - cached.loadedAt > CACHE_TTL_MS;

    if (!isExpired) {
      if (cached.error) throw cached.error;
      if (cached.module) return cached.module;
      if (cached.promise) return cached.promise;
    } else {
      // Clear expired entry
      clearCacheEntry(url);
    }
  }

  // Create loading promise
  const loadPromise = (async (): Promise<ComponentType<any>> => {
    try {
      logger.log(`[CodeComponent] Loading module from: ${resolvedUrl}`);

      // Dynamic import with @vite-ignore to prevent bundling attempts
      // @ts-ignore - Dynamic import of external URL
      const module = await import(/* @vite-ignore */ resolvedUrl);

      // Support multiple export patterns
      const Component = module.default || module.Component || module;

      // Validate that we got a valid React component
      const isValidComponent = validateReactComponent(Component);

      if (!isValidComponent) {
        throw new Error(
          `Code module at ${url} does not export a valid React component. ` +
          `Received: ${typeof Component}`
        );
      }

      logger.log(`[CodeComponent] Successfully loaded: ${url}`);

      // Update cache with successful load
      moduleCache[url] = {
        module: Component,
        promise: null,
        error: null,
        loadedAt: Date.now(),
      };

      return Component;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));

      logger.error(`[CodeComponent] Failed to load: ${url}`, err);

      // Do NOT cache load failures. A transient network error would otherwise
      // poison this URL for the full CACHE_TTL_MS (30 min), so one blip would
      // keep the component broken long after the network recovered. Drop the
      // entry entirely so the very next mount/retry re-attempts the import.
      // Only SUCCESSFUL loads are cached (above).
      clearCacheEntry(url);

      throw err;
    }
  })();

  // Store promise in cache while loading
  moduleCache[url] = {
    module: null,
    promise: loadPromise,
    error: null,
    loadedAt: Date.now(),
  };

  return loadPromise;
}

/**
 * Validates that a value is a valid React component
 */
function validateReactComponent(component: unknown): boolean {
  if (!component) return false;

  // Function component
  if (typeof component === 'function') {
    return true;
  }

  // Object-based components (memo, forwardRef, lazy)
  if (typeof component === 'object') {
    const obj = component as any;

    // React.memo, React.forwardRef
    if (obj.$$typeof) return true;

    // React.lazy
    if (obj._payload && obj._init) return true;

    // Class component or forwardRef with render
    if (typeof obj.render === 'function') return true;
  }

  return false;
}

// ============================================================================
// Custom Hook: useCodeComponent
// ============================================================================

/**
 * Hook to load and manage a code component.
 * Handles loading state, caching, and retry logic.
 */
function useCodeComponent(url: string): UseCodeComponentResult {
  // Synchronous cache read on first render: if the module is already loaded
  // (SSR-primed, hydration-primed, or loaded on a prior mount) initialize
  // straight to `success` with the component in hand. This is what makes the
  // server render and the client's FIRST hydrate render produce identical
  // content (no skeleton→content swap, no #418), and it also lets warm SPA
  // navigations paint cached components in a single step.
  const warmInitial = getCachedModule(url);
  const [state, setState] = useState<LoadingState>(
    warmInitial ? { status: 'success' } : { status: 'idle' },
  );
  // Lazy-initializer FORM is required: `component` holds a function (the React
  // component), and `useState(fn)` would invoke `fn` as an initializer — storing
  // its render output instead of the component itself. `() => warmInitial`
  // stores the component verbatim. (Same reason the loader uses `setComponent(() => ...)`.)
  const [component, setComponent] = useState<ComponentType<any> | null>(() => warmInitial);
  const mountedRef = useRef(true);
  const urlRef = useRef(url);

  const loadComponent = useCallback(async () => {
    if (!url) {
      // An empty url is a transient pre-resolution state, NOT a failure: the
      // component registry resolves compiled URLs asynchronously, so the first
      // render(s) pass '' until `registryReady` flips. Stay in idle/skeleton so
      // the effect re-runs and loads once the real URL arrives. Setting an
      // error here recorded a stale "No URL provided" that, on the very next
      // render (urlWithHash resolved but this effect not yet re-run), got
      // misclassified as `module_eval_failed` and spammed the console for
      // components that then loaded fine. The genuine never-resolves case is
      // reported as `unresolved_url` by the caller, correctly gated on
      // `registryReady`.
      setState({ status: 'idle' });
      return;
    }

    // Warm cache (SSR/hydration-primed or previously loaded) → resolve without
    // the `loading` transition. Flipping to `loading` here would unmount the
    // just-hydrated content for a frame (reflow + breaks hydration adoption).
    const warm = getCachedModule(url);
    if (warm) {
      if (mountedRef.current && urlRef.current === url) {
        setComponent(() => warm);
        setState({ status: 'success' });
      }
      return;
    }

    setState({ status: 'loading' });

    try {
      const LoadedComp = await importRemoteModule(url);

      if (mountedRef.current && urlRef.current === url) {
        setComponent(() => LoadedComp);
        setState({ status: 'success' });
      }
    } catch (err) {
      if (mountedRef.current && urlRef.current === url) {
        setState({
          status: 'error',
          error: err instanceof Error ? err : new Error(String(err)),
        });
      }
    }
  }, [url]);

  useEffect(() => {
    mountedRef.current = true;
    urlRef.current = url;
    loadComponent();

    return () => {
      mountedRef.current = false;
    };
  }, [url, loadComponent]);

  const retry = useCallback(() => {
    // Clear cache for this URL to force reload
    clearCacheEntry(url);
    setComponent(null);
    loadComponent();
  }, [url, loadComponent]);

  return {
    Component: component,
    loading: state.status === 'loading' || state.status === 'idle',
    error: state.error || null,
    retry,
  };
}

// ============================================================================
// Fallback Components
// ============================================================================

/**
 * Default loading skeleton for code components
 */
const CodeComponentSkeleton: React.FC<{ className?: string; style?: React.CSSProperties }> = ({ className, style }) => (
  <div className={cn("w-full space-y-4 p-6", className)} style={style}>
    <Skeleton className="h-8 w-3/4" />
    <Skeleton className="h-4 w-full" />
    <Skeleton className="h-4 w-5/6" />
    <Skeleton className="h-32 w-full" />
  </div>
);

/**
 * Failure classes the runtime distinguishes for side-channel reporting.
 *
 * End users see the same generic placeholder for all of them — these
 * labels are only emitted to the console + the
 * ``exepad:code-component-failure`` CustomEvent so platform operators
 * (and the dashboard frame) can act on them without polluting the
 * rendered preview with technical detail. See
 * ``apps/agent/docs/validation/severity-policy.md`` and the Change E
 * rationale in the stability plan.
 */
type CodeComponentFailureClass =
  | 'fetch_failed'
  | 'module_eval_failed'
  | 'render_failed'
  | 'blocked'
  | 'unresolved_url';

interface CodeComponentFailureDetail {
  componentName?: string;
  componentUuid?: string;
  failureClass: CodeComponentFailureClass;
  errorMessage: string;
  errorStack?: string;
  /** React component stack (only present for ``render_failed``). */
  componentStack?: string;
  url?: string;
}

/**
 * Emit a structured failure to the side-channel.
 *
 * Three sinks today: (1) browser console (operators F12-debugging see
 * full detail); (2) a window-level ``CustomEvent`` so a parent dashboard
 * frame can listen; (3) ``window.postMessage`` for cross-origin
 * dashboard contexts. The end-user-facing DOM stays clean — only the
 * generic placeholder renders.
 */
export function reportCodeComponentFailure(
  detail: CodeComponentFailureDetail,
): void {
  // Sink 1 — console. Already logged by callers via ``logger.error`` for
  // pre-existing observability; this entry is structured-event style.
  logger.error('[CodeComponent] failure', detail);

  if (typeof window === 'undefined') {
    return;
  }
  // Sink 2 — same-document CustomEvent. Lets in-page tooling (e.g. an
  // editor sidebar mounted as a sibling React tree) react.
  try {
    window.dispatchEvent(
      new CustomEvent('exepad:code-component-failure', { detail }),
    );
  } catch {
    // CustomEvent unsupported in extremely old browsers; sink 1 still fires.
  }
  // Sink 3 — postMessage for the dashboard iframe parent. Targeted to the
  // editor origin (defaults to https://app.exepad.com via VITE_EDITOR_ORIGIN)
  // so cross-origin sandboxes don't log a "targetOrigin does not match"
  // warning on every page render. The payload still carries no secrets;
  // we only narrow the recipient to silence browser console noise.
  //
  // Skip entirely when this window IS the top frame — no iframe parent
  // means no editor to receive the message, and Chrome still emits the
  // targetOrigin-mismatch warning even though `window.parent === window`
  // makes the post a no-op. Observed on standalone preview navigations.
  if (typeof window !== 'undefined' && window.parent !== window) {
    try {
      const editorOrigin = getEditorOrigin();
      window.parent.postMessage(
        { type: 'exepad:code-component-failure', detail },
        editorOrigin,
      );
    } catch {
      // postMessage can throw on cross-origin sandboxes; ignore silently.
    }
  }
}

/**
 * Generic placeholder shown to end users when a code component fails to
 * load OR fails to render.
 *
 * Deliberately neutral — no error language, no URLs, no stack traces.
 * Exepad targets non-technical users; surfacing technical detail in the
 * rendered preview reads as "the whole platform is broken" to a non-dev.
 * Operators get the full failure detail through the side-channel via
 * :func:`reportCodeComponentFailure`.
 *
 * Same component used for fetch / module-eval / render / security-block
 * failure classes. The slot occupies the host's layout dimensions so the
 * page doesn't reflow.
 */
export const CodeComponentPlaceholder: React.FC<{
  className?: string;
  style?: React.CSSProperties;
}> = ({ className, style }) => (
  <div
    className={cn(
      "flex items-center justify-center min-h-[120px] p-6 rounded-lg",
      "border border-muted bg-muted/30 text-muted-foreground",
      className,
    )}
    style={style}
    role="status"
    aria-live="polite"
  >
    <p className="text-sm">This section isn't available right now.</p>
  </div>
);

// ============================================================================
// Error Boundary for Code Components
// ============================================================================

interface CodeErrorBoundaryProps {
  children: React.ReactNode;
  fallback?: React.ReactNode;
  url: string;
  componentName?: string;
  componentUuid?: string;
  onError?: (error: Error) => void;
}

interface CodeErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class CodeErrorBoundary extends React.Component<
  CodeErrorBoundaryProps,
  CodeErrorBoundaryState
> {
  constructor(props: CodeErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): CodeErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    // Render error: the JS module loaded successfully but the component
    // crashed at first render (React #130 etc). Side-channel-only —
    // end users see the generic placeholder. ``reportCodeComponentFailure``
    // is the single sink for both the console and the structured event,
    // so we don't double-log here.
    reportCodeComponentFailure({
      componentName: this.props.componentName,
      componentUuid: this.props.componentUuid,
      failureClass: 'render_failed',
      errorMessage: error.message,
      errorStack: error.stack,
      componentStack: errorInfo.componentStack ?? undefined,
      url: this.props.url,
    });

    this.props.onError?.(error);
  }

  render(): React.ReactNode {
    if (this.state.hasError && this.state.error) {
      return this.props.fallback ?? <CodeComponentPlaceholder />;
    }

    return this.props.children;
  }
}

// ============================================================================
// Main CodeComponent
// ============================================================================

/**
 * CodeComponent
 *
 * Dynamically loads and renders a React component from a remote URL.
 * The remote module should be a compiled ES module that exports a React component.
 *
 * Features:
 * - URL allowlist validation for security
 * - Module caching with TTL to avoid re-fetching
 * - Error boundary to catch render errors
 * - Loading skeleton while fetching
 * - Retry capability on failure
 * - Passes only className for host styling control
 * - Supports repo.components references via 'component' prop
 *
 * @example Direct URL:
 * ```tsx
 * <CodeComponent
 *   uuid="hero-1"
 *   componentType="CodeComponentProps"
 *   compiled_module_url="https://cdn.exepad.com/slots/v1/hero_section.js"
 *   classes="my-8"
 * />
 * ```
 *
 * @example Repo component reference:
 * ```tsx
 * <CodeComponent
 *   uuid="stats-1"
 *   componentType="CodeComponentProps"
 *   component="StatsWidget"
 *   classes="p-4"
 * />
 * ```
 */
export const CodeComponent: React.FC<CodeComponentProps> = (props) => {
  const {
    compiled_module_url,
    component,
    code_component_source,
    extensions,
    classes,
    uuid,
    componentType,
    reserved_min_height,
    ...restProps
  } = props;

  // CLS guard: an optional reserved min-height held during async load and as a
  // floor once mounted, so the skeleton→content swap can't shift siblings.
  // No-op (undefined) when the agent didn't stamp it → existing apps unchanged.
  const reservedStyle: React.CSSProperties | undefined =
    reserved_min_height != null
      ? { minHeight: typeof reserved_min_height === 'number' ? `${reserved_min_height}px` : reserved_min_height }
      : undefined;

  // Load required extensions into import map before module import.
  // useMemo ensures this runs synchronously before useCodeComponent triggers the import.
  useMemo(() => {
    if (extensions && extensions.length > 0) {
      loadExtensionsIntoImportMap(extensions);
    }
  }, [extensions]);

  const source = code_component_source;

  // Read-only (published) views must NOT render the tall fixed skeleton for an
  // unknown-height component: a ~300px skeleton standing in for, say, a 64px
  // sticky header — then collapsing when the real component arrives — is itself
  // the single largest CLS source on these pages (measured: two shifts totalling
  // ~0.5 traced to exactly this). Preview/editor keeps the skeleton for
  // authoring feedback, where layout shift is not measured.
  const { isPreview } = useEditMode();

  // Resolve URL: prefer component reference from repo.components, fallback to
  // compiled_module_url. Subscribe to registry initialization if a component
  // ref is used but the registry isn't ready yet.
  const [registryReady, setRegistryReady] = useState(componentRegistry.isInitialized());
  useEffect(() => {
    if (registryReady || !component) return;
    return componentRegistry.onReady(() => setRegistryReady(true));
  }, [component, registryReady]);

  const resolvedUrl = useMemo(() => {
    if (component) {
      if (componentRegistry.has(component)) {
        const url = componentRegistry.getCompiledUrl(component);
        logger.log(`[CodeComponent] Resolved component "${component}" to URL: ${url}`);
        return url;
      } else if (!registryReady) {
        // Registry not initialized yet — will re-resolve on next render after useRuntimeStore initializes
        return undefined;
      } else {
        logger.warn(`[CodeComponent] Component "${component}" not found in repo.components`);
        return undefined;
      }
    }
    return compiled_module_url;
  }, [component, compiled_module_url, registryReady]);

  // Append hash parameter for cache busting if source hash is available
  const urlWithHash = useMemo(() => {
    if (!resolvedUrl) return undefined;

    if (source?.source_code_hash) {
      try {
        const url = new URL(resolvedUrl);
        // Extract just the hash value (remove "sha256:" prefix if present)
        const hashValue = source.source_code_hash.replace(/^sha256:/, '');
        url.searchParams.set('hash', hashValue);
        return url.toString();
      } catch (error) {
        // If URL parsing fails, return original URL
        logger.warn('[CodeComponent] Failed to parse URL for hash appending:', error);
        return resolvedUrl;
      }
    }
    return resolvedUrl;
  }, [resolvedUrl, source?.source_code_hash]);

  const { Component, loading, error, retry } = useCodeComponent(urlWithHash || '');

  // Development mode: lazy load DevModeViewer
  const [DevViewer, setDevViewer] = useState<ComponentType<any> | null>(null);

  useEffect(() => {
    // Check both NODE_ENV and custom flag to control DevModeViewer visibility
    const showDevViewer = false;//import.meta.env.VITE_SHOW_REMOTE_DEV !== 'false';

    if (showDevViewer && source) {
      import('./DevModeViewer').then(m => {
        setDevViewer(() => m.DevModeViewer);
      }).catch(() => {
        // DevModeViewer not available, silently ignore
      });
    }
  }, [source]);

  // Compute pre-render failure once per identity transition, then report
  // it via useEffect. Reporting during render is a React anti-pattern —
  // every re-render (e.g. parent state change) would re-fire the side
  // channel and spam the dashboard / console with duplicate events.
  const preRenderFailure = useMemo<CodeComponentFailureDetail | null>(() => {
    if (!urlWithHash) {
      // Skeleton case (registry initializing) is not a failure.
      if (component && !registryReady) return null;
      return {
        componentName: component,
        componentUuid: uuid,
        failureClass: 'unresolved_url',
        errorMessage: component
          ? `Component "${component}" not found in repo.components`
          : 'No compiled_module_url or component reference provided',
        url: component,
      };
    }
    if (loading) return null;
    if (error || !Component) {
      return {
        componentName: component,
        componentUuid: uuid,
        failureClass:
          error instanceof RemoteUrlValidationError
            ? 'blocked'
            : 'module_eval_failed',
        errorMessage: error?.message ?? 'Component failed to load',
        errorStack: error?.stack,
        url: urlWithHash,
      };
    }
    return null;
  }, [
    urlWithHash,
    component,
    registryReady,
    loading,
    error,
    Component,
    uuid,
  ]);

  // Fire one report per failure transition. The dependency on
  // ``preRenderFailure`` (a stable reference until inputs change) means
  // unrelated re-renders don't re-fire the side channel.
  useEffect(() => {
    if (preRenderFailure) {
      reportCodeComponentFailure(preRenderFailure);
    }
  }, [preRenderFailure]);

  // --- All hooks above this line — early returns below ---

  // Loading fallback policy (CLS-aware):
  //  - preview/editor → the shimmer skeleton, for authoring feedback;
  //  - published + a stamped reserved_min_height → a bare box holding that
  //    height, so the skeleton→content swap can't shift;
  //  - published + no reserved height → render nothing, so the component paints
  //    in a single 0→content step instead of empty→tall-skeleton→content (the
  //    latter is what produced the large measured CLS on published pages).
  const loadingFallback = isPreview
    ? <CodeComponentSkeleton className={classes} style={reservedStyle} />
    : reservedStyle
      ? <div className={cn(classes)} style={reservedStyle} />
      : null;

  // Show the loading fallback while waiting for the registry or while the
  // module loads. Render errors fall through to the placeholder below.
  if (!urlWithHash) {
    if (component && !registryReady) {
      return loadingFallback;
    }
    return <CodeComponentPlaceholder className={classes} style={reservedStyle} />;
  }
  if (loading) {
    return loadingFallback;
  }
  if (error || !Component) {
    return <CodeComponentPlaceholder className={classes} style={reservedStyle} />;
  }

  // Render the loaded component wrapped in error boundary and link interceptor.
  // When a reserved height is set, wrap in a div carrying the same min-height so
  // the reserved floor persists through the skeleton→content swap (no shift if
  // the reserved height ≥ the content's). Without it, render exactly as before
  // (no extra wrapper) to avoid any structural change for existing apps.
  const tree = (
    <>
      <CodeErrorBoundary
        url={urlWithHash}
        componentName={component}
        componentUuid={uuid}
        fallback={<CodeComponentPlaceholder className={classes} style={reservedStyle} />}
      >
        <Suspense fallback={loadingFallback}>
          {/* LinkInterceptor intercepts internal links and rewrites them with basePath */}
          <LinkInterceptor>
            <CodeComponentContrastBoundary>
              <Component />
            </CodeComponentContrastBoundary>
          </LinkInterceptor>
        </Suspense>
      </CodeErrorBoundary>

      {/* Development mode: Show source viewer */}
      {DevViewer && source && (
        <DevViewer source={source} />
      )}
    </>
  );

  return reservedStyle ? <div style={reservedStyle}>{tree}</div> : tree;
};

export default CodeComponent;
