import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, renderHook, act } from '@testing-library/react';
import * as React from 'react';

import { ChartStyle } from '@/components/ui/chart';
import { useIsMobile } from '@/hooks/use-mobile';
import { SidebarProvider, useSidebar } from '@/components/ui/sidebar';

/**
 * Three SDK UI primitives that ship verbatim into every generated app and carry
 * load-bearing behavior beyond styling:
 *
 *  1. chart `ChartStyle` — emits a per-chart `<style>` block from a color config
 *     via `dangerouslySetInnerHTML`. The colors come from app/agent-supplied
 *     config, so the emitted CSS is an injection surface: a hostile color string
 *     must not be able to (a) break out of the `<style>` element into live DOM,
 *     nor (b) smuggle extra CSS rules. Only well-formed `--color-<key>: <value>;`
 *     vars should appear.
 *  2. sidebar `SidebarProvider` — persists open/closed in a `sidebar_state`
 *     cookie and re-reads it on mount, and gates layout on a `ready` flag derived
 *     from `useIsMobile()` so SSR/first-paint does not flash the wrong variant.
 *  3. `useIsMobile` — returns `undefined` on the first synchronous render (no
 *     guess before the media query resolves), then commits a real boolean from
 *     `matchMedia`/`innerWidth`, and must detach its `change` listener on unmount.
 *
 * `useIsMobile` reads `window.matchMedia` + `window.innerWidth`; happy-dom ships a
 * real matchMedia, so each test installs a controllable stub to drive the breakpoint
 * deterministically and to observe listener add/remove.
 */

// A controllable matchMedia stub. Tracks the listeners the hook attaches so we
// can both fire `change` events and assert cleanup on unmount.
function installMatchMedia(matches: boolean) {
  const listeners = new Set<(e: any) => void>();
  const mql = {
    matches,
    media: '',
    onchange: null as null | ((e: any) => void),
    addEventListener: vi.fn((_type: string, cb: (e: any) => void) => {
      listeners.add(cb);
    }),
    removeEventListener: vi.fn((_type: string, cb: (e: any) => void) => {
      listeners.delete(cb);
    }),
    // legacy API the hook does not use, present for shape parity
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  };
  (window as any).matchMedia = vi.fn(() => mql);
  return {
    mql,
    listeners,
    fireChange() {
      for (const cb of listeners) cb({ matches: mql.matches });
    },
  };
}

function setInnerWidth(px: number) {
  Object.defineProperty(window, 'innerWidth', {
    value: px,
    writable: true,
    configurable: true,
  });
}

// Clear the sidebar_state cookie so each test starts from a known (absent) state.
function clearSidebarCookie() {
  document.cookie = 'sidebar_state=; path=/; max-age=0';
}

let realMatchMedia: typeof window.matchMedia;
let realInnerWidth: number;

beforeEach(() => {
  realMatchMedia = window.matchMedia;
  realInnerWidth = window.innerWidth;
  clearSidebarCookie();
});

afterEach(() => {
  window.matchMedia = realMatchMedia;
  setInnerWidth(realInnerWidth);
  clearSidebarCookie();
  vi.restoreAllMocks();
});

describe('ChartStyle — CSS var emission', () => {
  it('returns null (renders nothing) when no entry carries a color or theme', () => {
    const { container } = render(<ChartStyle id="chart-1" config={{}} />);
    expect(container.querySelector('style')).toBeNull();
    expect(container.innerHTML).toBe('');
  });

  it('skips entries that have neither color nor theme even when other keys exist', () => {
    // `label`-only entries carry no paint, so they contribute no var; an entry
    // with a color does. Only the colored key may appear.
    const { container } = render(
      <ChartStyle
        id="chart-2"
        config={{
          revenue: { color: 'hsl(220 90% 50%)' },
          // label-only: no color, no theme -> filtered out of colorConfig
          notes: { label: 'Notes' },
        }}
      />,
    );
    const css = container.querySelector('style')!.innerHTML;
    expect(css).toContain('--color-revenue: hsl(220 90% 50%);');
    expect(css).not.toContain('--color-notes');
  });

  it('emits a light (no-prefix) and a dark (.dark) block scoped to the chart id', () => {
    const { container } = render(
      <ChartStyle id="chart-3" config={{ revenue: { color: '#16a34a' } }} />,
    );
    const css = container.querySelector('style')!.innerHTML;
    // Light block: bare `[data-chart=id]`. Dark block: `.dark [data-chart=id]`.
    expect(css).toContain('[data-chart=chart-3] {');
    expect(css).toContain('.dark [data-chart=chart-3] {');
    // The var is present in both theme blocks.
    expect(css.match(/--color-revenue: #16a34a;/g)).toHaveLength(2);
  });

  it('uses the per-theme color for theme-keyed entries (light vs dark differ)', () => {
    const { container } = render(
      <ChartStyle
        id="chart-4"
        config={{
          revenue: { theme: { light: '#000000', dark: '#ffffff' } },
        }}
      />,
    );
    const css = container.querySelector('style')!.innerHTML;
    // Split on the dark selector to inspect each block independently.
    const [lightBlock, darkBlock] = css.split('.dark [data-chart=chart-4]');
    expect(lightBlock).toContain('--color-revenue: #000000;');
    expect(darkBlock).toContain('--color-revenue: #ffffff;');
    expect(lightBlock).not.toContain('#ffffff');
  });
});

describe('ChartStyle — injection surface (security)', () => {
  // The color string is concatenated raw into a `<style>` body via
  // dangerouslySetInnerHTML. Two distinct dangers:
  //   (a) CSS-rule smuggling: a value that closes the rule/declaration block can
  //       append attacker-controlled rules that affect the whole document.
  //   (b) element breakout: a value containing the literal `</style>` ends the
  //       style element in the HTML parser, after which `<script>`/markup is
  //       parsed as live DOM — i.e. stored XSS.
  // The secure contract is that a config color may only ever produce a
  // well-formed `--color-<key>: <value>;` declaration and nothing else.

  it('always wraps the value as a single CSS custom-property declaration', () => {
    const { container } = render(
      <ChartStyle id="chart-x" config={{ k: { color: 'red' } }} />,
    );
    const css = container.querySelector('style')!.innerHTML;
    // The well-formed shape per theme block.
    expect(css).toContain('--color-k: red;');
  });

  // Regression: a color value containing `} ... {` must not close the per-chart
  // rule block and inject brand-new global rules (e.g. `body { display:none }`).
  // The sanitizer rejects any color that is not a plain CSS value.
  it(
    'must NOT let a color smuggle additional CSS rules into the document',
    () => {
      const evil = 'red; } body { display:none } [data-x] {';
      const { container } = render(
        <ChartStyle id="chart-x" config={{ k: { color: evil } }} />,
      );
      const css = container.querySelector('style')!.innerHTML;
      // No attacker-authored rule selector may appear in the emitted CSS.
      expect(css).not.toContain('body { display:none }');
      // And the value must not contain a brace that could terminate the block.
      expect(css).not.toMatch(/--color-k:[^;]*}/);
    },
  );

  // Regression: a color containing the literal `</style>` must not end the style
  // element so trailing markup (`<script>…`) becomes live DOM. The sanitizer
  // drops `<`-bearing values; the rendered subtree stays a single inert <style>.
  it(
    'must NOT allow a color to break out of the <style> element (XSS)',
    () => {
      const evil = 'red</style><script>window.__pwned=1</script>';
      const { container } = render(
        <ChartStyle id="chart-x" config={{ k: { color: evil } }} />,
      );
      // No live <script> may have been parsed out of the style body.
      expect(container.querySelectorAll('script').length).toBe(0);
      // The whole config-driven subtree must be a single <style> element.
      expect(container.childNodes.length).toBe(1);
      expect(
        (container.firstChild as Element)?.tagName?.toLowerCase(),
      ).toBe('style');
    },
  );
});

describe('useIsMobile — resolve + cleanup', () => {
  it('resolves to true (mobile) when innerWidth is below the 768px breakpoint', () => {
    installMatchMedia(true);
    setInnerWidth(500);

    const { result } = renderHook(() => useIsMobile());
    // After the mount effect commits, the boolean is the real value.
    expect(result.current).toBe(true);
  });

  it('resolves to false (desktop) when innerWidth is at/above the breakpoint', () => {
    installMatchMedia(false);
    setInnerWidth(768);

    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(false);
  });

  it('produces undefined on the first synchronous render, then commits a boolean', () => {
    installMatchMedia(true);
    setInnerWidth(400);

    const seen: Array<boolean | undefined> = [];
    function Probe() {
      seen.push(useIsMobile());
      return null;
    }
    render(<Probe />);

    // First render is pre-effect: the hook must not guess a value.
    expect(seen[0]).toBeUndefined();
    // A later render carries the resolved boolean.
    expect(seen[seen.length - 1]).toBe(true);
  });

  it('updates when a matchMedia change fires, reading the live innerWidth', () => {
    const mm = installMatchMedia(false);
    setInnerWidth(1024);

    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(false);

    // Simulate a viewport resize crossing the breakpoint.
    act(() => {
      setInnerWidth(500);
      mm.fireChange();
    });
    expect(result.current).toBe(true);
  });

  it('subscribes to the change event on mount and removes that exact listener on unmount', () => {
    const mm = installMatchMedia(false);
    setInnerWidth(1024);

    const { unmount } = renderHook(() => useIsMobile());
    expect(mm.mql.addEventListener).toHaveBeenCalledWith(
      'change',
      expect.any(Function),
    );
    const attached = mm.mql.addEventListener.mock.calls[0][1];

    unmount();
    expect(mm.mql.removeEventListener).toHaveBeenCalledWith('change', attached);
    // After cleanup the hook holds no live subscription.
    expect(mm.listeners.size).toBe(0);
  });
});

describe('SidebarProvider — cookie persistence + hydration gate', () => {
  // A tiny consumer that surfaces the context onto data-* attributes so we can
  // assert state without reaching into React internals.
  function Probe() {
    const ctx = useSidebar();
    return (
      <div
        data-testid="probe"
        data-open={String(ctx.open)}
        data-state={ctx.state}
        data-ready={String(ctx.ready)}
        data-mobile={String(ctx.isMobile)}
      />
    );
  }

  function readProbe(container: HTMLElement) {
    const el = container.querySelector('[data-testid="probe"]')!;
    return {
      open: el.getAttribute('data-open'),
      state: el.getAttribute('data-state'),
      ready: el.getAttribute('data-ready'),
      mobile: el.getAttribute('data-mobile'),
    };
  }

  it('defaults to open + expanded when no cookie is present', () => {
    installMatchMedia(false);
    setInnerWidth(1200);

    const { container } = render(
      <SidebarProvider>
        <Probe />
      </SidebarProvider>,
    );
    const p = readProbe(container);
    expect(p.open).toBe('true');
    expect(p.state).toBe('expanded');
  });

  it('honors an explicit defaultOpen={false} when no cookie overrides it', () => {
    installMatchMedia(false);
    setInnerWidth(1200);

    const { container } = render(
      <SidebarProvider defaultOpen={false}>
        <Probe />
      </SidebarProvider>,
    );
    const p = readProbe(container);
    expect(p.open).toBe('false');
    expect(p.state).toBe('collapsed');
  });

  it('hydrates from a persisted sidebar_state=false cookie (cookie wins over defaultOpen=true)', () => {
    installMatchMedia(false);
    setInnerWidth(1200);
    document.cookie = 'sidebar_state=false; path=/';

    const { container } = render(
      <SidebarProvider>
        <Probe />
      </SidebarProvider>,
    );
    const p = readProbe(container);
    expect(p.open).toBe('false');
    expect(p.state).toBe('collapsed');
  });

  it('hydrates open from a persisted sidebar_state=true cookie (cookie wins over defaultOpen=false)', () => {
    installMatchMedia(false);
    setInnerWidth(1200);
    document.cookie = 'sidebar_state=true; path=/';

    const { container } = render(
      <SidebarProvider defaultOpen={false}>
        <Probe />
      </SidebarProvider>,
    );
    const p = readProbe(container);
    expect(p.open).toBe('true');
    expect(p.state).toBe('expanded');
  });

  it('writes the new open state to the sidebar_state cookie on toggle', () => {
    installMatchMedia(false);
    setInnerWidth(1200);
    // Pin a known starting cookie so this test is independent of run order.
    document.cookie = 'sidebar_state=true; path=/';

    function Toggler() {
      const { open, toggleSidebar } = useSidebar();
      return (
        <button data-testid="toggle" data-open={String(open)} onClick={toggleSidebar}>
          toggle
        </button>
      );
    }
    const { container } = render(
      <SidebarProvider>
        <Toggler />
      </SidebarProvider>,
    );
    const btn = container.querySelector('[data-testid="toggle"]') as HTMLButtonElement;
    expect(btn.getAttribute('data-open')).toBe('true');

    act(() => {
      btn.click();
    });

    // State flipped to closed...
    expect(btn.getAttribute('data-open')).toBe('false');
    // ...and the cookie now persists that value for a future mount.
    expect(document.cookie).toContain('sidebar_state=false');
  });

  it('marks ready=true once useIsMobile has resolved (hydration gate satisfied)', () => {
    installMatchMedia(false);
    setInnerWidth(1200);

    const { container } = render(
      <SidebarProvider>
        <Probe />
      </SidebarProvider>,
    );
    // After the mount effect, the underlying useIsMobile is no longer undefined,
    // so ready flips true and isMobile reflects the desktop viewport.
    const p = readProbe(container);
    expect(p.ready).toBe('true');
    expect(p.mobile).toBe('false');
  });

  it('reflects a mobile viewport in isMobile while still becoming ready', () => {
    installMatchMedia(true);
    setInnerWidth(500);

    const { container } = render(
      <SidebarProvider>
        <Probe />
      </SidebarProvider>,
    );
    const p = readProbe(container);
    expect(p.mobile).toBe('true');
    expect(p.ready).toBe('true');
  });

  it('treats a controlled `open` prop as the source of truth (overrides cookie)', () => {
    installMatchMedia(false);
    setInnerWidth(1200);
    // Cookie says closed, but a controlled open={true} must win.
    document.cookie = 'sidebar_state=false; path=/';

    const { container } = render(
      <SidebarProvider open={true} onOpenChange={() => {}}>
        <Probe />
      </SidebarProvider>,
    );
    const p = readProbe(container);
    expect(p.open).toBe('true');
    expect(p.state).toBe('expanded');
  });

  it('routes toggles to onOpenChange when controlled, instead of self-mutating', () => {
    installMatchMedia(false);
    setInnerWidth(1200);
    const onOpenChange = vi.fn();

    function Toggler() {
      const { toggleSidebar } = useSidebar();
      return (
        <button data-testid="t" onClick={toggleSidebar}>
          t
        </button>
      );
    }
    const { container } = render(
      <SidebarProvider open={true} onOpenChange={onOpenChange}>
        <Toggler />
      </SidebarProvider>,
    );
    act(() => {
      (container.querySelector('[data-testid="t"]') as HTMLButtonElement).click();
    });
    // Controlled: the parent is asked to flip to false; provider does not self-set.
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

describe('useSidebar — context guard', () => {
  it('throws a clear error when used outside a SidebarProvider', () => {
    // renderHook surfaces the thrown error rather than swallowing it.
    expect(() => renderHook(() => useSidebar())).toThrow(
      /useSidebar must be used within a SidebarProvider/,
    );
  });
});

// ---------------------------------------------------------------------------
// Select — empty-string value tolerance.
//
// Radix `Select.Item` THROWS on `value=""` (it reserves "" to clear the
// selection). Agent-generated filters constantly emit
// `<SelectItem value="">All</SelectItem>`, which crashed the whole page
// (observed live: TasksContent render_failed). The SDK Select/SelectItem
// wrappers map "" → an internal sentinel so the natural pattern renders.
// ---------------------------------------------------------------------------
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

describe('Select — empty-string value tolerance', () => {
  it('renders a defaultOpen Select with a value="" item without throwing', () => {
    // defaultOpen mounts the Content so the Items actually render — the path
    // that throws in raw Radix when an Item has value="".
    expect(() =>
      render(
        <Select value="" defaultOpen onValueChange={() => {}}>
          <SelectTrigger>
            <SelectValue placeholder="All Statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">All Statuses</SelectItem>
            <SelectItem value="todo">Todo</SelectItem>
            <SelectItem value="done">Done</SelectItem>
          </SelectContent>
        </Select>,
      ),
    ).not.toThrow();
  });

  it('renders a closed Select with a value="" item without throwing', () => {
    expect(() =>
      render(
        <Select value="" onValueChange={() => {}}>
          <SelectTrigger>
            <SelectValue placeholder="All" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">All</SelectItem>
            <SelectItem value="x">X</SelectItem>
          </SelectContent>
        </Select>,
      ),
    ).not.toThrow();
  });
});
