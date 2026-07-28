/**
 * useRuntimeStore — Initializes the Zustand state store from app config.
 *
 * Extracted from ClientLayoutRenderer so the same initialization logic
 * can be shared by PreviewPage and ClientLayoutRenderer.
 *
 * Responsibilities:
 * - Scope localStorage to the current app
 * - Merge static datasets into initial state
 * - Inject $auth namespace when security is configured
 * - Initialize the store with basePath and router
 * - Initialize component registry
 */

import { useEffect } from 'react';
import { useNavigate } from 'react-router';
import { useAppConfig } from '@/context/AppConfigContext';
import { useAppStateStore, AppConfig, setCurrentAppId, setApiAppId } from '@/stores/appStateStore';
import { isStaticBackend } from '@/app_runtime/interfaces/backend';

import { initializeComponentRegistry } from '@/lib/componentRegistry';
import { installPlatformAuthInterceptor } from '@/lib/platformAuth';
import { getJWTTokenFromCookieAPI, getPlatformUser } from '@/lib/jwt-helper';
import { useRef } from 'react';

/**
 * Initialize the Zustand runtime store from the app config context.
 * Must be called inside a component wrapped by AppConfigProvider.
 */
export function useRuntimeStore(skip = false) {
  const navigate = useNavigate();
  const { appConfig, basePath, apiAppId } = useAppConfig();
  const frontend = appConfig.frontend;

  const initializeStore = useAppStateStore((s) => s.initialize);

  // Stabilize navigate ref — useNavigate() may return a new function on re-renders
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;

  useEffect(() => {
    // When skip is true, a parent component already initialized the store.
    // Re-running would reset auth state and cause infinite loops.
    if (skip) return;
    // Scope localStorage persistence to this app
    setCurrentAppId(appConfig.uuid || '');
    // Set the API-facing app ID (public_id/slug)
    setApiAppId(apiAppId);

    // Hydrate persisted state from the now-scoped localStorage key. The store
    // is created with `skipHydration: true` because `_currentAppId` was empty at
    // module-import time; rehydrating here (before initializeStore) reads the
    // correct `exepad-app-state:<appId>` key so previous-session $persist values
    // survive reloads instead of being overwritten with config initial values.
    // The persist storage is synchronous localStorage, so rehydrate() applies
    // the persisted state synchronously before initializeStore runs below.
    useAppStateStore.persist.rehydrate();

    // Get datasets from backend.data.datasets (static mode)
    // Legacy fallback: check frontend.data for old configs
    let datasets: Record<string, unknown> = {};
    if (isStaticBackend(appConfig.backend)) {
      datasets = appConfig.backend.data.datasets;
    } else {
      const legacyDatasets = (appConfig as any).frontend?.data?.datasets || (appConfig as any).data?.datasets;
      if (legacyDatasets) {
        console.warn('[Exepad] Deprecated: frontend.data.datasets → use backend: { mode: "static", data: { datasets } }');
        datasets = legacyDatasets;
      }
    }

    // Start with UI state from config
    const initialState = { ...frontend?.logic?.state };

    // Auto-inject all static datasets into state
    for (const [datasetId, dataset] of Object.entries(datasets)) {
      if (dataset && (dataset as any).type === 'static' && Array.isArray((dataset as any).records)) {
        initialState[datasetId] = (dataset as any).records;
      }
    }

    // Inject $auth namespace + run the auth_me session check only when per-app
    // auth is actually CONFIGURED (at least one provider, not explicitly
    // disabled). The previous `!!appConfig.security` was true even for fully
    // public apps that carry an empty `security: { authProviders: [],
    // defaultAccess: 'public' }` block — firing a wasted POST /auth_me and
    // seeding an auth-loading namespace on every public marketing page. This
    // predicate still covers optional-login public apps (providers present,
    // defaultAccess 'public'), unlike the worker's stricter isAuthRequired.
    const sec = appConfig.security as
      | { enabled?: boolean; authProviders?: unknown[] }
      | undefined;
    const authConfigured = !!(
      sec &&
      sec.enabled !== false &&
      Array.isArray(sec.authProviders) &&
      sec.authProviders.length > 0
    );
    if (authConfigured) {
      initialState['auth'] = {
        isAuthenticated: false,
        isLoading: true,
        user: null,
        roles: [],
        error: null,
      };
    }

    // Build config — state only (actions/computed/onMount removed)
    const stateConfig: AppConfig = {
      state: initialState,
    };

    // Initialize store with router for navigation and basePath for relative URLs
    initializeStore(stateConfig, {
      push: (url: string) => navigateRef.current(url),
      replace: (url: string) => navigateRef.current(url, { replace: true }),
    }, basePath);

    // Platform bridge auth: install a global fetch interceptor that adds
    // X-Platform-Token to /api/* requests, then eagerly fetch a token.
    installPlatformAuthInterceptor();

    // Initialize component registry from repo.components
    initializeComponentRegistry((appConfig as any).repo, basePath);

    // Per-app auth (Mode B): check existing session on mount via auth_me.
    const abortController = new AbortController();

    function normalizeAuthUser(payload: unknown) {
      const rawUser = (payload as any)?.user ?? payload;
      if (!rawUser || typeof rawUser !== 'object') {
        return null;
      }

      return {
        id: (rawUser as any).id ?? null,
        email: (rawUser as any).email ?? null,
        name: (rawUser as any).name ?? null,
        roles: Array.isArray((rawUser as any).roles) ? (rawUser as any).roles : [],
      };
    }

    async function fetchAuthMe(signal?: AbortSignal) {
      try {
        const res = await fetch(`/api/${apiAppId}/auth_me`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ method: 'auth_me', params: {} }),
          signal,
        });
        const result = await res.json();
        if (signal?.aborted) return;

        const store = useAppStateStore.getState();
        let user = normalizeAuthUser(result.data);

        // If auth_me returned a generic preview identity (no real email),
        // enrich with platform user identity from session or cookie API.
        if (user && (!user.email || user.id?.startsWith('preview-owner-'))) {
          let platformUser = getPlatformUser();
          if (!platformUser?.email) {
            // Reuse the shared cookie API helper — avoids a duplicate
            // /api/auth/ws-token/ call that EditModeProvider already made
            // (token + user are cached in sessionStorage).
            try {
              await getJWTTokenFromCookieAPI();
              platformUser = getPlatformUser();
            } catch { /* ignore — user not on platform */ }
          }
          if (platformUser?.email) {
            user = {
              ...user,
              id: platformUser.id || user.id,
              email: platformUser.email,
              name: platformUser.name || user.name,
            };
          }
        }

        if (result.success && user) {
          store.set('auth.isAuthenticated', true);
          store.set('auth.user', user);
          store.set('auth.roles', user.roles);
        } else {
          store.set('auth.isAuthenticated', false);
          store.set('auth.user', null);
        }
        store.set('auth.isLoading', false);
      } catch (err: any) {
        if (err?.name === 'AbortError') return;
        const store = useAppStateStore.getState();
        store.set('auth.isAuthenticated', false);
        store.set('auth.user', null);
        store.set('auth.isLoading', false);
      }
    }

    if (authConfigured && apiAppId) {
      fetchAuthMe(abortController.signal);

      // Listen for login/logout events from code components (e.g. LoginForm).
      // If the event carries user data (detail.user), update the store
      // synchronously so the auth guard sees it before any navigation.
      // Otherwise fall back to an async auth_me re-fetch.
      const onAuthChanged = (e: Event) => {
        const detail = (e as CustomEvent).detail;
        const user = normalizeAuthUser(detail?.user);
        if (user) {
          const store = useAppStateStore.getState();
          store.set('auth.isAuthenticated', true);
          store.set('auth.user', user);
          store.set('auth.roles', user.roles);
          store.set('auth.isLoading', false);
        } else if (detail?.action === 'signout') {
          const store = useAppStateStore.getState();
          store.set('auth.isAuthenticated', false);
          store.set('auth.user', null);
          store.set('auth.roles', []);
          store.set('auth.isLoading', false);
        } else {
          fetchAuthMe();
        }
      };
      window.addEventListener('exepad:auth:changed', onAuthChanged);

      return () => {
        abortController.abort();
        window.removeEventListener('exepad:auth:changed', onAuthChanged);
      };
    }

    return () => {
      abortController.abort();
    };
  }, [skip, appConfig, frontend, initializeStore, basePath, apiAppId]);
}
