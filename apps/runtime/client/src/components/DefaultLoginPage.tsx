/**
 * Platform Default Login Page
 *
 * Infrastructure component rendered when an app has security.authProviders
 * configured but no custom login page defined in frontend.pages.
 * Supports email/password login+signup and Google OAuth.
 *
 * Inherits app theme via CSS variables from DynamicTheme.
 * Follows the ForbiddenPage pattern: self-contained, no Shadow DOM, no SDK dependency.
 */

import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router';
import type { SecurityProps } from '@exepad/types';
import { useAppStateStore } from '@/stores/appStateStore';

interface DefaultLoginPageProps {
  security: SecurityProps;
  basePath: string;
  apiAppId: string;
  appName?: string;
  initialMode?: 'login' | 'signup';
}

// ── Inline SVG Icons ────────────────────────────────────────────────

function MailIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <rect width="20" height="16" x="2" y="4" rx="2" />
      <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
    </svg>
  );
}

function LockIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

function UserIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

function SpinnerIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`animate-spin ${className || ''}`}>
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  );
}

function AlertIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="12" cy="12" r="10" />
      <line x1="12" x2="12" y1="8" y2="12" />
      <line x1="12" x2="12.01" y1="16" y2="16" />
    </svg>
  );
}

function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" className={className}>
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18A10.96 10.96 0 0 0 1 12c0 1.77.42 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05" />
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
    </svg>
  );
}

// ── Component ───────────────────────────────────────────────────────

export function DefaultLoginPage({
  security,
  basePath,
  apiAppId,
  appName,
  initialMode = 'login',
}: DefaultLoginPageProps) {
  const navigate = useNavigate();

  // Auth state from store (already initialized by ClientLayoutRenderer)
  const authIsAuthenticated = useAppStateStore((s) =>
    (s._state['auth.isAuthenticated'] as boolean) ?? (s._state['auth'] as any)?.isAuthenticated ?? false
  );

  const [mode, setMode] = useState<'login' | 'signup'>(initialMode);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [error, setError] = useState('');
  // "Check your email" state — shown after signup when requireVerification
  // is on, or after signin when the user hasn't verified yet. The email
  // we captured is what the Resend button will target.
  const [pendingVerificationEmail, setPendingVerificationEmail] = useState<string | null>(null);
  const [resendLoading, setResendLoading] = useState(false);
  const [resendNote, setResendNote] = useState<string | null>(null);

  // Banner state from ?verified=1 / ?verify_error=invalid on the /login page.
  // Set by the runtime worker's /verify-email route after the user clicks
  // the email link.
  const verifyBanner = useMemo<'verified' | 'invalid' | null>(() => {
    if (typeof window === 'undefined') return null;
    const params = new URLSearchParams(window.location.search);
    if (params.get('verified') === '1') return 'verified';
    if (params.get('verify_error') === 'invalid') return 'invalid';
    return null;
  }, []);

  // Older agent builds emitted authProviders as bare strings (e.g. ["email"])
  // instead of the typed `[{ provider: 'email' }]` shape. Normalize here so
  // the login form renders for apps frozen on the legacy config shape without
  // requiring a republish. The canonical shape is still `{ provider: ... }`.
  const providerNames = useMemo<ReadonlyArray<string>>(() => {
    const raw = security.authProviders ?? [];
    return (raw as unknown[])
      .map((entry) => {
        if (typeof entry === 'string') return entry;
        if (entry && typeof entry === 'object' && 'provider' in entry) {
          return String((entry as { provider: unknown }).provider || '');
        }
        return '';
      })
      .filter(Boolean);
  }, [security.authProviders]);
  const hasEmail = useMemo(() => providerNames.includes('email'), [providerNames]);
  // Gate on a runtime-side capability flag: the meta-injector stamps
  // `data-google-configured="1"` on the root div only when the runtime
  // worker has Google OAuth credentials wired. Without this check, agents
  // that default `authProviders` to include `google` would show a button
  // that always fails on click because no OAuth client is configured.
  const googleConfigured = useMemo(() => {
    if (typeof document === 'undefined') return false;
    return document.querySelector('#root')?.getAttribute('data-google-configured') === '1';
  }, []);
  const hasGoogle = useMemo(
    () => providerNames.includes('google') && googleConfigured,
    [providerNames, googleConfigured],
  );
  const allowSignup = security.allowSignup !== false;

  // Read returnUrl from query params. Only a same-origin root-relative PATH is a
  // safe post-login redirect target — reject protocol-relative (`//host`), the
  // backslash trick (`/\host`, which browsers normalize to `//host`) and
  // absolute (`scheme://host`) URLs. Without this, a root-mounted app
  // (basePath === '') treats `returnUrl.startsWith('')` as always-true and would
  // navigate off-origin to an attacker URL (open redirect / phishing).
  const returnUrl = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    const raw = params.get('returnUrl');
    if (!raw || raw[0] !== '/' || raw[1] === '/' || raw[1] === '\\') {
      return null;
    }
    return raw;
  }, []);

  // Auto-redirect if already authenticated
  useEffect(() => {
    if (authIsAuthenticated) {
      if (returnUrl) {
        const slug = returnUrl.startsWith(basePath)
          ? returnUrl.slice(basePath.length) || '/'
          : '/';
        navigate(`${basePath}${slug}`, { replace: true });
      } else {
        const target = security.redirectAfterLogin ?? '/';
        navigate(`${basePath}${target}`, { replace: true });
      }
    }
  }, [authIsAuthenticated, returnUrl, basePath, navigate, security.redirectAfterLogin]);

  // ── Email/password submit ───────────────────────────────────────

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const method = mode === 'login' ? 'auth_signin' : 'auth_signup';
      const params: Record<string, string> = { email, password };
      if (mode === 'signup' && name) params.name = name;
      else if (mode === 'signup') params.name = email.split('@')[0];

      const response = await fetch(`/api/${apiAppId}/rpc`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ method, params }),
      });

      if (!response.ok) {
        setError('Service temporarily unavailable. Please try again later.');
        return;
      }

      const result = await response.json();

      if (result.success) {
        // Signup with requireVerification=true returns no session — render
        // the "Check your email" state instead of navigating.
        if (result.data?.verification_required === true) {
          setPendingVerificationEmail(email);
          return;
        }
        // Full-document navigation instead of a client-side transition. A
        // React Router navigate() here would race the browser's cookie-jar
        // commit of the just-set Set-Cookie from the auth RPC against the
        // first round of React.lazy(() => import(...)) calls for the
        // authenticated-page code components — those import()s target
        // /repo/**/*.js, which serveAppR2Asset gates on the session cookie.
        // When the cookie isn't yet visible to the module loader the gate
        // returns 401, and the browser's module map caches that rejection
        // so retries within the same document never fetch again. A fresh
        // GET flushes the cookie jar, re-runs meta-injector with an
        // authenticated identity (which re-enables modulepreload hints),
        // and gives the browser a clean module graph. Matches the Google
        // OAuth flow below.
        const target = returnUrl && returnUrl.startsWith(basePath)
          ? returnUrl
          : `${basePath}${security.redirectAfterLogin ?? '/'}`;
        window.location.assign(target);
        return;
      } else {
        // Signin blocked because the user hasn't verified their email.
        // Switch to the "Check your email" state with a resend CTA.
        if (result.error?.code === 'EMAIL_NOT_VERIFIED') {
          setPendingVerificationEmail(email);
          return;
        }
        setError(result.error?.message || 'Authentication failed');
      }
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // ── Resend verification ────────────────────────────────────────

  const handleResendVerification = async () => {
    if (!pendingVerificationEmail) return;
    setResendLoading(true);
    setResendNote(null);
    try {
      const response = await fetch(`/api/${apiAppId}/rpc`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          method: 'auth_request_verification',
          params: { email: pendingVerificationEmail },
        }),
      });
      if (response.ok) {
        setResendNote('Verification email sent. Check your inbox.');
      } else {
        setResendNote('Could not resend. Please try again in a moment.');
      }
    } catch {
      setResendNote('Network error. Please try again.');
    } finally {
      setResendLoading(false);
    }
  };

  // ── Google OAuth ────────────────────────────────────────────────

  const handleGoogleLogin = async () => {
    setGoogleLoading(true);
    setError('');

    try {
      const googleReturnUrl = returnUrl || `${basePath}${security.redirectAfterLogin ?? '/'}`;
      // Pass the browser's live origin so the OAuth callback can redirect
      // back to the exact subdomain the user came from. `env.APP_ALIAS` on
      // the app-backend can differ from the live subdomain (dashes, casing,
      // custom domains), so reconstructing `${alias}.exepad.app` on the
      // server side lands on the wrong host.
      const response = await fetch(`/api/${apiAppId}/rpc`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          method: 'auth_social_login',
          params: {
            provider: 'google',
            return_url: googleReturnUrl,
            origin: window.location.origin,
          },
        }),
      });

      if (!response.ok) {
        setError('Service temporarily unavailable. Please try again later.');
        setGoogleLoading(false);
        return;
      }

      const result = await response.json();

      if (result.success && result.data?.redirect_url) {
        window.location.href = result.data.redirect_url;
      } else {
        setError(result.error?.message || 'Could not initiate Google login');
        setGoogleLoading(false);
      }
    } catch {
      setError('Network error. Please try again.');
      setGoogleLoading(false);
    }
  };

  // ── Render ──────────────────────────────────────────────────────

  // "Check your email" state — shown after signup when requireVerification
  // is on, or after signin blocked on EMAIL_NOT_VERIFIED.
  if (pendingVerificationEmail) {
    return (
      <main className="flex min-h-[80vh] items-center justify-center p-4">
        <div className="w-full max-w-md rounded-lg border border-border bg-card p-6 shadow-sm sm:p-8">
          <div className="mb-6 text-center">
            <h1 className="text-2xl font-semibold text-card-foreground">Check your email</h1>
            {appName && <p className="mt-1 text-sm text-muted-foreground">{appName}</p>}
            <p className="mt-4 text-sm text-muted-foreground">
              We sent a verification link to{' '}
              <span className="font-medium text-foreground break-words">{pendingVerificationEmail}</span>.
              Click it to activate your account and sign in.
            </p>
          </div>
          {resendNote && (
            <div className="mb-4 rounded-md bg-muted p-3 text-center text-sm text-muted-foreground">
              {resendNote}
            </div>
          )}
          <button
            type="button"
            onClick={handleResendVerification}
            disabled={resendLoading}
            className="flex w-full items-center justify-center gap-2 rounded-md border border-border bg-background px-4 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-accent disabled:opacity-50"
          >
            {resendLoading ? <SpinnerIcon className="h-4 w-4" /> : null}
            Resend verification email
          </button>
          <button
            type="button"
            onClick={() => {
              setPendingVerificationEmail(null);
              setResendNote(null);
              setError('');
              setMode('login');
            }}
            className="mt-3 w-full text-center text-sm text-muted-foreground hover:text-foreground"
          >
            Back to sign in
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-[80vh] items-center justify-center p-4">
      <div className="w-full max-w-md rounded-lg border border-border bg-card p-8 shadow-sm">
        {/* Header */}
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-semibold text-card-foreground">
            {mode === 'login' ? 'Sign In' : 'Create Account'}
          </h1>
          {appName && (
            <p className="mt-1 text-sm text-muted-foreground">{appName}</p>
          )}
          <p className="mt-2 text-sm text-muted-foreground">
            {mode === 'login'
              ? 'Enter your credentials to continue'
              : 'Create a new account to get started'}
          </p>
        </div>

        {/* Verification banner — set by the runtime /verify-email redirect */}
        {verifyBanner === 'verified' && (
          <div className="mb-4 rounded-md border border-green-600/30 bg-green-600/10 p-3 text-sm text-green-700 dark:text-green-400">
            Email verified — sign in to continue.
          </div>
        )}
        {verifyBanner === 'invalid' && (
          <div className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            Verification link is invalid or has expired. Sign in to request a new one.
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="mb-4 flex items-center gap-2 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
            <AlertIcon className="shrink-0" />
            {error}
          </div>
        )}

        {/* Google OAuth button */}
        {hasGoogle && (
          <>
            <button
              type="button"
              onClick={handleGoogleLogin}
              disabled={googleLoading}
              className="flex w-full items-center justify-center gap-3 rounded-md border border-border bg-background px-4 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-accent disabled:opacity-50"
            >
              {googleLoading ? (
                <SpinnerIcon className="h-5 w-5" />
              ) : (
                <GoogleIcon />
              )}
              Continue with Google
            </button>

            {hasEmail && (
              <div className="my-5 flex items-center gap-3">
                <div className="h-px flex-1 bg-border" />
                <span className="text-xs text-muted-foreground">or</span>
                <div className="h-px flex-1 bg-border" />
              </div>
            )}
          </>
        )}

        {/* Email/password form */}
        {hasEmail && (
          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === 'signup' && (
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-foreground">Name</label>
                <div className="relative">
                  <UserIcon className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <input
                    type="text"
                    placeholder="Your name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full rounded-md border border-input bg-background py-2 pl-10 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-hidden focus:ring-2 focus:ring-ring"
                  />
                </div>
              </div>
            )}

            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground">Email</label>
              <div className="relative">
                <MailIcon className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="w-full rounded-md border border-input bg-background py-2 pl-10 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-hidden focus:ring-2 focus:ring-ring"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground">Password</label>
              <div className="relative">
                <LockIcon className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="w-full rounded-md border border-input bg-background py-2 pl-10 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-hidden focus:ring-2 focus:ring-ring"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="flex w-full items-center justify-center gap-2 rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
            >
              {loading && <SpinnerIcon className="h-4 w-4" />}
              {mode === 'login' ? 'Sign In' : 'Create Account'}
            </button>

            {/* Login/signup toggle */}
            {allowSignup && (
              <p className="text-center text-sm text-muted-foreground">
                {mode === 'login' ? (
                  <>
                    Don&apos;t have an account?{' '}
                    <button
                      type="button"
                      onClick={() => { setMode('signup'); setError(''); }}
                      className="font-medium text-primary hover:underline"
                    >
                      Sign up
                    </button>
                  </>
                ) : (
                  <>
                    Already have an account?{' '}
                    <button
                      type="button"
                      onClick={() => { setMode('login'); setError(''); }}
                      className="font-medium text-primary hover:underline"
                    >
                      Sign in
                    </button>
                  </>
                )}
              </p>
            )}
          </form>
        )}
      </div>
    </main>
  );
}
