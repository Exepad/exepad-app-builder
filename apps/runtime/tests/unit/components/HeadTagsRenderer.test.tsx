/**
 * HeadTagsRenderer XSS + LinkInterceptor tests
 *
 * Two security-sensitive Code Focus surfaces share this file because they are
 * the two "untrusted-config → DOM" choke points used by agent-generated apps:
 *
 *  1. HeadTagsRenderer injects external resources (stylesheet/script/style) into
 *     the document <head> from app config. Hostile config values must be
 *     escaped/neutralized: no </script> breakout, no attribute breakout, no
 *     javascript:/data: URLs, and inline <script> content must be refused.
 *     We mirror DynamicTheme's adversarial CSS-injection suite (the model).
 *
 *  2. LinkInterceptor classifies internal vs external anchors and intercepts
 *     clicks on internal paths (preventDefault + SPA navigate) while passing
 *     external/modified clicks through untouched.
 *
 * Harness note: tests/setup.ts globally mocks `react-router` so `useNavigate()`
 * returns the shared `mockNavigate` spy, and also stubs `console.warn`. We
 * import both so we can assert navigation + block-warnings without re-mocking.
 */

import React from 'react';
import { render, fireEvent } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import HeadTagsRenderer from '@/components/HeadTagsRenderer';
import { LinkInterceptor } from '@/runtime/components/custom/code/LinkInterceptor';
import { AppContextProvider } from '@/context/AppContext';
import type { HeadTagProps } from '@/interfaces/apps/webapp';

// `mockNavigate` is the shared spy that the global react-router mock returns
// from useNavigate(). Importing it lets us assert SPA navigation targets.
import { mockNavigate } from '../../setup';

// =============================================================================
// HeadTagsRenderer — head injection sanitization
// =============================================================================

/**
 * Render the head tags and return the container so tests can inspect the actual
 * DOM nodes React produced (link/script/style). We assert on real elements
 * rather than serialized HTML where attribute escaping matters, because React
 * escapes attribute values itself — the security question is *which* nodes get
 * created and *what* their attributes resolve to.
 */
function renderTags(headTags?: HeadTagProps[]) {
  return render(<HeadTagsRenderer headTags={headTags} />);
}

describe('HeadTagsRenderer', () => {
  describe('empty / nullish input', () => {
    it('renders nothing when headTags is undefined', () => {
      const { container } = renderTags(undefined);
      expect(container.innerHTML).toBe('');
    });

    it('renders nothing when headTags is an empty array', () => {
      const { container } = renderTags([]);
      expect(container.innerHTML).toBe('');
    });

    it('ignores tags with an unknown type (default branch → null)', () => {
      const { container } = renderTags([
        { type: 'meta' as any, content: 'x' },
        { type: '' as any },
      ]);
      expect(container.innerHTML).toBe('');
    });
  });

  describe('stylesheet host allow-listing', () => {
    it('renders an allow-listed HTTPS stylesheet', () => {
      const { container } = renderTags([
        { type: 'stylesheet', src: 'https://fonts.googleapis.com/css?family=Inter' },
      ]);
      const link = container.querySelector('link');
      expect(link).not.toBeNull();
      expect(link!.getAttribute('rel')).toBe('stylesheet');
      expect(link!.getAttribute('href')).toBe(
        'https://fonts.googleapis.com/css?family=Inter',
      );
    });

    it('allows all configured stylesheet hosts', () => {
      const hosts = [
        'fonts.googleapis.com',
        'fonts.gstatic.com',
        'cdn.exepad.com',
        'cdn.jsdelivr.net',
        'unpkg.com',
      ];
      for (const host of hosts) {
        const { container } = renderTags([
          { type: 'stylesheet', src: `https://${host}/a.css` },
        ]);
        expect(container.querySelector('link')).not.toBeNull();
      }
    });

    it('blocks a stylesheet from a non-allow-listed host', () => {
      const { container } = renderTags([
        { type: 'stylesheet', src: 'https://evil.example.com/a.css' },
      ]);
      expect(container.querySelector('link')).toBeNull();
    });

    it('blocks an HTTP (non-HTTPS) stylesheet even on an allow-listed host', () => {
      const { container } = renderTags([
        { type: 'stylesheet', src: 'http://fonts.googleapis.com/a.css' },
      ]);
      expect(container.querySelector('link')).toBeNull();
    });

    it('blocks a stylesheet with a missing src', () => {
      const { container } = renderTags([{ type: 'stylesheet' }]);
      expect(container.querySelector('link')).toBeNull();
    });

    it('rejects host-confusion via userinfo (evil hidden behind @allowed-host)', () => {
      // https://fonts.googleapis.com@evil.com/x parses with hostname=evil.com,
      // so the allow-list must reject it despite the allow-listed userinfo.
      const { container } = renderTags([
        { type: 'stylesheet', src: 'https://fonts.googleapis.com@evil.com/a.css' },
      ]);
      expect(container.querySelector('link')).toBeNull();
    });

    it('matches the allow-list case-insensitively on hostname', () => {
      const { container } = renderTags([
        { type: 'stylesheet', src: 'https://FONTS.GoogleAPIs.COM/a.css' },
      ]);
      // hostname is lowercased before the allow-list check, so this passes.
      expect(container.querySelector('link')).not.toBeNull();
    });

    it('blocks a javascript: stylesheet href', () => {
      const { container } = renderTags([
        { type: 'stylesheet', src: 'javascript:alert(1)' },
      ]);
      expect(container.querySelector('link')).toBeNull();
    });
  });

  describe('script host allow-listing + inline refusal', () => {
    it('renders an allow-listed HTTPS external script', () => {
      const { container } = renderTags([
        { type: 'script', src: 'https://cdn.tailwindcss.com' },
      ]);
      const script = container.querySelector('script');
      expect(script).not.toBeNull();
      expect(script!.getAttribute('src')).toBe('https://cdn.tailwindcss.com');
    });

    it('blocks an external script from a non-allow-listed host', () => {
      const { container } = renderTags([
        { type: 'script', src: 'https://evil.example.com/x.js' },
      ]);
      expect(container.querySelector('script')).toBeNull();
    });

    it('blocks an HTTP external script even on an allow-listed host', () => {
      const { container } = renderTags([
        { type: 'script', src: 'http://cdn.jsdelivr.net/x.js' },
      ]);
      expect(container.querySelector('script')).toBeNull();
    });

    it('refuses inline <script> content entirely (no node emitted)', () => {
      const { container } = renderTags([
        { type: 'script', content: 'alert(document.cookie)' },
      ]);
      // Inline JS bypasses CSP and runs on the app subdomain → never injected.
      expect(container.querySelector('script')).toBeNull();
      expect(container.innerHTML).toBe('');
    });

    it('does not let an inline-content script smuggle a </script> breakout', () => {
      const { container } = renderTags([
        { type: 'script', content: '</script><img src=x onerror=alert(1)>' },
      ]);
      expect(container.innerHTML).toBe('');
      expect(container.querySelector('img')).toBeNull();
    });

    it('emits no node when a script tag has neither src nor content', () => {
      const { container } = renderTags([{ type: 'script' }]);
      expect(container.innerHTML).toBe('');
    });
  });

  describe('inline <style> CSS sanitization', () => {
    function styleCss(content: string): string {
      const { container } = renderTags([{ type: 'style', content }]);
      const styleTag = container.querySelector('style');
      return styleTag?.innerHTML ?? '';
    }

    it('renders a sanitized <style> for inline CSS', () => {
      const { container } = renderTags([
        { type: 'style', content: 'body { color: red; }' },
      ]);
      const styleTag = container.querySelector('style');
      expect(styleTag).not.toBeNull();
      expect(styleTag!.innerHTML).toContain('color: red');
    });

    it('renders nothing for a style tag with empty content', () => {
      const { container } = renderTags([{ type: 'style', content: '' }]);
      expect(container.querySelector('style')).toBeNull();
    });

    it('neutralizes a <script> tag embedded in CSS', () => {
      const css = styleCss('body{}</style><script>alert(1)</script>');
      expect(css).not.toContain('<script>');
      // The closing </style> is stripped so the style element cannot be escaped.
      expect(css).not.toContain('</style>');
    });

    it('strips a bare </style> close to prevent element breakout', () => {
      const css = styleCss('</style><img src=x onerror=alert(1)>');
      expect(css).not.toContain('</style>');
    });

    it('removes IE expression() CSS', () => {
      const css = styleCss('width: expression(alert(1))');
      expect(css).not.toMatch(/expression\s*\(/i);
    });

    it('removes -moz-binding injection', () => {
      const css = styleCss('-moz-binding: url(http://evil/x.xml#e)');
      expect(css).not.toMatch(/-moz-binding\s*:/i);
    });

    it('removes behavior: HTC injection', () => {
      const css = styleCss('behavior: url(evil.htc)');
      expect(css).not.toMatch(/behavior\s*:/i);
    });

    it('blocks javascript: inside url()', () => {
      const css = styleCss('background: url(javascript:alert(1))');
      expect(css).not.toMatch(/url\s*\(\s*['"]?\s*javascript:/i);
      expect(css).toContain('url(blocked:');
    });

    it('blocks data: inside url()', () => {
      const css = styleCss("background: url('data:text/html,<script>1</script>')");
      expect(css).not.toMatch(/url\s*\(\s*['"]?\s*data:/i);
      expect(css).toContain('url(blocked:');
    });

    it('blocks javascript: url() with surrounding whitespace and quotes', () => {
      const css = styleCss('background: url(  "javascript:alert(1)" )');
      expect(css).not.toMatch(/url\s*\(\s*['"]?\s*javascript:/i);
    });

    it('keeps benign url() references intact', () => {
      const css = styleCss('background: url(https://cdn.exepad.com/bg.png)');
      expect(css).toContain('url(https://cdn.exepad.com/bg.png)');
    });
  });

  describe('multiple tags + mixed safe/hostile', () => {
    it('renders only the allowed tags from a mixed list, dropping the hostile ones', () => {
      const { container } = renderTags([
        { type: 'stylesheet', src: 'https://fonts.googleapis.com/a.css' }, // keep
        { type: 'stylesheet', src: 'https://evil.com/a.css' }, // drop
        { type: 'script', src: 'https://cdn.tailwindcss.com' }, // keep
        { type: 'script', content: 'alert(1)' }, // drop (inline)
        { type: 'style', content: 'body{color:green}' }, // keep
      ]);
      expect(container.querySelectorAll('link')).toHaveLength(1);
      expect(container.querySelectorAll('script')).toHaveLength(1);
      expect(container.querySelectorAll('style')).toHaveLength(1);
      expect(container.querySelector('link')!.getAttribute('href')).toBe(
        'https://fonts.googleapis.com/a.css',
      );
    });
  });
});

// =============================================================================
// LinkInterceptor — internal/external classification + click handling
// =============================================================================

/**
 * Render the interceptor inside an AppContextProvider with the given basePath,
 * wrapping a single anchor. Tests then fire a click on the anchor and assert the
 * navigation / preventDefault behavior.
 */
function renderInterceptor(
  basePath: string,
  anchor: React.ReactNode,
) {
  return render(
    <AppContextProvider basePath={basePath}>
      <LinkInterceptor>{anchor}</LinkInterceptor>
    </AppContextProvider>,
  );
}

describe('LinkInterceptor', () => {
  let openSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mockNavigate.mockClear();
    // window.open is invoked for new-window/modified clicks — stub it so we can
    // assert the target without spawning anything.
    openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
  });

  afterEach(() => {
    openSpy.mockRestore();
  });

  describe('internal path interception', () => {
    it('intercepts an internal link and SPA-navigates with basePath prepended', () => {
      const { getByText } = renderInterceptor(
        '/a/myapp',
        <a href="/about">About</a>,
      );
      fireEvent.click(getByText('About'));
      expect(mockNavigate).toHaveBeenCalledTimes(1);
      expect(mockNavigate).toHaveBeenCalledWith('/a/myapp/about');
    });

    it('navigates to bare basePath + "/" for the root-relative "/" href', () => {
      const { getByText } = renderInterceptor(
        '/a/myapp',
        <a href="/">Home</a>,
      );
      fireEvent.click(getByText('Home'));
      expect(mockNavigate).toHaveBeenCalledWith('/a/myapp/');
    });

    it('preserves query strings and hash fragments on internal links', () => {
      const { getByText } = renderInterceptor(
        '/a/myapp',
        <a href="/search?q=1#top">Search</a>,
      );
      fireEvent.click(getByText('Search'));
      expect(mockNavigate).toHaveBeenCalledWith('/a/myapp/search?q=1#top');
    });

    it('works with an empty basePath (root-hosted app)', () => {
      const { getByText } = renderInterceptor('', <a href="/about">About</a>);
      fireEvent.click(getByText('About'));
      expect(mockNavigate).toHaveBeenCalledWith('/about');
    });

    it('intercepts clicks that originate on a nested child of the anchor', () => {
      const { getByText } = renderInterceptor(
        '/a/myapp',
        <a href="/profile">
          <span>Open profile</span>
        </a>,
      );
      // closest('a') must resolve the anchor from the inner <span> target.
      fireEvent.click(getByText('Open profile'));
      expect(mockNavigate).toHaveBeenCalledWith('/a/myapp/profile');
    });
  });

  describe('external / non-navigable hrefs pass through untouched', () => {
    const passthroughCases: Array<[string, string]> = [
      ['absolute https', 'https://example.com/page'],
      ['absolute http', 'http://example.com/page'],
      ['mailto', 'mailto:hi@example.com'],
      ['tel', 'tel:+15551234567'],
      ['javascript', 'javascript:alert(1)'],
      ['hash-only', '#section'],
      ['blob', 'blob:https://example.com/uuid'],
      ['data uri', 'data:text/html,<h1>x</h1>'],
    ];

    for (const [label, href] of passthroughCases) {
      it(`does not intercept ${label} (${href})`, () => {
        const { getByText } = renderInterceptor('/a/myapp', <a href={href}>L</a>);
        fireEvent.click(getByText('L'));
        expect(mockNavigate).not.toHaveBeenCalled();
      });
    }

    it('does not intercept a relative (non-root) path', () => {
      const { getByText } = renderInterceptor('/a/myapp', <a href="about">L</a>);
      fireEvent.click(getByText('L'));
      expect(mockNavigate).not.toHaveBeenCalled();
    });
  });

  describe('already-fully-qualified / cross-app routes pass through', () => {
    it('does not re-prepend basePath when href already starts with the basePath', () => {
      const { getByText } = renderInterceptor(
        '/a/myapp',
        <a href="/a/myapp/about">L</a>,
      );
      fireEvent.click(getByText('L'));
      // It already targets this app's basePath, so the interceptor leaves it
      // to the browser/router rather than double-prepending.
      expect(mockNavigate).not.toHaveBeenCalled();
    });

    it.each(['/example/', '/a/', '/demo/'])(
      'does not intercept known top-level route prefix %s',
      (prefix) => {
        const { getByText } = renderInterceptor(
          '/a/myapp',
          <a href={`${prefix}other`}>L</a>,
        );
        fireEvent.click(getByText('L'));
        expect(mockNavigate).not.toHaveBeenCalled();
      },
    );
  });

  describe('modified clicks open a new window instead of SPA navigating', () => {
    it('opens a new window for target="_blank" internal links', () => {
      const { getByText } = renderInterceptor(
        '/a/myapp',
        <a href="/about" target="_blank">About</a>,
      );
      fireEvent.click(getByText('About'));
      expect(openSpy).toHaveBeenCalledWith('/a/myapp/about', '_blank');
      expect(mockNavigate).not.toHaveBeenCalled();
    });

    it('opens a new window for ctrl/meta/shift-clicks', () => {
      const { getByText } = renderInterceptor(
        '/a/myapp',
        <a href="/about">About</a>,
      );
      fireEvent.click(getByText('About'), { ctrlKey: true });
      expect(openSpy).toHaveBeenCalledWith('/a/myapp/about', '_blank');
      expect(mockNavigate).not.toHaveBeenCalled();
    });
  });

  describe('defaultPrevented + missing-anchor guards', () => {
    it('bails out when the component already called preventDefault', () => {
      const { getByText } = renderInterceptor(
        '/a/myapp',
        <a href="/about" onClick={(e) => e.preventDefault()}>
          About
        </a>,
      );
      fireEvent.click(getByText('About'));
      // Interceptor must not double-handle SDK navigate()-style components.
      expect(mockNavigate).not.toHaveBeenCalled();
      expect(openSpy).not.toHaveBeenCalled();
    });

    it('does nothing when the click is not on an anchor', () => {
      const { getByText } = renderInterceptor(
        '/a/myapp',
        <button type="button">Not a link</button>,
      );
      fireEvent.click(getByText('Not a link'));
      expect(mockNavigate).not.toHaveBeenCalled();
      expect(openSpy).not.toHaveBeenCalled();
    });

    it('does nothing for an anchor with no href attribute', () => {
      const { getByText } = renderInterceptor(
        '/a/myapp',
        // eslint-disable-next-line jsx-a11y/anchor-is-valid
        <a>No href</a>,
      );
      fireEvent.click(getByText('No href'));
      expect(mockNavigate).not.toHaveBeenCalled();
      expect(openSpy).not.toHaveBeenCalled();
    });
  });
});
