/**
 * Platform Default Logout Handler
 *
 * Infrastructure component rendered at `/logout` when an app has
 * security.authProviders configured but no custom logout page. Calls the
 * backend `auth_signout` RPC to clear the session cookie, broadcasts an
 * `exepad:auth:changed` event so the in-memory auth store updates, then
 * navigates to the login page.
 *
 * Matches the DefaultLoginPage pattern: self-contained, no SDK dependency,
 * renders a tiny inline spinner while the RPC is in flight.
 */

import React, { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router';

interface LogoutHandlerProps {
  basePath: string;
  apiAppId: string;
  loginPage: string;
}

export function LogoutHandler({ basePath, apiAppId, loginPage }: LogoutHandlerProps) {
  const navigate = useNavigate();
  // StrictMode double-invokes effects in dev; guard so we only POST once.
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    let cancelled = false;

    (async () => {
      try {
        await fetch(`/api/${apiAppId}/rpc`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ method: 'auth_signout', params: {} }),
        });
      } catch {
        // Even if the RPC fails (network, expired session), clear the
        // in-memory auth state and bounce to login — staying on /logout
        // would just spin forever.
      }

      if (cancelled) return;

      // useRuntimeStore's auth listener clears the store only when the
      // detail carries `action: 'signout'` — a bare `user: null` falls
      // through to a re-fetch which would see the stale cookie. See
      // useRuntimeStore.ts::onAuthChanged.
      window.dispatchEvent(
        new CustomEvent('exepad:auth:changed', { detail: { action: 'signout' } }),
      );

      navigate(`${basePath}${loginPage}`, { replace: true });
    })();

    return () => {
      cancelled = true;
    };
  }, [apiAppId, basePath, loginPage, navigate]);

  return (
    <main className="flex min-h-[80vh] items-center justify-center p-4">
      <div className="flex items-center gap-3 text-sm text-muted-foreground">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="animate-spin"
        >
          <path d="M21 12a9 9 0 1 1-6.219-8.56" />
        </svg>
        Signing out…
      </div>
    </main>
  );
}
