import { Outlet, useParams } from 'react-router';
import { useState, useEffect } from 'react';
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

export default function DemoLayout() {
  const { appId } = useParams<{ appId: string }>();
  const [result, setResult] = useState<UnifiedConfigResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!appId) return;

    setLoading(true);
    setError(false);
    getConfig({
      source: 'demo',
      appId,
      mode: 'published',
    }).then((r) => {
      if (!r) {
        setError(true);
      } else {
        setResult(r);
      }
      setLoading(false);
    }).catch(() => {
      setError(true);
      setLoading(false);
    });
  }, [appId]);

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
        <div className="animate-pulse text-muted-foreground">Loading demo...</div>
      </div>
    );
  }

  if (error || !result) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-2">Demo Not Found</h1>
          <p className="text-muted-foreground">The demo app could not be loaded.</p>
        </div>
      </div>
    );
  }

  const { config, basePath } = result;

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
        appId={appId!}
        mode="published"
        routeType="demo"
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
