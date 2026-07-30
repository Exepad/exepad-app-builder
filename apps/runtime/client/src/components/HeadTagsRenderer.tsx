/**
 * HeadTagsRenderer — injects external resources into the document <head>.
 * Used by Code Focus designs to load custom stylesheets, scripts, and Tailwind CDN configs.
 *
 * Security model:
 *  - stylesheet: href must be HTTPS and on STYLESHEET_HOST_ALLOWLIST.
 *  - script (src): src must be HTTPS and on SCRIPT_HOST_ALLOWLIST.
 *  - script (inline content): refused. Inline JS bypasses CSP and gives XSS
 *    against the app's subdomain (which shares parent cookie scope).
 *  - style (inline CSS): sanitized via sanitizeCss.
 */

import type { HeadTagProps } from '@/app_runtime/interfaces/apps/webapp';
import { sanitizeCss } from '@/lib/cssSanitizer';

const STYLESHEET_HOST_ALLOWLIST: ReadonlySet<string> = new Set([
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'cdn.exepad.com',
  'cdn.jsdelivr.net',
  'unpkg.com',
]);

// Scripts execute with full authority on the app's own origin (which shares the
// parent cookie scope), so the script allowlist must NOT include multi-tenant
// package CDNs (unpkg.com, cdn.jsdelivr.net) that serve arbitrary attacker-
// published JS — a prompt-injected config could otherwise request execution of
// `https://unpkg.com/<evil-pkg>/payload.js`. Only first-party/pinned hosts are
// trusted here; the same shared-host reasoning already excludes such CDNs from
// the dynamic-import allowlist in urlValidator.ts.
const SCRIPT_HOST_ALLOWLIST: ReadonlySet<string> = new Set([
  'cdn.exepad.com',
  'cdn.tailwindcss.com',
]);

function isHostAllowed(urlStr: string, allowlist: ReadonlySet<string>): boolean {
  try {
    const url = new URL(urlStr, window.location.origin);
    // Same-origin resources are always allowed. In self-host the runtime is
    // served over http://localhost:8080 (or a LAN IP / custom domain), so its
    // own /runtime_assets/*.css would otherwise be blocked by the https check.
    if (typeof window !== 'undefined' && url.origin === window.location.origin) return true;
    if (url.protocol !== 'https:') return false;
    return allowlist.has(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}

const HeadTagsRenderer = ({ headTags }: { headTags?: HeadTagProps[] }) => {
  if (!headTags?.length) return null;

  return (
    <>
      {headTags.map((tag, i) => {
        switch (tag.type) {
          case 'stylesheet':
            if (!tag.src || !isHostAllowed(tag.src, STYLESHEET_HOST_ALLOWLIST)) {
              if (tag.src) {
                console.warn('[HeadTagsRenderer] Blocked stylesheet from disallowed host:', tag.src);
              }
              return null;
            }
            return <link key={`ht-${i}`} rel="stylesheet" href={tag.src} />;

          case 'script':
            if (tag.src) {
              if (!isHostAllowed(tag.src, SCRIPT_HOST_ALLOWLIST)) {
                console.warn('[HeadTagsRenderer] Blocked script from disallowed host:', tag.src);
                return null;
              }
              return <script key={`ht-${i}`} src={tag.src} />;
            }
            if (tag.content) {
              console.warn('[HeadTagsRenderer] Inline <script> content is not allowed');
            }
            return null;

          case 'style':
            return tag.content ? (
              <style
                key={`ht-${i}`}
                dangerouslySetInnerHTML={{ __html: sanitizeCss(tag.content) }}
              />
            ) : null;

          default:
            return null;
        }
      })}
    </>
  );
};

export default HeadTagsRenderer;
