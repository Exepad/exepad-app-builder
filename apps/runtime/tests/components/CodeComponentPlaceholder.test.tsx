/**
 * CodeComponent placeholder + side-channel reporting tests.
 *
 * Change E target: when a code component fails to load OR fails to
 * render, end users see a single generic placeholder with no error
 * language, no URLs, no stack traces. Operators get the structured
 * failure detail through three sinks:
 *   1. ``logger.error`` (browser console).
 *   2. ``window`` CustomEvent ``exepad:code-component-failure``.
 *   3. ``window.parent.postMessage`` for cross-frame dashboards.
 *
 * These tests are the contract for that behavior. If the placeholder
 * starts leaking technical detail (URLs, stack traces, "Failed to
 * load" copy) the assertions here flip immediately. Reproduces the
 * `ze1ltmf9` confusion where a non-tech user read the technical
 * overlay as "scripts missing 404".
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

import {
  CodeComponentPlaceholder,
  reportCodeComponentFailure,
} from '@/runtime/components/custom/code/CodeComponent';


describe('CodeComponentPlaceholder', () => {
  it('renders a generic non-technical message', () => {
    render(<CodeComponentPlaceholder />);
    expect(
      screen.getByText("This section isn't available right now."),
    ).toBeTruthy();
  });

  it('does NOT leak any error language to the rendered DOM', () => {
    const { container } = render(<CodeComponentPlaceholder />);
    const text = container.textContent ?? '';
    // Hard contract: no "error", "failed", "blocked", URLs, or stack
    // traces in the rendered output. Catches accidental regressions
    // that re-introduce technical copy.
    const forbidden = [
      'error',
      'Error',
      'Failed',
      'failed',
      'Blocked',
      'blocked',
      'http://',
      'https://',
      'Stack',
      'stack',
      'Retry',
      'retry',
    ];
    for (const term of forbidden) {
      expect(text.includes(term)).toBe(false);
    }
  });

  it('uses an aria-live status role so screen readers announce it neutrally', () => {
    const { container } = render(<CodeComponentPlaceholder />);
    const status = container.querySelector('[role="status"]');
    expect(status).toBeTruthy();
    expect(status?.getAttribute('aria-live')).toBe('polite');
  });

  it('passes className to the host slot so layout dimensions are preserved', () => {
    const { container } = render(
      <CodeComponentPlaceholder className="my-custom-slot-class" />,
    );
    expect(container.querySelector('.my-custom-slot-class')).toBeTruthy();
  });
});


describe('reportCodeComponentFailure', () => {
  beforeEach(() => {
    // Silence the console.error sink for assertion clarity. The
    // dispatched CustomEvent is the assertion surface; console output
    // is incidental.
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('dispatches a window CustomEvent with the failure detail', () => {
    const handler = vi.fn();
    window.addEventListener(
      'exepad:code-component-failure',
      handler as EventListener,
    );

    reportCodeComponentFailure({
      componentName: 'GameContent',
      componentUuid: 'abc-123',
      failureClass: 'render_failed',
      errorMessage: 'Minified React error #130',
      errorStack: 'Error: ... at oi (/assets/...)',
      url: 'https://p1.exepad.com/a/preview-test/repo/compiled/X.js',
    });

    expect(handler).toHaveBeenCalledTimes(1);
    const event = handler.mock.calls[0][0] as CustomEvent;
    expect(event.detail.componentName).toBe('GameContent');
    expect(event.detail.componentUuid).toBe('abc-123');
    expect(event.detail.failureClass).toBe('render_failed');
    expect(event.detail.errorMessage).toBe('Minified React error #130');

    window.removeEventListener(
      'exepad:code-component-failure',
      handler as EventListener,
    );
  });

  it('skips window.parent.postMessage when no iframe parent exists', () => {
    // Standalone preview / direct navigation: ``window.parent === window``.
    // Posting a message in that case fires a browser console warning on every
    // render ("targetOrigin does not match the recipient window's origin"),
    // even though the post is functionally a no-op. The guard inside
    // ``reportCodeComponentFailure`` short-circuits before postMessage runs.
    const postMessage = vi.spyOn(window.parent, 'postMessage');

    reportCodeComponentFailure({
      failureClass: 'fetch_failed',
      errorMessage: 'network timeout',
    });

    // jsdom default: window.parent === window, so the guard skips the post.
    expect(window.parent).toBe(window);
    expect(postMessage).not.toHaveBeenCalled();
    postMessage.mockRestore();
  });

  it('survives postMessage failures without throwing', () => {
    // Even when running standalone (no real iframe parent), the function
    // must not throw — sink failures are tolerated; the placeholder
    // still rendered to the user. The guard means postMessage is never
    // invoked here, but the original try/catch around the call site is
    // preserved so that future code paths inside the iframe branch stay
    // resilient.
    vi.spyOn(window.parent, 'postMessage').mockImplementation(() => {
      throw new Error('cross-origin sandbox');
    });
    expect(() =>
      reportCodeComponentFailure({
        failureClass: 'blocked',
        errorMessage: 'blocked',
      }),
    ).not.toThrow();
  });
});
