/**
 * ExposePlatformGlobal
 * Exposes platform hooks to the window object for CodeComponents.
 *
 * CodeComponents can access platform features via:
 * - window.ExepadPlatform.useModel(name, opts)
 * - window.ExepadPlatform.useHandler(name, opts)
 * - window.ExepadPlatform.useNavigation()
 * - window.ExepadPlatform.useTheme()
 * - window.ExepadPlatform.useCurrentUser()
 *
 * Follows the same pattern as ExposeStateGlobal.tsx
 */

import { useEffect, useCallback, useRef, useSyncExternalStore } from 'react';
import { useNavigate, useLocation } from 'react-router';
import { useAppConfig } from '@/context/AppConfigContext';
import { useModelData } from '@/app_runtime/runtime/hooks/useModelData';
import { useHandlerData } from '@/app_runtime/runtime/hooks/useHandlerData';
import { useAppStateStore } from '@/stores/appStateStore';

import type { ModelDataParams } from '@/app_runtime/runtime/hooks/useModelData';

// NOTE: This contract is duplicated from the SDK's typed `ExepadPlatformAPI`
// (packages/exepad-sdk/src/platform/types.ts). The runtime client does not
// currently depend on `@exepad/sdk`, so we cannot import the canonical type
// here without adding that workspace dependency (tracked as a follow-up). Until
// then, the bridge object is checked against this local interface via
// `satisfies ExepadPlatformAPI` below so at least a shape mismatch (missing
// method / wrong arity) fails `pnpm check`. `getCssUrls` is a runtime-only
// extension not yet present in the SDK interface.
interface ExepadPlatformAPI {
  useModel: (name: string, opts?: any) => any;
  useHandler: (name: string, opts?: any) => any;
  useNavigation: () => any;
  navigate: (path: string, opts?: { replace?: boolean }) => void;
  useTheme: () => any;
  useCurrentUser: () => any;
  getBasePath: () => string;
  getAppId: () => string;
  getRpcUrl: () => string;
  getCssUrls: () => string[];
}

declare global {
  interface Window {
    ExepadPlatform?: ExepadPlatformAPI;
  }
}

/**
 * Wrapper around useModelData that adds create/update/remove mutations.
 * The runtime's useModelData only provides read + refetch.
 */
function useModelBridge(name: string, opts?: any) {
  const params: ModelDataParams = {
    filters: opts?.filters,
    orderBy: opts?.orderBy,
    limit: opts?.limit,
    offset: opts?.offset,
    aggregate: opts?.aggregate,
    search: opts?.search,
    searchFields: opts?.searchFields,
  };

  // If opts.enabled is explicitly false, pass undefined as name to skip fetching
  const effectiveName = opts?.enabled === false ? undefined : name;
  const result = useModelData(effectiveName, params);

  // Get appId for mutation RPC calls
  const { appId, apiAppId } = useAppConfig();
  const rpcAppId = apiAppId || appId;

  const create = useCallback(async (record: Record<string, unknown>) => {
    const response = await fetch(`/api/${rpcAppId}/${name}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method: 'sys_create', model: name, params: { data: record } }),
    });
    const json = await response.json();
    if (!json.success) throw new Error(json.error?.message || 'Create failed');
    // Trigger refetch on all listeners
    window.dispatchEvent(new CustomEvent('exepad:model:changed', { detail: { modelName: name } }));
    return json.data;
  }, [rpcAppId, name]);

  const update = useCallback(async (id: string | number, updates: Record<string, unknown>) => {
    const response = await fetch(`/api/${rpcAppId}/${name}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method: 'sys_update', model: name, params: { id: String(id), data: updates } }),
    });
    const json = await response.json();
    if (!json.success) throw new Error(json.error?.message || 'Update failed');
    window.dispatchEvent(new CustomEvent('exepad:model:changed', { detail: { modelName: name } }));
    return json.data;
  }, [rpcAppId, name]);

  const remove = useCallback(async (id: string | number) => {
    const response = await fetch(`/api/${rpcAppId}/${name}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method: 'sys_delete', model: name, params: { id: String(id) } }),
    });
    const json = await response.json();
    if (!json.success) throw new Error(json.error?.message || 'Delete failed');
    window.dispatchEvent(new CustomEvent('exepad:model:changed', { detail: { modelName: name } }));
  }, [rpcAppId, name]);

  return {
    ...result,
    create,
    update,
    remove,
  };
}

/**
 * Wrapper around useHandlerData that adds execute() for imperative calls.
 */
function useHandlerBridge(name: string, opts?: any) {
  const shouldAutoFetch = opts?.autoFetch ?? (name !== 'auth_signout');
  const effectiveName = shouldAutoFetch ? name : undefined;
  const result = useHandlerData(effectiveName, opts?.params);

  const { appId, apiAppId } = useAppConfig();
  const rpcAppId = apiAppId || appId;

  const execute = useCallback(async (params?: Record<string, unknown>) => {
    try {
      const response = await fetch(`/api/${rpcAppId}/${name}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params || {}),
      });
      const json = await response.json();
      if (!json.success) {
        console.error(`[ExposePlatformGlobal] Handler "${name}" failed:`, json.error?.message);
        return null;
      }
      return json.data;
    } catch (err) {
      console.error(`[ExposePlatformGlobal] Handler "${name}" error:`, err);
      return null;
    }
  }, [rpcAppId, name]);

  return {
    ...result,
    execute,
  };
}

/**
 * Navigation hook bridge — subscribes the calling component to route changes
 * via useLocation(), making currentPath and currentSlug reactive.
 */
function useNavigationBridge() {
  const { pathname } = useLocation();
  const nav = useNavigate();
  const { basePath } = useAppConfig();

  const navigate = useCallback((path: string, opts?: { replace?: boolean }) => {
    const fullPath = path.startsWith(basePath) ? path : `${basePath}${path}`;
    nav(fullPath, opts?.replace ? { replace: true } : undefined);
  }, [nav, basePath]);

  const currentSlug = pathname.startsWith(basePath)
    ? pathname.slice(basePath.length) || '/'
    : pathname;

  return {
    navigate,
    currentPath: pathname,
    currentSlug,
    basePath,
  };
}

// ---- Reactive dark-mode detection (MutationObserver on <html> class) ----

function subscribeDarkMode(onStoreChange: () => void): () => void {
  const observer = new MutationObserver(onStoreChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['class'],
  });
  return () => observer.disconnect();
}

function getDarkModeSnapshot(): boolean {
  return document.documentElement.classList.contains('dark');
}

/**
 * Theme hook bridge — reads from app config frontend.theme.
 * Maps ThemeProps (light/dark palettes, fonts, radius) to the SDK's ThemeTokens shape.
 * Reactively tracks dark mode via useSyncExternalStore.
 */
function useThemeBridge() {
  const { appConfig } = useAppConfig();
  const theme = appConfig.frontend?.theme;

  const isDark = useSyncExternalStore(subscribeDarkMode, getDarkModeSnapshot);
  const colors = isDark ? theme?.dark : theme?.light;
  const fallbackColors = theme?.light;

  return {
    colors: {
      primary: colors?.primary || fallbackColors?.primary || '#0f172a',
      'primary-foreground': colors?.['primary-foreground'] || fallbackColors?.['primary-foreground'] || '#ffffff',
      secondary: colors?.secondary || fallbackColors?.secondary || '#64748b',
      'secondary-foreground': colors?.['secondary-foreground'] || fallbackColors?.['secondary-foreground'] || '#0f172a',
      accent: colors?.accent || fallbackColors?.accent || '#3b82f6',
      'accent-foreground': colors?.['accent-foreground'] || fallbackColors?.['accent-foreground'] || '#0f172a',
      background: colors?.background || fallbackColors?.background || '#ffffff',
      foreground: colors?.foreground || fallbackColors?.foreground || '#0f172a',
      muted: colors?.muted || fallbackColors?.muted || '#f1f5f9',
      'muted-foreground': colors?.['muted-foreground'] || fallbackColors?.['muted-foreground'] || '#64748b',
      destructive: colors?.destructive || fallbackColors?.destructive || '#ef4444',
      'destructive-foreground': colors?.['destructive-foreground'] || fallbackColors?.['destructive-foreground'] || '#ffffff',
      card: colors?.card || colors?.background || fallbackColors?.card || '#ffffff',
      'card-foreground': colors?.['card-foreground'] || colors?.foreground || fallbackColors?.['card-foreground'] || '#0f172a',
      popover: colors?.popover || colors?.background || fallbackColors?.popover || '#ffffff',
      'popover-foreground': colors?.['popover-foreground'] || colors?.foreground || fallbackColors?.['popover-foreground'] || '#0f172a',
      border: colors?.border || fallbackColors?.border || '#e2e8f0',
      input: colors?.input || fallbackColors?.input || '#e2e8f0',
      ring: colors?.ring || fallbackColors?.ring || '#0f172a',
      success: '#22c55e',
      warning: '#f59e0b',
    },
    typography: {
      fontFamily: theme?.fonts?.body?.family || 'Inter, system-ui, sans-serif',
      headingFontFamily: theme?.fonts?.heading?.family || theme?.fonts?.body?.family || 'Inter, system-ui, sans-serif',
    },
    borderRadius: theme?.radius || '0.5rem',
    mode: isDark ? 'dark' as const : 'light' as const,
  };
}

/**
 * Current user hook bridge — reads from app state auth namespace.
 */
function useCurrentUserBridge() {
  const auth = useAppStateStore((s) => s._state['auth'] as Record<string, unknown> | undefined);
  const authUser = auth?.user as Record<string, unknown> | null | undefined;

  if (!auth) {
    return {
      id: null,
      email: null,
      roles: [] as string[],
      isAuthenticated: false,
    };
  }

  return {
    id: (authUser?.id as string) ?? null,
    email: (authUser?.email as string) ?? null,
    name: (authUser?.name as string) ?? null,
    roles: (auth.roles as string[]) ?? (authUser?.roles as string[]) ?? [],
    isAuthenticated: (auth.isAuthenticated as boolean) ?? false,
  };
}

/**
 * Component that exposes platform hooks to window for CodeComponents.
 * Should be rendered once at the app root level, alongside ExposeStateGlobal.
 */
export function ExposePlatformGlobal(): null {
  const { appId, apiAppId, basePath, appConfig } = useAppConfig();
  const navigate = useNavigate();
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;

  const rpcAppId = apiAppId || appId;

  // Set basePath synchronously (not in useEffect) so the SDK fallback
  // can prepend it even before the full ExepadPlatform API is ready.
  if (typeof window !== 'undefined') {
    (window as any).__EXEPAD_BASE_PATH__ = basePath;
  }

  useEffect(() => {
    window.ExepadPlatform = {
      // Hook references — called by CodeComponents during their render cycle
      useModel: useModelBridge,
      useHandler: useHandlerBridge,
      useNavigation: useNavigationBridge,
      useTheme: useThemeBridge,
      useCurrentUser: useCurrentUserBridge,

      // Standalone navigate function (non-hook)
      navigate: (path: string, opts?: { replace?: boolean }) => {
        const fullPath = path.startsWith(basePath) ? path : `${basePath}${path}`;
        if (opts?.replace) {
          navigateRef.current(fullPath, { replace: true });
        } else {
          navigateRef.current(fullPath);
        }
      },

      // Utility getters
      getBasePath: () => basePath,
      getAppId: () => appId,
      getRpcUrl: () => `/api/${rpcAppId}`,

      // Code Focus: compiled CSS URLs — resolved from repo.frontend.styles
      getCssUrls: () => {
        const styles = (appConfig as any)?.repo?.frontend?.styles;
        if (!styles || typeof styles !== 'object') return [];
        return Object.values(styles)
          .map((s: any) => s?.compiled ? `${basePath}/repo/${s.compiled}` : null)
          .filter(Boolean) as string[];
      },
    } satisfies ExepadPlatformAPI;

    return () => {
      delete window.ExepadPlatform;
    };
  }, [appId, apiAppId, basePath]);

  return null;
}

export default ExposePlatformGlobal;
