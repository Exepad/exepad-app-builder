import { useParams, useSearchParams } from 'react-router';
import { useState, useEffect } from 'react';
import { parsePreviewMode } from '@/app_shared/utils/unifiedConfig';
import PreviewPage from '@/core/preview/PreviewPage';
import { ClientPageRenderer } from '@/components/ClientPageRenderer';

export default function AppPage() {
  const { appId: rawAppId } = useParams<{ appId: string }>();
  const [searchParams] = useSearchParams();
  const [initialJWT, setInitialJWT] = useState<string | undefined>();

  const searchParamsObj = Object.fromEntries(searchParams.entries());
  const { isPreview } = parsePreviewMode(rawAppId || '', searchParamsObj);

  useEffect(() => {
    if (!isPreview || typeof searchParamsObj.pt !== 'string') return;
    // Cloud-only flow: preview-token exchange against the hosted backend.
    // Self-host has no such backend — operator auth is handled by /auth/me.
    if (!import.meta.env.VITE_BACKEND_URL) return;

    const backendUrl = import.meta.env.VITE_BACKEND_URL;
    fetch(`${backendUrl}/api/auth/exchange-preview-token/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: searchParamsObj.pt }),
    })
      .then((res) => res.ok ? res.json() : null)
      .then((data) => {
        if (data?.jwt) setInitialJWT(data.jwt);
      })
      .catch(() => {});
  }, [isPreview, searchParamsObj.pt]);

  if (isPreview) {
    return <PreviewPage initialJWT={initialJWT} />;
  }

  return <ClientPageRenderer routeType="production" />;
}
