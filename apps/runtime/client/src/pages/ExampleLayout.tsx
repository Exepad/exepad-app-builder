import { Outlet, useParams } from 'react-router';
import { useState, useEffect, useRef } from 'react';
import { getConfig, type UnifiedConfigResult } from '@/app_shared/utils/unifiedConfig';
import { AppConfigProvider } from '@/context/AppConfigContext';
import { AppContextProvider } from '@/context/AppContext';
import { TransitionProvider } from '@/context/TransitionContext';
import { ClientLayoutRenderer } from '@/components/ClientLayoutRenderer';
import DynamicTheme from '@/components/DynamicTheme';
import DynamicFontLoader from '@/components/DynamicFontLoader';
import FontVariables from '@/components/FontVariables';
import HeadTagsRenderer from '@/components/HeadTagsRenderer';
import { DefaultThemeApplier } from '@/components/DefaultThemeApplier';

export default function ExampleLayout() {
  const { '*': pathStr } = useParams<{ '*': string }>();
  const [result, setResult] = useState<UnifiedConfigResult | null>(null);
  const [loading, setLoading] = useState(true);
  const loadedBaseRef = useRef<string | null>(null);

  useEffect(() => {
    if (!pathStr) return;

    const segments = pathStr.split('/').filter(Boolean);
    if (segments.length === 0) return;

    // Skip re-fetch if navigating within the same already-loaded app
    const loadedBase = loadedBaseRef.current;
    if (loadedBase && pathStr.startsWith(loadedBase)) {
      return;
    }

    const appId = segments[0];
    const slug = segments.slice(1);

    setLoading(true);
    getConfig({
      source: 'example',
      appId,
      mode: 'published',
      slugSegments: slug,
    }).then((r) => {
      setResult(r);
      if (r) {
        // Store the base path suffix (without /example/ prefix) for comparison
        loadedBaseRef.current = r.basePath.replace(/^\/example\//, '');
      }
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [pathStr]);

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

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-pulse text-muted-foreground">Loading example...</div>
      </div>
    );
  }

  if (!result) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-2">Example Not Found</h1>
          <p className="text-muted-foreground">The example app could not be loaded.</p>
        </div>
      </div>
    );
  }

  const { config, basePath } = result;
  // Use the app's alias (or uuid) as appId for API routing — NOT the filesystem path segment
  const appId = config.alias || config.uuid;

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
        appId={appId}
        mode="published"
        routeType="example"
      >
        <TransitionProvider globalConfig={config.frontend?.transitions}>
          <AppContextProvider basePath={basePath} mode="published">
            <ClientLayoutRenderer>
              <Outlet />
            </ClientLayoutRenderer>
          </AppContextProvider>
        </TransitionProvider>
      </AppConfigProvider>
    </>
  );
}
