import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import {
  withBasePath,
  resolveAppPath,
  useNavigation,
  navigate,
} from './useNavigation';
import type { ExepadPlatformAPI, NavigationAPI } from './types';

/**
 * useNavigation is the SDK's app-internal router shim. It ships verbatim into
 * every generated app, so two behaviors are load-bearing:
 *
 *  1. basePath joining — apps mounted under a path prefix (e.g. "/a/<id>") must
 *     have their relative links rewritten exactly once (idempotent, never
 *     double-prefixed), and "/" / already-prefixed / off-origin targets left
 *     alone.
 *  2. open-redirect safety — a path coming from app data/URL params must not be
 *     able to bounce the browser to an attacker origin. Protocol-relative
 *     ("//evil.com") and absolute external URLs are the classic vectors.
 *
 * The module reads basePath from the synchronous global `window.__EXEPAD_BASE_PATH__`
 * and delegates to a full platform navigator (`window.ExepadPlatform`) when one is
 * present, falling back to a `window.location`-based standalone implementation.
 * Tests drive both seams by setting/clearing those globals.
 */

// A fresh fake `location` so each test can observe href assignments / replace()
// without happy-dom actually trying to navigate the JSDOM-ish realm.
function installFakeLocation(pathname = '/'): {
  href: string;
  replace: ReturnType<typeof vi.fn>;
  pathname: string;
} {
  const fake = {
    href: '',
    pathname,
    replace: vi.fn(),
  };
  Object.defineProperty(window, 'location', {
    value: fake,
    writable: true,
    configurable: true,
  });
  return fake as any;
}

let realLocation: Location;

beforeEach(() => {
  realLocation = window.location;
  delete (window as any).__EXEPAD_BASE_PATH__;
  delete (window as any).ExepadPlatform;
});

afterEach(() => {
  Object.defineProperty(window, 'location', {
    value: realLocation,
    writable: true,
    configurable: true,
  });
  delete (window as any).__EXEPAD_BASE_PATH__;
  delete (window as any).ExepadPlatform;
  vi.restoreAllMocks();
});

describe('withBasePath — prefix matrix', () => {
  it('prefixes a relative path when basePath is set', () => {
    expect(withBasePath('/about', '/a/app123')).toBe('/a/app123/about');
  });

  it('is idempotent — never double-prefixes an already-prefixed path', () => {
    const once = withBasePath('/about', '/a/app123');
    expect(once).toBe('/a/app123/about');
    // Re-running with the same basePath must be a no-op, not "/a/app123/a/app123/about".
    expect(withBasePath(once, '/a/app123')).toBe('/a/app123/about');
  });

  it('treats a path that already starts with basePath as already-prefixed', () => {
    expect(withBasePath('/a/app123/posts', '/a/app123')).toBe('/a/app123/posts');
  });

  it('prefixes the bare root "/" to the basePath itself', () => {
    expect(withBasePath('/', '/a/app123')).toBe('/a/app123/');
  });

  it('returns the path unchanged when basePath is empty (no prefix configured)', () => {
    expect(withBasePath('/about', '')).toBe('/about');
    expect(withBasePath('/', '')).toBe('/');
  });

  it('does not prefix a non-absolute path (no leading slash)', () => {
    // Only paths starting with "/" are app-internal candidates; a bare relative
    // or fragment-only string is left for the browser to resolve.
    expect(withBasePath('about', '/a/app123')).toBe('about');
    expect(withBasePath('#section', '/a/app123')).toBe('#section');
  });

  it('does not prefix a protocol-relative "//host" target (it is not app-internal)', () => {
    // The `!path.startsWith('//')` clause exists so basePath is never glued onto
    // a network-path reference. (Whether such a target should navigate at all is
    // the open-redirect concern, covered separately.)
    expect(withBasePath('//evil.com/steal', '/a/app123')).toBe('//evil.com/steal');
  });

  it('does not prefix an absolute http(s) URL', () => {
    expect(withBasePath('https://example.com/x', '/a/app123')).toBe(
      'https://example.com/x',
    );
    expect(withBasePath('http://example.com/x', '/a/app123')).toBe(
      'http://example.com/x',
    );
  });
});

describe('resolveAppPath — reads basePath from the synchronous global', () => {
  it('prefixes using window.__EXEPAD_BASE_PATH__ when present', () => {
    (window as any).__EXEPAD_BASE_PATH__ = '/a/app123';
    expect(resolveAppPath('/about')).toBe('/a/app123/about');
  });

  it('leaves paths untouched when no basePath global is set', () => {
    expect(resolveAppPath('/about')).toBe('/about');
  });

  it('is idempotent against the global basePath', () => {
    (window as any).__EXEPAD_BASE_PATH__ = '/a/app123';
    expect(resolveAppPath('/a/app123/about')).toBe('/a/app123/about');
  });
});

describe('useNavigation — standalone fallback (no platform navigator)', () => {
  it('exposes basePath + currentPath + slug derived from window.location', () => {
    (window as any).__EXEPAD_BASE_PATH__ = '/a/app123';
    installFakeLocation('/a/app123/posts');

    const { result } = renderHook(() => useNavigation());

    expect(result.current.basePath).toBe('/a/app123');
    expect(result.current.currentPath).toBe('/a/app123/posts');
    // slug strips the basePath prefix.
    expect(result.current.currentSlug).toBe('/posts');
  });

  it('derives slug "/" when the current path equals the basePath', () => {
    (window as any).__EXEPAD_BASE_PATH__ = '/a/app123';
    installFakeLocation('/a/app123');

    const { result } = renderHook(() => useNavigation());
    expect(result.current.currentSlug).toBe('/');
  });

  it('leaves the slug equal to the path when it is not under basePath', () => {
    (window as any).__EXEPAD_BASE_PATH__ = '/a/app123';
    installFakeLocation('/somewhere/else');

    const { result } = renderHook(() => useNavigation());
    expect(result.current.currentSlug).toBe('/somewhere/else');
  });

  it('navigate() assigns a basePath-prefixed href on window.location', () => {
    (window as any).__EXEPAD_BASE_PATH__ = '/a/app123';
    const loc = installFakeLocation('/a/app123');

    const { result } = renderHook(() => useNavigation());
    result.current.navigate('/about');

    expect(loc.href).toBe('/a/app123/about');
  });

  it('navigate() does not double-prefix an already-qualified internal path', () => {
    (window as any).__EXEPAD_BASE_PATH__ = '/a/app123';
    const loc = installFakeLocation('/a/app123');

    const { result } = renderHook(() => useNavigation());
    result.current.navigate('/a/app123/posts');

    expect(loc.href).toBe('/a/app123/posts');
  });
});

describe('useNavigation — platform delegation', () => {
  it('delegates entirely to the platform navigator when one is present', () => {
    const platformNav: NavigationAPI = {
      navigate: vi.fn(),
      currentPath: '/platform/here',
      currentSlug: '/here',
      basePath: '/platform',
    };
    const platform: Partial<ExepadPlatformAPI> = {
      useNavigation: vi.fn(() => platformNav),
    };
    (window as any).ExepadPlatform = platform;
    // A different fallback global must be ignored when the platform wins.
    (window as any).__EXEPAD_BASE_PATH__ = '/a/ignored';
    installFakeLocation('/a/ignored/x');

    const { result } = renderHook(() => useNavigation());

    expect(platform.useNavigation).toHaveBeenCalled();
    expect(result.current).toBe(platformNav);
    expect(result.current.basePath).toBe('/platform');
    expect(result.current.currentPath).toBe('/platform/here');
  });
});

describe('navigate() standalone — push vs replace', () => {
  it('pushes (sets href) by default', () => {
    (window as any).__EXEPAD_BASE_PATH__ = '/a/app123';
    const loc = installFakeLocation('/a/app123');

    navigate('/about');

    expect(loc.href).toBe('/a/app123/about');
    expect(loc.replace).not.toHaveBeenCalled();
  });

  it('replaces (calls location.replace) when opts.replace is true', () => {
    (window as any).__EXEPAD_BASE_PATH__ = '/a/app123';
    const loc = installFakeLocation('/a/app123');

    navigate('/about', { replace: true });

    expect(loc.replace).toHaveBeenCalledWith('/a/app123/about');
    // push path must not also fire.
    expect(loc.href).toBe('');
  });

  it('applies basePath joining for replace too', () => {
    (window as any).__EXEPAD_BASE_PATH__ = '/a/app123';
    const loc = installFakeLocation('/a/app123');

    navigate('/a/app123/already', { replace: true });

    expect(loc.replace).toHaveBeenCalledWith('/a/app123/already');
  });
});

describe('navigate() — platform delegation', () => {
  it('delegates to platform.navigate (push) and never touches window.location', () => {
    const platformNavigate = vi.fn();
    (window as any).ExepadPlatform = {
      navigate: platformNavigate,
    } as Partial<ExepadPlatformAPI>;
    const loc = installFakeLocation('/');

    navigate('/about');

    expect(platformNavigate).toHaveBeenCalledWith('/about', undefined);
    expect(loc.href).toBe('');
    expect(loc.replace).not.toHaveBeenCalled();
  });

  it('forwards the replace option to the platform navigator verbatim', () => {
    const platformNavigate = vi.fn();
    (window as any).ExepadPlatform = {
      navigate: platformNavigate,
    } as Partial<ExepadPlatformAPI>;

    navigate('/about', { replace: true });

    expect(platformNavigate).toHaveBeenCalledWith('/about', { replace: true });
  });
});

describe('open-redirect guard (security)', () => {
  // The default test origin is http://localhost:3000. A navigation target that
  // resolves to a *different* origin is an open redirect: app data, a URL query
  // param, or an AI-emitted link must not be able to bounce a user to an
  // attacker-controlled host.

  it('keeps an absolute external http(s) URL — allowed per design (explicit, not "//"-disguised)', () => {
    // Absolute URLs are an intentional escape hatch (e.g. "Open external docs").
    // They are unambiguous to the user, unlike protocol-relative targets.
    (window as any).__EXEPAD_BASE_PATH__ = '/a/app123';
    const loc = installFakeLocation('/a/app123');

    navigate('https://example.com/docs');
    expect(loc.href).toBe('https://example.com/docs');
  });

  // BUG: protocol-relative targets bounce off-origin. `withBasePath` deliberately
  // skips prefixing "//evil.com" but `navigate()` then assigns it raw to
  // window.location.href, so the browser resolves it as `<scheme>://evil.com`
  // — a classic open redirect. The secure behavior is to refuse the off-origin
  // jump (e.g. ignore it, or coerce it to a same-origin path). Quarantined until
  // the SDK grows an origin check.
  it.fails(
    'must NOT navigate to a protocol-relative "//evil.com" target',
    () => {
      (window as any).__EXEPAD_BASE_PATH__ = '/a/app123';
      const loc = installFakeLocation('/a/app123');

      navigate('//evil.com/phish');

      // Secure expectation: the off-origin protocol-relative URL was rejected,
      // so href was never set to it (and replace was not abused either).
      expect(loc.href).not.toBe('//evil.com/phish');
      expect(loc.replace).not.toHaveBeenCalledWith('//evil.com/phish');
    },
  );

  // BUG: same vector via the replace path.
  it.fails(
    'must NOT replace() to a protocol-relative "//evil.com" target',
    () => {
      (window as any).__EXEPAD_BASE_PATH__ = '/a/app123';
      const loc = installFakeLocation('/a/app123');

      navigate('//evil.com/phish', { replace: true });

      expect(loc.replace).not.toHaveBeenCalledWith('//evil.com/phish');
    },
  );

  // BUG: the useNavigation() standalone navigator shares the same flaw.
  it.fails(
    'useNavigation().navigate must NOT honor a protocol-relative target',
    () => {
      (window as any).__EXEPAD_BASE_PATH__ = '/a/app123';
      const loc = installFakeLocation('/a/app123');

      const { result } = renderHook(() => useNavigation());
      result.current.navigate('//evil.com/phish');

      expect(loc.href).not.toBe('//evil.com/phish');
    },
  );

  it('does not prefix-disguise a protocol-relative target into the basePath (documents withBasePath output)', () => {
    // Confirms the raw join leaves "//evil.com" intact rather than producing a
    // safe "/a/app123//evil.com" — i.e. the danger is real, not theoretical.
    expect(withBasePath('//evil.com', '/a/app123')).toBe('//evil.com');
  });
});

describe('SSR / no-window safety', () => {
  it('navigate() is a no-op shape when there is no platform (does not throw on assignment)', () => {
    // With a fake location present, push simply assigns; this guards the
    // common-case branch and complements the typeof-window guard in source.
    (window as any).__EXEPAD_BASE_PATH__ = '';
    const loc = installFakeLocation('/');
    expect(() => navigate('/x')).not.toThrow();
    expect(loc.href).toBe('/x');
  });
});
