import { Outlet, useParams, useSearchParams } from 'react-router';
import { useState, useEffect, useMemo, useRef } from 'react';
import { getConfig, getConfigSync, parsePreviewMode, type UnifiedConfigResult } from '@/app_shared/utils/unifiedConfig';
import { AppConfigProvider } from '@/context/AppConfigContext';
import { AppContextProvider } from '@/context/AppContext';
import { TransitionProvider } from '@/context/TransitionContext';
import DynamicTheme from '@/components/DynamicTheme';
import DynamicFontLoader from '@/components/DynamicFontLoader';
import FontVariables from '@/components/FontVariables';
import HeadTagsRenderer from '@/components/HeadTagsRenderer';
import { DefaultThemeApplier } from '@/components/DefaultThemeApplier';
import { ClientLayoutRenderer } from '@/components/ClientLayoutRenderer';
import { useBrokenImageFallback } from '@/hooks/useBrokenImageFallback';

// Direct import — PreviewProviders is lightweight (just context providers).
// Avoids Suspense delay that breaks scroll inside editor iframe.
import PreviewProviders from '@/core/providers/PreviewProviders';

/**
 * Check if we're running inside an iframe (the editor embeds preview in iframe)
 */
function getIsInEditorIframe(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.self !== window.top;
  } catch (e) {
    return true;
  }
}

export default function AppLayout() {
  const { appId: routeAppId } = useParams<{ appId: string }>();
  // On subdomain, appId comes from server-injected data attribute, not URL params
  const rawAppId = routeAppId || document.getElementById('root')?.getAttribute('data-app-id') || undefined;
  const [searchParams] = useSearchParams();

  // Stabilize the search params string so useEffect doesn't re-fire on every render
  const searchParamsStr = searchParams.toString();

  const { isPreview, cleanAppId } = useMemo(() => {
    if (!rawAppId) return { isPreview: false, cleanAppId: '' };
    const searchParamsObj = Object.fromEntries(new URLSearchParams(searchParamsStr).entries());
    return parsePreviewMode(rawAppId, searchParamsObj);
  }, [rawAppId, searchParamsStr]);

  // Seed config synchronously from the worker-inlined blob (public published
  // apps) so the first page paints WITHOUT the /api/{appId}/app-config round
  // trip and without the "Loading app..." spinner→content swap (the dominant
  // CLS source on the prior CSR path). Returns null for preview, auth-required
  // apps, and local dev → the network effect below handles those.
  const [result, setResult] = useState<UnifiedConfigResult | null>(() =>
    cleanAppId
      ? getConfigSync({
          source: 'backend',
          appId: cleanAppId,
          mode: isPreview ? 'preview' : 'published',
        })
      : null,
  );
  const [loading, setLoading] = useState(() => result === null);
  const [error, setError] = useState(false);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // True only on the first mount when config was seeded from the inlined blob.
  // Consumed once by the load effect to skip the redundant fetch (and the
  // spinner flash its `setLoading(true)` would cause).
  const seededRef = useRef(result !== null);

  // Check if we're in the editor iframe — detect synchronously to avoid
  // remounting ClientLayoutRenderer (which would break scroll and state)
  const [isInEditorIframe] = useState(() => getIsInEditorIframe());

  useEffect(() => {
    if (!cleanAppId) return;

    // Config was seeded synchronously from the worker-inlined blob on this
    // mount — it's fresh (the worker just rendered it), so skip the redundant
    // network fetch and the spinner flash a `setLoading(true)` would cause.
    // Consumed once: a later appId/mode change falls through to a real fetch.
    if (seededRef.current) {
      seededRef.current = false;
      return;
    }

    setLoading(true);
    setError(false);
    setErrorCode(null);
    setErrorMessage(null);

    getConfig({
      source: 'backend',
      appId: cleanAppId,
      mode: isPreview ? 'preview' : 'published',
    }).then((r) => {
      if (!r) {
        setError(true);
      } else {
        setResult(r);
      }
      setLoading(false);
    }).catch((e) => {
      // Surface specific worker error codes so the UI can render a
      // distinct state (e.g. "preview exists but not published",
      // "preview build failed").
      const code = (e as Error & { code?: string })?.code;
      const message = (e as Error)?.message;
      if (code) setErrorCode(code);
      if (message) setErrorMessage(message);
      setError(true);
      setLoading(false);
    });
  }, [cleanAppId, isPreview]);

  // Update favicon when app config loads
  useEffect(() => {
    if (!result?.config) return;
    const faviconSvg = result.config.frontend?.metadata?.favicon;
    if (faviconSvg && typeof faviconSvg === 'string' && faviconSvg.startsWith('<svg')) {
      const link = document.querySelector('link[rel="icon"]') as HTMLLinkElement;
      if (link) {
        link.href = `data:image/svg+xml,${encodeURIComponent(faviconSvg)}`;
        link.type = 'image/svg+xml';
      }
    }
  }, [result]);

  // Degrade broken content images (e.g. a kept hotlink that 404s) to a
  // neutral placeholder instead of the browser's broken-image glyph.
  useBrokenImageFallback();

  if (!rawAppId) {
    return <div className="p-8 text-center text-muted-foreground">No app specified</div>;
  }

  if (loading && !result) {
    return (
      <div
        className="flex items-center justify-center min-h-screen"
        role="status"
        aria-live="polite"
        aria-busy="true"
      >
        <div className="animate-pulse text-muted-foreground" aria-hidden="true">Loading app...</div>
        <span className="sr-only">Loading app, please wait…</span>
      </div>
    );
  }

  if (error || !result) {
    if (errorCode === 'NOT_PUBLISHED') {
      return (
        <div className="flex items-center justify-center min-h-screen">
          <div className="text-center max-w-md px-6">
            <h1 className="text-2xl font-bold mb-2">App Not Published Yet</h1>
            <p className="text-muted-foreground">
              This app has a preview build but has not been published. Open the
              preview from your dashboard, or publish from the editor to make it
              available at this URL.
            </p>
          </div>
        </div>
      );
    }
    if (errorCode === 'DEPLOY_FAILED') {
      // The preview deploy explicitly failed (e.g., a backend handler
      // never made it to R2). Show the underlying error so the user can
      // act on it instead of staring at a "Loading app…" spinner that
      // never resolves. 1ybz1p4n (2026-05-19) was the canonical case.
      return (
        <div className="flex items-center justify-center min-h-screen">
          <div className="text-center max-w-md px-6">
            <h1 className="text-2xl font-bold mb-2">Preview Build Failed</h1>
            <p className="text-muted-foreground mb-3">
              The preview build for this app did not complete. Try rebuilding
              from the editor.
            </p>
            {errorMessage && (
              <p className="text-xs text-muted-foreground/80 font-mono break-words">
                {errorMessage}
              </p>
            )}
          </div>
        </div>
      );
    }
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-2">App Not Found</h1>
          <p className="text-muted-foreground">The requested app could not be loaded.</p>
        </div>
      </div>
    );
  }

  const { config, basePath } = result;
  const mode = isPreview ? 'preview' : 'published';
  const routeType = isPreview ? 'preview' : 'production';

  const shouldLoadPreviewProviders = isPreview && isInEditorIframe;

  // Layout content that needs to be wrapped with preview providers
  const layoutContent = (
    <ClientLayoutRenderer>
      <Outlet />
    </ClientLayoutRenderer>
  );

  return (
    <>
      {config.frontend?.theme && <DynamicTheme theme={config.frontend.theme} />}
      <DefaultThemeApplier defaultTheme={config.frontend?.theme?.defaultTheme} />
      <DynamicFontLoader
        fonts={config.frontend?.theme?.fonts}
        extraFontUrls={(config.repo as any)?.frontend?.fonts}
      />
      {config.frontend?.theme?.fonts && <FontVariables fonts={config.frontend.theme.fonts} />}
      {config.frontend?.headTags && <HeadTagsRenderer headTags={config.frontend.headTags} />}

      <AppConfigProvider
        appConfig={config}
        basePath={basePath}
        appId={cleanAppId}
        mode={mode}
        routeType={routeType}
      >
        <TransitionProvider globalConfig={config.frontend?.transitions}>
          <AppContextProvider basePath={basePath} mode={mode}>
            {shouldLoadPreviewProviders ? (
              <PreviewProviders appId={cleanAppId} appConfig={config}>
                {layoutContent}
              </PreviewProviders>
            ) : (
              layoutContent
            )}
          </AppContextProvider>
        </TransitionProvider>
      </AppConfigProvider>
    </>
  );
}
