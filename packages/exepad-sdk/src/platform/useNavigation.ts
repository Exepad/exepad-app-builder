import { getPlatform } from '../helpers/bridge';
import type { NavigationAPI } from './types';

/**
 * Read basePath from the runtime's synchronous global (set by ExposePlatformGlobal).
 * Used as a defensive fallback when the full platform API isn't available yet.
 */
function getFallbackBasePath(): string {
  if (typeof window !== 'undefined') {
    return (window as any).__EXEPAD_BASE_PATH__ || '';
  }
  return '';
}

/**
 * Prepend basePath to a relative path if not already present.
 */
export function withBasePath(path: string, basePath: string): string {
  if (basePath && path.startsWith('/') && !path.startsWith(basePath) && !path.startsWith('//')) {
    return `${basePath}${path}`;
  }
  return path;
}

/**
 * Resolve an app-internal navigation path to the fully-qualified URL the
 * browser should load. Used by ``Link`` so the rendered ``href`` is correct
 * for "Open in new tab", crawlers, and modifier-click navigation — not just
 * the intercepted left-click path that routes through ``navigate()``.
 */
export function resolveAppPath(path: string): string {
  return withBasePath(path, getFallbackBasePath());
}

export function useNavigation(): NavigationAPI {
  const platform = getPlatform();
  if (platform) {
    return platform.useNavigation();
  }
  const basePath = getFallbackBasePath();
  const currentPath = typeof window !== 'undefined' ? window.location.pathname : '/';
  const currentSlug = currentPath.startsWith(basePath)
    ? currentPath.slice(basePath.length) || '/'
    : currentPath;
  return {
    navigate: (path: string) => {
      if (typeof window !== 'undefined') {
        window.location.href = withBasePath(path, basePath);
      }
    },
    currentPath,
    currentSlug,
    basePath,
  };
}

/**
 * Per-app route catalogue. Apps augment this interface via a generated
 * `app.d.ts` that declares each declared page slug:
 *
 *     declare module '@exepad/sdk' {
 *       interface AppRoutes {
 *         '/': true;
 *         '/posts': true;
 *         '/posts/:id': true;
 *       }
 *     }
 *
 * Used by the typed `navigate()` overload to provide autocomplete and
 * typo flagging on literal-string calls. Variable-typed paths fall
 * through to the permissive `string` overload.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface AppRoutes {}

type AppRoute = keyof AppRoutes extends never
  ? string
  : (keyof AppRoutes & string)
    | `${keyof AppRoutes & string}?${string}`
    | `${string}#${string}`;

// Overload 1: literal route — gets autocomplete + typo detection from
// the augmented AppRoutes union. TS resolves this overload first when
// the argument is a string literal that matches the union.
export function navigate<P extends AppRoute>(
  path: P,
  opts?: { replace?: boolean },
): void;
// Overload 2: variable-typed string — for `navigate(link.path)`,
// `navigate(slug)`, computed paths, etc. Skips static route checking;
// the runtime resolves it the same way.
export function navigate(path: string, opts?: { replace?: boolean }): void;
export function navigate(path: string, opts?: { replace?: boolean }): void {
  const platform = getPlatform();
  if (platform) {
    platform.navigate(path, opts);
  } else if (typeof window !== 'undefined') {
    // Defensive: prepend basePath even without full platform API
    const fullPath = withBasePath(path, getFallbackBasePath());
    if (opts?.replace) {
      window.location.replace(fullPath);
    } else {
      window.location.href = fullPath;
    }
  }
}
