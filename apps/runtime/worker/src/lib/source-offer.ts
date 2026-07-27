/**
 * AGPL-3.0 section 13 source offer, server side — the one place a fork rebrands
 * everything the *worker* serves.
 *
 * Section 13 obliges anyone who modifies Exepad and lets users interact with it
 * over a network to offer *those* users *their* Corresponding Source. That is
 * everyone who touches this server, not just the logged-in operator: the
 * anonymous visitors of apps served at `/a/{appId}/*`, on a published/tunnel
 * URL, on a custom domain, and in a single-app deployable bundle. The studio
 * About page (`/help/about`) lives behind the operator login, so it cannot be
 * the only place the offer appears.
 *
 * Both worker-side surfaces read the values below:
 *   - `GET /source` (worker `index.ts`) — unauthenticated 302 to the repository.
 *   - `<link rel="license">` in every HTML page the meta injector serves.
 *
 * `EXEPAD_SOURCE_URL` is read at RUNTIME (settable with `docker run -e …`, and
 * baked by the Dockerfile's build-arg of the same name). The SPA carries a
 * SECOND copy of the same default, baked at build time from
 * `VITE_EXEPAD_SOURCE_URL` in `client/src/pages/AboutPage.tsx` — the
 * client/worker boundary rules out a shared constant, so a fork hardcoding a
 * new upstream URL edits that file too. The Dockerfile feeds both from one
 * build-arg, so overriding at build/run time needs no code change.
 */

/** Path of the unauthenticated source offer served by the worker. */
export const SOURCE_OFFER_PATH = '/source';

/** This upstream build's repository — the default when nothing overrides it. */
const DEFAULT_SOURCE_URL = 'https://github.com/Exepad/exepad-app-builder';

/**
 * The Corresponding Source URL to offer. Falls back to the upstream repository
 * when unset, and also when the configured value is not an http(s) URL — the
 * value is emitted into an `href`, so a malformed or `javascript:` override must
 * never reach the page.
 */
export function sourceOfferUrl(): string {
  const configured = (process.env.EXEPAD_SOURCE_URL ?? '').trim();
  if (!configured) return DEFAULT_SOURCE_URL;
  try {
    const parsed = new URL(configured);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return configured;
  } catch {
    /* unparseable — fall through to the default */
  }
  return DEFAULT_SOURCE_URL;
}
