/**
 * LogoutHandler — signout RPC + auth-broadcast + redirect seam tests
 *
 * LogoutHandler is the platform default `/logout` surface. On mount it:
 *   1. POSTs `{ method: 'auth_signout' }` to `/api/{appId}/rpc` with
 *      credentials:'include' so the server can clear the session cookie,
 *   2. broadcasts `exepad:auth:changed` with detail EXACTLY `{ action: 'signout' }`,
 *   3. SPA-navigates to `basePath + loginPage` with `{ replace: true }`.
 *
 * The high-value, security-relevant seams under test:
 *
 *  - DETAIL SHAPE CONTRACT: useRuntimeStore's `onAuthChanged` only clears the
 *    in-memory auth store when `detail.action === 'signout'`. Any other shape
 *    (e.g. a bare `{ user: null }`) falls through to an `auth_me` re-fetch which
 *    would observe the *stale* cookie if the RPC raced — leaving the user
 *    effectively logged in. So the emitted detail must be precisely
 *    `{ action: 'signout' }` (no `user` key, correct action string). We assert
 *    against the real consumer's branch logic so a drift here is caught.
 *
 *  - STRICTMODE ONCE-GUARD: React.StrictMode double-invokes effects in dev. The
 *    `started` ref must keep the signout RPC to a single POST — a double-POST
 *    races two cookie-clears/redirects.
 *
 *  - REDIRECT: navigates to basePath+loginPage with replace:true (so Back does
 *    not re-enter /logout), and still does so even when the RPC rejects
 *    (network/expired session) — staying on /logout would spin forever.
 *
 * Harness: copied from the sibling component tests (HeadTagsRenderer.test.tsx).
 * `tests/setup.ts` globally mocks `react-router` so `useNavigate()` returns the
 * shared `mockNavigate` spy. We arm `globalThis.fetch` per-test exactly like
 * useRuntimeStore.test.ts does.
 */

import React from 'react';
import { render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LogoutHandler } from '@/components/LogoutHandler';

// Shared navigate spy returned by the global react-router mock in tests/setup.ts.
import { mockNavigate } from '../../setup';

// -----------------------------------------------------------------------------
// fetch arming helpers (mirrors useRuntimeStore.test.ts)
// -----------------------------------------------------------------------------

/** Arm fetch to resolve with a generic ok JSON body (the signout response). */
function armFetchOk() {
  globalThis.fetch = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ success: true }),
  })) as any;
}

/** Arm fetch to reject (network failure / expired session). */
function armFetchReject() {
  globalThis.fetch = vi.fn(async () => {
    throw new Error('network down');
  }) as any;
}

const PROPS = { basePath: '/a/myapp', apiAppId: 'myapp', loginPage: '/login' } as const;

/**
 * Capture exepad:auth:changed events for the duration of one test. Returns the
 * array of received `detail` payloads plus a teardown.
 */
function captureAuthEvents() {
  const details: any[] = [];
  const listener = (e: Event) => details.push((e as CustomEvent).detail);
  window.addEventListener('exepad:auth:changed', listener);
  return {
    details,
    stop: () => window.removeEventListener('exepad:auth:changed', listener),
  };
}

describe('LogoutHandler', () => {
  beforeEach(() => {
    mockNavigate.mockClear();
    armFetchOk();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ---------------------------------------------------------------------------
  // signout RPC
  // ---------------------------------------------------------------------------
  describe('auth_signout RPC', () => {
    it('POSTs auth_signout to /api/{appId}/rpc with credentials included', async () => {
      render(<LogoutHandler {...PROPS} />);

      await waitFor(() => {
        expect(globalThis.fetch).toHaveBeenCalledTimes(1);
      });

      const [url, init] = (globalThis.fetch as any).mock.calls[0];
      expect(url).toBe('/api/myapp/rpc');
      expect(init.method).toBe('POST');
      // The session cookie is httpOnly; it only travels if credentials:'include'.
      expect(init.credentials).toBe('include');
      expect(init.headers['Content-Type']).toBe('application/json');
      expect(JSON.parse(init.body)).toEqual({ method: 'auth_signout', params: {} });
    });

    it('renders the inline "Signing out…" spinner while the RPC is in flight', () => {
      // Hold fetch open so we observe the in-flight UI.
      globalThis.fetch = vi.fn(() => new Promise(() => {})) as any;
      const { getByText } = render(<LogoutHandler {...PROPS} />);
      expect(getByText(/Signing out/i)).toBeTruthy();
    });
  });

  // ---------------------------------------------------------------------------
  // exepad:auth:changed detail-shape contract
  // ---------------------------------------------------------------------------
  describe('exepad:auth:changed broadcast', () => {
    it('dispatches exactly { action: \'signout\' } (no stray user key)', async () => {
      const cap = captureAuthEvents();
      try {
        render(<LogoutHandler {...PROPS} />);
        await waitFor(() => expect(cap.details.length).toBe(1));

        const detail = cap.details[0];
        // Deep-equality pins the WHOLE shape: a wrong/extra key (e.g. `user`)
        // would route useRuntimeStore down the auth_me re-fetch branch.
        expect(detail).toEqual({ action: 'signout' });
        expect(detail.action).toBe('signout');
        expect('user' in detail).toBe(false);
      } finally {
        cap.stop();
      }
    });

    it('never emits a DOUBLE auth:changed event under StrictMode', async () => {
      // Under StrictMode the effect mounts → cleanup (cancelled=true) → re-mounts.
      // The `started` ref short-circuits the second mount, and the first mount's
      // in-flight async is `cancelled`-guarded, so the broadcast fires at most
      // once. The security property we pin is "never twice" — a second emit
      // would be harmless here, but a second *RPC* (covered separately) would
      // race. We assert single-fire on the network call and bounded event count.
      const cap = captureAuthEvents();
      try {
        render(
          <React.StrictMode>
            <LogoutHandler {...PROPS} />
          </React.StrictMode>,
        );
        await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
        // Give any pending microtasks/macrotasks a chance to flush a 2nd emit.
        await new Promise((r) => setTimeout(r, 20));
        expect(globalThis.fetch).toHaveBeenCalledTimes(1);
        expect(cap.details.length).toBeLessThanOrEqual(1);
      } finally {
        cap.stop();
      }
    });

    it('the emitted detail satisfies the real consumer\'s signout branch (and NOT the re-fetch branch)', async () => {
      // Replicate useRuntimeStore.ts::onAuthChanged's branch selection to prove
      // the emitted detail clears auth instead of triggering an auth_me re-fetch.
      const cap = captureAuthEvents();
      try {
        render(<LogoutHandler {...PROPS} />);
        await waitFor(() => expect(cap.details.length).toBe(1));
        const detail = cap.details[0];

        const hasUser = detail?.user != null; // normalizeAuthUser(null|undefined) → null
        const isSignout = detail?.action === 'signout';
        const wouldRefetch = !hasUser && !isSignout;

        expect(hasUser).toBe(false);
        expect(isSignout).toBe(true);
        // The stale-cookie hazard: re-fetch must NOT be the selected branch.
        expect(wouldRefetch).toBe(false);
      } finally {
        cap.stop();
      }
    });
  });

  // ---------------------------------------------------------------------------
  // StrictMode once-guard on the RPC
  // ---------------------------------------------------------------------------
  describe('StrictMode once-guard', () => {
    it('POSTs auth_signout exactly once under React.StrictMode', async () => {
      render(
        <React.StrictMode>
          <LogoutHandler {...PROPS} />
        </React.StrictMode>,
      );

      await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
      // started.current guards the effect body; StrictMode's second mount must
      // be a no-op for the network call.
      expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    });
  });

  // ---------------------------------------------------------------------------
  // redirect
  // ---------------------------------------------------------------------------
  describe('redirect after signout', () => {
    it('navigates to basePath + loginPage with replace:true on success', async () => {
      render(<LogoutHandler {...PROPS} />);

      await waitFor(() => expect(mockNavigate).toHaveBeenCalled());
      expect(mockNavigate).toHaveBeenCalledTimes(1);
      // replace:true keeps /logout out of history so Back doesn't re-trigger it.
      expect(mockNavigate).toHaveBeenCalledWith('/a/myapp/login', { replace: true });
    });

    it('still navigates to login when the signout RPC rejects (no infinite spinner)', async () => {
      armFetchReject();
      render(<LogoutHandler {...PROPS} />);

      await waitFor(() => expect(mockNavigate).toHaveBeenCalled());
      expect(mockNavigate).toHaveBeenCalledWith('/a/myapp/login', { replace: true });
    });

    it('still broadcasts signout even when the RPC rejects (clear stale auth)', async () => {
      armFetchReject();
      const cap = captureAuthEvents();
      try {
        render(<LogoutHandler {...PROPS} />);
        await waitFor(() => expect(cap.details.length).toBe(1));
        expect(cap.details[0]).toEqual({ action: 'signout' });
      } finally {
        cap.stop();
      }
    });

    it('composes basePath + loginPage verbatim for a root-hosted app (empty basePath)', async () => {
      render(<LogoutHandler basePath="" apiAppId="rootapp" loginPage="/signin" />);
      await waitFor(() => expect(mockNavigate).toHaveBeenCalled());
      expect(mockNavigate).toHaveBeenCalledWith('/signin', { replace: true });
    });

    it('broadcasts signout BEFORE navigating (store cleared before the auth guard runs)', async () => {
      // Ordering matters: if navigate fired first, the destination's auth guard
      // could read a still-authenticated store. Assert event precedes navigate.
      const order: string[] = [];
      const listener = () => order.push('event');
      window.addEventListener('exepad:auth:changed', listener);
      mockNavigate.mockImplementation(() => {
        order.push('navigate');
      });
      try {
        render(<LogoutHandler {...PROPS} />);
        await waitFor(() => expect(order).toContain('navigate'));
        expect(order).toEqual(['event', 'navigate']);
      } finally {
        window.removeEventListener('exepad:auth:changed', listener);
        mockNavigate.mockReset();
      }
    });
  });
});
